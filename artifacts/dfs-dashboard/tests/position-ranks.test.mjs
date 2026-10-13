import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(), 'allplay-position-'));
await build({ stdin: { contents: 'export * from "./src/lib/position-ranks";', resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile: join(dir, 'ranks.mjs') });
const {positionRanks,formatValueMultiple,positionKey} = await import(pathToFileURL(join(dir,'ranks.mjs')));
test.after(() => rm(dir,{recursive:true,force:true}));
const player = (id,position,points,overrides={})=>({id,position,availability:'Active',fantasy:[{site:'draftkings',status:'ready',mean:points}],...overrides});
test('position ranks use own scored slate peers, preserve ties and separate positions',()=>{
  const ranks=positionRanks({sport:'nfl',players:[player('a','WR',20),player('b','WR',20),player('c','WR',10),player('qb','QB',40)]},'draftkings');
  assert.deepEqual(ranks.get('a'),{position:'WR',rank:1,count:3});
  assert.equal(ranks.get('b').rank,1);assert.equal(ranks.get('c').rank,3);
  assert.deepEqual(ranks.get('qb'),{position:'QB',rank:1,count:1});
});
test('partial, missing-site and ruled-out projections do not fabricate rankings',()=>{
  const sheet={sport:'nfl',players:[player('out','WR',20,{availability:'Out'}),player('partial','WR',20,{fantasy:[{site:'draftkings',status:'partial',mean:null,trackedMean:20}]}),player('active','WR',10)]};
  assert.equal(positionRanks(sheet,'draftkings').size,1);
  assert.equal(positionRanks(sheet,'fanduel').size,0);
});
test('role grouping and value formatting stay explicit and compact',()=>{
  assert.equal(positionKey({position:'LW'},'nhl'),'W');
  assert.equal(positionKey({position:'CF'},'mlb'),'OF');
  assert.equal(positionKey({position:'SP'},'mlb'),'P');
  assert.equal(formatValueMultiple(3.449),'3.4x');
  assert.equal(formatValueMultiple(0),'0.0x');
  assert.equal(formatValueMultiple(null),'—');
  assert.equal(formatValueMultiple(NaN),'—');
});
test('a depth-chart backup cannot outrank a starter even if a stale full-game score is present',()=>{
  const ranks=positionRanks({sport:'nfl',players:[player('starter','QB',15),player('backup','QB',40,{roleContext:{eligible:false}})]},'draftkings');
  assert.equal(ranks.get('starter').rank,1);assert.equal(ranks.has('backup'),false);
});
