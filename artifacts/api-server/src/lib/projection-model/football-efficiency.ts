import type { HistoricalGame } from "./types";

export interface EfficiencyPrior { mean: number; opportunities: number; scope: string; }
const rareRates = {
  passingTDs: "passingAttempts", interceptionsThrown: "passingAttempts",
  rushingTDs: "rushingAttempts", receivingTDs: "targets",
};
/** Empirical beta-binomial prior from completed same-position player histories.
 * Strength comes from observed between-player variation, capped by the median
 * recorded workload; no provider forecast or fixed fantasy-point correction.
 */
export function footballEfficiencyPriors(games: HistoricalGame[]): Map<string, EfficiencyPrior> {
  const result = new Map<string, EfficiencyPrior>();
  for (const [metric, exposure] of Object.entries(rareRates)) {
    const positions = new Map<string, Map<string, { count: number; total: number; games: number }>>();
    for (const game of games) for (const player of game.players) {
      const count = player.stats[metric], total = player.stats[exposure];
      if (!Number.isFinite(count) || !Number.isFinite(total) ||
        total <= 0 || count < 0 || count > total) continue;
      // ESPN football boxes often omit positions. Never invent WR/RB/TE labels
      // from the receiving/rushing table; retain an explicit opportunity cohort.
      const position = /^(QB|RB|FB|WR|TE)$/.test(player.position) ? player.position : "UNSPECIFIED";
      const cohort = positions.get(position) ?? new Map();
      const row = cohort.get(player.id) ?? { count: 0, total: 0, games: 0 };
      row.count += count; row.total += total; row.games++;
      cohort.set(player.id, row); positions.set(position, cohort);
    }
    for (const [position, cohort] of positions) {
      const rows = [...cohort.values()].filter(row => row.games >= 2);
      if (rows.length < 8) continue;
      const mean = rows.reduce((sum, row) => sum + row.count, 0) / rows.reduce((sum, row) => sum + row.total, 0);
      if (mean <= 0 || mean >= 1) continue;
      const rates = rows.map(row => row.count / row.total);
      const center = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
      const observedVariance = rates.reduce((sum, rate) => sum + (rate - center) ** 2, 0) / (rates.length - 1);
      const noise = mean * (1 - mean) * rows.reduce((sum, row) => sum + 1 / row.total, 0) / rows.length;
      const between = Math.max(0, observedVariance - noise);
      const workloads = rows.map(row => row.total).sort((a, b) => a - b);
      const median = workloads[Math.floor(workloads.length / 2)];
      const strength = between > 0 ? Math.max(0, mean * (1 - mean) / between - 1) : median;
      result.set(`${position}:${metric}`, { mean, opportunities: Math.min(median, strength),
        scope: position === "UNSPECIFIED" ? `Recorded ${exposure} contributors; historical positions unavailable` : `Historical ${position} position group` });
    }
  }
  return result;
}
