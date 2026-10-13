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
const skater = { goals: "goals", assists: "assists", shotsTotal: "shots", blockedShots: "blockedShots" };
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
  return {
    version: HISTORY_VERSION, id, date, teams, players: [...players.values()],
    phase: Number(obj(header.season).type ?? 0), season: Number(obj(header.season).year ?? 0),
    venue: str(obj(obj(data.gameInfo).venue).fullName),
  };
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
