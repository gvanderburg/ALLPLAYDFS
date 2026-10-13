import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'allplay-roles-'));
await build({stdin:{contents:'export * from "./src/lib/projection-model/playing-roles"; export * from "./src/lib/projection-model/role-sources"; export * from "./src/lib/projection-model/calculate"; export * from "./src/lib/projection-model/fantasy";',resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:join(dir,'roles.mjs')});
const {applyTeamRoles,parseDepth,hockeyLines,hockeyStarter,calculatePlayers,scoringRule,lineupCalendarDay}=await import(pathToFileURL(join(dir,'roles.mjs')));
test.after(()=>rm(dir,{recursive:true,force:true}));
const candidate=(id,position,name=id)=>({id,name,position,teamId:'26',team:'SEA',opponentId:'7',opponent:'DEN',availability:'Active',participation:'Unverified'});
const game=(index,players)=>({id:`g${index}`,date:`2026-10-0${index+1}T20:00:00Z`,phase:2,season:2026,venue:'',teams:[{id:'26',abbreviation:'SEA'},{id:'7',abbreviation:'DEN'}],players});
const input=(sport,players,history)=>({sport,players,history,teamId:'26',teamName:'Seattle Seahawks',opponentName:'Denver Broncos',date:'2026-10-15',startTime:'2026-10-16T00:15:00Z',season:2026,probable:''});
const qbStats=(yards,td)=>({...Object.fromEntries(Object.keys(scoringRule('nfl','draftkings',false,'QB').weights).map(k=>[k,0])),passingYards:yards,passingTDs:td,passingAttempts:35,passingCompletions:25,rushingAttempts:0,targets:0});
test('Seattle depth order prevents Drew Lock historic starts from outranking Sam Darnold',async()=>{
  const players=[candidate('3912547','QB','Sam Darnold'),candidate('3924327','QB','Drew Lock')];
  const history=[1,2,3].map(i=>game(i,players.map((p,j)=>({...p,stats:qbStats(j?400:240,j?4:2)}))));
  const payload=JSON.parse(await readFile(new URL('../fixtures/seattle-depth-role.json',import.meta.url),'utf8'));
  const depth=parseDepth(payload,'nfl',2026), roles=applyTeamRoles(input('nfl',players,history),depth,null,null,null);
  assert.equal(roles[0].roleContext.eligible,true);assert.equal(roles[1].roleContext.eligible,false);
  assert.equal(roles[1].roleContext.depthRank,2);assert.match(roles[1].roleContext.note,/Sam Darnold/);
  const calculated=calculatePlayers('nfl',roles,history,{recentGames:3,recentWeight:70,matchupWeight:25},'2026-10-13',2);
  assert.ok(calculated.players[0].fantasy.find(f=>f.site==='draftkings').mean>0);
  assert.equal(calculated.players[1].fantasy.find(f=>f.site==='draftkings').mean,null);
  assert.ok(calculated.players[1].stats.every(s=>s.projected===null));
  assert.ok(calculated.players[1].history.length>0);
});
test('NBA/WNBA rotations preserve productive bench players and use recent observed minutes',()=>{
  for(const sport of ['nba','wnba']){
    const p=candidate('bench','SG');
    const history=[1,2,3].map(i=>game(i,[{...p,stats:{minutes:12,points:10,rebounds:3,assists:2,blocks:0,steals:1,turnovers:1,threePointers:2}}]));
    const depth=new Map([['bench',{rank:2,unit:'SG',starterName:'Starter'}]]);
    const [role]=applyTeamRoles(input(sport,[p],history),depth,null,null,null);
    assert.equal(role.roleContext.eligible,true);assert.equal(role.roleContext.status,'rotation');
    const older=[4,5,6].map(i=>({...game(0,[{...p,stats:{minutes:36,points:30,rebounds:9,assists:6,blocks:0,steals:3,turnovers:3,threePointers:6}}]),id:`old${i}`,date:'2026-09-20T00:00:00Z'}));
    const result=calculatePlayers(sport,[role],[...history,...older],{recentGames:5,recentWeight:70,matchupWeight:0},'2026-10-13',2).players[0];
    assert.equal(result.stats.find(s=>s.id==='minutes').projected,12);
    assert.ok(result.stats.find(s=>s.id==='points').projected<20);
  }
});
test('CFB uses recent passing evidence when published depth is unavailable; no roster-order starter guesses',()=>{
  const a=candidate('lead','QB'),b=candidate('backup','QB');
  const history=[1,2,3].map(i=>game(i,[{...a,stats:qbStats(220,2)},{...b,stats:{...qbStats(100,1),passingAttempts:2}}]));
  const roles=applyTeamRoles(input('cfb',[a,b],history),new Map(),null,null,null);
  assert.equal(roles[0].roleContext.status,'projected-starter');
  assert.equal(roles[1].roleContext.eligible,false);
});
test('NHL goalie depth is not a daily start; dated likely/confirmed starters and scratches control eligibility',()=>{
  const goalie=candidate('g','G','Goalie One'),backup=candidate('b','G','Goalie Two'),skater=candidate('s','C','Skater');
  const i={...input('nhl',[goalie,backup,skater],[]),teamName:'Anaheim Ducks',opponentName:'New Jersey Devils'};
  const lines={lines:new Map([['skater',{label:'Scratch',rank:null,scratched:true}]]),asOf:new Date()};
  let rows=applyTeamRoles(i,new Map(),lines,null,null);
  assert.equal(rows[0].roleContext.eligible,false);
  rows=applyTeamRoles(i,new Map(),lines,{name:'Goalie One',confirmed:true,asOf:new Date()},null);
  assert.equal(rows[0].roleContext.eligible,true);assert.equal(rows[1].roleContext.eligible,false);
  assert.equal(rows[2].roleContext.eligible,false);
});
test('MLB rotation rank one cannot become today’s pitcher; published batting order overrides depth',()=>{
  const pitcher=candidate('p','SP'),hitter=candidate('h','CF','Hitter');
  const i=input('mlb',[pitcher,hitter],[]);
  const depth=new Map([['p',{rank:1,unit:'SP',starterName:'p'}],['h',{rank:1,unit:'CF',starterName:'Hitter'}]]);
  let rows=applyTeamRoles(i,depth,null,null,{names:['someoneelse'],pitcher:'',url:'https://www.mlb.com'});
  assert.equal(rows[0].roleContext.eligible,false);assert.equal(rows[1].roleContext.eligible,false);
  rows=applyTeamRoles({...i,probable:'p'},depth,null,null,{names:['hitter'],pitcher:'p',url:'https://www.mlb.com'});
  assert.equal(rows[0].roleContext.eligible,true);assert.equal(rows[1].roleContext.label,'Batting order 1');
});
test('stale, mismatched and scratch-conflicted hockey lines cannot fabricate active assignments',()=>{
  const payload={combinations:{teamName:'Anaheim Ducks',updatedAt:new Date().toISOString(),players:[{name:'Skater',categoryIdentifier:'ev',groupIdentifier:'f1'},{name:'Skater',categoryIdentifier:'oi',groupIdentifier:'ir'}]}};
  assert.equal(hockeyLines(payload,'Anaheim Ducks').lines.get('skater').scratched,true);
  assert.equal(hockeyLines(payload,'Other Team').lines.size,0);
  assert.equal(hockeyLines(payload,'Anaheim Ducks',Date.now()+8*86400000).lines.size,0);
  assert.equal(hockeyStarter({date:'2026-10-12'},'2026-10-13','Team','Other'),null);
});
test('all offensive receiver slots and kickers are recognized, but returners/holders cannot promote backups',()=>{
  const d={season:{year:2026},team:{id:'26'},depthchart:[
    {name:'3WR 1TE',positions:{wr2:{athletes:[{id:'wr',displayName:'Receiver'}]}}},
    {name:'Special Teams',positions:{pk:{athletes:[{id:'k',displayName:'Kicker'}]},h:{athletes:[{id:'backup',displayName:'Backup'}]}}},
  ]};
  const result=parseDepth(d,'nfl',2026,'26');
  assert.equal(result.get('wr').rank,1);assert.equal(result.get('k').rank,1);assert.equal(result.has('backup'),false);
  assert.equal(parseDepth(d,'nfl',2026,'wrong').size,0);assert.equal(parseDepth(d,'nfl',2025,'26').size,0);
});
test('night-game lineup lookup uses the report’s calendar, not UTC midnight',()=>{
  assert.equal(lineupCalendarDay('2026-10-14T02:00:00Z','2026-10-14'),'2026-10-13');
});
test('historical role research cannot read future games or resurrect old-season starters',()=>{
  const qb=candidate('qb','QB'), history=[1,2,3].map(i=>game(i,[{...qb,stats:qbStats(250,2)}]));
  const past=applyTeamRoles({...input('cfb',[qb],history),date:'2026-10-02'},new Map(),null,null,null)[0];
  assert.equal(past.roleContext.eligible,false);
  const old=applyTeamRoles(input('cfb',[qb],history.map(g=>({...g,date:'2025-10-01T20:00:00Z'}))),new Map(),null,null,null)[0];
  assert.equal(old.roleContext.eligible,false);
});
test('unverified NASCAR entrants retain history but cannot acquire an expected slate workload',()=>{
  const driver={...candidate('driver','Driver'),roleContext:{eligible:false,note:'Entry not published'}};
  const history=[1,2,3].map(i=>game(i,[{...driver,stats:{finish:4,start:10,lapsLed:20,fastestLaps:10,lapsCompleted:100}}]));
  const p=calculatePlayers('nascar',[driver],history,{recentGames:3,recentWeight:70,matchupWeight:0},'2026-10-13',2).players[0];
  assert.ok(p.stats.every(s=>s.projected===null));assert.equal(p.history.length,3);
});
