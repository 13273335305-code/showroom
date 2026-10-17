import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptureAiStore, validateCaptureAiBase } from '../shared/capture-ai-store.js';

function harness(){
 let userId='alice',base='https://shared.example',error=null,afterRead=null;
 const accounts=new Map(),calls=[];
 const client={from(table){
  const site=table==='spenic_capture_ai_site';
  return {
   select(){return {eq(field,id){return {async single(){return read(id)},async maybeSingle(){return read(id)}}}}},
   upsert(value){calls.push({table,value:structuredClone(value)});return {select(){return {async single(){
    if(error)return {error};
    if(site){base=value.base;return {data:{base}}}
    accounts.set(value.owner_id,structuredClone(value));return {data:{owner_id:value.owner_id}};
   }}}}},
  };
  async function read(id){const data=site?{base}:accounts.get(id)||null;afterRead?.();return {data,error}}
 }};
 const access=async()=>({client,userId,canManageSite:true});
 return {access,accounts,calls,set user(value){userId=value},set base(value){base=value},set error(value){error=value},set afterRead(value){afterRead=value}};
}
test('endpoint follows the site and complete model plus Key follow each account across store instances',async()=>{
 const h=harness(),a=createCaptureAiStore(h);
 await a.saveAccount('alice',{apiKey:'alice-test-key',model:'gemini-3-pro-image'});
 await a.saveSite('alice','https://changed.example/');
 const restored=await createCaptureAiStore(h).load();
 assert.equal(restored.apiKey,'alice-test-key');assert.equal(restored.model,'gemini-3-pro-image');assert.equal(restored.base,'https://changed.example');
 h.user='bob';let b=await a.load();assert.equal(b.apiKey,'');assert.equal(b.base,restored.base);
 await a.saveAccount('bob',{apiKey:'bob-test-key',model:'gemini-3.1-flash-lite-image'});
 assert.equal((await a.load()).apiKey,'bob-test-key');
 h.user='alice';assert.equal((await a.load()).apiKey,'alice-test-key');
 assert.deepEqual(Object.keys(h.calls.find(call=>call.table==='spenic_capture_ai_site').value),['id','base']);
 h.base='https://newest.example';assert.equal(await a.loadSite('alice'),'https://newest.example');
});
test('account switches before saving or during loading never use another account config',async()=>{
 const h=harness(),store=createCaptureAiStore(h);h.user='bob';
 await assert.rejects(store.saveAccount('alice',{apiKey:'alice-test-key'}),/账号已切换/);
 await assert.rejects(store.saveSite('alice','https://example.com'),/账号已切换/);assert.equal(h.calls.length,0);
 h.user='alice';h.afterRead=()=>{h.user='bob'};
 await assert.rejects(store.load(),/账号已切换/);
});
test('missing schema and network errors cannot silently fall back to a shared browser Key',async()=>{
 const h=harness(),store=createCaptureAiStore(h);
 h.error={code:'PGRST205',message:'secret-should-not-be-shown'};
 await assert.rejects(store.load(),/supabase\/capture-ai.sql/);
 h.error={message:'secret-should-not-be-shown'};
 await assert.rejects(store.saveAccount('alice',{apiKey:'test'}),error=>/保存失败/.test(error.message)&&!error.message.includes('secret'));
 h.error={code:'42501'};await assert.rejects(store.saveSite('alice','https://site.example'),/开发者账号/);
});
test('global endpoint rejects embedded credentials and query keys',()=>{
 for(const value of ['','ftp://test','https://user:pass@test','https://test?key=secret','https://test#secret'])assert.throws(()=>validateCaptureAiBase(value));
 assert.equal(validateCaptureAiBase('https://test/v1beta/models/{{model}}:generateContent/'),'https://test/v1beta/models/{{model}}:generateContent');
});
