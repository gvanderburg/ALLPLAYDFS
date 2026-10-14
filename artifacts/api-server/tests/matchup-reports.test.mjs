import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const dir = await mkdtemp(join(tmpdir(), 'allplay-report-'));
await build({ stdin: { contents: `
  export { createMatchupReportRouter } from "./src/routes/matchup-reports";
  export { validateReport } from "./src/lib/projection-model/report-validation";
  export { selectReportRanking } from "./src/lib/projection-model/report-selection";
  export { attachPublishedMatchups } from "./src/lib/projection-model/published-rankings";
  export { approvedReports } from "./src/lib/projection-model/report-store";
  export { db, matchupReports, pool } from "@workspace/db";
  export { eq } from "drizzle-orm";
  export { default as express } from "express";
`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile: join(dir, 'test.mjs'),
  banner: { js: 'import {createRequire} from "node:module"; const require=createRequire(import.meta.url);' },
  plugins: [{ name: 'isolated-model-cache', setup(build) {
    build.onResolve({ filter: /projection-model\/service$/ }, () => ({ path: 'model-cache', namespace: 'test' }));
    build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export function invalidatePublishedReports() {}', loader: 'js' }));
  } }],
});
const { createMatchupReportRouter, validateReport, selectReportRanking, attachPublishedMatchups, approvedReports,
  db, matchupReports, pool, eq, express } = await import(pathToFileURL(join(dir, 'test.mjs')));
const owner = `test-report-${randomUUID()}`, otherOwner = `${owner}-second`;
const app = express(); app.use(express.json()); app.use((req, res, next) => { req.log = { error() {} }; next(); });
app.use('/api', createMatchupReportRouter({ userId: req => req.get('x-test-user') ?? null, owner: id => [owner, otherOwner].includes(id) }));
const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const input = (overrides = {}) => ({
  metadata: { publisher: 'fantasypros', season: 2026, phase: 'regular', startWeek: 1, endWeek: 6,
    publishedAt: '2026-09-20T12:00:00Z', asOf: '2026-09-20T11:00:00Z', positions: ['QB'],
    rankOneMeans: 'most-allowed', sourceUrl: 'https://www.fantasypros.com/nfl/points-allowed.php' },
  authorized: true, format: 'csv', content: 'team,position,rank\nDenver Broncos,QB,19\nWSH,QB,2', ...overrides,
});
const now = new Date('2026-10-14T12:00:00Z');
const request = async (user, suffix = '', method = 'GET', data, origin = base) => {
  const response = await fetch(`${base}/api/matchup-reports${suffix}`, { method,
    headers: { 'Content-Type': 'application/json', Origin: origin, ...(user ? { 'x-test-user': user } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  return { status: response.status, data: response.status === 204 ? null : await response.json(), cache: response.headers.get('cache-control') };
};
test.after(async () => {
  for (const id of [owner, otherOwner]) await db.delete(matchupReports).where(eq(matchupReports.ownerId, id));
  await pool.end(); await new Promise(r => server.close(r)); await rm(dir, { recursive: true, force: true });
});
test('report validation rejects unapproved access, teams, ranks, directions, dates and scopes; detects full coverage', () => {
  const report = validateReport(input(), now);
  assert.equal(report.fullCoverage, false); assert.equal(report.coverage.QB, 2); assert.equal(report.rows[1].team, 'WAS');
  const teams = ['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS'];
  const full = validateReport(input({ format: 'json', content: JSON.stringify(teams.map((team, i) => ({ team, position: 'QB', rank: i + 1 }))) }), now);
  assert.equal(full.fullCoverage, true); assert.equal(full.coverage.QB, 32);
  for (const content of ['team,position,rank\nBAD,QB,2', 'team,position,rank\nDEN,QB,33',
    'team,position,rank\nDEN,QB,1.2', 'team,position,rank\nDEN,QB,1\nDenver Broncos,QB,2',
    'team,position,rank\nDEN,QB,1\nBUF,QB,1', 'team,position,rank\nDEN,WR,1',
    'team,position,rank\n"DEN,QB,1', 'team,rank\nDEN,1']) assert.throws(() => validateReport(input({ content }), now));
  assert.throws(() => validateReport(input({ authorized: false }), now));
  for (const change of [{ endWeek: 0 }, { startWeek: 8 }, { positions: ['QB', 'QB'] },
    { sourceUrl: 'https://fantasypros.com.evil.test/report' }, { sourceUrl: 'https://user:pass@fantasypros.com/' },
    { rankOneMeans: 'strongest' }, { publishedAt: '2027-01-01T00:00:00Z' },
    { asOf: '2026-10-01T00:00:00Z' }, { publisher: 'pff' }])
    assert.throws(() => validateReport(input({ metadata: { ...input().metadata, ...change } }), now));
});
test('matchup joins use the correct opponent, role, season/phase/week and cutoff without altering means', () => {
  const report = { ...validateReport(input(), now), id: 'fixture', status: 'approved', createdAt: now };
  const lookup = (opponent = 'DEN', role = 'QB', season = 2026, phase = 2, week = 6, cutoff = now) =>
    selectReportRanking([report], 'fantasypros', opponent, role, season, phase, week, cutoff);
  assert.equal(lookup().rank, 19);
  assert.equal(lookup('WSH').rank, 2);
  assert.equal(lookup('BUF').status, 'unavailable');
  assert.equal(lookup('DEN', 'RB'), null);
  for (const args of [['DEN','QB',2025,2,6], ['DEN','QB',2026,1,6], ['DEN','QB',2026,2,7],
    ['DEN','QB',2026,2,null], ['DEN','QB',2026,2,6,new Date('2026-09-19T00:00:00Z')]])
    assert.equal(lookup(...args).status, 'stale');
  assert.equal(selectReportRanking([{ ...report, status: 'preview' }], 'fantasypros', 'DEN', 'QB', 2026, 2, 6, now), null);
  const empty = { ranks: {}, period: 'Unavailable', asOf: null, coverage: 0, note: 'No public coverage' };
  const player = { id: 'test', opponent: 'DEN', position: 'QB', stats: [{ projected: 222 }], fantasy: [{ mean: 20 }] };
  const result = attachPublishedMatchups([player], 'nfl', empty, empty, 'https://www.pff.com/', 'https://www.fantasypros.com/', now, [report], { season: 2026, phase: 2, weeks: { DEN: 6 } })[0];
  assert.equal(result.publishedMatchups[1].rank, 19);
  assert.deepEqual(result.stats, player.stats); assert.deepEqual(result.fantasy, player.fantasy);
  const stale = attachPublishedMatchups([player], 'nfl', empty, empty, '', '', now, [report], { season: 2026, phase: 2, weeks: { DEN: 7 } })[0];
  assert.equal(stale.publishedMatchups[1].status, 'stale');
  const partialPublic = { ...empty, coverage: 10, ranks: { BUF: { QB: 3 } } };
  const missing = attachPublishedMatchups([{ ...player, opponent: 'BUF' }], 'nfl', empty, partialPublic, '', '', now, [report], { season: 2026, phase: 2, weeks: { BUF: 6 } })[0];
  assert.equal(missing.publishedMatchups[1].rank, null); // never fill an incomplete stored period from live data
  const pff = { ...report, ...validateReport(input({ metadata: { ...input().metadata, publisher: 'pff', positions: ['secondary'], rankOneMeans: 'strongest', sourceUrl: 'https://www.pff.com/report' }, content: 'team,position,rank\nDEN,secondary,1' }), now) };
  assert.equal(selectReportRanking([pff], 'pff', 'DEN', 'WR', 2026, 2, 5, now).rankOneMeans, 'strongest');
});
test('owner-only HTTP preview/approval/replacement/deletion persists, expires and never trusts member writes', async () => {
  for (const user of [null, 'member']) {
    for (const [path, method, body] of [['','GET'], ['/preview','POST',input()], ['/fake/approve','POST',{confirmed:true}], ['/fake','DELETE']]) {
      const response = await request(user, path, method, body);
      assert.equal(response.status, user ? 403 : 401); assert.equal(response.cache, 'private, no-store');
    }
  }
  assert.equal((await request(owner, '/preview', 'POST', input(), 'https://evil.test')).status, 403);
  assert.equal((await request(owner, '/preview', 'POST', input({ authorized: false }))).status, 400);
  const preview = await request(owner, '/preview', 'POST', input());
  assert.equal(preview.status, 200); assert.equal(preview.data.status, 'preview');
  assert.equal((await request(owner)).data.some(r => r.id === preview.data.id), false);
  assert.equal((await request(otherOwner, `/${preview.data.id}/approve`, 'POST', { confirmed: true })).status, 409);
  assert.equal((await request(owner, `/${preview.data.id}/approve`, 'POST', { confirmed: false })).status, 400);
  const saved = await request(owner, `/${preview.data.id}/approve`, 'POST', { confirmed: true });
  assert.equal(saved.status, 200); assert.equal(saved.data.status, 'approved');
  assert.equal((await approvedReports()).find(r => r.id === saved.data.id).metadata.asOf instanceof Date, true);
  assert.equal((await request(owner, `/${preview.data.id}/approve`, 'POST', { confirmed: true })).status, 409);
  const next = await request(owner, '/preview', 'POST', input({ content: 'team,position,rank\nDEN,QB,5' }));
  assert.equal((await request(owner, `/${next.data.id}/approve`, 'POST', { confirmed: true, replaceId: 'missing' })).status, 409);
  const replaced = await request(owner, `/${next.data.id}/approve`, 'POST', { confirmed: true, replaceId: saved.data.id });
  assert.equal(replaced.status, 200); assert.equal(replaced.data.rows[0].rank, 5);
  assert.equal((await request(owner)).data.some(r => r.id === saved.data.id), false);
  assert.equal((await request(owner, `/${replaced.data.id}`, 'DELETE')).status, 204);
  assert.equal((await request(owner, `/${replaced.data.id}`, 'DELETE')).status, 404);
  const expired = await request(owner, '/preview', 'POST', input());
  await db.update(matchupReports).set({ createdAt: new Date(Date.now() - 3600001) }).where(eq(matchupReports.id, expired.data.id));
  assert.equal((await request(owner, `/${expired.data.id}/approve`, 'POST', { confirmed: true })).status, 409);
});
