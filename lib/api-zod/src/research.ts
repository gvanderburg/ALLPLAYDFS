/** Shared, outcome-blind research math used by both the live UI and historical replay. */
export const researchRole = (position: string, sport: string) => {
  const p = position.toUpperCase().split(/[\/,]/)[0];
  if (sport === "nhl" && ["LW", "RW", "F"].includes(p)) return "W";
  if (sport === "nfl" && p === "FB") return "RB";
  return p;
};
export function researchPercentile(value: number, population: number[]) {
  if (population.length < 2) return .5;
  return population.reduce((n, v) => n + (v < value ? 1 : v === value ? .5 : 0), 0) / population.length;
}
export const ownershipShares: Record<string, Record<string, number>> = {
  "nfl:draftkings": { QB: 1, RB: 2.5, WR: 3.3, TE: 1.2 },
  "nfl:fanduel": { QB: 1, RB: 2.5, WR: 3.3, TE: 1.2 },
  "nhl:draftkings": { C: 2.3, W: 3.5, D: 2.2, G: 1 },
  "nhl:fanduel": { C: 2.6, W: 2.8, D: 2.6, G: 1 },
  "nba:draftkings": { PG: 1.75, SG: 1.75, SF: 1.75, PF: 1.75, C: 1 },
  "nba:fanduel": { PG: 2, SG: 2, SF: 2, PF: 2, C: 1 },
};
export interface ResearchRow {
  playerId: string; position: string; points: number; floor: number | null;
  ceiling: number | null; value: number | null; estimatedOwnership: number | null;
  historicalGames: number;
}
export function allocateOwnership(group: ResearchRow[], expectedSlots: number) {
  const weights = group.map(p => Math.exp(3 * (.7 * researchPercentile(p.points, group.map(r => r.points)) +
    .3 * researchPercentile(p.value!, group.map(r => r.value!)))));
  const assigned = new Map<string, number>();
  let remaining = expectedSlots * 100, active = [...group];
  while (active.length && remaining > .001) {
    const total = active.reduce((n, row) => n + weights[group.indexOf(row)], 0);
    const capped = active.filter(row => remaining * weights[group.indexOf(row)] / total >= 100);
    if (!capped.length) {
      for (const row of active) assigned.set(row.playerId, Math.round(remaining * weights[group.indexOf(row)] / total * 10) / 10);
      break;
    }
    for (const row of capped) { assigned.set(row.playerId, 100); remaining -= 100; }
    active = active.filter(row => !capped.includes(row));
  }
  return assigned;
}
export function researchScores(rows: ResearchRow[], sport: string, style: "balanced" | "tournament") {
  return new Map(rows.map(row => {
    const peers = rows.filter(r => researchRole(r.position, sport) === researchRole(row.position, sport));
    const p = researchPercentile(row.points, peers.map(r => r.points));
    const v = row.value !== null ? researchPercentile(row.value, peers.flatMap(r => r.value !== null ? [r.value] : [])) : p;
    const upside = row.ceiling !== null ? researchPercentile(row.ceiling, peers.flatMap(r => r.ceiling !== null ? [r.ceiling] : [])) : p;
    const floor = row.floor !== null ? researchPercentile(row.floor, peers.flatMap(r => r.floor !== null ? [r.floor] : [])) : p;
    const leverage = row.estimatedOwnership !== null ? 1 - row.estimatedOwnership / 100 : 0;
    const sample = Math.min(1, row.historicalGames / 5);
    return [row.playerId, style === "tournament"
      ? .4 * p + .2 * v + .25 * upside + .1 * leverage + .05 * sample
      : .45 * p + .25 * v + .2 * floor + .1 * sample] as const;
  }));
}
