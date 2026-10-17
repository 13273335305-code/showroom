import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
const generate=app.slice(app.indexOf('async function captureAiGenerate(){'),app.indexOf('function formatCount'));
const urlHelper=app.slice(app.indexOf('function buildCaptureAiUrl('),app.indexOf('function cleanCaptureBase64('));
function harness(model,{switchBeforeSend=false,failResponse=false}={}){
 let user='alice';const requests=[],saved=[],statuses=[];
 const nodes={captureAiGenerate:{disabled:false},captureWidth:{value:'1920'},captureHeight:{value:'1080'},captureShoot:{disabled:false},captureAiSettingsOpen:{disabled:false}};
 const store={assertAccount:async owner=>{if(owner!==user)throw new Error('账号已切换')},loadSite:async()=>{if(switchBeforeSend)user='bob';return 'https://newest.example'}};
 class Reader{readAsDataURL(){this.result='encoded-test-image';this.onload()}}
 const canvas={getContext:()=>({drawImage(){}}),toBlob:resolve=>resolve(new Blob(['png'],{type:'image/png'}))};
 const names=['$','captureAiStore','setCaptureAiBusy','captureFilename','setCaptureAiStatus','saveCaptureAiConfig','captureFrameBlob','FileReader','cleanCaptureBase64','fetch','extractCaptureImage','captureBase64Blob','createImageBitmap','document','addPhoto','notify'];
 const values=[id=>nodes[id],store,busy=>{nodes.captureAiGenerate.disabled=busy},()=> 'test-photo',(...args)=>statuses.push(args),async()=>({apiKey:'private-test-key',prompt:'test prompt',model,aspect:'AUTO',size:'1K'}),async()=>new Blob(['input']),Reader,x=>x,
  async(url,options)=>{requests.push({url,options});return {ok:!failResponse,status:failResponse?401:200,text:async()=>JSON.stringify(failResponse?{error:{message:'private-test-key'}}:{test:true})}},
  ()=>({data:'test',mime:'image/png'}),()=>new Blob(['image']),async()=>({width:1024,height:1024,close(){}}),{createElement:()=>canvas},async(blob,metadata)=>saved.push(metadata),()=>{}];
 const capture=new Function(...names,`let captureMode=true,captureAiLoaded={ownerId:'alice'},captureAiVersion=1,captureAiRequest=null;${urlHelper}${generate};return captureAiGenerate;`)(...values);
 return {capture,nodes,requests,saved,statuses};
}
test('AI requests use the latest site address, full model ID and current account Key',async()=>{
 for(const model of ['gemini-3-pro-image','gemini-3.1-flash-lite-image']){
  const h=harness(model);await h.capture();
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,`https://newest.example/v1beta/models/${model}:generateContent`);
  assert.equal(h.requests[0].options.headers['X-API-Key'],'private-test-key');
  assert.equal(h.saved[0].ownerId,'alice');assert.equal(h.saved[0].source,'ai');
  assert.equal(h.nodes.captureShoot.disabled,false);assert.equal(h.nodes.captureAiSettingsOpen.disabled,false);
 }
});
test('account change before API request prevents sending the old Key or saving a result',async()=>{
 const h=harness('gemini-3-pro-image',{switchBeforeSend:true});await h.capture();
 assert.equal(h.requests.length,0);assert.equal(h.saved.length,0);assert.match(h.statuses.at(-1)[0],/账号已切换/);
 assert.equal(h.nodes.captureShoot.disabled,false);
});
test('API errors never echo a private Key from the response',async()=>{
 const h=harness('gemini-3-pro-image',{failResponse:true});await h.capture();
 assert.equal(h.saved.length,0);assert.match(h.statuses.at(-1)[0],/HTTP 401/);assert.ok(!h.statuses.flat().join(' ').includes('private-test-key'));
});
