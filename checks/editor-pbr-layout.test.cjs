const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const p=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await p.goto('http://127.0.0.1:4186/material-editor.html');
  await p.waitForFunction(()=>!document.getElementById('saveMaterial').disabled);
  const positions=await p.evaluate(()=>['.material-type-tabs','#name','#category','#sizingHeading','#pbrHeading'].map(s=>document.querySelector(s).getBoundingClientRect().top));
  assert.deepEqual([...positions].sort((a,b)=>a-b),positions,'Type, name, category, sizing, PBR in requested order');
  await p.locator('[data-material-type=pattern]').click();assert.equal(await p.locator('#materialType').inputValue(),'pattern');assert.equal(await p.locator('#fabricCategoryRow').isVisible(),false);
  await p.locator('[data-material-type=fabric]').click();assert.equal(await p.locator('#fabricCategoryRow').isVisible(),true);
  const transfer=await p.evaluateHandle(async()=>{const blob=await(await fetch('./checks/fabric-no-dpi.png')).blob();const dt=new DataTransfer();dt.items.add(new File([blob],'dropped.png',{type:'image/png'}));return dt;});
  const keys=['map','normalMap','roughnessMap','metalnessMap','aoMap','bumpMap','emissiveMap'];
  for(const key of keys){
   const row=p.locator(`[data-map=${key}]`);await row.scrollIntoViewIfNeeded();
   const layout=await row.evaluate(el=>{const a=el.querySelector('.pbr-texture').getBoundingClientRect(),b=el.querySelector('.pbr-values').getBoundingClientRect();return a.right<=b.left;});assert.ok(layout,'Two columns for '+key);
   await row.dispatchEvent('dragenter',{dataTransfer:transfer});assert.ok(await row.evaluate(el=>el.classList.contains('drag-over')));
   assert.ok(await row.evaluate((el)=>{const dt=new DataTransfer();dt.items.add(new File(['x'],'test.png',{type:'image/png'}));const event=new DragEvent('dragover',{dataTransfer:dt,bubbles:true,cancelable:true});let reachedWindow=false;const listener=()=>{reachedWindow=true;};window.addEventListener('dragover',listener);el.dispatchEvent(event);window.removeEventListener('dragover',listener);return event.defaultPrevented&&!reachedWindow;}),'Row accepts drop without reaching window guard');
   await row.dispatchEvent('drop',{dataTransfer:transfer});await p.waitForFunction(k=>document.getElementById('file-'+k).textContent==='dropped.png',key);
   assert.equal(await row.evaluate(el=>el.classList.contains('drag-over')),false);assert.equal(await p.locator('#remove-'+key).isDisabled(),false);
  }
  await p.locator('#roughnessValue').fill('0.34');await p.locator('#roughnessValue').press('Tab');assert.equal(await p.locator('#roughness').inputValue(),'0.34');
  await p.locator('#roughness').fill('0.72');assert.equal(await p.locator('#roughnessValue').inputValue(),'0.72');
  await p.locator('#normalStrengthValue').fill('1.75');await p.locator('#normalStrengthValue').press('Tab');await p.locator('#flip').check();
  await p.locator('#colorValue').fill('#aabbcc');await p.locator('#colorValue').press('Tab');assert.equal(await p.locator('#color').inputValue(),'#aabbcc');
  const bad=await p.evaluateHandle(()=>{const dt=new DataTransfer();dt.items.add(new File(['bad'],'bad.txt',{type:'text/plain'}));return dt;});
  await p.locator('[data-map=map]').dispatchEvent('drop',{dataTransfer:bad});assert.match(await p.locator('#status').textContent(),/请选择 PNG/);assert.equal(await p.locator('#file-map').textContent(),'dropped.png');
  await p.locator('#remove-aoMap').click();assert.equal(await p.locator('#preview-aoMap').getAttribute('src'),null);assert.equal(await p.locator('#remove-aoMap').isDisabled(),true);
  const url=p.url();await p.locator('#previewPane').dispatchEvent('drop',{dataTransfer:transfer});assert.equal(p.url(),url);assert.match(await p.locator('#status').textContent(),/对应的 PBR/);
  await p.locator('#name').fill('两列 PBR 回归');await p.locator('#saveMaterial').click();await p.waitForFunction(()=>document.getElementById('status').textContent==='已保存到资产库');
  await p.reload();await p.waitForFunction(()=>document.getElementById('name').value==='两列 PBR 回归');assert.equal(await p.locator('#roughnessValue').inputValue(),'0.72');assert.equal(await p.locator('#normalStrengthValue').inputValue(),'1.75');assert.equal(await p.locator('#flip').isChecked(),true);assert.equal(await p.locator('#colorValue').inputValue(),'#aabbcc');
  for(const key of keys.filter(k=>k!=='aoMap'))assert.equal(await p.locator('#file-'+key).textContent(),'dropped.png');
  await p.locator('.editor-panel').evaluate(el=>el.scrollTop=0);await p.screenshot({path:'checks/editor-pbr-top.png'});
  await p.locator('#pbrHeading').evaluate(el=>el.scrollIntoView({block:'start'}));await p.screenshot({path:'checks/editor-pbr-columns.png'});
  await p.setViewportSize({width:390,height:844});await p.locator('[data-map=roughnessMap]').scrollIntoViewIfNeeded();assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:'checks/editor-pbr-mobile.png'});
  assert.deepEqual(errors,[]);console.log('PASS: editor order/type tabs, seven channel drops, drag highlight, number/slider sync, color, invalid file preservation, remove, outside drop guard, persistence and mobile columns');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
