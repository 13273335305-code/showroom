const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
function makeBmp() {
  const w=32,h=24,stride=w*3,data=Buffer.alloc(54+stride*h);
  data.write('BM');data.writeUInt32LE(data.length,2);data.writeUInt32LE(54,10);data.writeUInt32LE(40,14);
  data.writeInt32LE(w,18);data.writeInt32LE(h,22);data.writeUInt16LE(1,26);data.writeUInt16LE(24,28);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.set((x+y)%7<3?[50,90,190]:[235,240,245],54+y*stride+x*3);
  return data;
}
(async()=>{
 const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/shared/auth.js'){
   res.setHeader('Content-Type','text/javascript');return res.end('export async function requireAuth(){document.documentElement.classList.remove("auth-pending");document.getElementById("authBootLoading")?.remove();} export const authState=()=>({id:"11111111-1111-1111-1111-111111111111"}); export const workspaceClient=async()=>(await import("./project-store.js")).fixtureAccess();');
  }
  const file=path.resolve(root,'.'+decodeURIComponent(pathname));
  if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
  try{const body=await fs.readFile(file);res.setHeader('Content-Type',{'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[path.extname(file)]||'application/octet-stream');
   res.end(pathname==='/entries/material-editor.js'?body.toString()+'\nwindow.previewProbe=()=>({plane,sheenBall,material,camera,controls,renderer,scene,asset:()=>currentAsset(),revisions:proceduralRevisions});':body);
  }catch{res.writeHead(404).end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const fixture=await require('./project-test-server.cjs').installProjectFixture(context);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const base='http://127.0.0.1:'+server.address().port;
  await page.goto(base+'/material-editor.html');await page.waitForFunction(()=>window.previewProbe&&!document.getElementById('saveMaterial').disabled);
  const maps=page.locator('#materialPreviewMaps');assert.equal(await maps.locator('[data-preview-map]').count(),8);
  const equalWidths=async()=>assert.equal(await maps.locator('[data-preview-map]').evaluateAll(buttons=>{
    const widths=buttons.map(button=>button.getBoundingClientRect().width);
    return Math.max(...widths)-Math.min(...widths)<1&&buttons.every(button=>button.scrollWidth<=button.clientWidth);
  }),true,'All preview buttons have equal widths and readable labels');
  assert.equal(await maps.isVisible(),true,'Ordinary materials share the preview bar');await equalWidths();
  assert.equal(await page.locator('#proceduralParameters').isVisible(),false,'Procedural controls stay collapsed before BMP upload');
  assert.equal(await page.locator('#proceduralCropStart').isVisible(),false,'Crop button stays hidden before BMP upload');
  assert.equal(await page.locator('.editor-mode-switch').count(),0);
  assert.equal(await page.locator('#uploadProceduralBmp').isVisible(),true);
  await fs.mkdir(path.join(root,'.codex-project-check'),{recursive:true});
  await page.screenshot({path:path.join(root,'.codex-project-check/material-properties-empty.png')});
  await page.locator('[data-material-type=pattern]').click();assert.equal(await maps.isVisible(),false);
  await page.locator('[data-material-type=fabric]').click();assert.equal(await maps.isVisible(),true);
  const ordinaryMaps={base:'map',normal:'normalMap',roughness:'roughnessMap',metalness:'metalnessMap',ao:'aoMap'};
  for(const [kind,key] of Object.entries(ordinaryMaps)){
   assert.equal(await maps.locator('[data-preview-map='+kind+']').isDisabled(),true);
   await page.locator('#map-'+key).setInputFiles({name:'ordinary.bmp',mimeType:'image/bmp',buffer:makeBmp()});
   await page.waitForFunction(kind=>!document.querySelector('[data-preview-map='+kind+']').disabled,kind);
   await maps.locator('[data-preview-map='+kind+']').click();
   assert.equal(await page.evaluate(key=>{const p=previewProbe();return p.plane.material.isMeshBasicMaterial&&p.plane.material.map.image===p.material[key].image&&p.plane.material.map!==p.material[key];},key),true);
   await page.locator('[data-preview-mode=ball]').click();await page.locator('[data-preview-mode=flat]').click();
  }
  await maps.locator('[data-preview-map=roughness]').click();
  await page.locator('#openSizingPage').click();await page.locator('#sizing').selectOption('legacy');
  await page.locator('#repeatU').fill('2');await page.locator('#repeatU').press('Tab');
  await page.locator('#repeatV').fill('3');await page.locator('#repeatV').press('Tab');
  assert.deepEqual(await page.evaluate(()=>{const t=previewProbe().plane.material.map;return [t.channel,...t.repeat.toArray()];}),[0,2,3],'Ordinary previews retain legacy UV placement');
  await page.locator('#sizing').selectOption('physical');await page.locator('#closeSizingPage').click();
  await page.locator('#upload-roughnessMap').hover();await page.locator('#remove-roughnessMap').click();
  assert.equal(await maps.locator('[data-preview-map=roughness]').isDisabled(),true);
  assert.equal(await page.evaluate(()=>previewProbe().plane.material===previewProbe().material),true,'Removing the displayed map restores material effect');
  await page.locator('#map-roughnessMap').setInputFiles({name:'roughness.bmp',mimeType:'image/bmp',buffer:makeBmp()});
  await page.waitForFunction(()=>!document.querySelector('[data-preview-map=roughness]').disabled);
  const frame=page.frameLocator('#proceduralFrame');
  const fileChooser=page.waitForEvent('filechooser');await page.locator('#uploadProceduralBmp').click();
  await (await fileChooser).setFiles({name:'preview.bmp',mimeType:'image/bmp',buffer:makeBmp()});
  await frame.locator('#fileInput').waitFor({state:'attached'});
  assert.equal(await page.locator('#materialCanvas').isVisible(),true);
  assert.equal(await frame.locator('.preview-panel').count(),0);
  assert.equal(await maps.isVisible(),true);await equalWidths();
  await page.waitForFunction(()=>!document.querySelector('[data-preview-map=base]').disabled&&!document.querySelector('[data-preview-map=input]').disabled&&!document.getElementById('saveMaterial').disabled);
  assert.equal(await page.locator('#proceduralCropStart').isVisible(),false,'Crop stays hidden until BMP Map is clicked');
  assert.equal(await frame.locator('#cropButton').isVisible(),false,'The property panel no longer shows the crop button');
  await maps.locator('[data-preview-map=input]').hover();
  assert.equal(await maps.locator('[data-preview-map=input]').getAttribute('aria-expanded'),'false','Hover does not expand BMP Map');
  await maps.locator('[data-preview-map=input]').click();
  await page.waitForFunction(()=>getComputedStyle(document.getElementById('proceduralCropStart')).opacity==='1');
  await page.mouse.move(900,600);
  assert.equal(await maps.locator('[data-preview-map=input]').getAttribute('aria-expanded'),'true','Moving away preserves the clicked expansion');
  assert.equal(await page.locator('#proceduralCropStart').evaluate(button=>{
    const bmp=button.previousElementSibling.getBoundingClientRect(),crop=button.getBoundingClientRect();
    return crop.left>=bmp.right&&Math.abs(crop.top-bmp.top)<1;
  }),true,'Crop button sits next to BMP Map');
  await equalWidths();
  assert.equal(await page.locator('#proceduralParameters').isVisible(),true);
  assert.equal(await page.evaluate(()=>{
    const panel=document.querySelector('.editor-panel'),section=document.getElementById('proceduralWorkspace'),frame=document.getElementById('proceduralFrame');
    const controls=frame.contentDocument.querySelector('.controls'),bounds=section.getBoundingClientRect();
    return panel.contains(section)&&document.getElementById('fabricColorCodeRow').getBoundingClientRect().bottom<=bounds.top&&bounds.bottom<=document.getElementById('pbrHeading').getBoundingClientRect().top&&Math.abs(frame.clientHeight-controls.getBoundingClientRect().height)<2&&controls.scrollHeight<=controls.clientHeight+1;
  }),true,'Procedural controls and PBR channels share one scrolling property panel');
  assert.equal(await page.locator('#proceduralBmpName').textContent(),'preview.bmp','Uploaded filename occupies the upload button');
  assert.equal(await frame.locator('.source-group').isVisible(),false,'The inline panel has no duplicate file picker');
  const workspace=page.locator('#proceduralWorkspace'),summary=workspace.locator('summary');
  const parameterValues=()=>frame.locator('input[type=range],input[type=number]').evaluateAll(inputs=>inputs.map(input=>[input.id,input.value]));
  const valuesBeforeCollapse=await parameterValues(),expandedHeight=(await workspace.boundingBox()).height;
  const replaceChooser=page.waitForEvent('filechooser');await page.locator('#uploadProceduralBmp').click();await(await replaceChooser).setFiles([]);
  assert.equal(await workspace.getAttribute('open')!==null,true,'Using the filename picker does not collapse the section');
  await page.locator('#proceduralHeading').click();
  assert.equal(await workspace.getAttribute('open'),null);
  assert.equal(await page.locator('#proceduralFrame').isVisible(),false,'Collapsing hides all procedural parameters');
  assert.ok((await workspace.boundingBox()).height<expandedHeight-100,'Collapsing frees space for the PBR section');
  await summary.focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('#proceduralFrame').isVisible(),true,'Keyboard activation expands the section');
  assert.deepEqual(await parameterValues(),valuesBeforeCollapse,'Collapsing preserves parameter values');
  await frame.locator('.palette-id').first().hover();
  const panelScroll=await page.locator('.editor-panel').evaluate(panel=>panel.scrollTop);
  await page.mouse.wheel(0,240);
  await page.waitForFunction(before=>document.querySelector('.editor-panel').scrollTop>before+10,panelScroll);
  assert.equal(await frame.locator('body').evaluate(()=>document.scrollingElement.scrollTop),0,'Wheel over procedural controls scrolls the common property panel');
  await page.locator('.editor-panel').evaluate(panel=>panel.scrollTop=0);
  await frame.locator('.relief-toggle').nth(1).check();await frame.locator('#normalButton').click();
  await page.waitForFunction(()=>!document.querySelector('[data-preview-map=height]').disabled&&!document.getElementById('saveMaterial').disabled);
  for(const kind of ['material','input','base','height','normal','roughness','metalness','ao']){
   await maps.locator('[data-preview-map='+kind+']').click();
   if(kind==='input'){
    assert.equal(await page.locator('#proceduralCropViewport').isVisible(),true);
    assert.equal(await page.locator('#materialPreviewModes').isVisible(),false);
    const original=await page.locator('#proceduralCropCanvas').boundingBox();
    assert.ok(Math.abs(original.width/original.height-32/24)<.001,'BMP keeps its original pixel aspect ratio');
    const originalView=await page.locator('#proceduralCropViewport').boundingBox();
    assert.ok(original.width<=originalView.width&&original.height<=originalView.height,'BMP fits as a single image');
    const camera=await page.evaluate(()=>previewProbe().camera.position.toArray());
    const x=original.x+original.width/2,y=original.y+original.height/2;
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+35,y+20,{steps:5});await page.mouse.up();
    const panned=await page.locator('#proceduralCropCanvas').boundingBox();
    assert.ok(Math.abs(panned.x-original.x-35)<1&&Math.abs(panned.y-original.y-20)<1,'BMP pans as one image');
    await page.mouse.wheel(0,-100);
    await page.waitForFunction(width=>document.getElementById('proceduralCropCanvas').getBoundingClientRect().width>width,panned.width);
    const zoomed=await page.locator('#proceduralCropCanvas').boundingBox();
    assert.ok(Math.abs(zoomed.width/zoomed.height-32/24)<.001,'BMP zoom preserves pixel aspect ratio');
    assert.deepEqual(await page.evaluate(()=>previewProbe().camera.position.toArray()),camera,'BMP pan/zoom leaves the Three.js camera unchanged');
    await fs.mkdir(path.join(root,'.codex-project-check'),{recursive:true});
    await page.screenshot({path:path.join(root,'.codex-project-check/procedural-preview-bmp.png')});
    continue;
   }
   assert.equal(await page.evaluate(kind=>{const p=previewProbe();return kind==='material'?p.plane.material===p.material:p.plane.material.isMeshBasicMaterial&&p.plane.material.map.colorSpace==='srgb';},kind),true);
   await page.locator('[data-preview-mode=ball]').click();
   assert.equal(await page.evaluate(()=>previewProbe().sheenBall.visible&&previewProbe().controls.enableRotate),true);
   await page.locator('[data-preview-mode=flat]').click();
  }
  const box=await page.locator('#materialCanvas').boundingBox();
  const target=await page.evaluate(()=>previewProbe().controls.target.toArray());
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+40,box.y+box.height/2+30,{steps:8});await page.mouse.up();
  await page.waitForFunction(v=>previewProbe().controls.target.toArray().some((x,i)=>Math.abs(x-v[i])>.01),target);
  const dist=await page.evaluate(()=>previewProbe().camera.position.distanceTo(previewProbe().controls.target));
  await page.mouse.wheel(0,-100);await page.waitForFunction(v=>previewProbe().camera.position.distanceTo(previewProbe().controls.target)<v-.01,dist);
  await maps.locator('[data-preview-map=normal]').click();await page.locator('[data-preview-mode=ball]').click();
  const before=await page.evaluate(()=>previewProbe().camera.position.toArray());
  await maps.locator('[data-preview-map=input]').click();
  await page.locator('#proceduralCropStart').click();await page.locator('#proceduralCropToolbar').waitFor();
  const c=await page.locator('#proceduralCropCanvas').boundingBox();
  for(const [x,y] of [[4,3],[22,3],[22,18]])await page.mouse.click(c.x+x*c.width/32,c.y+y*c.height/24);
  assert.equal(await page.locator('#proceduralCropProgress').textContent(),'18 × 15 px');
  await page.locator('#proceduralCropApply').click();
  await page.waitForFunction(()=>previewProbe().revisions.source===2&&previewProbe().material.map&&!document.querySelector('[data-preview-map=base]').disabled&&!document.getElementById('saveMaterial').disabled);
  assert.equal(await page.locator('#proceduralCropToolbar').isVisible(),false);
  assert.deepEqual(await page.evaluate(()=>previewProbe().camera.position.toArray()),before);
  assert.equal(await page.locator('[data-preview-map=height]').isDisabled(),true);
  const cropped=await frame.locator('body').evaluate(()=>[state.width,state.height]);assert.deepEqual(cropped,[18,15]);
  await frame.locator('#normalButton').click();await page.waitForFunction(()=>!document.querySelector('[data-preview-map=height]').disabled&&!document.getElementById('saveMaterial').disabled);
  await maps.locator('[data-preview-map=ao]').click();
  await fs.mkdir(path.join(root,'.codex-project-check'),{recursive:true});
  await page.screenshot({path:path.join(root,'.codex-project-check/procedural-preview-desktop.png')});
  // Invalidation clears all derived views without leaving stale texture buttons.
  await frame.locator('#aoStrength').fill('0.5');await frame.locator('#aoStrength').dispatchEvent('input');
  await page.waitForFunction(()=>document.querySelector('[data-preview-map=height]').disabled&&document.getElementById('remove-normalMap').disabled);
  await frame.locator('#normalButton').click();await page.waitForFunction(()=>!document.querySelector('[data-preview-map=height]').disabled&&!document.getElementById('saveMaterial').disabled);
  await page.setViewportSize({width:390,height:844});
  await equalWidths();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await maps.locator('[data-preview-map=ao]').isVisible(),true);
  assert.equal(await frame.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(root,'.codex-project-check/procedural-preview-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await maps.locator('[data-preview-map=material]').click();
  assert.equal(await maps.isVisible(),true);assert.equal(await page.evaluate(()=>previewProbe().plane.material===previewProbe().material),true);
  for(const kind of ['roughness','metalness']){
   await maps.locator('[data-preview-map='+kind+']').click();
   assert.equal(await page.evaluate(()=>previewProbe().plane.material.isMeshBasicMaterial),true);
  }
  await maps.locator('[data-preview-map=input]').click();
  assert.equal(await page.locator('#proceduralCropViewport').isVisible(),true,'BMP stays a single image in the ordinary editor too');
  await maps.locator('[data-preview-map=material]').click();
  await page.locator('#saveMaterial').click();await page.locator('#confirmPreviewGeneration').click();
  await page.waitForFunction(()=>document.getElementById('status').textContent==='已生成预览图并保存到资产库');
  const id=new URL(page.url()).searchParams.get('asset');assert.ok(fixture.assets.has(id));
  await page.reload();await page.waitForFunction(()=>window.previewProbe&&!document.getElementById('saveMaterial').disabled);
  await frame.locator('.palette-row').first().waitFor();
  await page.waitForFunction(()=>!document.querySelector('[data-preview-map=input]').disabled&&!document.getElementById('saveMaterial').disabled);
  const saved=await page.evaluate(()=>{const a=previewProbe().asset();return {w:a.proceduralMapping.width,h:a.proceduralMapping.height,maps:Object.keys(a.maps),physical:a.physical};});
  assert.equal(saved.w,18);assert.equal(saved.h,15);assert.ok(saved.maps.includes('normalMap')&&saved.maps.includes('aoMap'));assert.equal(saved.maps.includes('height'),false);
  assert.equal(await maps.locator('[data-preview-map=material]').getAttribute('aria-pressed'),'true');
  // A cancelled encoder cannot publish its previous BMP after a new upload.
  await frame.locator('body').evaluate(()=>{
    const encode=encodeCanvasJpeg;
    window.oldEncodeStarted=new Promise(resolve=>{window.markOldEncode=resolve;});
    encodeCanvasJpeg=async(...args)=>{encodeCanvasJpeg=encode;markOldEncode();await new Promise(resolve=>{window.releaseOldEncode=resolve;});return encode(...args);};
    window.oldRender=renderNow();
  });
  await frame.locator('body').evaluate(()=>oldEncodeStarted);
  assert.equal(await frame.locator('#renderButton').getAttribute('data-render-state'),'rendering');
  assert.equal(await frame.locator('#renderButton').isDisabled(),true);
  await page.locator('#proceduralBmpInput').setInputFiles({name:'replacement.bmp',mimeType:'image/bmp',buffer:makeBmp()});
  await page.waitForFunction(()=>previewProbe().revisions.source===2&&!document.getElementById('saveMaterial').disabled);
  const newest=await page.evaluate(()=>previewProbe().material.map.uuid);
  await frame.locator('body').evaluate(async()=>{releaseOldEncode();await oldRender;});
  assert.equal(await page.evaluate(()=>previewProbe().material.map.uuid),newest,'Late encoded output cannot replace the current material');
  assert.equal(await frame.locator('#renderButton').getAttribute('data-render-state'),'ready','Late cancelled encoding preserves the latest render state');
  assert.equal(await page.locator('[data-preview-map=height]').isDisabled(),true);
  // A quality-only encode keeps feedback busy and ignores superseded errors.
  await frame.locator('body').evaluate(async()=>{
    const encode=encodeCanvasJpeg;
    window.qualityEncodeStarted=new Promise(resolve=>{window.markQualityEncode=resolve;});
    encodeCanvasJpeg=()=>new Promise((resolve,reject)=>{window.rejectOldQuality=reject;markQualityEncode();});
    window.oldQualityEncode=exportJpeg(state.renderId);
    encodeCanvasJpeg=encode;
    await qualityEncodeStarted;
  });
  assert.equal(await frame.locator('#renderButton').getAttribute('data-render-state'),'rendering');
  assert.equal(await frame.locator('#renderButton').isDisabled(),true);
  await frame.locator('body').evaluate(async()=>{await exportJpeg(state.renderId);rejectOldQuality(new Error('superseded quality encode'));await oldQualityEncode;});
  assert.equal(await frame.locator('#renderButton').getAttribute('data-render-state'),'ready','A superseded quality failure cannot override the newest success');
  // A rendering failure clears its map and unlocks saving/retry.
  await frame.locator('body').evaluate(()=>{
    const start=KnitRenderJob.start;KnitRenderJob.start=()=>{KnitRenderJob.start=start;return {promise:Promise.reject(new Error('test render failure')),cancel(){}};};
    return renderNow();
  });
  await page.waitForFunction(()=>document.querySelector('[data-preview-map=base]').disabled&&!document.getElementById('saveMaterial').disabled);
  assert.equal(await frame.locator('#renderButton').getAttribute('data-render-state'),'error');
  assert.equal(await frame.locator('#renderButton').isDisabled(),false,'Failed rendering allows retry');
  await frame.locator('#renderButton').click();
  await page.waitForFunction(()=>!document.querySelector('[data-preview-map=base]').disabled&&!document.getElementById('saveMaterial').disabled);
  assert.equal(await frame.locator('#renderButton').getAttribute('data-render-state'),'ready');
  await page.locator('#proceduralBmpInput').setInputFiles({name:'invalid.bmp',mimeType:'image/bmp',buffer:Buffer.from('invalid BMP')});
  await page.waitForFunction(()=>document.getElementById('proceduralParameters').hidden&&document.querySelector('[data-preview-map=input]').disabled&&!document.getElementById('saveMaterial').disabled);
  assert.equal(await page.locator('#proceduralCropStart').isVisible(),false,'Invalid BMP removes the crop entry');
  for(const kind of ['base','height','normal','ao'])assert.equal(await maps.locator('[data-preview-map='+kind+']').isDisabled(),true);
  await page.locator('#proceduralBmpInput').setInputFiles({name:'recovered.bmp',mimeType:'image/bmp',buffer:makeBmp()});
  await page.waitForFunction(()=>!document.getElementById('proceduralParameters').hidden&&!document.querySelector('[data-preview-map=base]').disabled&&!document.getElementById('saveMaterial').disabled);
  const host=await context.newPage();await host.goto(base+'/web-demo/index.html');
  const hidden=await host.evaluate(async bytes=>{
    const frame=document.createElement('iframe');frame.hidden=true;frame.src='/web-demo/index.html?embed=1&host=design';
    const ready=new Promise(resolve=>frame.onload=resolve);document.body.append(frame);await ready;
    return new Promise(resolve=>{
      addEventListener('message',event=>{if(event.source===frame.contentWindow&&event.data.type==='procedural-material')resolve({id:event.data.requestId,valid:event.data.file.size>0,physical:event.data.physical});});
      frame.contentWindow.postMessage({type:'procedural-update',requestId:'design-test',sourceFile:new File([new Uint8Array(bytes)],'design.bmp',{type:'image/bmp'}),mapping:{options:{dpi:20}}},'*');
    });
  },[...makeBmp()]);
  assert.equal(hidden.id,'design-test');assert.equal(hidden.valid,true);assert.equal(hidden.physical.widthCm,3.2);
  const standalone=await context.newPage();await standalone.goto(base+'/web-demo/index.html');
  assert.equal(await standalone.locator('.preview-panel').count(),0);assert.equal(await standalone.locator('#cropButton').isVisible(),false);
  await standalone.locator('#fileInput').setInputFiles({name:'standalone.bmp',mimeType:'image/bmp',buffer:makeBmp()});
  await standalone.waitForFunction(()=>!document.getElementById('downloadButton').disabled);
  const download=standalone.waitForEvent('download');await standalone.locator('#downloadButton').click();assert.equal((await download).suggestedFilename(),'fabric-render.jpg');
  assert.deepEqual(errors.filter(error=>!error.includes('test render failure')),[]);console.log('PASS: shared Three.js maps, flat/sphere, pan/zoom, parent crop, invalidation, responsive layout, save/reopen and standalone export.');
 }finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
