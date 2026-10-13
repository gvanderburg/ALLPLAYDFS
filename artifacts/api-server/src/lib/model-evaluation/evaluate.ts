import type { ModelPlayerProjection } from "@workspace/api-zod";
import { researchScores, researchRole, ownershipShares, allocateOwnership, type ResearchRow } from "@workspace/api-zod";
import { scoringRule, scoreOutcome, RULES_AS_OF } from "../projection-model/fantasy";
import { calculatePlayers } from "../projection-model/calculate";
import { HISTORY_VERSION, type HistoricalGame, type ModelSettings, type ModelSport, type SlatePlayer } from "../projection-model/types";
import type { OwnershipRow } from "./csv";

export const EVALUATION_VERSION = "independent-matchup-research-1";
export type Site = "draftkings" | "fanduel" | "yahoo" | "ownersbox";
export const quantiles = ["p25", "p50", "p75", "p85", "p95", "p99"] as const;
export interface EvaluationRow {
  date: string; eventId: string; playerId: string; name: string; position: string;
  forecast: number | null; actual: number | null;
  p25: number | null; p50: number | null; p75: number | null; p85: number | null; p95: number | null; p99: number | null;
  estimatedOwnership: number | null; balancedRank: number | null; tournamentRank: number | null;
  stats: Record<string, number> | null; forecastStats: Record<string, number | null>;
  historyEventIds: string[]; history: unknown; exclusion: string | null; source: string;
}
const avg = (v: number[]) => v.reduce((s, n) => s + n, 0) / v.length;
const round = (n: number) => Math.round(n * 10000) / 10000;

