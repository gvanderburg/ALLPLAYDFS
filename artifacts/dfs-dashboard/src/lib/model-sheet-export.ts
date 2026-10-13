import type {
  DfsDashboard,
  DfsSalaryPlatform,
  ModelFantasyForecast,
  ModelPlayerProjection,
  ModelProjectionSheet,
} from '@workspace/api-client-react';
import { findUniqueSelectedSlateSalary } from './model-salary-match';
import { deriveLineupInsights } from './lineup-insights';
import { positionRanks, formatValueMultiple } from './position-ranks';
export { findUniqueSelectedSlateSalary } from './model-salary-match';

export const MODEL_REFERENCE_HEADERS = [
  'DFS ID', 'Name', 'Pos', 'Team', 'Opp', 'Status', 'Salary', 'Actual', 'ALLPLAY Proj', 'My Proj', 'Value',
  'My Own', 'Adj Own', 'Min Exp', 'Max Exp', 'ALLPLAY Team', 'ALLPLAY Total',
  ...(['DK', 'FD', 'Yahoo', 'OB'] as const).flatMap((site) => [
    `${site} Points`, `${site} p25`, `${site} p50`, `${site} p75`, `${site} p85`, `${site} p95`, `${site} p99`, `${site} Std`,
  ]),
  'EV Line', 'PP Line', 'G', 'A', 'SOG', 'ShAtt', 'BLK', 'SV', 'GA', 'SO', 'W',
] as const;

const FORECAST_SITES = [
  ['draftkings', 'DK'],
  ['fanduel', 'FD'],
  ['yahoo', 'Yahoo'],
  ['ownersbox', 'OB'],
] as const;
type Site = typeof FORECAST_SITES[number][0];
type ForecastKey = 'mean' | 'std' | 'p25' | 'p50' | 'p75' | 'p85' | 'p95' | 'p99';

const fullForecastValue = (forecast: ModelFantasyForecast | undefined, key: ForecastKey): number | null =>
  forecast?.status === 'ready' ? forecast[key] : null;

