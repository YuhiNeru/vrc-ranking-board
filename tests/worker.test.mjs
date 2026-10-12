import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{validateSnapshot} from '../worker/index.js';
import {demoSnapshot} from '../scripts/demo.mjs';
const real=()=>({...demoSnapshot(),demo:false,eligibleCount:132});
test('Ingest strips unrelated fields and accepts valid sample-shaped observations',()=>{
  const payload=real();payload.worlds[0].users=['secret'];payload.cookie='secret';
  const cleaned=validateSnapshot(payload);
  assert.equal(cleaned.cookie,undefined);assert.equal(cleaned.worlds[0].users,undefined);
});
test('Reject demo, missing counts, duplicate ids and impossible coverage',()=>{
  assert.throws(()=>validateSnapshot(demoSnapshot()));
  let p=real();delete p.worlds[0].public;assert.throws(()=>validateSnapshot(p));
  p=real();p.worlds[1].id=p.worlds[0].id;assert.throws(()=>validateSnapshot(p));
  p=real();p.candidateCount=10;assert.throws(()=>validateSnapshot(p));
});
test('Ingest cannot write without an authenticated token',async()=>{
  const response=await worker.fetch(new Request('https://example.com/api/ingest',{method:'POST',body:'{}'}),{});
  assert.equal(response.status,401);
});
test('Live API never silently substitutes sample data',async()=>{
  const response=await worker.fetch(new Request('https://example.com/api/latest'),{});
  assert.equal(response.status,503);
});
test('Authenticated ingest writes only validated public snapshot fields',async()=>{
  const token='a'.repeat(48),calls=[];
  const db={prepare(sql){return {bind(...values){calls.push({sql,values});return this;}};},async batch(statements){assert.equal(statements.length,2);}};
  const response=await worker.fetch(new Request('https://example.com/api/ingest',{method:'POST',headers:{authorization:`Bearer ${token}`},body:JSON.stringify(real())}),{DB:db,INGEST_TOKEN:token});
  assert.equal(response.status,200);assert.equal(calls.length,1);
  assert.equal(JSON.parse(calls[0].values[2]).worlds.length,132);
});
