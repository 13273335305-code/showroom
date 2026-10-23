import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
const generate=app.slice(app.indexOf('async function captureAiGenerate(){'),app.indexOf('function formatCount'));
function harness(model,{switchBeforeSend=false,failResponse=false}={}){
 let user='alice';const requests=[],saved=[],statuses=[];
 const nodes={captureAiGenerate:{disabled:false},captureWidth:{value:'1920'},captureHeight:{value:'1080'},captureShoot:{disabled:false},captureAiSettingsOpen:{disabled:false}};
 const store={assertAccount:async owner=>{if(switchBeforeSend)user='bob';if(owner!==user)throw new Error('账号已切换')},generate:async(owner,model,body,signal)=>{requests.push({owner,model,body,signal});return {ok:!failResponse,status:failResponse?401:200,text:async()=>JSON.stringify(failResponse?{error:{message:'HTTP 401 private-test-key'}}:{test:true})}}};
 class Reader{readAsDataURL(){this.result='encoded-test-image';this.onload()}}
 const canvas={getContext:()=>({drawImage(){}}),toBlob:resolve=>resolve(new Blob(['png'],{type:'image/png'}))};
 const names=['$','captureAiStore','setCaptureAiBusy','captureFilename','setCaptureAiStatus','saveCaptureAiConfig','captureFrameBlob','FileReader','cleanCaptureBase64','fetch','extractCaptureImage','captureBase64Blob','createImageBitmap','document','addPhoto','notify'];
 const values=[id=>nodes[id],store,busy=>{nodes.captureAiGenerate.disabled=busy},()=> 'test-photo',(...args)=>statuses.push(args),async()=>({apiKey:'private-test-key',prompt:'test prompt',model,aspect:'AUTO',size:'1K'}),async()=>new Blob(['input']),Reader,x=>x,
  async(url,options)=>{requests.push({url,options});return {ok:!failResponse,status:failResponse?401:200,text:async()=>JSON.stringify(failResponse?{error:{message:'private-test-key'}}:{test:true})}},
  ()=>({data:'test',mime:'image/png'}),()=>new Blob(['image']),async()=>({width:1024,height:1024,close(){}}),{createElement:()=>canvas},async(blob,metadata)=>saved.push(metadata),()=>{}];
 const capture=new Function(...names,`let captureMode=true,captureAiLoaded={ownerId:'alice'},captureAiVersion=1,captureAiRequest=null;${generate};return captureAiGenerate;`)(...values);
 return {capture,nodes,requests,saved,statuses};
}
test('AI generation uses authenticated transport with complete model IDs and Banana image parameters',async()=>{
 for(const model of ['「Rim」gemini-3.1-flash-image-preview','「YQ」gemini-3.1-flash-image-preview']){
  const h=harness(model);await h.capture();
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].owner,'alice');assert.equal(h.requests[0].model,model);
  assert.equal(h.requests[0].body.generationConfig.topP,.95);assert.deepEqual(h.requests[0].body.generationConfig.responseModalities,['IMAGE']);
  assert.equal(h.requests[0].body.generationConfig.imageConfig.imageSize,'1K');assert.ok(!JSON.stringify(h.requests).includes('private-test-key'));
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
