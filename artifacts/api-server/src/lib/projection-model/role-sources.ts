import { list, obj, str } from "./normalize";
import type { ModelSport } from "./types";

export const nameKey = (name: string) => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const cache = new Map<string, { until: number; promise: Promise<unknown> }>();
let active = 0;
const waiting: Array<() => void> = [];
export async function rolePage(url: string, html = false): Promise<unknown> {
  const cached = cache.get(url);
  if (cached && cached.until > Date.now()) return cached.promise;
  const entry = { until: Date.now() + 60_000, promise: Promise.resolve(null) as Promise<unknown> };
  entry.promise = (async () => {
    if (active >= 3) await new Promise<void>(resolve => waiting.push(resolve)); else active++;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { Accept: html ? "text/html" : "application/json" } });
      if (!response.ok) throw new Error(`Role source HTTP ${response.status}`);
      const text = await response.text();
      if (text.length > 2_000_000) throw new Error("Role source exceeded size limit");
      return html ? nextPage(text) : JSON.parse(text);
    } catch { entry.until = Date.now() + 30_000; return null; }
    finally { const next = waiting.shift(); if (next) next(); else active--; }
  })();
  cache.set(url, entry);
  if (cache.size > 256) cache.delete(cache.keys().next().value!);
  return entry.promise;
}
export function nextPage(html: string) {
  const raw = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  try { return raw ? obj(obj(JSON.parse(raw).props).pageProps) : null; } catch { return null; }
}
export interface DepthEntry { rank: number; unit: string; starterName: string; }
export function parseDepth(payload: unknown, sport: ModelSport, season: number, teamId?: string) {
  const data = obj(payload), entries = new Map<string, DepthEntry>();
  const timestamp = Date.parse(str(data.timestamp));
  if (Number(obj(data.season).year) !== season || teamId && str(obj(data.team).id)!==teamId ||
    Number.isFinite(timestamp) && (timestamp>Date.now()+60_000 || Date.now()-timestamp>2*86400000)) return entries;
  for (const chart of list(data.depthchart)) {
    // Returners / holders must not promote a backup offensive QB/WR to a starting role.
    if ((sport === "nfl"||sport==="cfb") && /defen|base.*d/i.test(str(obj(chart).name))) continue;
    for (const [slot, value] of Object.entries(obj(obj(chart).positions))) {
      if (/special/i.test(str(obj(chart).name)) && !/^(pk|k)$/i.test(slot)) continue;
      if ((sport === "nfl" || sport === "cfb") && !/^(qb|rb\d?|fb|hb|te\d?|wr\d?|lwr|rwr|swr|slot|pk|k)$/i.test(slot)) continue;
      const athletes = list(obj(value).athletes).map(obj), starterName = str(athletes[0]?.displayName);
      athletes.forEach((a, i) => {
        const id = str(a.id), prior = entries.get(id);
        if (id && (!prior || i + 1 < prior.rank)) entries.set(id, { rank: i + 1, unit: slot.toUpperCase(), starterName });
      });
    }
  }
  return entries;
}
export function hockeyLines(payload: unknown, teamName: string, now = Date.now()) {
  const data = obj(obj(payload).combinations), updated = Date.parse(str(data.updatedAt));
  const lines = new Map<string, { label: string; rank: number | null; scratched: boolean }>();
  if (nameKey(str(data.teamName)) !== nameKey(teamName) || !Number.isFinite(updated) || updated > now + 60_000 || now - updated > 7 * 86400000) return { lines, asOf: null };
  for (const raw of list(data.players)) {
    const p = obj(raw), key = nameKey(str(p.name)), group = str(p.groupIdentifier), category = str(p.categoryIdentifier);
    if (!key || category !== "ev" || !/^[fd][1-4]$/.test(group)) continue;
    const rank = Number(group.slice(1));
    const pp = list(data.players).map(obj).find(other => nameKey(str(other.name)) === key && str(other.categoryIdentifier) === "pp");
    lines.set(key, { label: `${group[0] === "f" ? "Line" : "Pair"} ${rank}${pp ? ` · ${str(pp.groupIdentifier).toUpperCase()}` : ""}`, rank, scratched: false });
  }
  // A player listed on an active line and IR has conflicting source evidence: do not choose silently.
  for (const raw of list(data.players)) {
    const p = obj(raw), key = nameKey(str(p.name));
    if (key && str(p.categoryIdentifier) === "oi") lines.set(key, { label: "Scratch / unavailable", rank: null, scratched: true });
  }
  return { lines, asOf: new Date(updated) };
}
export function hockeyStarter(payload: unknown, date: string, team: string, opponent: string, startTime?: string) {
  const page = obj(payload);
  if (str(page.date).slice(0, 10) !== date) return null;
  for (const row of list(page.data).map(obj)) for (const side of ["home", "away"]) {
    const other = side === "home" ? "away" : "home";
    if (str(row.date) !== date || nameKey(str(row[`${side}TeamName`])) !== nameKey(team) ||
      nameKey(str(row[`${other}TeamName`])) !== nameKey(opponent)) continue;
    const strength = str(row[`${side}NewsStrengthName`]);
    const asOf = Date.parse(str(row[`${side}NewsCreatedAt`]));
    const gameTime = Date.parse(str(row.dateGmt));
    if (!str(row[`${side}GoalieName`]) || !["Confirmed", "Likely"].includes(strength) || !Number.isFinite(asOf) ||
      startTime && Math.abs(Date.parse(startTime)-gameTime)>10*60_000 ||
      !Number.isFinite(gameTime) || asOf > gameTime || asOf > Date.now() + 60_000 || gameTime - asOf > 3 * 86400000) return null;
    return { name: str(row[`${side}GoalieName`]), confirmed: strength === "Confirmed", asOf: new Date(asOf) };
  }
  return null;
}
export async function baseballLineup(date: string, team: string, opponent: string, startTime: string) {
  const schedule = obj(await rolePage(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=probablePitcher,team`));
  const games = list(schedule.dates).flatMap(day => list(obj(day).games)).map(obj);
  const candidates = games.flatMap(game => ["home", "away"].flatMap(side => {
    const teams = obj(game.teams), mine = obj(teams[side]), other = obj(teams[side === "home" ? "away" : "home"]);
    return str(game.officialDate) === date && nameKey(str(obj(mine.team).name)) === nameKey(team) &&
      nameKey(str(obj(other.team).name)) === nameKey(opponent) &&
      Math.abs(Date.parse(str(game.gameDate)) - Date.parse(startTime)) <= 10 * 60_000 ? [{ game, side, mine }] : [];
  }));
  if (candidates.length !== 1) return null; // Never mix doubleheader lineups.
  const { game, side, mine } = candidates[0];
  const box = obj(obj(obj(await rolePage(`https://statsapi.mlb.com/api/v1/game/${game.gamePk}/boxscore`)).teams)[side]);
  const players = obj(box.players), batting = list(box.battingOrder);
  const names = batting.map(id => nameKey(str(obj(obj(players[`ID${id}`]).person).fullName))).filter(Boolean);
  return { names, pitcher: nameKey(str(obj(mine.probablePitcher).fullName)), url: `https://www.mlb.com/gameday/${game.gamePk}` };
}
