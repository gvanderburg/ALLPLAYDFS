import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(), 'allplay-published-'));
await build({ stdin: { contents: 'export * from "./src/lib/projection-model/published-rankings";', resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile: join(dir, 'ranks.mjs') });
const { parsePffSecondary, parseFantasyProsPreview, attachPublishedMatchups, nflTeamKey } = await import(pathToFileURL(join(dir, 'ranks.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));
const teams = ['New England Patriots','Houston Texans','Denver Broncos','Philadelphia Eagles','Pittsburgh Steelers','Seattle Seahawks','Los Angeles Rams','Baltimore Ravens','Jacksonville Jaguars','Green Bay Packers','Los Angeles Chargers','Cleveland Browns','Detroit Lions','Buffalo Bills','New York Jets','Chicago Bears','Tampa Bay Buccaneers','Las Vegas Raiders','New York Giants','Dallas Cowboys','Indianapolis Colts','San Francisco 49ers','Minnesota Vikings','New Orleans Saints','Carolina Panthers','Atlanta Falcons','Arizona Cardinals','Tennessee Titans','Cincinnati Bengals','Kansas City Chiefs','Washington Commanders','Miami Dolphins'];
const pffHtml = `<h1>2026 NFL secondary rankings: fixture</h1><script>{"datePublished":"2026-08-20T14:03:03Z"}</script>${teams.map((team,i) => `<h3>${i+1}. <a>${team}</a></h3>`).join('')}`;
const fpHtml = (rows = [{team:{id:'DEN'},qb_rk:19,rb_rk:7,wr_rk:29,te_rk:12}]) => `window.FP.reportConfig = ${JSON.stringify({type:'points-allowed',sport:'NFL',subtitle:'Average Per Game Weeks 1 - 5 in 2026',table:{rows}})}; window.FP.isLoggedIn = false;`;
const cutoff = new Date('2026-10-13T00:00:00Z');
test('PFF requires all 32 distinct teams/ranks and a verified season/date', () => {
  assert.equal(parsePffSecondary(pffHtml,2026).coverage,32);
  assert.equal(parsePffSecondary(pffHtml,2026).ranks.SEA.secondary,6);
  assert.equal(parsePffSecondary(pffHtml.replace('32.','31.'),2026).coverage,0);
  assert.equal(parsePffSecondary(pffHtml.replace('Miami Dolphins','Unknown team'),2026).coverage,0);
  assert.equal(parsePffSecondary(pffHtml,2025).coverage,0);
  assert.equal(parsePffSecondary('<h1>Blocked</h1>',2026).coverage,0);
});
test('FantasyPros parses only supplied public rows; inaccessible teams remain absent', () => {
  const result = parseFantasyProsPreview(fpHtml(),2026,cutoff);
  assert.equal(result.coverage,1); assert.equal(result.ranks.DEN.WR,29);
  assert.equal(result.ranks.SEA,undefined);
  assert.match(result.note,/authorized access/);
  assert.equal(parseFantasyProsPreview(fpHtml(),2025).coverage,0);
  assert.equal(parseFantasyProsPreview('<h1>Sign in</h1>',2026).coverage,0);
});
test('published ranks remain separately attributed, with opposite rank-one meanings', () => {
  const players = [
    {id:'wr',position:'WR',opponent:'DEN',fantasy:[{mean:19}]},
    {id:'missing',position:'WR',opponent:'SEA'},
    {id:'rb',position:'RB',opponent:'DEN'},
  ];
  const result = attachPublishedMatchups(players,'nfl',parsePffSecondary(pffHtml,2026),parseFantasyProsPreview(fpHtml(),2026,cutoff),'https://pff.com','https://fantasypros.com',cutoff);
  assert.equal(result[0].publishedMatchups[0].rank,3);
  assert.equal(result[0].publishedMatchups[0].rankOneMeans,'strongest');
  assert.equal(result[0].publishedMatchups[1].rank,29);
  assert.equal(result[0].publishedMatchups[1].rankOneMeans,'most-allowed');
  assert.equal(result[1].publishedMatchups[1].rank,null);
  assert.equal(result[2].publishedMatchups[0].status,'unsupported');
  assert.equal(result[2].publishedMatchups[1].rank,7);
  assert.deepEqual(result[0].fantasy,players[0].fantasy);
});
test('football sources cannot become hockey or NASCAR defense ratings, or leak future publications', () => {
  const players=[{id:'p',position:'WR',opponent:'DEN'}], pff=parsePffSecondary(pffHtml,2026),fp=parseFantasyProsPreview(fpHtml(),2026,cutoff);
  for(const sport of ['nhl','nba','mlb','nascar','cfb'])
    assert.ok(attachPublishedMatchups(players,sport,pff,fp,'pff','fp',cutoff)[0].publishedMatchups.every(r=>r.status==='unsupported' && r.rank===null));
  assert.equal(attachPublishedMatchups(players,'nfl',pff,fp,'pff','fp',new Date('2026-08-01'))[0].publishedMatchups[0].rank,null);
  assert.equal(nflTeamKey('Denver Broncos'),'DEN');
  assert.equal(nflTeamKey('WSH'),'WAS');
});
test('current downloaded public pages satisfy the parsers when supplied for a live smoke check', async () => {
  if (process.env.ALLPLAY_PUBLIC_RANK_SMOKE !== '1') return;
  assert.equal(parsePffSecondary(await readFile('/tmp/pff-secondary.html','utf8'),2026).coverage,32);
  const fp=parseFantasyProsPreview(await readFile('/tmp/fp-allowed.html','utf8'),2026);
  assert.ok(fp.coverage > 0 && fp.coverage <= 32);
});
