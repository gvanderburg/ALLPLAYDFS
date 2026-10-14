import { and, eq, inArray } from "drizzle-orm";
import { db, nascarQualifyingGrids, projectionHistory } from "@workspace/db";
import { findNextSlate } from "../next-slate";
import { MODEL_SPORTS, HISTORY_VERSION, type HistoricalGame, type ModelSport, type SlatePlayer } from "./types";
import { list, normalizeRace, normalizeSummary, numeric, obj, str, type Json } from "./normalize";
import { annualHistoryRanges } from "./date-ranges";
import { completedScheduleIds } from "./schedule-history";
import { baseballBoxFor } from "./baseball-scoring";
import { loadTeamRoles } from "./playing-roles";
import { unstartedModelEvents } from "./history-cutoff";
import { matchCupRace, reconcileCupHistory, weekendRace, cupGrid, nascarName, scheduledCupLaps } from "./nascar-sources";
export { unstartedModelEvents } from "./history-cutoff";

const SITE = "https://site.api.espn.com/apis/site/v2/sports";
const CORE = "https://sports.core.api.espn.com/v2/sports";
const NASCAR = "https://cf.nascar.com/cacher";
const cupSchedules = new Map<number, { expires: number; promise: Promise<unknown> }>();
export async function cupSchedule(season: number) {
  if (!Number.isInteger(season) || season < 2000 || season > 2100) throw new Error("Invalid NASCAR season");
  const cached = cupSchedules.get(season);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const entry = { expires: Date.now() + 300_000, promise: fetchSportsJson(`${NASCAR}/${season}/race_list_basic.json`) };
  cupSchedules.set(season, entry);
  try { return await entry.promise; } catch (err) { cupSchedules.delete(season); throw err; }
}
export async function loadCompletedCupEvent(event: Json): Promise<HistoricalGame | null> {
  if (!normalizeRace(event)) return null;
  const season = Number(obj(event.season).year);
  const race = matchCupRace(event, await cupSchedule(season));
  if (!race) return null;
  const payload = await fetchSportsJson(`${NASCAR}/${season}/1/${race.race_id}/weekend-feed.json`);
  return reconcileCupHistory(event, race, payload);
}
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
  // A US slate day may be yesterday in UTC but still contain unstarted evening games.
  const forward = requestedDate >= today || unstartedModelEvents(initial).length > 0;
  if (!initial.length || (forward && !unstartedModelEvents(initial).length)) {
    const next = await findNextSlate(base, requestedDate, payload, fetchSportsJson);
    if (next) { date = next.date; payload = obj(next.scoreboard); }
  }
  const discovered = list(payload.events).map(obj);
  const events = forward || date >= today ? unstartedModelEvents(discovered) : discovered;
  return {
    date, events, phase: numeric(obj(events[0]?.season).type) ?? 0,
    venue: sport === "nascar" ? str(events[0]?.name) : "",
  };
}

function storedHistory(value: unknown): value is HistoricalGame {
  const record = obj(value);
  return record.version === HISTORY_VERSION && typeof record.id === "string" &&
    typeof record.date === "string" && Number.isFinite(Date.parse(record.date)) &&
    typeof record.finalObservedAt === "string" && Number.isFinite(Date.parse(record.finalObservedAt)) &&
    Array.isArray(record.teams) && Array.isArray(record.players);
}

