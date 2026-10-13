import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'allplay-full-sheet-'));
await build({stdin:{contents:`
  import {createElement} from "react";
  import {renderToStaticMarkup} from "react-dom/server";
  import {PlayerTable} from "./src/components/model-projections";
  export const render=(sheet,dashboard)=>renderToStaticMarkup(createElement(PlayerTable,{sheet,dashboard,platform:"draftkings",onPlatformChange:()=>{}}));
`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',jsx:'automatic',
  define:{'import.meta.env':JSON.stringify({BASE_URL:'/',DEV:false,MODE:'test'})},
  banner:{js:'import {createRequire} from "node:module"; const require=createRequire(import.meta.url);'},
  outfile:join(dir,'sheet.mjs')});
const {render}=await import(pathToFileURL(join(dir,'sheet.mjs')));
test.after(()=>rm(dir,{recursive:true,force:true}));
test('the real full sheet shows raw stats, fantasy outcomes, x-value and both published rankings together',()=>{
  const date='2026-10-15T00:00:00.000Z';
  const p={id:'fixture',name:'Fixture Receiver',position:'WR',team:'SEA',opponent:'DEN',availability:'Questionable',participation:'Conditional on playing',historicalGames:5,
    fantasy:[{site:'draftkings',status:'ready',mean:17,p25:10,p50:16,p75:22,p85:25,p95:30,p99:40,std:5,missingStats:[],notes:[]}],
    stats:[{id:'receivingYards',projected:90,matchupMultiplier:1,defenseGames:5,opponentRank:4,rankedTeams:32}],
    history:[{date:'2026-10-01T20:00:00Z',opponent:'AAA',stats:{receivingYards:80}}],
    publishedMatchups:[
      {source:'pff',unit:'secondary',rank:3,rankedTeams:32,rankOneMeans:'strongest',sourceUrl:'https://www.pff.com/news/nfl-secondary-rankings-2026',period:'Preseason 2026',asOf:'2026-08-20T14:03:03Z',status:'available',note:'PFF source context'},
      {source:'fantasypros',unit:'vs WR',rank:29,rankedTeams:32,rankOneMeans:'most-allowed',sourceUrl:'https://www.fantasypros.com/nfl/points-allowed.php',period:'Weeks 1–5 in 2026',asOf:'2026-10-13T20:00:00Z',status:'available',note:'Public preview'},
    ]};
  const sheet={status:'ready',sport:'nfl',slateDate:date,players:[p],metrics:[{id:'receivingYards',label:'Receiving yards',unit:'yds',group:'Receiving',higherIsBetter:true}],notes:[]};
  const dashboard={date,events:[],salaryCoverage:{platform:'draftkings',available:true,selectedSlateId:'s1',slates:[{id:'s1',name:'Main'}]},projections:[{id:'salary',name:p.name,team:p.team,sport:'nfl',salary:5000,salaryPlatform:'draftkings',salarySlateId:'s1'}]};
  const html=render(sheet,dashboard);
  const head=html.match(/<thead>([\s\S]*?)<\/thead>/)[1], body=html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
  for(const text of ['Receiving yards','DraftKings Points','VALUE','Position rank','PFF secondary','Defense vs position','P99']) assert.ok(head.includes(text),text);
  assert.ok(body.includes('3.4x'));
  const backup={...p,id:'backup',name:'Drew Lock',roleContext:{status:'backup',label:'QB2 · Backup',depthRank:2,eligible:false,
    source:'ESPN live depth chart',sourceUrl:'https://www.espn.com/nfl/team/depth/_/id/26',asOf:date,note:'Behind Sam Darnold',
    recentWorkload:35,workloadUnit:'passingAttempts',recentAppearances:3,teamGames:3}};
  const withBackup=render({...sheet,players:[p,backup]},dashboard);
  assert.ok(withBackup.includes('QB2 · Backup'));
  const backupOnly=render({...sheet,players:[backup]},{...dashboard,projections:[{...dashboard.projections[0],name:'Drew Lock'}]});
  const backupBody=backupOnly.split('<tbody>')[1].split('</tbody>')[0];
  assert.ok(backupBody.includes('No supported slate workload'));
  assert.ok(!backupBody.includes('3.4x'));
  assert.ok(body.includes('WR #1/1'));
  assert.ok(body.includes('injury-questionable'));
  assert.equal((head.match(/<th\b/g)||[]).length,(body.match(/<td\b/g)||[]).length);
  assert.equal((body.match(/matchup-hard/g)||[]).length,2);
  assert.ok(!head.includes('SALARY') && !head.includes('$1K'));
});
