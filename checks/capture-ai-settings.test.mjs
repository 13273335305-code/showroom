import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CAPTURE_AI_DEFAULTS, CAPTURE_AI_DEFAULT_BASE } from '../shared/capture-ai-store.js';

const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('const captureAiStore='),app.indexOf('function cleanCaptureBase64('));
function harness(){
 const nodes={};
 for(const id of ['captureAiKey','captureAiModel','captureAiBase','captureAiAspect','captureAiSize','captureAiPrompt','captureAiGenerate','captureAiStatus','captureAiSettingsStatus','captureMainPage','captureAiSettingsPage','captureAiSettingsOpen','captureAiSettingsBack','capturePanel'])
  nodes[id]={value:'',disabled:false,dataset:{},style:{},setAttribute(){},focus(){}};
 nodes.captureAiModel.options=[{value:CAPTURE_AI_DEFAULTS.model}];nodes.captureAiModel.add=option=>nodes.captureAiModel.options.push(option);
 let load=async()=>({ownerId:'alice',canManageSite:false,base:'https://site.example',...CAPTURE_AI_DEFAULTS,apiKey:'alice-test-key'}),accountSave=async()=>{},siteSave=async()=>{},callback;
 const calls=[],request=new AbortController(),cleared=[];
 const store={load:()=>load(),saveSite:async(...args)=>{calls.push(['site',...args]);return siteSave(...args)},saveAccount:async(...args)=>{calls.push(['account',...args]);return accountSave(...args)}};
 const api=new Function('createCaptureAiStore','workspaceClient','$','CAPTURE_AI_DEFAULTS','CAPTURE_AI_DEFAULT_BASE','localStorage','Option',source+`;captureAiRequest=arguments[7];return {loadCaptureAiConfig,saveCaptureAiConfig,closeCaptureAiSettings,initCaptureAiConfig,invalidateCaptureAiConfig,get loaded(){return captureAiLoaded}};`)(
  ()=>store,async()=>({client:{auth:{onAuthStateChange:fn=>{callback=fn}}},userId:'alice'}),id=>nodes[id],CAPTURE_AI_DEFAULTS,CAPTURE_AI_DEFAULT_BASE,{removeItem:key=>cleared.push(key)},function Option(text,value){this.text=text;this.value=value},request);
 return {api,nodes,calls,request,cleared,event:(...args)=>callback(...args),set load(fn){load=fn},set save(fn){accountSave=fn},set saveSite(fn){siteSave=fn}};
}
test('settings restore only after cloud read, clear immediately on sign-out and abort active requests',async()=>{
 const h=harness();await h.api.initCaptureAiConfig();
 assert.equal(h.nodes.captureAiKey.value,'alice-test-key');assert.equal(h.nodes.captureAiBase.readOnly,true);
 assert.deepEqual(h.cleared,['spenic-capture-ai-v1']);
 h.event('SIGNED_OUT',null);
 assert.equal(h.nodes.captureAiKey.value,'');assert.equal(h.nodes.captureAiKey.disabled,true);assert.equal(h.nodes.captureAiGenerate.disabled,true);assert.equal(h.api.loaded,null);assert.equal(h.request.signal.aborted,true);
});
test('failed cloud load never enables AI or restores unowned local credentials',async()=>{
 const h=harness();h.load=async()=>{throw new Error('数据库尚未初始化')};await h.api.loadCaptureAiConfig();
 assert.equal(h.nodes.captureAiKey.value,'');assert.equal(h.nodes.captureAiGenerate.disabled,true);assert.equal(h.nodes.captureAiSettingsStatus.textContent,'数据库尚未初始化');
});
test('reopening settings reuses current-account config without clearing or disabling the Key field',async()=>{
 const h=harness();await h.api.loadCaptureAiConfig();
 let reads=0;h.load=async()=>{reads++;throw new Error('A saved config should already be available')};
 const pending=h.api.loadCaptureAiConfig();
 assert.equal(h.nodes.captureAiKey.value,'alice-test-key');assert.equal(h.nodes.captureAiKey.disabled,false);
 assert.equal(h.nodes.captureAiGenerate.disabled,false);assert.equal(reads,0);
 await pending;assert.equal(h.nodes.captureAiKey.value,'alice-test-key');
});
test('account invalidation clears the cached config before the next settings load',async()=>{
 const h=harness();await h.api.loadCaptureAiConfig();h.api.invalidateCaptureAiConfig();
 assert.equal(h.nodes.captureAiKey.value,'');
 let reads=0;h.load=async()=>{reads++;return {ownerId:'bob',canManageSite:false,base:'https://site.example',...CAPTURE_AI_DEFAULTS,apiKey:'bob-test-key'}};
 await h.api.loadCaptureAiConfig();
 assert.equal(reads,1);assert.equal(h.nodes.captureAiKey.value,'bob-test-key');assert.equal(h.api.loaded.ownerId,'bob');
});
test('late old-account load cannot repopulate a cleared Key',async()=>{
 const h=harness();let resolve;h.load=()=>new Promise(r=>resolve=r);
 const pending=h.api.loadCaptureAiConfig();h.api.invalidateCaptureAiConfig();
 resolve({ownerId:'alice',base:'https://site.example',...CAPTURE_AI_DEFAULTS,apiKey:'alice-test-key'});await pending;
 assert.equal(h.nodes.captureAiKey.value,'');assert.equal(h.api.loaded,null);
});
test('Done waits for account save, keeps settings visible on failure and never rewrites unchanged global address',async()=>{
 const h=harness();await h.api.loadCaptureAiConfig();h.nodes.captureAiSettingsPage.hidden=false;
 h.nodes.captureAiKey.value='changed-test-key';let reject;h.save=()=>new Promise((_,r)=>reject=r);
 const pending=h.api.closeCaptureAiSettings();
 assert.equal(h.nodes.captureAiKey.disabled,true);assert.equal(h.nodes.captureAiSettingsPage.hidden,false);
 reject(new Error('保存失败'));await pending;
 assert.equal(h.nodes.captureAiSettingsPage.hidden,false);assert.equal(h.nodes.captureAiKey.value,'changed-test-key');assert.equal(h.nodes.captureAiKey.disabled,false);
 assert.equal(h.calls.filter(call=>call[0]==='site').length,0);
 h.save=async()=>{};await h.api.closeCaptureAiSettings();
 assert.equal(h.nodes.captureAiSettingsPage.hidden,true);assert.equal(h.calls.at(-1)[1],'alice');assert.equal(h.calls.at(-1)[2].apiKey,'changed-test-key');
});
