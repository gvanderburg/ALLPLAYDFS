import { and, eq, inArray } from "drizzle-orm";
import { db, projectionHistory } from "@workspace/db";
import { findNextSlate } from "../next-slate";
import { MODEL_SPORTS, HISTORY_VERSION, type HistoricalGame, type ModelSport, type SlatePlayer } from "./types";
import { list, normalizeRace, normalizeSummary, numeric, obj, str, type Json } from "./normalize";
import { annualHistoryRanges } from "./date-ranges";

const SITE = "https://site.api.espn.com/apis/site/v2/sports";
const CORE = "https://sports.core.api.espn.com/v2/sports";
let activeRequests = 0;
const pending: Array<() => void> = [];
async function acquire() {
  if (activeRequests >= 6) await new Promise<void>(resolve => pending.push(resolve));
  else activeRequests++;
}
function release() {
  const waiting = pending.shift();
  if (waiting) waiting();
  else activeRequests--;
}
export async function fetchSportsJson(url: string): Promise<unknown> {
  await acquire();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Historical data provider returned HTTP ${response.status}`);
    return await response.json();
  } finally { release(); }
}
export interface ModelSlate { date: string; events: Json[]; phase: number; venue: string; }
export async function resolveModelSlate(sport: ModelSport, requestedDate: string): Promise<ModelSlate> {
  const base = `${SITE}/${MODEL_SPORTS[sport].path}`;
  let date = requestedDate;
  let payload = obj(await fetchSportsJson(`${base}/scoreboard?dates=${date.replaceAll("-", "")}&limit=200`));
  const today = new Date().toISOString().slice(0, 10);
  const initial = list(payload.events).map(obj);
  if (!initial.length || (requestedDate === today && initial.every(e => obj(obj(e.status).type).completed === true))) {
    const next = await findNextSlate(base, requestedDate, payload, fetchSportsJson);
    if (next) { date = next.date; payload = obj(next.scoreboard); }
  }
  const events = list(payload.events).map(obj);
  return {
    date, events, phase: numeric(obj(events[0]?.season).type) ?? 0,
    venue: sport === "nascar" ? str(events[0]?.name) : "",
  };
}

function storedHistory(value: unknown): value is HistoricalGame {
  const record = obj(value);
  return record.version === HISTORY_VERSION && typeof record.id === "string" &&
    typeof record.date === "string" && Number.isFinite(Date.parse(record.date)) &&
    Array.isArray(record.teams) && Array.isArray(record.players);
}

export async function loadHistory(
  sport: ModelSport, cutoff: string, progress: (completed: number, total: number, failed: number) => void,
): Promise<{ games: HistoricalGame[]; failed: number; truncated: boolean }> {
  const config = MODEL_SPORTS[sport];
  const before = new Date(cutoff), after = new Date(before.getTime() - config.historyDays * 86400000);
  const lastDay = new Date(before.getTime() - 86400000).toISOString().slice(0, 10).replaceAll("-", "");
  const startDay = after.toISOString().slice(0, 10).replaceAll("-", "");
  if (sport === "nascar") {
    // A multi-year racing query is HTTP 400, even though individual annual ranges work.
    const pages = await Promise.all(annualHistoryRanges(after, before).map(async range =>
      obj(await fetchSportsJson(`${SITE}/${config.path}/scoreboard?dates=${range}&limit=200`))));
    const games = [...new Map(pages.flatMap(page => list(page.events)).map(normalizeRace)
      .filter((game): game is HistoricalGame => !!game).map(game => [game.id, game])).values()]
      .filter(game => Date.parse(game.date) < before.getTime());
    progress(games.length, games.length, 0);
    return { games, failed: 0, truncated: pages.some(page => list(page.events).length >= 200) };
  }
  // The site scoreboard rejects multi-day ranges for team sports; core events
  // accepts them. Parse numeric IDs from its references, never follow arbitrary URLs.
  const corePath = config.path.replace("/", "/leagues/");
  const result = obj(await fetchSportsJson(`${CORE}/${corePath}/events?dates=${startDay}-${lastDay}&limit=1000`));
  const ids = [...new Set(list(result.items).flatMap(item => {
    const match = str(obj(item).$ref).match(/\/events\/(\d+)(?:\?|$)/);
    return match ? [match[1]] : [];
  }))].slice(0, 650);
  const truncated = (numeric(result.count) ?? ids.length) > ids.length;
  if (!ids.length) { progress(0, 0, 0); return { games: [], failed: 0, truncated }; }
  const saved = await db.select().from(projectionHistory).where(and(eq(projectionHistory.sport, sport), inArray(projectionHistory.eventId, ids)));
  const cached = new Map(saved.filter(row =>
    storedHistory(row.data) && row.fetchedAt.getTime() > Date.now() - 86400000,
  ).map(row => [row.eventId, row.data as HistoricalGame]));
  const games: HistoricalGame[] = [];
  let completed = 0, failed = 0, next = 0;
  const deadline = Date.now() + 150_000;
  progress(0, ids.length, 0);
  await Promise.all(Array.from({ length: Math.min(6, ids.length) }, async () => {
    while (next < ids.length && Date.now() < deadline) {
      const id = ids[next++];
      try {
        let game = cached.get(id);
        if (!game) {
          const payload = await fetchSportsJson(`${SITE}/${config.path}/summary?event=${id}`);
          game = normalizeSummary(payload, sport) ?? undefined;
          if (game) {
            const fetchedAt = new Date();
            await db.insert(projectionHistory).values({
              sport, eventId: id, occurredAt: new Date(game.date), data: game, fetchedAt,
            }).onConflictDoUpdate({
              target: [projectionHistory.sport, projectionHistory.eventId],
              set: { data: game, fetchedAt, occurredAt: new Date(game.date) },
            });
          } else failed++;
        }
        if (game && Date.parse(game.date) < before.getTime()) games.push(game);
      } catch { failed++; }
      completed++;
      progress(completed, ids.length, failed);
    }
  }));
  const skipped = ids.length - completed;
  if (skipped) { failed += skipped; progress(completed, ids.length, failed); }
  return { games, failed, truncated: truncated || skipped > 0 };
}

function rosterAthletes(payload: unknown): Json[] {
  return list(obj(payload).athletes).flatMap(value => {
    const group = obj(value);
    return Array.isArray(group.items) ? group.items.map(obj) : [group];
  });
}
export async function slateCandidates(
  sport: ModelSport, slate: ModelSlate, history: HistoricalGame[],
): Promise<{ players: SlatePlayer[]; notes: string[] }> {
  const players: SlatePlayer[] = [], notes: string[] = [];
  if (sport === "nascar") {
    const entrants = list(obj(list(slate.events[0]?.competitions)[0]).competitors);
    const confirmed = entrants.length > 0;
    const latest = [...history].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 2);
    const pool = confirmed ? entrants.map(value => {
      const c = obj(value), a = obj(c.athlete);
      return { id: str(c.id || a.id), name: str(a.displayName || a.fullName) };
    }) : [...new Map(latest.flatMap(game => game.players.map(p => [p.id, { id: p.id, name: p.name }] as const))).values()];
    for (const driver of pool) if (driver.id) players.push({
      ...driver, team: "Driver pool", teamId: "field", opponent: slate.venue, opponentId: "",
      position: "Driver", availability: "Driver availability not verified",
      participation: confirmed ? "Published entrant; start not guaranteed" : "Conditional pool: upcoming entry list not published",
    });
    if (!confirmed) notes.push("NASCAR's upcoming entry list is not published. These are conditional estimates for drivers from the last two completed races, not confirmed starters.");
    notes.push("NASCAR forecasts finishing position only. Laps led, fastest laps, qualifying position and place differential are not available from this source and are not invented.");
    return { players, notes };
  }
  const matchups = new Map<string, { team: string; opponentId: string; opponent: string; probable: string }>();
  for (const event of slate.events) {
    const competitors = list(obj(list(event.competitions)[0]).competitors).map(obj);
    for (const competitor of competitors) {
      const team = obj(competitor.team), opponent = competitors.find(c => str(c.id) !== str(competitor.id));
      const opponentTeam = obj(opponent?.team);
      matchups.set(str(competitor.id || team.id), {
        team: str(team.abbreviation || team.displayName), opponentId: str(opponent?.id),
        opponent: str(opponentTeam.abbreviation || opponentTeam.displayName),
        probable: str(obj(obj(list(competitor.probables)[0]).athlete).id),
      });
    }
  }
  await Promise.all([...matchups].map(async ([teamId, matchup]) => {
    let roster: Json[] = [], verified = true;
    try { roster = rosterAthletes(await fetchSportsJson(`${SITE}/${MODEL_SPORTS[sport].path}/teams/${teamId}/roster`)); }
    catch { verified = false; }
    if (!roster.length) {
      verified = false;
      const past = [...history].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
        .filter(game => game.teams.some(t => t.id === teamId)).slice(0, 2);
      roster = [...new Map(past.flatMap(game => game.players.filter(p => p.teamId === teamId)
        .map(p => [p.id, { id: p.id, displayName: p.name, position: { abbreviation: p.position } }] as const))).values()];
      notes.push(`${matchup.team}: current roster unavailable; the recent player pool is conditional and may omit new players.`);
    }
    for (const athlete of roster) {
      const position = str(obj(athlete.position).abbreviation), id = str(athlete.id);
      if (!id || ((sport === "nfl" || sport === "cfb") && position && !["QB", "RB", "FB", "WR", "TE", "K"].includes(position))) continue;
      const injury = obj(list(athlete.injuries)[0]);
      players.push({
        id, name: str(athlete.displayName || athlete.fullName), teamId, team: matchup.team,
        opponentId: matchup.opponentId, opponent: matchup.opponent, position,
        availability: str(injury.status) || "Injury status not verified",
        participation: matchup.probable === id ? "Published probable pitcher; start not guaranteed" :
          verified ? "On current roster; participation/starting role unconfirmed" : "Recent player pool; current roster unverified",
      });
    }
  }));
  return { players: [...new Map(players.map(player => [`${player.id}:${player.teamId}`, player])).values()], notes };
}
