import type { ModelHistoryAppearance, ModelPlayerProjection, ModelStatEstimate } from "@workspace/api-zod";
import { METRICS, type MetricDefinition } from "./metrics";
import type { HistoricalGame, ModelSettings, ModelSport, SlatePlayer, StatValues } from "./types";
import { fantasyForecasts, modelTeamTotals, teamTotalFor } from "./fantasy";

const round = (n: number) => Math.round(n * 100) / 100;
const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export function recencyMean(values: number[]): number {
  const weights = values.map((_, index) => Math.pow(0.8, index));
  return values.reduce((sum, value, i) => sum + value * weights[i], 0) / weights.reduce((a, b) => a + b, 0);
}

interface OpponentProfile {
  value: number;
  games: number;
  rank: number;
  teams: number;
  league: number;
}

function teamTotals(game: HistoricalGame): Map<string, StatValues> {
  const teams = new Map<string, StatValues>();
  for (const player of game.players) {
    const values = teams.get(player.teamId) ?? {};
    for (const [key, value] of Object.entries(player.stats)) {
      // Workload totals mix skaters/goalies or hitters/pitchers, and are not defense metrics.
      if (["minutes", "timeOnIce", "inningsPitched", "finish"].includes(key)) continue;
      values[key] = (values[key] ?? 0) + value;
    }
    teams.set(player.teamId, values);
  }
  return teams;
}

function makeProfiles(games: HistoricalGame[], definition: MetricDefinition): Map<string, OpponentProfile> {
  if (!definition.matchup) return new Map();
  const samples = new Map<string, number[]>();
  for (const game of games) {
    const totals = teamTotals(game);
    for (const team of game.teams) {
      const sourceTeam = definition.matchup.mode === "attack" ? team : game.teams.find(t => t.id !== team.id);
      const value = sourceTeam ? totals.get(sourceTeam.id)?.[definition.matchup.metric] : undefined;
      if (value === undefined || !Number.isFinite(value)) continue;
      const values = samples.get(team.id) ?? [];
      values.push(value);
      samples.set(team.id, values);
    }
  }
  const values = [...samples.entries()].filter(([, observations]) => observations.length >= 2)
    .map(([id, observations]) => ({ id, value: mean(observations.slice(0, 10)), games: Math.min(10, observations.length) }));
  if (!values.length) return new Map();
  const league = mean(values.map(item => item.value));
  return new Map(values.map(item => [item.id, {
    value: item.value, games: item.games, teams: values.length, league,
    rank: 1 + values.filter(other => other.value < item.value - 1e-9).length,
  }]));
}

function estimate(
  metric: MetricDefinition, history: ModelHistoryAppearance[], settings: ModelSettings,
  profile: OpponentProfile | undefined, workload: Record<string, number>,
): ModelStatEstimate {
  const rows = history.filter(row => row.stats[metric.id] !== undefined);
  const recent = rows.slice(0, settings.recentGames);
  const baselineAverage = rows.length ? mean(rows.map(row => row.stats[metric.id])) : null;
  const recentAverage = recent.length ? recencyMean(recent.map(row => row.stats[metric.id])) : null;
  const recentShare = settings.recentWeight / 100;
  let base = recentAverage !== null && baselineAverage !== null ?
    recentShare * recentAverage + (1 - recentShare) * baselineAverage : null;
  // Minutes/TOI/innings/at-bats predict opportunity. Rate means are weighted by actual
  // exposure, not averages of per-game rates that overvalue one-minute appearances.
  if (base !== null && metric.exposure && workload[metric.exposure] !== undefined) {
    const withExposure = rows.filter(row => row.stats[metric.exposure!] > 0);
    const recentExposure = withExposure.slice(0, settings.recentGames);
    const rate = (appearances: ModelHistoryAppearance[], weighted: boolean) => {
      let numerator = 0, denominator = 0;
      appearances.forEach((row, index) => {
        const weight = weighted ? Math.pow(0.8, index) : 1;
        numerator += row.stats[metric.id] * weight;
        denominator += row.stats[metric.exposure!] * weight;
      });
      return denominator > 0 ? numerator / denominator : null;
    };
    const r = rate(recentExposure, true), b = rate(withExposure, false);
    if (withExposure.length >= 2 && r !== null && b !== null)
      base = workload[metric.exposure] * (recentShare * r + (1 - recentShare) * b);
  }
  const reliability = profile ? Math.min(1, profile.games / 5) * Math.min(1, profile.teams / 8) : 0;
  const factor = profile && profile.league > 0 ?
    clamp(1 + (profile.value / profile.league - 1) * settings.matchupWeight / 100 * reliability, 0.8, 1.2) : 1;
  const projected = rows.length >= 2 && base !== null ? round(clamp(base * factor, metric.minimum ?? 0, metric.maximum ?? Infinity)) : null;
  return {
    id: metric.id, projected, recentAverage: recentAverage === null ? null : round(recentAverage),
    baselineAverage: baselineAverage === null ? null : round(baselineAverage), matchupMultiplier: round(factor),
    opponentRank: profile?.rank ?? null, rankedTeams: profile?.teams ?? 0, defenseGames: profile?.games ?? 0,
    opponentMean: profile ? round(profile.value) : null, leagueMean: profile ? round(profile.league) : null,
    sampleSize: rows.length, recentSampleSize: recent.length,
  };
}