/** A start time is NOT proof that a result was available. Unknown completion stays excluded. */
export function pregameHistory(games: HistoricalGame[], asOf: string, phase: number) {
  const cutoff = Date.parse(asOf);
  if (!Number.isFinite(cutoff)) throw new Error("Invalid as-of timestamp.");
  return games.filter(game => {
    const completion = game.completedAt ? Date.parse(game.completedAt) : NaN;
    const receipt = game.recordedAt ? Date.parse(game.recordedAt) : NaN;
    return game.version === HISTORY_VERSION && game.phase === phase &&
      Date.parse(game.date) < cutoff &&
      ((Number.isFinite(completion) && completion >= Date.parse(game.date) && completion < cutoff) ||
       (!Number.isFinite(completion) && Number.isFinite(receipt) && receipt >= Date.parse(game.date) && receipt < cutoff));
  });
}
/** Requires every weighted/bonus input; a provider fantasy field is never consulted. */
export function observedFantasy(sport: ModelSport, site: Site, position: string, stats: Record<string, number> | undefined) {
  const rule = scoringRule(sport, site, sport === "nhl" && position === "G", position);
  if (!rule) return { score: null, reason: "Unsupported verified scoring rules." };
  if (!stats) return { score: null, reason: "No observed appearance: DNP/absence is not a verified zero." };
  const missing = Object.keys(rule.weights).filter(key => !Number.isFinite(stats[key]));
  if (missing.length) return { score: null, reason: `Incomplete observed scoring inputs: ${missing.join(", ")}.` };
  const score = scoreOutcome(rule, stats);
  return Number.isFinite(score) ? { score: round(score), reason: null } : { score: null, reason: "Non-finite observed score." };
}
export function reconstructPool(events: HistoricalGame[], history: HistoricalGame[]): Array<SlatePlayer & { eventId: string; salary: number | null }> {
  // Pool selection uses prior history only. Never select players from evaluation box scores.
  const rows: Array<SlatePlayer & { eventId: string; salary: number | null }> = [];
  for (const event of events) for (const team of event.teams) {
    const prior = [...history].filter(g => g.teams.some(t => t.id === team.id))
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 2);
    const opponent = event.teams.find(t => t.id !== team.id);
    for (const player of new Map(prior.flatMap(g => g.players.filter(p => p.teamId === team.id).map(p => [p.id, p] as const))).values()) {
      rows.push({ id: player.id, name: player.name, teamId: team.id, team: team.abbreviation,
        opponentId: opponent?.id ?? "", opponent: opponent?.abbreviation ?? event.venue,
        position: player.position, availability: "Historical availability unknown",
        participation: "Reconstructed from prior appearances; selection bias", eventId: event.id, salary: null });
    }
  }
  return rows;
}
export function evaluateSlate(
  sport: ModelSport, site: Site, date: string, asOf: string, settings: ModelSettings,
  events: HistoricalGame[], inputHistory: HistoricalGame[],
  pool: Array<SlatePlayer & { eventId: string; salary: number | null }>,
) {
  const rows: EvaluationRow[] = [];
  const projections: Array<{ player: ModelPlayerProjection; eventId: string; salary: number | null }> = [];
  // Compute forecasts before joining any outcome stats; keep phases and event contexts separate.
  for (const event of events) {
    const candidates = pool.filter(p => p.eventId === event.id);
    const history = pregameHistory(inputHistory, asOf, event.phase);
    const calculated = calculatePlayers(sport, candidates, history, settings, asOf, event.phase, event.venue);
    projections.push(...calculated.players.map(player => ({ player, eventId: event.id, salary: candidates.find(p => p.id === player.id)?.salary ?? null })));
  }
  const counts = new Map<string, number>();
  for (const p of projections) counts.set(p.player.id, (counts.get(p.player.id) ?? 0) + 1);
  const research: ResearchRow[] = [];
  for (const { player, eventId, salary } of projections) {
    const forecast = player.fantasy?.find(f => f.site === site);
    const eligible = !/\b(out|inactive|suspended|doubtful|ir|injured[- ]reserve|reserve\/injured|physically unable)\b/i.test(player.availability);
    if (eligible && counts.get(player.id) === 1 && forecast?.status === "ready" && forecast.mean != null && forecast.mean > 0)
      research.push({ playerId: player.id, position: player.position, points: forecast.mean, floor: forecast.p25,
        ceiling: forecast.p85, value: salary ? forecast.mean / (salary / 1000) : null, estimatedOwnership: null, historicalGames: player.historicalGames });
    const event = events.find(e => e.id === eventId)!;
    const actual = observedFantasy(sport, site, player.position, event.players.find(p => p.id === player.id && p.teamId === player.teamId)?.stats);
    const observation = event.players.find(p => p.id === player.id && p.teamId === player.teamId);
    rows.push({
      date, eventId, playerId: player.id, name: player.name, position: player.position,
      forecast: forecast?.status === "ready" ? forecast.mean : null, actual: actual.score,
      p25: forecast?.p25 ?? null, p50: forecast?.p50 ?? null, p75: forecast?.p75 ?? null,
      p85: forecast?.p85 ?? null, p95: forecast?.p95 ?? null, p99: forecast?.p99 ?? null,
      estimatedOwnership: null, balancedRank: null, tournamentRank: null,
      stats: observation?.stats ?? null, forecastStats: Object.fromEntries(player.stats.map(s => [s.id, s.projected])),
      historyEventIds: player.history.map(h => h.eventId), history: player.history,
      exclusion: !eligible ? "Unavailable in the pre-game pool." : counts.get(player.id)! > 1 ? "Multi-game player: ambiguous daily/contest selection." :
        forecast?.status !== "ready" || forecast.mean == null ? "Incomplete forecast or unsupported scoring." : actual.reason,
      source: "ESPN verified final box score; supplemental official inputs where reconciled",
    });
  }
  const priced = research.filter(r => r.value !== null);
  const shares = ownershipShares[`${sport}:${site}`];
  if (shares && research.length >= 8 && priced.length >= 8 && priced.length / research.length >= .8) {
    const groups = Object.entries(shares).map(([role, slots]) => ({ slots, group: priced.filter(p => researchRole(p.position, sport) === role) }));
    if (groups.every(g => g.group.length > g.slots)) {
      for (const g of groups) {
        const estimates = allocateOwnership(g.group, g.slots);
        for (const p of g.group) p.estimatedOwnership = estimates.get(p.playerId) ?? null;
      }
    }
  }
  for (const p of research) for (const row of rows.filter(r => r.playerId === p.playerId)) row.estimatedOwnership = p.estimatedOwnership;
  for (const style of ["balanced", "tournament"] as const) {
    const scores = researchScores(research, sport, style);
    const ordered = [...research].sort((a, b) => scores.get(b.playerId)! - scores.get(a.playerId)! ||
      b.points - a.points || a.playerId.localeCompare(b.playerId));
    ordered.forEach((p, i) => { const row = rows.find(r => r.playerId === p.playerId)!; row[`${style}Rank`] = i + 1; });
  }
  return rows;
}
export function calibrationGroups(rows: EvaluationRow[], sport: string, site: string) {
  const groups = new Map<string, EvaluationRow[]>();
  for (const row of rows) if (!row.exclusion && row.forecast !== null && row.actual !== null) {
    const list = groups.get(row.position) ?? []; list.push(row); groups.set(row.position, list);
  }
  return [...groups].map(([position, values]) => ({
    sport, site, position, n: values.length,
    mae: round(avg(values.map(r => Math.abs(r.forecast! - r.actual!)))),
    bias: round(avg(values.map(r => r.forecast! - r.actual!))),
    coverage: { ...Object.fromEntries(quantiles.map(q => {
      const valid = values.filter(r => r[q] !== null);
      return [q, valid.length ? round(valid.filter(r => r.actual! <= r[q]!).length / valid.length) : null];
    })), central50: values.some(r => r.p25 !== null && r.p75 !== null) ?
      round(values.filter(r => r.p25 !== null && r.p75 !== null && r.actual! >= r.p25 && r.actual! <= r.p75).length /
        values.filter(r => r.p25 !== null && r.p75 !== null).length) : null },
    coverageN: { ...Object.fromEntries(quantiles.map(q => [q, values.filter(r => r[q] !== null).length])),
      central50: values.filter(r => r.p25 !== null && r.p75 !== null).length },
    fromDate: [...values.map(r => r.date)].sort()[0], toDate: [...values.map(r => r.date)].sort().at(-1),
  }));
}
export function researchSummaries(rows: EvaluationRow[], selectionBias: boolean) {
  return [...new Set(rows.map(r => r.date))].flatMap(date => (["balanced", "tournament"] as const).map(style => {
    const selected = rows.filter(r => r.date === date && r[`${style}Rank`] !== null && r[`${style}Rank`]! <= 10);
    const paired = selected.filter(r => !r.exclusion && r.actual !== null);
    return { date, style, topK: 10, n: selected.length, observedN: paired.length, selectionBias,
      forecastMean: selected.length ? round(avg(selected.map(r => r.forecast!))) : null,
      actualMean: paired.length ? round(avg(paired.map(r => r.actual!))) : null,
      pairedForecastMean: paired.length ? round(avg(paired.map(r => r.forecast!))) : null,
      mae: paired.length ? round(avg(paired.map(r => Math.abs(r.forecast! - r.actual!)))) : null };
  }));
}
export function ownershipSummary(rows: EvaluationRow[], observations: OwnershipRow[], date: string) {
  const matched = observations.flatMap(o => {
    const forecasts = rows.filter(r => r.date === date && r.playerId === o.playerId && r.estimatedOwnership !== null);
    return forecasts.length === 1 ? [{ actual: o.ownership, estimate: forecasts[0].estimatedOwnership! }] : [];
  });
  return {
    n: matched.length, unmatched: observations.length - matched.length, fromDate: date, toDate: date,
    mae: matched.length ? round(avg(matched.map(r => Math.abs(r.estimate - r.actual)))) : null,
    bias: matched.length ? round(avg(matched.map(r => r.estimate - r.actual))) : null,
    bins: [[0, 10], [10, 25], [25, 50], [50, 101]].map(([lo, hi]) => {
      const pairs = matched.filter(r => r.estimate >= lo && r.estimate < hi);
      return { range: `${lo}–${Math.min(hi, 100)}%`, n: pairs.length,
        estimatedMean: pairs.length ? round(avg(pairs.map(p => p.estimate))) : null,
        actualMean: pairs.length ? round(avg(pairs.map(p => p.actual))) : null };
    }),
  };
}
export const scoringPolicy = `Counterfactual standard player rules reviewed ${RULES_AS_OF}, applied identically to forecast and observed stats; not asserted to be rules in force for the original contest.`;
