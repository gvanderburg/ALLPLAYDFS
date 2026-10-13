import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'allplay-forward-football-'));
await build({stdin:{contents:'export * from "./src/lib/projection-model/calculate"; export * from "./src/lib/projection-model/normalize"; export * from "./src/lib/projection-model/history-cutoff";',resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:join(dir,'model.mjs')});
const {calculatePlayers,normalizeSummary,forecastHistoryCutoff,verifiedFinalsAsOf,unstartedModelEvents}=await import(pathToFileURL(join(dir,'model.mjs')));
test.after(()=>rm(dir,{recursive:true,force:true}));
const cutoff='2026-10-13T23:00:00.000Z';
const stats={passingAttempts:20,passingCompletions:14,passingYards:140,passingTDs:1,interceptionsThrown:0,rushingAttempts:2,rushingYards:10,rushingTDs:0};
const player={id:'p',name:'Test QB',position:'QB',team:'AAA',teamId:'a',opponent:'BBB',opponentId:'b',availability:'Verified',participation:'Starter'};
const game=(id,season=2026,s=stats)=>({id,version:5,date:season===2026?`2026-10-0${id}T20:00:00Z`:'2025-12-01T20:00:00Z',season,phase:2,venue:'',teams:[{id:'a',name:'A',abbreviation:'AAA'},{id:'b',name:'B',abbreviation:'BBB'}],players:[{...player,stats:s},{id:'op',name:'Opp QB',position:'QB',teamId:'b',stats:{...stats,passingAttempts:40,passingCompletions:28,passingYards:280}}]});
const calc=(games,role)=>calculatePlayers('nfl',[{...player,...(role?{roleContext:role}:{})}],games,{recentGames:3,recentWeight:70,matchupWeight:25},cutoff,2,'',2026).players[0];
const value=(p,id)=>p.stats.find(s=>s.id===id);
test('forward cutoff includes today while past previews remain day-bounded',()=>{
  const now=new Date(cutoff);
  assert.equal(forecastHistoryCutoff('2026-10-15',now),cutoff);
  assert.equal(forecastHistoryCutoff('2026-10-13',now),cutoff);
  assert.equal(forecastHistoryCutoff('2026-10-12',now),'2026-10-12T00:00:00.000Z');
});
test('only finals actually observed before the forward snapshot qualify',()=>{
  const earlier={...game('1'),date:'2026-10-13T16:00:00Z',finalObservedAt:'2026-10-13T20:00:00Z'};
  assert.deepEqual(verifiedFinalsAsOf([earlier,{...earlier,id:'later',finalObservedAt:'2026-10-14T01:00:00Z'},{...earlier,id:'unknown',finalObservedAt:undefined},{...earlier,id:'future',date:'2026-10-15T20:00:00Z'}],cutoff).map(g=>g.id),['1']);
});
test('forward slates exclude started/live/final/cancelled games, including US evenings crossing UTC midnight',()=>{
  const event=(id,state,date='2026-10-14T02:00:00Z',completed=false)=>({id,date,status:{type:{state,completed}}});
  assert.deepEqual(unstartedModelEvents([event('upcoming','pre'),event('live','in'),event('final','post',undefined,true),event('old','pre','2026-10-13T21:00:00Z'),event('cancelled','post')],Date.parse(cutoff)).map(e=>e.id),['upcoming']);
});
test('QB production is opportunity times recorded efficiency, without double-scaling a role override',()=>{
  const role={eligible:true,workloadUnit:'passingAttempts',recentWorkload:10};
  const p=calc([game('1'),game('2')],role);
  assert.equal(value(p,'passingAttempts').projected,10);
  assert.equal(value(p,'passingYards').projected,70);
  assert.equal(value(p,'passingCompletions').projected,7);
  assert.equal(value(p,'passingTDs').projected,.5);
});
test('current-season samples replace stale previous-season production when supported',()=>{
  const p=calc([game('1'),game('2'),game('3',2025,{...stats,passingAttempts:50,passingYards:500,passingTDs:8})]);
  assert.equal(p.historicalGames,2);
  assert.equal(value(p,'passingYards').projected,value(calc([game('1'),game('2')]),'passingYards').projected);
  assert.equal(value(p,'passingYards').baselineAverage,140);
  assert.equal(value(p,'passingYards').sampleSize,2);
});
test('defensive efficiency does not reward a defense merely for facing more pass attempts',()=>{
  const p=calc([game('1'),game('2')]);
  assert.equal(value(p,'passingYards').matchupMultiplier,1);
  assert.equal(value(p,'passingYards').opponentMean,7);
  assert.equal(value(p,'passingYards').matchupBasis,'Per passing attempt');
});
test('small touchdown streaks regress toward real same-position league evidence, not provider projections',()=>{
  const receiver={...player,position:'WR'};
  const games=[game('1'),game('2')].map(g=>({...g,players:[
    {...receiver,stats:{targets:10,receptions:7,receivingYards:70,receivingTDs:3}},
    ...Array.from({length:8},(_,i)=>({id:`peer-${i}`,teamId:'b',name:'Peer',position:'WR',stats:{targets:10,receptions:7,receivingYards:70,receivingTDs:1}})),
  ]}));
  const p=calculatePlayers('nfl',[receiver],games,{recentGames:3,recentWeight:70,matchupWeight:0},cutoff,2,'',2026).players[0];
  const td=value(p,'receivingTDs');
  assert.ok(td.projected>1 && td.projected<3);
  assert.ok(td.ratePriorMean>0 && td.ratePriorMean<.3);
  assert.ok(td.ratePriorOpportunities>0);
});
test('missing historical positions use a disclosed opportunity cohort rather than invented position labels',()=>{
  const receiver={...player,position:'WR'};
  const games=[game('1'),game('2')].map(g=>({...g,players:Array.from({length:9},(_,i)=>({
    id:i===0?'p':`peer-${i}`,teamId:i===0?'a':'b',name:'Receiver',position:'',
    stats:{targets:10,receptions:7,receivingYards:70,receivingTDs:i===0?3:1},
  }))}));
  const p=calculatePlayers('nfl',[receiver],games,{recentGames:3,recentWeight:70,matchupWeight:0},cutoff,2,'',2026).players[0];
  const td=value(p,'receivingTDs');
  assert.ok(td.projected<3);
  assert.match(td.ratePriorScope,/positions unavailable/);
  assert.equal(p.position,'WR');
});
function box(net='162',sack='5-33'){
  return {header:{id:'g',season:{year:2026,type:2},competitions:[{date:'2026-10-11T20:25:00Z',status:{type:{completed:true}},competitors:[{team:{id:'a'}},{team:{id:'b'}}]}]},boxscore:{players:[{team:{id:'a'},statistics:[
    {name:'passing',keys:['completions/passingAttempts','passingYards','passingTouchdowns','interceptions','sacks-sackYardsLost'],totals:['18/29',net,'1','2',sack],athletes:[{athlete:{id:'p',displayName:'QB',position:{abbreviation:'QB'}},stats:['18/29','195','1','2','5-33']}]},
    {name:'receiving',keys:['receptions','receivingYards','receivingTouchdowns','receivingTargets'],totals:['6','80','1','8'],athletes:[{athlete:{id:'wr',displayName:'Receiver',position:{abbreviation:'WR'}},stats:['6','80','1','8']}]},
  ]}]}};
}
test('net team passing yards reconcile to gross athlete yards minus verified sacks',()=>{
  const g=normalizeSummary(box(),'nfl'), receiver=g.players.find(p=>p.id==='wr');
  assert.equal(receiver.stats.passingYards,0);
  assert.equal(receiver.stats.passingAttempts,0);
  assert.equal(g.players.find(p=>p.id==='p').stats.passingYards,195);
  assert.ok(Number.isFinite(Date.parse(g.finalObservedAt)));
});
test('incomplete or inconsistent passing tables must not invent a receiver passing-yard zero',()=>{
  for(const input of [box('160'),box('162','5-30')]){
    assert.equal(normalizeSummary(input,'nfl').players.find(p=>p.id==='wr').stats.passingYards,undefined);
  }
  const live=box();live.header.competitions[0].status.type.completed=false;
  assert.equal(normalizeSummary(live,'nfl'),null);
});