/** Only normalized observed final results; never reads a provider forecast. */
export async function loadCompletedEvent(sport: ModelSport, id: string): Promise<HistoricalGame | null> {
  if (!/^\d+$/.test(id)) throw new Error("Invalid provider event ID.");
  if (sport === "nascar") {
    const page = obj(await fetchSportsJson(`${SITE}/${MODEL_SPORTS.nascar.path}/scoreboard?dates=${id.slice(0, 8)}&limit=200`));
    const event = list(page.events).map(obj).find(e => str(e.id) === id);
    return event ? loadCompletedCupEvent(event) : null;
  }
  const config = MODEL_SPORTS[sport];
  const corePath = config.path.replace("/", "/leagues/");
  const payload = obj(await fetchSportsJson(`${SITE}/${config.path}/summary?event=${id}`));
  if (sport === "nfl" || sport === "cfb") {
    try { payload.allplayFootballPlays = await fetchSportsJson(`${CORE}/${corePath}/events/${id}/competitions/${id}/plays?limit=1000`); }
    catch { /* Missing categories stay missing. */ }
  }
  if (sport === "mlb") {
    try { payload.allplayBaseballBox = await baseballBoxFor(payload, fetchSportsJson); }
    catch { /* Missing categories stay missing. */ }
  }
  const game = normalizeSummary(payload, sport);
  if (game) game.recordedAt = new Date().toISOString();
  return game;
}
export async function loadHistory(
  sport: ModelSport, cutoff: string, progress: (completed: number, total: number, failed: number) => void,
  context?: { teams: string[]; phase: number; season: number },
): Promise<{ games: HistoricalGame[]; failed: number; truncated: boolean; scheduleFailures?: number }> {
  const config = MODEL_SPORTS[sport];
  const before = new Date(cutoff), after = new Date(before.getTime() - config.historyDays * 86400000);
  const lastDay = new Date(before.getTime() - 1).toISOString().slice(0, 10).replaceAll("-", "");
  const startDay = after.toISOString().slice(0, 10).replaceAll("-", "");
  if (sport === "nascar") {
    // A multi-year racing query is HTTP 400, even though individual annual ranges work.
    const pages = await Promise.all(annualHistoryRanges(after, before).map(async range =>
      obj(await fetchSportsJson(`${SITE}/${config.path}/scoreboard?dates=${range}&limit=200`))));
    const events = [...new Map(pages.flatMap(page => list(page.events)).map(obj)
      .filter(event => !!normalizeRace(event) && Date.parse(str(event.date)) < before.getTime())
      .map(event => [str(event.id), event])).values()];
    const games: HistoricalGame[] = [];
    let done = 0, failed = 0, next = 0;
    progress(0, events.length, 0);
    await Promise.all(Array.from({ length: Math.min(6, events.length) }, async () => {
      while (next < events.length) {
        const event = events[next++];
        try {
          const game = await loadCompletedCupEvent(event);
          if (game) games.push(game); else failed++;
        } catch { failed++; }
        progress(++done, events.length, failed);
      }
    }));
    return { games, failed, truncated: pages.some(page => list(page.events).length >= 200) };
  }
  // The site scoreboard rejects multi-day ranges for team sports; core events
  // accepts them. Parse numeric IDs from its references, never follow arbitrary URLs.
  const corePath = config.path.replace("/", "/leagues/");
  const result = obj(await fetchSportsJson(`${CORE}/${corePath}/events?dates=${startDay}-${lastDay}&limit=1000`));
  // Prioritize the upcoming teams' last ten same-phase games, including the
  // previous season when the recent calendar window contains too few games.
  // This avoids an empty season-opener forecast and arbitrary old league rows.
  let scheduleFailures = 0;
  const scheduled = context ? await Promise.all(context.teams.map(async team => {
    const selected: string[] = [];
    for (const season of [context.season, context.season - 1]) {
      if (!Number.isInteger(season) || season < 2000 || selected.length >= 10) break;
      try {
        const payload = await fetchSportsJson(`${SITE}/${config.path}/teams/${team}/schedule?season=${season}&seasontype=${context.phase}`);
        selected.push(...completedScheduleIds(payload, cutoff, context.phase, 10 - selected.length));
      } catch { scheduleFailures++; }
    }
    return selected;
  })) : [];
  const discovered = [...new Set([...scheduled.flat(), ...list(result.items).flatMap(item => {
    const match = str(obj(item).$ref).match(/\/events\/(\d+)(?:\?|$)/);
    return match ? [match[1]] : [];
  })])];
  const ids = discovered.slice(0, 650);
  const truncated = discovered.length > 650 || (numeric(result.count) ?? ids.length) > ids.length;
  if (!ids.length) { progress(0, 0, 0); return { games: [], failed: 0, truncated, scheduleFailures }; }
  const saved = await db.select().from(projectionHistory).where(and(eq(projectionHistory.sport, sport), inArray(projectionHistory.eventId, ids)));
  const cached = new Map(saved.filter(row =>
    storedHistory(row.data) && row.fetchedAt.getTime() > Date.now() - 86400000,
  ).map(row => [row.eventId, { ...row.data as HistoricalGame, recordedAt: row.fetchedAt.toISOString() }]));
  const games: HistoricalGame[] = [];
  let completed = 0, failed = 0, next = 0;
  const deadline = Date.now() + 150_000;
  progress(0, ids.length, 0);
  await Promise.all(Array.from({ length: Math.min(6, ids.length) }, async () => {
    while (next < ids.length && Date.now() < deadline) {
      const id = ids[next++];
      try {
        let game: HistoricalGame | undefined = cached.get(id);
        if (!game) {
          game = await loadCompletedEvent(sport, id) ?? undefined;
          if (game) {
            const fetchedAt = new Date();
            game.recordedAt = fetchedAt.toISOString();
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
  return { games, failed, truncated: truncated || skipped > 0, scheduleFailures };
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
    let scheduledLaps: number | null = null, sourceUrl: string | null = null;
    let grid = new Map<string, number>();
    let qualifyingGrid = new Map<string, number>();
    try {
      const event = slate.events[0], season = Number(obj(event?.season).year);
      const race = event ? matchCupRace(event, await cupSchedule(season)) : null;
      if (race) {
        scheduledLaps = scheduledCupLaps(race);
        sourceUrl = `${NASCAR}/${season}/1/${race.race_id}/weekend-feed.json`;
        // Past slates use the already reconciled historical result rather than today's pre-race feed.
        if (Date.parse(str(event.date)) > Date.now()) {
          const raceKey = `${season}:${race.race_id}`;
          let captured: typeof nascarQualifyingGrids.$inferSelect | undefined;
          try {
            [captured] = await db.select().from(nascarQualifyingGrids).where(eq(nascarQualifyingGrids.id, raceKey)).limit(1);
          } catch {
            notes.push("Saved NASCAR pre-race grid is not available; checking the current official weekend feed.");
          }
          if (captured) {
            grid = new Map(captured.startingOrder.map(entry => [nascarName(entry.driverName), entry.position]));
            qualifyingGrid = new Map(captured.qualifyingOrder.map(entry => [nascarName(entry.driverName), entry.position]));
          } else {
            const weekend = weekendRace(race, await fetchSportsJson(sourceUrl));
            if (weekend && !(numeric(race.winner_driver_id) ?? 0)) {
              grid = cupGrid(weekend);
              qualifyingGrid = cupGrid(weekend, "qualifying_position");
            }
          }
        }
      }
    } catch { notes.push("Official upcoming race/grid lookup failed; unsupported race inputs remain unavailable."); }
    for (const driver of pool) if (driver.id) players.push({
      ...driver, team: "Driver pool", teamId: "field", opponent: slate.venue, opponentId: "",
      position: "Driver", availability: "Driver availability not verified",
      participation: `${confirmed ? "Published entrant; start not guaranteed" : "Conditional pool: upcoming entry list not published"}. ${grid.has(nascarName(driver.name)) ? `Observed official starting position: ${grid.get(nascarName(driver.name))}.` : "Official starting position not posted; ALLPLAY historical grid forecast only."} ${qualifyingGrid.has(nascarName(driver.name)) ? `Official qualifying position: ${qualifyingGrid.get(nascarName(driver.name))}.` : "Official qualifying position not posted."}`,
      raceContext: { scheduledLaps, fieldSize: qualifyingGrid.size || grid.size || pool.length, observedStart: grid.get(nascarName(driver.name)) ?? null,
        observedQualifyingStart: qualifyingGrid.get(nascarName(driver.name)) ?? null, sourceUrl },
      roleContext: { status: confirmed ? "entrant" : "unknown", label: confirmed ? "Published entrant" : "Entry unverified",
        eligible: confirmed && (!grid.size || grid.has(nascarName(driver.name))), depthRank: null, source: "ESPN race entry list / official NASCAR grid", sourceUrl: sourceUrl ?? `https://www.espn.com/racing/race/_/id/${str(slate.events[0]?.id)}`,
        asOf: new Date(), recentWorkload: null, workloadUnit: null, recentAppearances: 0, teamGames: 0,
        note: grid.size && !grid.has(nascarName(driver.name)) ? "Driver is absent from the published official grid; no supported starting workload." :
          "NASCAR uses race-entry eligibility, not a team depth chart; entry is not a guarantee of starting." },
    });
    if (!confirmed) notes.push("NASCAR's upcoming entry list is not published. These are conditional estimates for drivers from the last two completed races, not confirmed starters.");
    notes.push("NASCAR uses inspected official Cup results reconciled to ESPN completed date, full final order and unique driver names. Historical lap rates scale to upcoming scheduled laps (not prefilled actual_laps). Starting positions use a published official grid where available, otherwise explicitly labeled ALLPLAY forecasts. Fastest-lap counts are absent from the weekend feed and remain unavailable.");
    if (!scheduledLaps) notes.push("Upcoming scheduled race length is unverified; lap forecasts and full fantasy totals remain unavailable.");
    return { players, notes };
  }
  const matchups = new Map<string, { team: string; teamName: string; opponentName: string; opponentId: string; opponent: string; probable: string; startTime: string; season: number }>();
  for (const event of slate.events) {
    const competitors = list(obj(list(event.competitions)[0]).competitors).map(obj);
    for (const competitor of competitors) {
      const team = obj(competitor.team), opponent = competitors.find(c => str(c.id) !== str(competitor.id));
      const opponentTeam = obj(opponent?.team);
      matchups.set(str(competitor.id || team.id), {
        team: str(team.abbreviation || team.displayName), opponentId: str(opponent?.id),
        teamName: str(team.displayName), opponentName: str(opponentTeam.displayName), startTime: str(event.date),
        season: Number(obj(event.season).year),
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
    const teamPlayers: SlatePlayer[] = [];
    for (const athlete of roster) {
      const position = str(obj(athlete.position).abbreviation), id = str(athlete.id);
      if (!id || ((sport === "nfl" || sport === "cfb") && position && !["QB", "RB", "FB", "WR", "TE", "K"].includes(position))) continue;
      const injury = obj(list(athlete.injuries)[0]);
      teamPlayers.push({
        id, name: str(athlete.displayName || athlete.fullName), teamId, team: matchup.team,
        opponentId: matchup.opponentId, opponent: matchup.opponent, position,
        availability: str(injury.status) || "Injury status not verified",
        participation: matchup.probable === id ? "Published probable pitcher; start not guaranteed" :
          verified ? "On current roster; participation/starting role unconfirmed" : "Recent player pool; current roster unverified",
      });
    }
    const roles = await loadTeamRoles({ sport, teamId, teamName: matchup.teamName, opponentName: matchup.opponentName,
      date: slate.date, season: matchup.season, startTime: matchup.startTime, probable: matchup.probable, players: teamPlayers, history });
    players.push(...roles.players);
    notes.push(roles.note);
  }));
  return { players: [...new Map(players.map(player => [`${player.id}:${player.teamId}`, player])).values()], notes };
}