const metricFor = (player: ModelPlayerProjection, id: string) => player.stats.find((stat) => stat.id === id);
const csvCell = (value: unknown) => {
  if (value == null) return '""';
  let text = String(value);
  // Escape spreadsheet formulas only for strings. Numeric negative model stats remain numeric.
  if (typeof value === 'string' && /^\s*[=+\-@]/.test(value)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

export function buildModelSheetCsv(
  sheet: ModelProjectionSheet,
  dashboard: DfsDashboard | undefined,
  platform: DfsSalaryPlatform,
): string {
  if (sheet.status !== 'ready') return '';
  const insights = new Map(deriveLineupInsights(sheet, dashboard, platform).rows.map(row => [row.playerId, row]));
  const ranksBySite = new Map(FORECAST_SITES.map(([site]) => [site, positionRanks(sheet, site)]));
  const headers = [...MODEL_REFERENCE_HEADERS, 'modelRole', 'modelPlayerId', 'participation', 'availability',
    'historicalGames', 'statusReason', 'modelTeamTotal', 'modelGameTotal', 'salarySource', 'salarySlateId',
    'model', 'backtested', 'fantasyResult', 'ownership', 'ownEVLineAssignment', 'ownPPLineAssignment',
    'exposureDefaultsNote', 'history', 'source', 'caveat', 'sport', 'requestedDate', 'slateDate',
    'generatedAt', 'effectiveAsOf', 'recentGames', 'recentWeightPct', 'matchupWeightPct',
    'gameCount', 'processedGames', 'totalGames', 'failedGames', 'observedTeams', 'modelFormula', 'sheetNotes', 'platform',
    'ALLPLAY Research Rank', 'ALLPLAY Pick Reasons', 'ALLPLAY Pick Cautions', 'Ownership Method',
    'Value Multiple', 'Position Rank Scope',
    'PFF Secondary Rank', 'PFF Period', 'PFF Source', 'PFF Status',
    'FantasyPros Position Rank', 'FantasyPros Period', 'FantasyPros Source', 'FantasyPros Status',
    'Playing Role', 'Depth Rank', 'Role Eligible', 'Role Source', 'Role Source URL', 'Role As Of', 'Role Note', 'Recent Workload', 'Workload Unit'];

  for (const [, prefix] of FORECAST_SITES) {
    headers.push(`${prefix} Status`, `${prefix} Tracked Mean`, `${prefix} Missing Stats`, `${prefix} Notes`,
      `${prefix} Scoring Source`, `${prefix} Rules As Of`, `${prefix} Sample Size`, `${prefix} Simulations`,
      `${prefix} Position Rank`, `${prefix} Position Peer Count`, `${prefix} Rank Role`);
  }
  for (const metric of sheet.metrics) {
    headers.push(
      `raw_${metric.id}`, `${metric.id}_recentAverage`, `${metric.id}_baselineAverage`,
      `${metric.id}_opponentRank`, `${metric.id}_rankedTeams`, `${metric.id}_opponentMultiplier`,
      `${metric.id}_opponentSampleGames`, `${metric.id}_opponentMean`, `${metric.id}_leagueMean`,
      `${metric.id}_sampleSize`, `${metric.id}_recentSampleSize`,
    );
  }

  const values = sheet.players.map((player) => {
    const salary = findUniqueSelectedSlateSalary(player, sheet, dashboard, platform);
    const insight = insights.get(player.id);
    const readyForecast = player.fantasy?.find((forecast) => forecast.site === platform && forecast.status === 'ready');
    const ownMean = readyForecast?.mean ?? '';
    const salaryValue = typeof ownMean === 'number' && salary?.salary != null && salary.salary > 0
      ? ownMean / (salary.salary / 1000)
      : '';
    const forecastBySite = new Map(player.fantasy?.map((forecast) => [forecast.site, forecast]) ?? []);
    const rawMetricIds = ['goals', 'assists', 'shots', 'shotAttempts', 'blockedShots', 'saves', 'goalsAgainst', 'shutouts', 'wins'];
    const rawMetricValues = rawMetricIds.map((id) => metricFor(player, id)?.projected ?? '');
    const reference = [
      salary?.salaryPlayerId ?? '', player.name, salary?.rosterPositions ?? '', player.team, player.opponent,
      player.availability, salary?.salary ?? '', '', ownMean, ownMean, salaryValue,
       '', insight?.estimatedOwnership ?? '', 0, 100, player.modelTeamTotal ?? '', player.modelGameTotal ?? '',
    ];
    for (const [site] of FORECAST_SITES) {
      const forecast = forecastBySite.get(site);
      reference.push(
        fullForecastValue(forecast, 'mean') ?? '',
        fullForecastValue(forecast, 'p25') ?? '',
        fullForecastValue(forecast, 'p50') ?? '',
        fullForecastValue(forecast, 'p75') ?? '',
        fullForecastValue(forecast, 'p85') ?? '',
        fullForecastValue(forecast, 'p95') ?? '',
        fullForecastValue(forecast, 'p99') ?? '',
        fullForecastValue(forecast, 'std') ?? '',
      );
    }
    reference.push('', '', ...rawMetricValues);

    const audit: unknown[] = [
      player.position, player.id, player.participation, player.availability, player.historicalGames,
      player.reason ?? '', player.modelTeamTotal ?? '', player.modelGameTotal ?? '', salary?.salarySource ?? '',
       salary?.salarySlateId ?? '', 'ALLPLAY custom model', 'No', '', insight?.estimatedOwnership ?? '', '', '',
      'Research defaults only (0–100); not optimizer controls.', player.history.map((appearance) =>
        `${appearance.date} vs ${appearance.opponent}: ${Object.entries(appearance.stats).map(([key, value]) => `${key}=${value}`).join('; ')}`,
      ).join(' | '),
      'ALLPLAY independent historical-performance matchup model',
      'Conditional on participation; observed ranks are not calibrated probabilities. Fantasy percentiles are simulation outcomes, not confidence intervals. Not backtested.',
      sheet.sport.toUpperCase(), sheet.requestedDate, sheet.slateDate, sheet.generatedAt, sheet.effectiveAsOf ?? '',
      sheet.recentGames, sheet.recentWeight, sheet.matchupWeight, sheet.gameCount, sheet.processedGames,
       sheet.totalGames, sheet.failedGames, sheet.observedTeams, sheet.modelFormula, sheet.notes.join('; '), platform,
       insight?.rank ?? '', insight?.reasons.join('; ') ?? '', insight?.cautions.join('; ') ?? '', insight?.ownershipMethod ?? '',
    ];
    audit.push(formatValueMultiple(typeof salaryValue === 'number' ? salaryValue : null),
      'Own full fantasy projection, current-slate primary-role candidates; ties share rank. OUT/IR/inactive/doubtful excluded.');
    for (const source of ['pff', 'fantasypros']) {
      const ranking = player.publishedMatchups?.find(row => row.source === source);
      audit.push(ranking?.status === 'available' ? ranking.rank ?? '' : '', ranking?.period ?? '',
        ranking?.sourceUrl ?? '', ranking?.status ?? 'unavailable');
    }
    audit.push(player.roleContext?.label ?? '', player.roleContext?.depthRank ?? '', player.roleContext?.eligible ?? '',
      player.roleContext?.source ?? '', player.roleContext?.sourceUrl ?? '', player.roleContext?.asOf ?? '', player.roleContext?.note ?? '',
      player.roleContext?.recentWorkload ?? '', player.roleContext?.workloadUnit ?? '');
    for (const [site] of FORECAST_SITES) {
      const forecast = forecastBySite.get(site);
      const rank = ranksBySite.get(site)?.get(player.id);
      audit.push(
        forecast?.status ?? 'unavailable', forecast?.trackedMean ?? '',
        forecast?.missingStats.join('; ') ?? '', forecast?.notes.join('; ') ?? '',
        forecast?.scoringSource ?? '', forecast?.rulesAsOf ?? '', forecast?.sampleSize ?? '', forecast?.simulations ?? '',
        rank?.rank ?? '', rank?.count ?? '', rank?.position ?? '',
      );
    }
    for (const metric of sheet.metrics) {
      const stat = metricFor(player, metric.id);
      audit.push(
        stat?.projected ?? '', stat?.recentAverage ?? '', stat?.baselineAverage ?? '',
        stat?.opponentRank ?? '', stat?.rankedTeams ?? '', stat?.matchupMultiplier ?? '',
        stat?.defenseGames ?? '', stat?.opponentMean ?? '', stat?.leagueMean ?? '',
        stat?.sampleSize ?? '', stat?.recentSampleSize ?? '',
      );
    }
    return [...reference, ...audit];
  });

  return [
    headers.map(csvCell).join(','),
    ...values.map((row) => row.map(csvCell).join(',')),
  ].join('\r\n');
}
