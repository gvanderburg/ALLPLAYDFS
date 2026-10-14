import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(), 'allplay-picks-'));
await build({ stdin: { contents: 'export * from "./src/lib/lineup-insights"; export * from "./src/lib/model-sheet-export";', resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile: join(dir, 'picks.mjs') });
const { deriveLineupInsights, findUniqueSelectedSlateSalary, buildModelSheetCsv } = await import(pathToFileURL(join(dir, 'picks.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));
function fixture() {
  const players = ['PG', 'SG', 'SF', 'PF', 'C'].flatMap(position => Array.from({ length: 4 }, (_, i) => ({
    id: `${position}${i}`, name: `${position} Player ${i}`, team: 'AAA', opponent: 'BBB', position,
    historicalGames: 5, availability: 'Active', participation: 'Current roster; role unconfirmed',
    fantasy: [{ site: 'draftkings', status: 'ready', mean: 20 + i, p25: 15 + i, p85: 35 + i, missingStats: [], notes: [] }],
    stats: [{ id: 'points', projected: 20, matchupMultiplier: 1.1, defenseGames: 5 }],
    history: [{ date: '2026-10-12T20:00:00Z', stats: { points: 20 + i } }],
  })));
  const sheet = { status: 'ready', sport: 'nba', slateDate: '2026-10-13T00:00:00.000Z', players,
    metrics: [{ id: 'points', label: 'Points', higherIsBetter: true }], notes: [] };
  const dashboard = { date: '2026-10-13T00:00:00Z', salaryCoverage: { platform: 'draftkings', selectedSlateId: 's1', slates: [{ id: 's1', name: 'Main' }] },
    projections: players.map(p => ({ name: p.name, team: p.team, sport: 'nba', salaryPlatform: 'draftkings',
      salarySlateId: 's1', salary: 5000, rosterPositions: p.position, projectedPoints: 99999, ownership: 99 })) };
  return { sheet, dashboard };
}
test('real serialized ISO slate dates match date-only/day filters and salary metadata', () => {
  const { sheet, dashboard } = fixture();
  assert.equal(findUniqueSelectedSlateSalary(sheet.players[0], sheet, dashboard, 'draftkings').salary, 5000);
  assert.equal(deriveLineupInsights(sheet, dashboard, 'draftkings').salaryCoverage, 20);
});
test('NASCAR matches unique driver salary across car-team labels, but never crosses sport/site/day/slate', () => {
  const { sheet, dashboard } = fixture();
  sheet.sport = 'nascar';
  const p = sheet.players[0];
  p.team = 'Driver pool';
  sheet.players = [p];
  const row = dashboard.projections[0];
  row.sport = 'nascar'; row.team = 'Race team 19';
  dashboard.projections = [row];
  assert.equal(findUniqueSelectedSlateSalary(p, sheet, dashboard, 'draftkings').salary, 5000);
  for (const [key, value] of [['sport', 'nfl'], ['salarySlateId', 'other'], ['salaryPlatform', 'fanduel']]) {
    const before = row[key]; row[key] = value;
    assert.equal(findUniqueSelectedSlateSalary(p, sheet, dashboard, 'draftkings'), undefined);
    row[key] = before;
  }
  dashboard.date = '2026-10-14T00:00:00Z';
  assert.equal(findUniqueSelectedSlateSalary(p, sheet, dashboard, 'draftkings'), undefined);
  dashboard.date = sheet.slateDate;
  dashboard.projections.push({ ...row, team: 'Another car' });
  assert.equal(findUniqueSelectedSlateSalary(p, sheet, dashboard, 'draftkings'), undefined);
  dashboard.projections.pop();
  sheet.players.push({ ...p, id: 'duplicate' });
  assert.equal(findUniqueSelectedSlateSalary(p, sheet, dashboard, 'draftkings'), undefined);
});
test('NASCAR shortlist explains grid provenance and never uses a partial DraftKings subtotal as salary value', () => {
  const { sheet, dashboard } = fixture();
  sheet.sport = 'nascar'; sheet.players = [sheet.players[0]];
  const p = sheet.players[0];
  p.position = 'Driver';
  p.stats = [{ id: 'qualifyingStart', projected: 25, matchupBasis: 'ALLPLAY starting-grid forecast; not observed', defenseGames: 0 },
    { id: 'lapsCompleted', projected: 260, defenseGames: 0 }];
  p.fantasy = [{ site: 'fanduel', status: 'ready', mean: 50, p25: 30, p85: 70 },
    { site: 'draftkings', status: 'partial', mean: null, trackedMean: 48 }];
  const fd = deriveLineupInsights(sheet, dashboard, 'draftkings', 'fanduel');
  assert.equal(fd.rows.length, 1);
  assert.ok(fd.rows[0].reasons.some(s => /forecast; not observed/.test(s)));
  assert.ok(fd.rows[0].cautions.some(s => /not an observed qualifying/.test(s)));
  assert.ok(fd.rows[0].cautions.some(s => /Same-venue/.test(s)));
  assert.equal(fd.rows[0].salary, null);
  assert.equal(deriveLineupInsights(sheet, dashboard, 'draftkings').rows.length, 0);
});
test('own full fantasy forecasts generate explained ranked picks, never provider predictions', () => {
  const { sheet, dashboard } = fixture();
  const first = deriveLineupInsights(sheet, dashboard, 'draftkings');
  assert.equal(first.rows.length, 20);
  assert.ok(first.rows.every(r => r.points < 100 && r.rank > 0 && r.reasons.some(x => x.includes('Opponent sample'))));
  dashboard.projections.forEach(p => { p.projectedPoints = -1000; p.ownership = .001; });
  assert.deepEqual(deriveLineupInsights(sheet, dashboard, 'draftkings'), first);
  sheet.players[0].fantasy[0].mean = 100;
  sheet.players[0].fantasy[0].p25 = 80;
  sheet.players[0].fantasy[0].p85 = 125;
  const updated = deriveLineupInsights(sheet, dashboard, 'draftkings');
  assert.equal(updated.rows[0].playerId, sheet.players[0].id);
  assert.ok(updated.rows.find(r => r.playerId === sheet.players[0].id).estimatedOwnership > first.rows.find(r => r.playerId === sheet.players[0].id).estimatedOwnership);
});
test('supported ownership is deterministic, bounded, conditional and not copied', () => {
  const { sheet, dashboard } = fixture();
  const result = deriveLineupInsights(sheet, dashboard, 'draftkings');
  assert.equal(result.ownershipCoverage, 20);
  assert.ok(result.rows.every(r => r.estimatedOwnership > 0 && r.estimatedOwnership <= 100 && r.ownershipMethod.includes('Uncalibrated')));
  assert.ok(Math.abs(result.rows.reduce((n, r) => n + r.estimatedOwnership, 0) - 800) < 1);
  assert.deepEqual(deriveLineupInsights(sheet, dashboard, 'draftkings'), result);
  const csv = buildModelSheetCsv(sheet, dashboard, 'draftkings');
  assert.ok(csv.includes('ALLPLAY Research Rank') && csv.includes('Uncalibrated classic-slate'));
});
test('wrong dates, ambiguous salaries and different scoring sites never manufacture value or ownership', () => {
  const { sheet, dashboard } = fixture();
  dashboard.date = '2026-10-14';
  const mismatch = deriveLineupInsights(sheet, dashboard, 'draftkings');
  assert.equal(mismatch.salaryCoverage, 0);
  assert.ok(mismatch.rows.every(r => r.salary === null && r.value === null && r.estimatedOwnership === null));
  dashboard.date = '2026-10-13';
  dashboard.projections.push({ ...dashboard.projections[0] });
  assert.equal(findUniqueSelectedSlateSalary(sheet.players[0], sheet, dashboard, 'draftkings'), undefined);
  sheet.players.forEach(p => p.fantasy.push({ ...p.fantasy[0], site: 'fanduel' }));
  assert.ok(deriveLineupInsights(sheet, dashboard, 'draftkings', 'fanduel').rows.every(r => r.salary === null && r.estimatedOwnership === null));
});
test('out/doubtful players, partial scores and locked data cannot become recommended picks', () => {
  const { sheet, dashboard } = fixture();
  sheet.players[0].availability = 'Out';
  sheet.players[1].availability = 'Doubtful';
  sheet.players[2].fantasy[0].status = 'partial';
  sheet.players[2].fantasy[0].trackedMean = 99999;
  const result = deriveLineupInsights(sheet, dashboard, 'draftkings');
  assert.equal(result.rows.length, 17);
  assert.equal(result.excludedPlayers, 2);
  assert.ok(!result.rows.some(r => ['PG0', 'PG1', 'PG2'].includes(r.playerId)));
  sheet.status = 'locked';
  assert.equal(deriveLineupInsights(sheet, dashboard, 'draftkings').rows.length, 0);
});
test('incomplete role pools and showdown slates keep ownership unavailable rather than invent percentages', () => {
  const { sheet, dashboard } = fixture();
  dashboard.salaryCoverage.slates[0].name = 'NBA Showdown Captain';
  assert.equal(deriveLineupInsights(sheet, dashboard, 'draftkings').ownershipCoverage, 0);
  dashboard.salaryCoverage.slates[0].name = 'Main';
  sheet.players = sheet.players.filter(p => p.position !== 'C');
  assert.equal(deriveLineupInsights(sheet, dashboard, 'draftkings').ownershipCoverage, 0);
});