function enforceConsistency(stats: ModelStatEstimate[]) {
  const byId = new Map(stats.map(stat => [stat.id, stat]));
  const limit = (id: string, reference: string) => {
    const a = byId.get(id), b = byId.get(reference);
    if (a?.projected != null && b?.projected != null) a.projected = Math.min(a.projected, b.projected);
  };
  limit("passingCompletions", "passingAttempts");
  limit("receptions", "targets");
  limit("hits", "atBats");
  limit("homeRuns", "hits");
  limit("goals", "shots");
  const g = byId.get("goals")?.projected, a = byId.get("assists")?.projected;
  if (g != null && a != null) {
    const pp = byId.get("powerPlayPoints"), sh = byId.get("shortHandedPoints");
    if (pp?.projected != null) pp.projected = Math.min(pp.projected, g + a);
    if (sh?.projected != null) sh.projected = Math.min(sh.projected, Math.max(0, g + a - (pp?.projected ?? 0)));
  }
  const attempts = byId.get("shotAttempts"), sog = byId.get("shots");
  if (attempts?.projected != null && sog?.projected != null) attempts.projected = Math.max(attempts.projected, sog.projected);
  const win = byId.get("wins"), otl = byId.get("overtimeLosses");
  if (win?.projected != null && otl?.projected != null) otl.projected = Math.min(otl.projected, 1 - win.projected);
  const saves = byId.get("saves"), shots = byId.get("shotsAgainst"), goals = byId.get("goalsAgainst");
  if (saves?.projected != null && shots?.projected != null && goals?.projected != null) {
    goals.projected = Math.min(goals.projected, shots.projected);
    saves.projected = round(shots.projected - goals.projected);
  }
}

export function calculatePlayers(
  sport: ModelSport, candidates: SlatePlayer[], input: HistoricalGame[], settings: ModelSettings,
  cutoff: string, phase: number, venue = "",
): { players: ModelPlayerProjection[]; observedTeams: number } {
  const games = input.filter(game => Date.parse(game.date) < Date.parse(cutoff) && (!phase || phase === game.phase))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const metrics = METRICS[sport];
  const profiles = new Map(metrics.map(metric => [metric.id, makeProfiles(games, metric)]));
  const observedTeams = new Set(games.flatMap(game => game.teams.map(team => team.id))).size;
  const totals = modelTeamTotals(sport, games, settings);
  const players = candidates.map((candidate): ModelPlayerProjection => {
    const history: ModelHistoryAppearance[] = games.flatMap(game => {
      const player = game.players.find(p => p.id === candidate.id);
      return player ? [{ eventId: game.id, date: new Date(game.date), opponent: sport === "nascar" ? game.venue :
        game.teams.find(team => team.id !== player.teamId)?.abbreviation ?? "", stats: player.stats }] : [];
    }).slice(0, 10);
    const workload: Record<string, number> = {};
    const stats = metrics.map(metric => {
      const estimateValue = estimate(metric, history, settings, profiles.get(metric.id)?.get(candidate.opponentId), workload);
      if (!metric.exposure && estimateValue.projected !== null) workload[metric.id] = estimateValue.projected;
      return estimateValue;
    }).filter(stat => stat.sampleSize > 0);
    if (sport === "nascar") {
      const finish = stats.find(stat => stat.id === "finish");
      // Published venue labels can combine different configurations; do not infer
      // Charlotte oval/Roval or Indianapolis/Bristol configurations from the city.
      const exactVenue = venue && !/charlotte|indianapolis|bristol/i.test(venue) ?
        games.filter(game => game.venue === venue).flatMap(game => {
          const value = game.players.find(p => p.id === candidate.id)?.stats.finish;
          return value === undefined ? [] : [value];
        }) : [];
      if (finish?.projected != null && finish.baselineAverage && exactVenue.length) {
        const trackAverage = mean(exactVenue);
        const factor = clamp(1 + (trackAverage / finish.baselineAverage - 1) *
          settings.matchupWeight / 100 * Math.min(1, exactVenue.length / 3), 0.8, 1.2);
        finish.projected = round(clamp(finish.projected * factor, 1, Math.max(...games.map(game => game.players.length), 1)));
        finish.matchupMultiplier = round(factor);
        finish.opponentMean = round(trackAverage);
        finish.leagueMean = finish.baselineAverage;
        finish.defenseGames = exactVenue.length;
      }
    }
    enforceConsistency(stats);
    const available = stats.some(stat => stat.projected !== null);
    return {
      ...candidate, historicalGames: history.length, history, stats,
      fantasy: fantasyForecasts(sport, candidate, stats, history),
      modelTeamTotal: teamTotalFor(totals, candidate.teamId, candidate.opponentId),
      modelGameTotal: teamTotalFor(totals, candidate.teamId, candidate.opponentId) != null && teamTotalFor(totals, candidate.opponentId, candidate.teamId) != null
        ? round(teamTotalFor(totals, candidate.teamId, candidate.opponentId)! + teamTotalFor(totals, candidate.opponentId, candidate.teamId)!) : null,
      reason: available ? null : history.length < 2 ? "At least two published appearances are required; no estimate is substituted." :
        "Tracked stat coverage is insufficient for this player.",
    };
  });
  return { players, observedTeams };
}
