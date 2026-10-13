import type { ModelFantasyForecast, ModelHistoryAppearance, ModelStatEstimate } from "@workspace/api-zod";
import type { HistoricalGame, ModelSettings, ModelSport, SlatePlayer } from "./types";

type Site = ModelFantasyForecast["site"];
type Values = Record<string, number>;
interface Rule { weights: Values; source: string; bonus?: (v: Values) => number; }
export const RULES_AS_OF = "2026-10-13";
const round = (n: number) => Math.round(n * 100) / 100;
const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const hockeySkater = { goals: 8.5, assists: 5, shots: 1.5, blockedShots: 1.3, shortHandedPoints: 2, shootoutGoals: 1.5 };
const dkHockey = "https://dknetwork.draftkings.com/2020/07/02/beginner-nhl-dfs-scoring/";
const fd = "https://www.fanduel.com/rules";
const yahooHockey = "https://sports.yahoo.com/dailyfantasy/help/nhl/rules";
export function scoringRule(sport: ModelSport, site: Site, goalie: boolean, position = ""): Rule | null {
  if (sport === "nhl") {
    if (site === "draftkings") return goalie
      ? { weights: { wins: 6, saves: .7, goalsAgainst: -3.5, shutouts: 4, overtimeLosses: 2 }, source: dkHockey, bonus: v => v.saves >= 35 ? 3 : 0 }
      : { weights: hockeySkater, source: dkHockey, bonus: v => 3 * (Number(v.goals >= 3) + Number(v.shots >= 5) + Number(v.blockedShots >= 3) + Number(v.goals + v.assists >= 3)) };
    if (site === "fanduel") return { source: fd, weights: goalie
      ? { wins: 12, saves: .8, goalsAgainst: -4, shutouts: 8 }
      : { goals: 12, assists: 8, shots: 1.6, blockedShots: 1.6, powerPlayPoints: .5, shortHandedPoints: 2 } };
    if (site === "yahoo") return { source: yahooHockey, weights: goalie
      ? { wins: 5, saves: .6, goalsAgainst: -3, shutouts: 5 }
      : { goals: 6, assists: 4, plusMinus: 2, shots: .9, blockedShots: 1, powerPlayPoints: 2 } };
  }
  if ((sport === "nba" || sport === "wnba") && site === "fanduel") return {
    source: fd, weights: { points: 1, rebounds: 1.2, assists: 1.5, blocks: 3, steals: 3, turnovers: -1 },
  };
  if (sport === "nba" && site === "draftkings") return {
    source: "https://www.draftkings.com/help/rules/4/137",
    weights: { points: 1, threePointers: .5, rebounds: 1.25, assists: 1.5, blocks: 2, steals: 2, turnovers: -.5 },
    bonus: v => {
      const doubles = ["points", "rebounds", "assists", "blocks", "steals"].filter(k => v[k] >= 10).length;
      return (doubles >= 2 ? 1.5 : 0) + (doubles >= 3 ? 3 : 0);
    },
  };
  if ((sport === "nfl" || sport === "cfb") && site === "fanduel") return {
    source: fd,
    weights: { passingYards: .04, passingTDs: 4, interceptionsThrown: -1, rushingYards: .1, rushingTDs: 6, receivingYards: .1, receivingTDs: 6, receptions: .5, fumblesLost: -2, twoPointConversions: 2, returnTouchdowns: 6, fumbleRecoveryTouchdowns: 6, ...(position === "K" ? { fieldGoalsUnder40: 3, fieldGoals40To49: 4, fieldGoals50Plus: 5, extraPointsMade: 1 } : {}) },
    bonus: sport === "nfl" ? v => 3 * (Number(v.passingYards >= 300) + Number(v.rushingYards >= 100) + Number(v.receivingYards >= 100)) : undefined,
  };
  if ((sport === "nfl" || sport === "cfb") && site === "draftkings" && position !== "K") return {
    source: sport === "nfl" ? "https://www.draftkings.com/help/rules/1/145" : "https://www.draftkings.com/help/rules/cfb",
    weights: { passingYards: .04, passingTDs: 4, interceptionsThrown: -1, rushingYards: .1, rushingTDs: 6,
      receivingYards: .1, receivingTDs: 6, receptions: 1, fumblesLost: -1, twoPointConversions: 2,
      returnTouchdowns: 6, fumbleRecoveryTouchdowns: 6 },
    bonus: v => 3 * (Number(v.passingYards >= 300) + Number(v.rushingYards >= 100) + Number(v.receivingYards >= 100)),
  };
  if (sport === "mlb" && site === "draftkings") return /^(SP|RP|P)$/.test(position)
    ? { source: "https://www.draftkings.com/help/rules/mlb", weights: {
      inningsPitched: 2.25, pitcherStrikeouts: 2, wins: 4, earnedRuns: -2, hitsAllowed: -.6, walksAllowed: -.6,
      hitBatters: -.6, completeGames: 2.5, shutouts: 2.5, noHitters: 5,
    } }
    : { source: "https://www.draftkings.com/help/rules/mlb", weights: {
      singles: 3, doubles: 5, triples: 8, homeRuns: 10, runs: 2, rbi: 2, walks: 2, hitByPitch: 2, stolenBases: 5,
    } };
  if (sport === "mlb" && site === "fanduel") return /^(SP|RP|P)$/.test(position)
    ? { source: fd, weights: { inningsPitched: 3, pitcherStrikeouts: 3, earnedRuns: -3, wins: 6, qualityStarts: 4 } }
    : { source: fd, weights: { singles: 3, doubles: 6, triples: 9, homeRuns: 12, rbi: 3.5, runs: 3.2, walks: 3, stolenBases: 6, hitByPitch: 3 } };
  // No approximate or partially known platform score is presented as a full total.
  return null;
}
export function scoreOutcome(rule: Rule, outcome: Values): number {
  return Object.entries(rule.weights).reduce((sum, [key, weight]) => sum + weight * outcome[key], 0) + (rule.bonus?.(outcome) ?? 0);
}
function seeded(seed: string) {
  let state = 2166136261;
  for (const c of seed) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let n = Math.imul(state ^ (state >>> 15), 1 | state);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(rng: () => number) {
  return Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());
}
function poisson(lambda: number, rng: () => number) {
  if (lambda <= 0) return 0;
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal(rng)));
  const threshold = Math.exp(-lambda);
  let product = 1, count = 0;
  do { count++; product *= Math.max(rng(), 1e-12); } while (product > threshold);
  return count - 1;
}
function gamma(shape: number, rng: () => number): number {
  if (shape < 1) return gamma(shape + 1, rng) * Math.pow(Math.max(rng(), 1e-12), 1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = normal(rng), base = 1 + c * x;
    if (base <= 0) continue;
    const v = base ** 3, u = Math.max(rng(), 1e-12);
    if (u < 1 - .0331 * x ** 4 || Math.log(u) < .5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
function binomial(n: number, p: number, rng: () => number) {
  let count = 0;
  for (let i = 0; i < n; i++) if (rng() < clamp(p, 0, 1)) count++;
  return count;
}
function variance(history: number[]) {
  if (history.length < 2) return 0;
  const m = avg(history);
  return history.reduce((n, v) => n + (v - m) ** 2, 0) / (history.length - 1);
}

export function fantasyForecasts(
  sport: ModelSport, player: SlatePlayer, stats: ModelStatEstimate[], history: ModelHistoryAppearance[],
): ModelFantasyForecast[] {
  const projections = new Map(stats.map(s => [s.id, s]));
  const goalie = sport === "nhl" && (player.position === "G" || projections.has("saves"));
  const means: Values = {};
  const dispersion: Values = {};
  for (const stat of stats) {
    if (stat.projected == null) continue;
    means[stat.id] = stat.projected;
    const samples = history.flatMap(h => h.stats[stat.id] === undefined ? [] : [h.stats[stat.id]]);
    const historicalMean = samples.length ? avg(samples) : 0;
    // Shrink sparse variance toward Poisson, rescale to the forecast's opportunity.
    const observed = historicalMean > 0 ? variance(samples) * Math.abs(stat.projected) / historicalMean : Math.abs(stat.projected);
    dispersion[stat.id] = Math.max(Math.abs(stat.projected), observed * samples.length / (samples.length + 8) + Math.abs(stat.projected) * 8 / (samples.length + 8));
    if (stat.id === "plusMinus") dispersion[stat.id] = Math.max(1, variance(samples));
  }
  const count = (key: string, rng: () => number) => {
    const m = means[key] ?? 0, v = dispersion[key] ?? m;
    if (m <= 0) return 0;
    if (v > m + .01) {
      const shape = Math.max(.05, m * m / (v - m));
      return poisson(gamma(shape, rng) * m / shape, rng);
    }
    return poisson(m, rng);
  };
  const sample = (rng: () => number): Values => {
    const v: Values = {};
    for (const key of Object.keys(means)) v[key] = key === "plusMinus"
      ? Math.round(means[key] + Math.sqrt(dispersion[key]) * normal(rng)) : count(key, rng);
    if (sport === "nhl" && goalie) {
      const faced = count("shotsAgainst", rng);
      v.goalsAgainst = binomial(faced, means.shotsAgainst > 0 ? means.goalsAgainst / means.shotsAgainst : 0, rng);
      v.saves = faced - v.goalsAgainst;
      v.wins = Number(rng() < (means.wins ?? 0));
      v.overtimeLosses = !v.wins ? Number(rng() < clamp((means.overtimeLosses ?? 0) / Math.max(1e-9, 1 - (means.wins ?? 0)), 0, 1)) : 0;
      v.shutouts = v.goalsAgainst === 0 ? Number(rng() < clamp((means.shutouts ?? 0) / Math.exp(-(means.goalsAgainst ?? 0)), 0, 1)) : 0;
    } else if (sport === "nhl") {
      v.goals = binomial(v.shots ?? 0, means.shots > 0 ? means.goals / means.shots : 0, rng);
      const points = v.goals + (v.assists ?? 0), expected = (means.goals ?? 0) + (means.assists ?? 0);
      v.powerPlayPoints = binomial(points, expected > 0 ? (means.powerPlayPoints ?? 0) / expected : 0, rng);
      v.shortHandedPoints = binomial(points - v.powerPlayPoints, expected - (means.powerPlayPoints ?? 0) > 0 ? (means.shortHandedPoints ?? 0) / (expected - (means.powerPlayPoints ?? 0)) : 0, rng);
    } else if (sport === "nba" || sport === "wnba") {
      v.threePointers = Math.min(v.threePointers ?? 0, Math.floor((v.points ?? 0) / 3));
    } else if (sport === "mlb") {
      for (const key of ["wins", "qualityStarts", "completeGames", "shutouts", "noHitters"])
        if (means[key] !== undefined) v[key] = Number(rng() < clamp(means[key], 0, 1));
      if (means.singles !== undefined && means.atBats !== undefined) {
        const categories = ["singles", "doubles", "triples", "homeRuns"];
        const expected = categories.reduce((n, key) => n + (means[key] ?? 0), 0);
        let hits = binomial(v.atBats ?? 0, means.atBats > 0 ? expected / means.atBats : 0, rng);
        let remainingMean = expected;
        for (const key of categories) {
          v[key] = remainingMean > 0 ? binomial(hits, (means[key] ?? 0) / remainingMean, rng) : 0;
          hits -= v[key]; remainingMean -= means[key] ?? 0;
        }
      }
    }
    return v;
  };
  let outcomes: Values[] | undefined;
  const forecasts: ModelFantasyForecast[] = [];
  for (const site of ["draftkings", "fanduel", "yahoo", "ownersbox"] as Site[]) {
    const rule = scoringRule(sport, site, goalie, player.position);
    const missingStats = rule ? Object.keys(rule.weights).filter(key => means[key] === undefined) : ["Verified scoring rules and complete model inputs not available for this sport/site"];
    if (rule && goalie && (means.shotsAgainst === undefined || means.goalsAgainst === undefined)) missingStats.push("shotsAgainst / goalsAgainst simulation inputs");
    const base: ModelFantasyForecast = {
      site, status: rule ? missingStats.length ? "partial" : "ready" : "unavailable",
      mean: null, trackedMean: null, std: null, p25: null, p50: null, p75: null, p85: null, p95: null, p99: null,
      sampleSize: rule ? Math.min(...Object.keys(rule.weights).map(key => projections.get(key)?.sampleSize ?? 0)) : 0,
      simulations: 0, missingStats, scoringSource: rule?.source ?? null, rulesAsOf: RULES_AS_OF,
      notes: [
        "ALLPLAY stat forecasts, not provider forecasts; standard per-player scoring, no Captain/Superstar multipliers.",
        "Simulated outcome percentiles, not confidence intervals or guarantees; model not backtested.",
        "Mean applies published weights to ALLPLAY stat means plus simulated expected threshold bonuses; range/std estimates come from outcome scenarios.",
        "Count variances shrink toward Poisson; limited same-player consistency constraints, no cross-player/team correlation model. Sparse samples weaken tail estimates.",
        "Published base scoring references were reviewed on the rules-as-of date; confirm the chosen contest's current rules. Ownership and starting/line assignments are not inferred.",
      ],
    };
    if (!rule) { forecasts.push(base); continue; }
    const known = Object.entries(rule.weights).filter(([key]) => means[key] !== undefined);
    base.trackedMean = known.length ? round(known.reduce((n, [key, weight]) => n + means[key] * weight, 0)) : null;
    if (missingStats.length) { base.notes.push("Tracked subtotal excludes missing scoring inputs and threshold bonuses; NOT a full fantasy projection."); forecasts.push(base); continue; }
    if (!outcomes) {
      const rng = seeded(`${sport}:${player.id}:${JSON.stringify(means)}:${JSON.stringify(dispersion)}`);
      outcomes = Array.from({ length: 2048 }, () => sample(rng));
    }
    const scores = outcomes.map(v => scoreOutcome(rule, v));
    const m = avg(scores);
    scores.sort((a, b) => a - b);
    const expectedLinear = known.reduce((n, [key, weight]) => n + means[key] * weight, 0);
    base.mean = round(expectedLinear + (rule.bonus ? avg(outcomes.map(v => rule.bonus!(v))) : 0));
    base.std = round(Math.sqrt(scores.reduce((n, v) => n + (v - m) ** 2, 0) / scores.length));
    base.simulations = scores.length;
    for (const [key, q] of [["p25", .25], ["p50", .5], ["p75", .75], ["p85", .85], ["p95", .95], ["p99", .99]] as const)
      base[key] = round(scores[Math.floor((scores.length - 1) * q)]);
    forecasts.push(base);
  }
  return forecasts;
}

export interface TeamTotalsModel {
  own: Map<string, number>;
  allowed: Map<string, number[]>;
  settings: ModelSettings;
}
export function modelTeamTotals(sport: ModelSport, games: HistoricalGame[], settings: ModelSettings): TeamTotalsModel {
  if (!["nhl", "nba", "wnba"].includes(sport)) return { own: new Map(), allowed: new Map(), settings };
  const stat = sport === "nhl" ? "goals" : "points";
  const forSamples = new Map<string, number[]>(), againstSamples = new Map<string, number[]>();
  for (const game of games) for (const team of game.teams) {
    const rows = game.players.filter(p => p.teamId === team.id && p.stats[stat] !== undefined);
    const opp = game.teams.find(t => t.id !== team.id);
    if (!rows.length || !opp) continue;
    const value = rows.reduce((n, p) => n + p.stats[stat], 0);
    forSamples.set(team.id, [...(forSamples.get(team.id) ?? []), value].slice(0, 10));
    againstSamples.set(opp.id, [...(againstSamples.get(opp.id) ?? []), value].slice(0, 10));
  }
  const own = new Map<string, number>();
  for (const [team, values] of forSamples) {
    if (values.length < 2) continue;
    const recent = values.slice(0, settings.recentGames);
    const weighted = recent.reduce((n, v, i) => n + v * .8 ** i, 0) / recent.reduce((n, _, i) => n + .8 ** i, 0);
    own.set(team, weighted * settings.recentWeight / 100 + avg(values) * (1 - settings.recentWeight / 100));
  }
  return { own, allowed: againstSamples, settings };
}
export function teamTotalFor(totals: TeamTotalsModel, team: string, opponent: string): number | null {
  const value = totals.own.get(team);
  if (value === undefined) return null;
  const values = totals.allowed.get(opponent);
  const population = [...totals.allowed.values()].filter(v => v.length >= 2);
  if (!values || values.length < 2 || !population.length) return round(value);
  const league = avg(population.map(avg));
  const reliability = Math.min(1, values.length / 5) * Math.min(1, population.length / 8);
  const factor = league > 0 ? clamp(1 + (avg(values) / league - 1) * totals.settings.matchupWeight / 100 * reliability, .8, 1.2) : 1;
  return round(value * factor);
}
