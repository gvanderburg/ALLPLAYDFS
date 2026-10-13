import type { DfsDashboard, DfsSalaryPlatform, ModelFantasyForecast, ModelProjectionSheet } from '@workspace/api-client-react';
import { findUniqueSelectedSlateSalary } from './model-salary-match';
import { researchScores, researchRole as role, researchPercentile as percentile, ownershipShares as shares, allocateOwnership } from '@workspace/api-client-react';

export type LineupStyle = 'balanced' | 'tournament';
export interface LineupInsight {
  playerId: string;
  name: string;
  team: string;
  opponent: string;
  position: string;
  points: number;
  floor: number | null;
  ceiling: number | null;
  salary: number | null;
  value: number | null;
  estimatedOwnership: number | null;
  ownershipMethod: string | null;
  rank: number;
  reasons: string[];
  cautions: string[];
  tags: string[];
}
export interface LineupInsights {
  rows: LineupInsight[];
  notes: string[];
  forecastCoverage: number;
  salaryCoverage: number;
  ownershipCoverage: number;
  excludedPlayers: number;
}
type Site = ModelFantasyForecast['site'];
const round = (n: number) => Math.round(n * 10) / 10;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const method = 'Uncalibrated classic-slate selection-share heuristic: 70% position-relative projected points, 30% salary value; assumed roster-role shares. Conditional on the covered player pool, not actual contest ownership. No salary-cap lineup optimization or ownership backtest.';
/** Uses ALLPLAY's own forecasts and observed history. Never reads provider fantasy projections/ownership. */
export function deriveLineupInsights(
  sheet: ModelProjectionSheet, dashboard: DfsDashboard | undefined, platform: DfsSalaryPlatform,
  site: Site = platform, style: LineupStyle = 'balanced',
): LineupInsights {
  if (sheet.status !== 'ready') return { rows: [], notes: ['Own forecasts must finish before recommendations are available.'], forecastCoverage: 0, salaryCoverage: 0, ownershipCoverage: 0, excludedPlayers: 0 };
  const notes = ['Research shortlist, not a completed lineup or a guarantee. Forecasts assume participation; verify starters and late injury news.',
    'Ownership is an uncalibrated model estimate, not measured contest data. A lower estimate alone does not make a player a good pick.'];
  const rows: LineupInsight[] = [];
  let excludedPlayers = 0;
  const metricMap = new Map(sheet.metrics.map(m => [m.id, m]));
  for (const player of sheet.players) {
    if (player.roleContext?.eligible === false) { excludedPlayers++; continue; }
    const forecast = player.fantasy?.find(f => f.site === site);
    if (/\b(out|inactive|suspended|doubtful|ir|injured[- ]reserve|reserve\/injured|physically unable)\b/i.test(player.availability)) { excludedPlayers++; continue; }
    if (forecast?.status !== 'ready' || !finite(forecast.mean) || forecast.mean <= 0) continue;
    const matched = site === platform ? findUniqueSelectedSlateSalary(player, sheet, dashboard, platform) : undefined;
    const salary = finite(matched?.salary) && matched.salary > 0 ? matched.salary : null;
    const value = salary ? forecast.mean / (salary / 1000) : null;
    const reasons = [
      ...(player.roleContext ? [`${player.roleContext.label}: ${player.roleContext.source}. ${player.roleContext.recentWorkload != null ? `Recent ${player.roleContext.workloadUnit}: ${player.roleContext.recentWorkload}.` : ''}`] : []),
      `${round(forecast.mean)} ${site} points from ALLPLAY's matchup-adjusted stat forecasts.`,
    ];
    const cautions: string[] = [];
    const favorable = player.stats.filter(s => s.projected !== null && s.defenseGames >= 2 &&
      (metricMap.get(s.id)?.higherIsBetter ? s.matchupMultiplier >= 1.03 : s.matchupMultiplier <= .97))
      .sort((a, b) => Math.abs(b.matchupMultiplier - 1) - Math.abs(a.matchupMultiplier - 1))[0];
    if (favorable) reasons.push(`Opponent sample favors ${metricMap.get(favorable.id)?.label ?? favorable.id}: ${Math.round(Math.abs(favorable.matchupMultiplier - 1) * 100)}% adjustment from ${favorable.defenseGames} games.`);
    else if (!player.stats.some(s => s.defenseGames >= 2)) cautions.push('Opponent sample unavailable; matchup adjustment is neutral.');
    const workload = player.stats.find(s => ['minutes', 'timeOnIce', 'inningsPitched', 'targets', 'rushingAttempts', 'passingAttempts'].includes(s.id) && finite(s.projected) && s.projected > 0);
    if (workload) reasons.push(`Expected ${metricMap.get(workload.id)?.label ?? workload.id}: ${round(workload.projected!)}.`);
    if (value !== null) reasons.push(`${value.toFixed(1)}x projected value at the selected DFS site.`);
    for (const rating of player.publishedMatchups ?? []) {
      if (rating.status !== 'available' || rating.rank === null) continue;
      reasons.push(`${rating.source === 'pff' ? 'PFF' : 'FantasyPros'} opponent ${rating.unit}: #${rating.rank}/${rating.rankedTeams} (${rating.period}; #1 = ${rating.rankOneMeans === 'strongest' ? 'strongest defense' : 'most fantasy points allowed'}). Published context, not a forecast adjustment.`);
    }
    if (finite(forecast.p85)) reasons.push(`Modeled 85th-percentile outcome: ${round(forecast.p85)} points, not a confidence limit.`);
    if (player.historicalGames < 5) cautions.push(`Small sample: ${player.historicalGames} recorded appearances.`);
    const latest = Math.max(...player.history.map(h => Date.parse(h.date)).filter(Number.isFinite));
    if (Number.isFinite(latest) && Date.parse(sheet.slateDate) - latest > 45 * 86400000) cautions.push('Last recorded appearance is over 45 days old; role may have changed.');
    if (/\bquestionable|probable|day-to-day\b/i.test(player.availability)) cautions.push(player.availability);
    if (/unverified|unconfirmed|not verified|not guaranteed|conditional/i.test(`${player.availability} ${player.participation}`))
      cautions.push('Participation/starting role is not confirmed.');
    rows.push({ playerId: player.id, name: player.name, team: player.team, opponent: player.opponent, position: player.position,
      points: forecast.mean, floor: finite(forecast.p25) ? forecast.p25 : null, ceiling: finite(forecast.p85) ? forecast.p85 : null,
      salary, value, estimatedOwnership: null, ownershipMethod: null, rank: 0, reasons, cautions, tags: favorable ? ['Favorable matchup'] : [] });
  }
  const priced = rows.filter(r => r.salary !== null);
  const assumptions = shares[`${sheet.sport}:${platform}`];
  const slateName = dashboard?.salaryCoverage?.slates?.find(s => s.id === dashboard.salaryCoverage?.selectedSlateId)?.name ?? '';
  const classic = !/showdown|captain|single.?game|tiers/i.test(slateName) &&
    priced.every(r => !/CPT|CAPTAIN/i.test(findUniqueSelectedSlateSalary(sheet.players.find(p => p.id === r.playerId)!, sheet, dashboard, platform)?.rosterPositions ?? ''));
  const enough = rows.length >= 8 && priced.length >= 8 && priced.length / Math.max(rows.length, 1) >= .8;
  if (site === platform && assumptions && classic && enough) {
    const groups = Object.entries(assumptions).map(([position, slots]) => ({
      slots, group: priced.filter(r => role(r.position, sheet.sport) === position),
    }));
    // Missing positions make even a conditional selection-share estimate misleading.
    if (groups.every(g => g.group.length > g.slots)) {
      for (const { group, slots } of groups) {
        const ownership = allocateOwnership(group.map(row => ({ ...row, historicalGames: 0 })), slots);
        for (const row of group) { row.estimatedOwnership = ownership.get(row.playerId) ?? null; row.ownershipMethod = method; }
      }
      notes.push(method);
      if (sheet.sport === 'nfl') notes.push('Football ownership shares cover offensive skill players only; team-defense and kicker forecasts are not supplied.');
    }
  }
  const ownershipCoverage = rows.filter(r => r.estimatedOwnership !== null).length;
  if (!ownershipCoverage) notes.push('Ownership unavailable: requires a supported classic NFL/NHL/NBA format, complete position groups, and same-site/date/slate salaries for at least 80% of the scored pool. Single-game/showdown and unsupported templates remain blank.');
  if (priced.length < rows.length) notes.push(`${rows.length - priced.length} scored players lack an unambiguous matching salary. Their value and ownership stay blank; recommendations still use own points and matchup history.`);
  const scores = researchScores(rows.map(row => ({ ...row,
    historicalGames: sheet.players.find(r => r.id === row.playerId)?.historicalGames ?? 0,
  })), sheet.sport, style);
  rows.sort((a, b) => scores.get(b.playerId)! - scores.get(a.playerId)! || b.points - a.points || a.playerId.localeCompare(b.playerId));
  rows.forEach((row, i) => {
    row.rank = i + 1;
    if (row.value !== null && percentile(row.value, priced.map(r => r.value!)) >= .75) row.tags.push('Strong value');
    if (percentile(row.points, rows.map(r => r.points)) >= .75) row.tags.push('High projection');
    if (row.estimatedOwnership !== null && row.estimatedOwnership < 15 && percentile(row.points, rows.map(r => r.points)) >= .5)
      row.tags.push('Lower modeled ownership');
  });
  return { rows, notes, forecastCoverage: rows.length, salaryCoverage: priced.length, ownershipCoverage, excludedPlayers };
}
