import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const dir=await mkdtemp(join(tmpdir(),'allplay-feedback-'));
await build({stdin:{contents:'export {createFeedbackRouter} from "./src/routes/feedback"; export {db,feedbackTickets,pool} from "@workspace/db"; export {eq,inArray} from "drizzle-orm"; export {default as express} from "express";',resolveDir:process.cwd()},
  bundle:true,platform:'node',format:'esm',outfile:join(dir,'test.mjs'),banner:{js:'import {createRequire} from "node:module";const require=createRequire(import.meta.url);'}});
const {createFeedbackRouter,db,feedbackTickets,pool,eq,inArray,express}=await import(pathToFileURL(join(dir,'test.mjs')));
const prefix=`feedback-test-${randomUUID()}`, a=`${prefix}-a`,b=`${prefix}-b`,owner=`${prefix}-owner`;
const app=express();app.use(express.json());app.use('/api',createFeedbackRouter({userId:req=>req.header('x-test-user')??null,owner:id=>id===owner}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));
const url=`http://127.0.0.1:${server.address().port}/api/feedback`;
async function request(user,method='GET',body,suffix=''){
  const r=await fetch(url+suffix,{method,headers:{...(user?{'x-test-user':user}:{}),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:r.status,body:await r.json(),cache:r.headers.get('cache-control')};
}
const input={category:'issue',subject:'Projection issue',details:'This is an isolated feedback integration test.',sport:'nfl',contextPath:'/projections'};
test.after(async()=>{await db.delete(feedbackTickets).where(inArray(feedbackTickets.reporterId,[a,b,owner]));await pool.end();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
test('feedback HTTP workflow persists tickets, separates accounts, restricts owner writes and applies quota atomically',async()=>{
  assert.equal((await request(null,'POST',input)).status,401);
  assert.equal((await request(a,'POST',{...input,subject:'   '})).status,400);
  assert.equal((await request(a,'POST',{...input,contextPath:'/sign-in?token=secret'})).status,400);
  const created=await request(a,'POST',{...input,reporterId:b,status:'resolved',ownerResponse:'spoofed'});
  assert.equal(created.status,201);assert.equal(created.body.status,'open');assert.equal(created.body.ownerResponse,'');
  assert.equal('reporterId' in created.body,false);
  assert.match(created.cache,/no-store/);
  assert.equal((await request(a)).body.items[0].id,created.body.id);
  assert.equal((await request(b)).body.items.length,0);
  assert.equal((await request(b,'GET',undefined,'?scope=all')).status,403);
  assert.equal((await request(b,'PATCH',{status:'resolved',ownerResponse:'fake'},`/${created.body.id}`)).status,403);
  const reply=await request(owner,'PATCH',{status:'in_progress',ownerResponse:'Looking into it'},`/${created.body.id}`);
  assert.equal(reply.status,200);
  const reloaded=await request(a);
  assert.equal(reloaded.body.items[0].status,'in_progress');assert.equal(reloaded.body.items[0].ownerResponse,'Looking into it');
  assert.ok((await request(owner,'GET',undefined,'?scope=all')).body.items.some(t=>t.id===created.body.id));
  assert.equal((await request(owner,'PATCH',{status:'resolved',ownerResponse:''},`/${created.body.id}`)).body.ownerResponse,'');
  assert.equal((await request(owner,'PATCH',{status:'bad',ownerResponse:''},`/${created.body.id}`)).status,400);
  assert.equal((await request(owner,'PATCH',{status:'open',ownerResponse:''},'/2147483647')).status,404);
  assert.equal((await request(a,'GET',undefined,'?before=nope')).status,400);
  assert.equal((await request(a,'GET',undefined,`?before=${created.body.id}`)).body.items.length,0);
  const batch=await Promise.all(Array.from({length:6},()=>request(a,'POST',input)));
  assert.equal(batch.filter(r=>r.status===201).length,4);assert.equal(batch.filter(r=>r.status===429).length,2);
  assert.equal((await request(a)).body.items.length,5);
});
