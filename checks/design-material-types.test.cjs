const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext({viewport:{width:1440,height:1000}}),temp=await fs.mkdtemp(path.join(os.tmpdir(),'spenic-types-'));
 const errors=[];context.on('page',p=>{p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});});
 try{
  const p=await context.newPage();await p.goto('http://127.0.0.1:4186/');await p.waitForFunction(()=>document.querySelectorAll('.material-item').length===9&&document.getElementById('loading').hidden);
  assert.equal(await p.locator('#inspector').isVisible(),false);await p.locator('#restoreInspector').click();assert.equal(await p.locator('#scenePanel').isVisible(),true);assert.equal(await p.locator('#textureSlots').isVisible(),false);
  await p.evaluate(async()=>{
   const {saveAsset}=await import('./shared/asset-store.js');const image=await(await fetch('./checks/fabric-no-dpi.png')).blob();const file=new File([image],'fabric.png',{type:'image/png'});
   const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');x.fillStyle='#e32265';x.beginPath();x.arc(64,64,48,0,Math.PI*2);x.fill();const logo=new File([await new Promise(r=>c.toBlob(r))],'logo.png',{type:'image/png'});
   const base={kind:'material',category:'面布',surface:{color:'#ffffff',roughness:.6,metalness:0},physical:{mode:'physical',sizeSource:'manual',widthCm:30,heightCm:30,angle:0,initialized:true},repeat:[1,1]};
   await saveAsset({...base,name:'测试面料',materialType:'fabric',maps:{map:file}});await saveAsset({...base,name:'测试图案',materialType:'pattern',maps:{map:logo}});
  });
  await p.locator('#addDockAsset').click();await p.locator('.picker-card').waitFor();assert.equal(await p.locator('.picker-card').count(),1);assert.match(await p.locator('.picker-card').textContent(),/测试面料/);await p.locator('.picker-card').click();
  await p.waitForFunction(()=>document.querySelectorAll('#materialList .material-item').length===10);assert.equal(await p.locator('#assetPicker').isVisible(),false);
  await p.locator('.material-item.active').click();assert.equal(await p.locator('#inspectorHeading').textContent(),'材质栏');
  assert.equal(await p.locator('#inspector input:visible').count(),4,'Only color, UV U/V, angle visible');
  await p.locator('#compactOffsetU').fill('0.15');await p.locator('#compactOffsetU').press('Tab');await p.locator('#compactAngle').fill('35');
  await p.locator('#backToScene').click();assert.equal(await p.locator('#scenePanel').isVisible(),true);
  await p.locator('#patternDockTab').click();await p.locator('#addDockAsset').click();await p.locator('.picker-card').waitFor();assert.equal(await p.locator('.picker-card').count(),1);assert.match(await p.locator('.picker-card').textContent(),/测试图案/);
  await p.screenshot({path:'checks/design-asset-picker.png'});await p.locator('.picker-card').click();
  await p.waitForFunction(()=>document.querySelectorAll('[data-pattern-kind=source]').length===1);
  await p.mouse.click(640,500);assert.equal(await p.locator('[data-pattern-kind=placed]').count(),0,'Clicking the model does not place a pattern');
  await p.locator('#patternDockTab').click();
  const source=p.locator('[data-pattern-kind=source]');await source.scrollIntoViewIfNeeded();let box=await source.locator('.material-thumb').boundingBox();
  await p.mouse.move(box.x+30,box.y+30);await p.mouse.down();await p.waitForTimeout(700);assert.ok((await p.locator('#materialPreview').boundingBox()).width>250,'Pattern hold expands');
  await p.mouse.move(30,300,{steps:10});await p.mouse.up();assert.equal(await p.locator('[data-pattern-kind=placed]').count(),0,'Empty drop cancels');
  box=await source.locator('.material-thumb').boundingBox();await p.mouse.move(box.x+30,box.y+30);await p.mouse.down();await p.mouse.move(640,500,{steps:12});
  let target=null;for(let y=370;y<680&&!target;y+=35){await p.mouse.move(640,y);if(await p.locator('#materialDropHint').isVisible())target={x:640,y};}
  assert.ok(target);assert.ok((await p.locator('#materialPreview').boundingBox()).width<80,'Pattern follows pointer at compact size');
  await p.waitForTimeout(1100);assert.ok(await p.locator('#materialPreview').evaluate(el=>el.classList.contains('jelly-ready')),'Hover heartbeat is shared with fabric');
  await p.screenshot({path:'checks/pattern-drag.png'});await p.mouse.up();await p.waitForTimeout(500);await p.screenshot({path:'checks/pattern-reveal-slow.png'});
  await p.waitForTimeout(1800);
  const placed=p.locator('[data-pattern-kind=placed]');box=await placed.locator('.material-thumb').boundingBox();await p.mouse.move(box.x+30,box.y+30);await p.mouse.down();await p.mouse.move(target.x+30,target.y+25,{steps:12});await p.mouse.up();assert.equal(await placed.count(),1,'Dragging a placed pattern moves it without duplication');
  assert.equal(await p.locator('[data-pattern-kind=placed]').count(),1,'Single surface decal created');
  await p.locator('#compactOffsetU').fill('0.1');await p.locator('#compactOffsetU').press('Tab');await p.locator('#compactAngle').fill('25');await p.locator('#compactColor').fill('#55ccff');
  await p.screenshot({path:'checks/design-single-pattern.png'});
  const [download]=await Promise.all([p.waitForEvent('download'),p.locator('#saveProject').click()]);const project=path.join(temp,'types.form');await download.saveAs(project);
  const {unzipSync,strFromU8}=await import('../vendor/three/addons/libs/fflate.module.js');const config=JSON.parse(strFromU8(unzipSync(new Uint8Array(await fs.readFile(project)))['project.json']));
  assert.equal(config.patterns.length,1);assert.equal(config.patterns[0].singlePlacement,true);assert.equal(config.patterns[0].angle,25);assert.equal(config.patterns[0].surface.color,'#55ccff');assert.deepEqual(config.materials[9].placement,{offset:[.15,0],angle:35});assert.equal(config.patternSources.length,1);
  await p.locator('#projectFile').setInputFiles(project);await p.waitForFunction(()=>document.getElementById('loading').hidden&&document.querySelectorAll('[data-pattern-kind=placed]').length===1);
  await p.locator('#patternDockTab').click();await p.locator('[data-pattern-kind=placed]').click();assert.equal(await p.locator('#compactAngle').inputValue(),'25');assert.equal(await p.locator('#compactColor').inputValue(),'#55ccff');assert.equal(await p.locator('#compactOffsetU').inputValue(),'0.1');
  await p.locator('#dockPatternDelete').click();assert.equal(await p.locator('[data-pattern-kind=placed]').count(),0);
  await p.setViewportSize({width:390,height:844});await p.locator('#addDockAsset').click();await p.locator('.picker-card').waitFor();await p.screenshot({path:'checks/design-picker-mobile.png'});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.keyboard.press('Escape');assert.equal(await p.locator('#assetPicker').isVisible(),false);
  const editor=await context.newPage();await editor.goto('http://127.0.0.1:4186/material-editor.html');await editor.waitForFunction(()=>!document.getElementById('saveMaterial').disabled);await editor.locator('[data-material-type=pattern]').click();await editor.locator('#map-map').setInputFiles('checks/fabric-no-dpi.png');await editor.waitForFunction(()=>document.getElementById('file-map').textContent==='fabric-no-dpi.png');await editor.locator('#name').fill('编辑器图案');await editor.locator('#saveMaterial').click();await editor.waitForFunction(()=>document.getElementById('status').textContent==='已保存到资产库');await editor.reload();await editor.waitForFunction(()=>document.getElementById('name').value==='编辑器图案');assert.equal(await editor.locator('#materialType').inputValue(),'pattern');assert.equal(await editor.locator('#sizing').isVisible(),false);
  for(const route of ['/','/material-editor.html','/asset-library.html']){const page=await context.newPage();await page.goto('http://127.0.0.1:4186'+route);await page.locator('.app-navigation a').first().waitFor();for(const width of [1440,1024,390]){await page.setViewportSize({width,height:900});const measured=await page.evaluate(()=>{const nav=document.querySelector('.app-navigation').getBoundingClientRect(),header=document.querySelector('.topbar').getBoundingClientRect(),a=document.querySelector('.header-actions').getBoundingClientRect();return {center:nav.x+nav.width/2,width:innerWidth,radius:getComputedStyle(document.querySelector('.topbar')).borderRadius,overlap:nav.left<a.right&&nav.right>a.left&&nav.top<a.bottom&&nav.bottom>a.top,overflow:document.documentElement.scrollWidth>innerWidth};});assert.ok(Math.abs(measured.center-width/2)<1,'Navigation is centred on every page');assert.equal(measured.overlap,false);assert.equal(measured.overflow,false);assert.equal(measured.radius,width<=760?'14px':'16px');}await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'checks/header-'+(route==='/'?'design':route.includes('material-editor')?'editor':'assets')+'.png'});await page.close();}
  assert.deepEqual(errors,[]);console.log('PASS: default scene panel, compact material controls, category-filtered library modal, fabric UV transforms, pattern hold/drag/hover/cancel/reposition, non-repeating surface pattern, project roundtrip, deletion, mobile modal and pattern asset editor');
 }finally{await browser.close();if(path.dirname(path.resolve(temp))===path.resolve(os.tmpdir())&&path.basename(temp).startsWith('spenic-types-'))await fs.rm(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
