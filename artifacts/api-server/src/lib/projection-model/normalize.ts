import { HISTORY_VERSION, type HistoricalGame, type HistoricalPlayer, type ModelSport, type StatValues } from "./types";

export type Json = Record<string, unknown>;
export const obj = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
export const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const str = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value) : "";
export function numeric(value: unknown): number | null {
  const raw = str(value).trim().replaceAll(",", "");
  if (!raw || !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
export function duration(value: unknown): number | null {
  const raw = str(value);
  if (/^\d+:\d{2}$/.test(raw)) {
    const [minutes, seconds] = raw.split(":").map(Number);
    return seconds < 60 ? minutes + seconds / 60 : null;
  }
  return numeric(value);
}
export function innings(value: unknown): number | null {
  const raw = str(value);
  if (!/^\d+(?:\.[012])?$/.test(raw)) return null;
  const [whole, outs = "0"] = raw.split(".");
  return Number(whole) + Number(outs) / 3;
}
const football: Record<string, Record<string, string>> = {
  passing: { passingYards: "passingYards", passingTouchdowns: "passingTDs", interceptions: "interceptionsThrown" },
  rushing: { rushingAttempts: "rushingAttempts", rushingYards: "rushingYards", rushingTouchdowns: "rushingTDs" },
  receiving: { receptions: "receptions", receivingYards: "receivingYards", receivingTouchdowns: "receivingTDs", receivingTargets: "targets" },
};
const basketball = { points: "points", rebounds: "rebounds", assists: "assists", steals: "steals", blocks: "blocks", turnovers: "turnovers" };
const skater = { goals: "goals", assists: "assists", shotsTotal: "shots", shotsMissed: "missedShots", blockedShots: "blockedShots", plusMinus: "plusMinus", shootoutGoals: "shootoutGoals" };
const goalie = { shotsAgainst: "shotsAgainst", goalsAgainst: "goalsAgainst", saves: "saves" };
const batting = { atBats: "atBats", hits: "hits", runs: "runs", RBIs: "rbi", homeRuns: "homeRuns", walks: "walks", strikeouts: "battingStrikeouts" };
const pitching = { hits: "hitsAllowed", earnedRuns: "earnedRuns", walks: "walksAllowed", strikeouts: "pitcherStrikeouts" };

function readStats(sport: ModelSport, category: string, values: Record<string, unknown>): StatValues {
  const stats: StatValues = {};
  const set = (key: string, value: number | null) => { if (value !== null) stats[key] = value; };
  let mapping: Record<string, string> = {};
  if (sport === "nfl" || sport === "cfb") {
    mapping = football[category] ?? {};
    if (category === "passing") {
      const parts = str(values["completions/passingAttempts"]).split("/");
      set("passingCompletions", numeric(parts[0]));
      set("passingAttempts", numeric(parts[1]));
    } else if (category === "kicking") {
      set("fieldGoalsMade", numeric(str(values["fieldGoalsMade/fieldGoalAttempts"]).split("/")[0]));
      set("extraPointsMade", numeric(str(values["extraPointsMade/extraPointAttempts"]).split("/")[0]));
    }
  } else if (sport === "nba" || sport === "wnba") {
    mapping = basketball;
    set("minutes", duration(values.minutes));
    set("threePointers", numeric(str(values["threePointFieldGoalsMade-threePointFieldGoalsAttempted"]).split("-")[0]));
  } else if (sport === "nhl") {
    mapping = category === "goalies" ? goalie : skater;
    set("timeOnIce", duration(values.timeOnIce));
  } else if (sport === "mlb") {
    mapping = category === "pitching" ? pitching : batting;
    if (category === "pitching") set("inningsPitched", innings(values["fullInnings.partInnings"]));
  }
  for (const [source, key] of Object.entries(mapping)) set(key, numeric(values[source]));
  return stats;
}

export function normalizeSummary(payload: unknown, sport: ModelSport): HistoricalGame | null {
  const data = obj(payload), header = obj(data.header), competition = obj(list(header.competitions)[0]);
  if (obj(obj(competition.status).type).completed !== true) return null;
  const id = str(header.id || competition.id), date = str(competition.date || header.date);
  if (!id || !Number.isFinite(Date.parse(date))) return null;
  const teams = list(competition.competitors).map((c) => {
    const team = obj(obj(c).team);
    return { id: str(team.id || obj(c).id), name: str(team.displayName), abbreviation: str(team.abbreviation) };
  }).filter(t => t.id);
  const players = new Map<string, HistoricalPlayer>();
  for (const teamGroup of list(obj(data.boxscore).players)) {
    const team = obj(obj(teamGroup).team);
    for (const groupValue of list(obj(teamGroup).statistics)) {
      const group = obj(groupValue), category = str(group.name || group.type);
      const keys = list(group.keys).map(str);
      for (const entryValue of list(group.athletes)) {
        const entry = obj(entryValue), athlete = obj(entry.athlete), athleteId = str(athlete.id);
        const raw = Object.fromEntries(keys.map((key, i) => [key, list(entry.stats)[i]]));
        const stats = readStats(sport, category, raw);
        if (!athleteId || !Object.keys(stats).length || (stats.minutes !== undefined && stats.minutes <= 0) ||
            (stats.timeOnIce !== undefined && stats.timeOnIce <= 0)) continue;
        const existing = players.get(athleteId);
        const position = str(obj(athlete.position).abbreviation) ||
          (category === "passing" ? "QB" : category === "kicking" ? "K" : category === "pitching" ? "P" : "");
        players.set(athleteId, {
          id: athleteId, name: str(athlete.displayName || athlete.fullName), teamId: str(team.id),
          position: existing?.position || position, stats: { ...existing?.stats, ...stats },
        });
      }
    }
  }
  if (teams.length !== 2 || !players.size) return null;
  if (sport === "nhl") enrichHockey(data, competition, players);
  return {
    version: HISTORY_VERSION, id, date, teams, players: [...players.values()],
    phase: Number(obj(header.season).type ?? 0), season: Number(obj(header.season).year ?? 0),
    venue: str(obj(obj(data.gameInfo).venue).fullName),
  };
}

// Derive supplemental HISTORY only when the full play log reconciles to the box.
// Never turn a missing/incomplete play log into observed zeros.
function enrichHockey(data: Json, competition: Json, players: Map<string, HistoricalPlayer>) {
  const skaters = [...players.values()].filter(p => p.stats.goals !== undefined);
  const plays = list(data.plays).map(obj).filter(p => Number(obj(p.period).number) < 5);
  const goals = plays.filter(p => str(obj(p.type).text) === "Goal");
  const totals = new Map<string, { goals: number; assists: number; shots: number; attempts: number; misses: number; blocks: number; pp: number; sh: number }>();
  const get = (id: string) => {
    let t = totals.get(id);
    if (!t) { t = { goals: 0, assists: 0, shots: 0, attempts: 0, misses: 0, blocks: 0, pp: 0, sh: 0 }; totals.set(id, t); }
    return t;
  };
  let goalLogComplete = goals.length === skaters.reduce((n, p) => n + p.stats.goals, 0);
  let shotLogComplete = plays.length > 0;
  const ambiguousStrengthTeams = new Set<string>();
  const specialGoals = new Map<string, { pp: number; sh: number }>();
  for (const play of plays) {
    const kind = str(obj(play.type).text);
    if (!["Goal", "Shot", "Missed", "Blocked"].includes(kind)) continue;
    const participants = list(play.participants).map(obj);
    const shooter = participants.find(p => ["shooter", "scorer"].includes(str(p.type)));
    const shooterId = str(obj(shooter?.athlete).id);
    if (!shooterId || !players.has(shooterId)) { shotLogComplete = false; if (kind === "Goal") goalLogComplete = false; continue; }
    const t = get(shooterId);
    t.attempts++;
    if (kind === "Shot" || kind === "Goal") t.shots++;
    if (kind === "Missed") t.misses++;
    if (kind === "Blocked") {
      const defender = participants.find(p => str(p.type) === "defender");
      const defenderId = str(obj(defender?.athlete).id);
      if (!defenderId || !players.has(defenderId)) shotLogComplete = false;
      else get(defenderId).blocks++;
    }
    if (kind !== "Goal") continue;
    t.goals++;
    const strength = str(obj(play.strength).abbreviation);
    const teamId = players.get(shooterId)!.teamId;
    if (strength === "empty-net") ambiguousStrengthTeams.add(teamId);
    else if (!["even-strength", "power-play", "short-handed"].includes(strength)) goalLogComplete = false;
    const special = specialGoals.get(teamId) ?? { pp: 0, sh: 0 };
    if (strength === "power-play") special.pp++;
    if (strength === "short-handed") special.sh++;
    specialGoals.set(teamId, special);
    for (const part of participants.filter(p => ["scorer", "assister"].includes(str(p.type)))) {
      const id = str(obj(part.athlete).id);
      if (!players.has(id)) { goalLogComplete = false; continue; }
      const pt = get(id);
      if (str(part.type) === "assister") pt.assists++;
      if (strength === "power-play") pt.pp++;
      if (strength === "short-handed") pt.sh++;
    }
  }
  // Empty-net strength does not reveal manpower. Only resolve it as neither
  // PP nor SH if the identified special-team goals reconcile to team box totals.
  for (const teamId of ambiguousStrengthTeams) {
    const boxTeam = list(obj(data.boxscore).teams).map(obj).find(t => str(obj(t.team).id) === teamId);
    const totalsByName = new Map(list(boxTeam?.statistics).map(obj).map(s => [str(s.name), numeric(s.displayValue)]));
    const identified = specialGoals.get(teamId) ?? { pp: 0, sh: 0 };
    if (totalsByName.get("powerPlayGoals") !== identified.pp || totalsByName.get("shortHandedGoals") !== identified.sh) goalLogComplete = false;
  }
  goalLogComplete = goalLogComplete && plays.length > 0 && skaters.every(p =>
    (totals.get(p.id)?.goals ?? 0) === p.stats.goals && (totals.get(p.id)?.assists ?? 0) === p.stats.assists);
  shotLogComplete = shotLogComplete && skaters.every(p =>
    (totals.get(p.id)?.shots ?? 0) === p.stats.shots
    && (totals.get(p.id)?.misses ?? 0) === p.stats.missedShots
    && (totals.get(p.id)?.blocks ?? 0) === p.stats.blockedShots);
  for (const player of skaters) {
    const t = totals.get(player.id);
    if (goalLogComplete) { player.stats.powerPlayPoints = t?.pp ?? 0; player.stats.shortHandedPoints = t?.sh ?? 0; }
    if (shotLogComplete) player.stats.shotAttempts = t?.attempts ?? 0;
  }
  const competitors = list(competition.competitors).map(obj);
  const status = obj(competition.status);
  const endPlay = list(data.plays).map(obj).reverse().find(p => str(obj(p.type).text) === "End of Game");
  const endPeriod = Number(status.period || obj(endPlay?.period).number);
  const featured = list(status.featuredAthletes).map(obj);
  const winningGoalie = str(featured.find(a => str(a.name) === "winningGoalie")?.playerId);
  const losingGoalie = str(featured.find(a => str(a.name) === "losingGoalie")?.playerId);
  for (const competitor of competitors) {
    const teamId = str(competitor.id || obj(competitor.team).id);
    const goalies = [...players.values()].filter(p => p.teamId === teamId && p.stats.saves !== undefined);
    const opponent = competitors.find(c => str(c.id || obj(c.team).id) !== teamId);
    const opponentGoals = [...players.values()].filter(p => p.teamId !== teamId && p.stats.goals !== undefined);
    const allowed = opponentGoals.length ? opponentGoals.reduce((n, p) => n + p.stats.goals, 0) : null;
    for (const player of goalies) {
      if (typeof competitor.winner === "boolean") {
        if (!competitor.winner) player.stats.wins = 0;
        else if (goalies.some(g => g.id === winningGoalie)) player.stats.wins = player.id === winningGoalie ? 1 : 0;
        else if (goalies.length === 1) player.stats.wins = 1;
        if (competitor.winner) player.stats.overtimeLosses = 0;
        else if (endPeriod > 0 && endPeriod < 4) player.stats.overtimeLosses = 0;
        else if (endPeriod >= 4 && (goalies.length === 1 || goalies.some(g => g.id === losingGoalie)))
          player.stats.overtimeLosses = goalies.length === 1 || player.id === losingGoalie ? 1 : 0;
      }
      if (allowed !== null && opponent && typeof competitor.winner === "boolean")
        player.stats.shutouts = allowed === 0 && goalies.length === 1 ? 1 : 0;
    }
  }
}

export function normalizeRace(eventValue: unknown): HistoricalGame | null {
  const event = obj(eventValue), comp = obj(list(event.competitions)[0]);
  if (obj(obj(event.status || comp.status).type).completed !== true) return null;
  const date = str(event.date), id = str(event.id);
  if (!id || !Number.isFinite(Date.parse(date))) return null;
  const players = list(comp.competitors).flatMap((value) => {
    const c = obj(value), athlete = obj(c.athlete), finish = numeric(c.order), athleteId = str(c.id);
    return finish !== null && finish >= 1 && athleteId ? [{
      id: athleteId, name: str(athlete.displayName || athlete.fullName), teamId: "field", position: "Driver", stats: { finish },
    }] : [];
  });
  return players.length ? {
    version: HISTORY_VERSION, id, date, phase: Number(obj(event.season).type ?? 0), season: Number(obj(event.season).year ?? 0),
    venue: str(event.name), teams: [], players,
  } : null;
}
