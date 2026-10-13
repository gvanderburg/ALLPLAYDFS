import type { HistoricalPlayer } from "./types";
import { innings, list, numeric, obj, str, type Json } from "./normalize";

const nameKey = (value: unknown) => str(value).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const schedules = new Map<string, Promise<unknown>>();

export async function baseballBoxFor(summary: Json, fetchJson: (url: string) => Promise<unknown>): Promise<unknown> {
  const competition = obj(list(obj(summary.header).competitions)[0]);
  const date = str(competition.date);
  if (!Number.isFinite(Date.parse(date))) return null;
  const day = date.slice(0, 10), before = new Date(Date.parse(day) - 86400000).toISOString().slice(0, 10);
  const key = `${before}:${day}`;
  if (schedules.size > 100) schedules.delete(schedules.keys().next().value!);
  let schedule = schedules.get(key);
  if (!schedule) {
    schedule = fetchJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${before}&endDate=${day}`);
    schedules.set(key, schedule);
    schedule.catch(() => schedules.delete(key));
  }
  const competitors = list(competition.competitors).map(obj);
  const home = competitors.find(t => t.homeAway === "home"), away = competitors.find(t => t.homeAway === "away");
  const matches = list(obj(await schedule).dates).flatMap(d => list(obj(d).games)).map(obj).filter(game => {
    const teams = obj(game.teams);
    return obj(game.status).codedGameState === "F" &&
      Math.abs(Date.parse(str(game.gameDate)) - Date.parse(date)) <= 30 * 60000 &&
      nameKey(obj(obj(teams.home).team).name) === nameKey(obj(home?.team).displayName) &&
      nameKey(obj(obj(teams.away).team).name) === nameKey(obj(away?.team).displayName) &&
      numeric(obj(teams.home).score) === numeric(home?.score) &&
      numeric(obj(teams.away).score) === numeric(away?.score);
  });
  const id = str(matches[0]?.gamePk);
  if (matches.length !== 1 || !/^\d+$/.test(id)) return null;
  return fetchJson(`https://statsapi.mlb.com/api/v1/game/${id}/boxscore`);
}

/** Cross-provider identity requires the exact normalized full name AND verified game/team/score. */
export function enrichBaseball(data: Json, competition: Json, players: Map<string, HistoricalPlayer>) {
  const box = obj(data.allplayBaseballBox), teams = obj(box.teams);
  const competitors = list(competition.competitors).map(obj);
  for (const side of ["home", "away"]) {
    const team = obj(teams[side]), competitor = competitors.find(t => t.homeAway === side);
    if (!competitor || nameKey(obj(team.team).name) !== nameKey(obj(competitor.team).displayName) ||
        numeric(obj(obj(team.teamStats).batting).runs) === null ||
        numeric(obj(obj(team.teamStats).batting).runs) !== numeric(competitor.score)) continue;
    const teamId = str(obj(competitor.team).id || competitor.id);
    const official = Object.values(obj(team.players)).map(obj);
    for (const player of [...players.values()].filter(p => p.teamId === teamId)) {
      const matches = official.filter(p => nameKey(obj(p.person).fullName) === nameKey(player.name));
      if (matches.length !== 1) continue;
      const source = obj(matches[0].stats), batting = obj(source.batting), pitching = obj(source.pitching);
      const set = (target: string, value: unknown) => {
        const n = numeric(value);
        if (n !== null && n >= 0) player.stats[target] = n;
      };
      if (numeric(batting.gamesPlayed) === 1) {
        const hits = numeric(batting.hits), doubles = numeric(batting.doubles), triples = numeric(batting.triples), hr = numeric(batting.homeRuns);
        if (hits !== null && doubles !== null && triples !== null && hr !== null && hits >= doubles + triples + hr)
          player.stats.singles = hits - doubles - triples - hr;
        for (const [target, key] of Object.entries({
          doubles: "doubles", triples: "triples", stolenBases: "stolenBases", hitByPitch: "hitByPitch",
        })) set(target, batting[key]);
      }
      if (numeric(pitching.gamesPlayed) === 1) {
        for (const [target, key] of Object.entries({
          wins: "wins", hitBatters: "hitBatsmen", completeGames: "completeGames", shutouts: "shutouts",
        })) set(target, pitching[key]);
        const ip = innings(pitching.inningsPitched), er = numeric(pitching.earnedRuns), starts = numeric(pitching.gamesStarted);
        if (ip !== null && er !== null && starts !== null)
          player.stats.qualityStarts = starts > 0 && ip >= 6 && er <= 3 ? 1 : 0;
        const complete = numeric(pitching.completeGames), hits = numeric(pitching.hits);
        if (complete !== null && hits !== null) player.stats.noHitters = complete > 0 && hits === 0 ? 1 : 0;
      }
    }
  }
}
