const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.env.FORM_BASE_URL || 'http://127.0.0.1:4186';

function modelBytes() {
  const values = new Float32Array([-1,0,-1,0,1,1,1,0,-1,0,0,.5,1,1,0,0,.894427,-.447214,0,.894427,-.447214,0,.894427,-.447214]);
  const binary = Buffer.from(values.buffer);
  const data = {asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],
    meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1,NORMAL:2},material:0}]}],
    materials:[{name:'Cloud fixture',doubleSided:true}],buffers:[{byteLength:binary.length}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:24},{buffer:0,byteOffset:60,byteLength:36}],
    accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-1,0,-1],max:[1,1,1]},
      {bufferView:1,componentType:5126,count:3,type:'VEC2'},{bufferView:2,componentType:5126,count:3,type:'VEC3'}]};
  const json = Buffer.from(JSON.stringify(data)), chunk = Buffer.alloc(Math.ceil(json.length/4)*4,32); json.copy(chunk);
  const result = Buffer.alloc(28+chunk.length+binary.length);
  result.writeUInt32LE(0x46546c67,0);result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);
  result.writeUInt32LE(chunk.length,12);result.writeUInt32LE(0x4e4f534a,16);chunk.copy(result,20);
  result.writeUInt32LE(binary.length,20+chunk.length);result.writeUInt32LE(0x004e4942,24+chunk.length);binary.copy(result,28+chunk.length);
  return result;
}

(async () => {
  const root = path.resolve(__dirname,'..');
  for (const filename of ['app.js','design.html','style.css']) {
    assert.doesNotMatch(await fs.readFile(path.join(root,filename),'utf8'), /importFiles|importModel|importSecondary|dropOverlay|drop-overlay/, `${filename}: legacy import path is removed`);
  }
  const browser = await chromium.launch({headless:true,channel:'msedge'});
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await context.route('**/shared/auth.js',route=>route.fulfill({contentType:'text/javascript',body:'export async function requireAuth() {} export const authState = () => ({id:"11111111-1111-1111-1111-111111111111"});'}));
    await context.route('**/model-source-fixture.glb',route=>route.fulfill({contentType:'model/gltf-binary',body:modelBytes()}));
    const cloud = await require('./project-test-server.cjs').installProjectFixture(context);
    const page = await context.newPage(), errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${base}/asset-library.html`);
    await page.waitForFunction(()=>document.getElementById('assetPanel').getAttribute('aria-busy')==='false');
    const ids = await page.evaluate(async()=>{
      const {saveAsset}=await import('./shared/asset-store.js');
      const file=new File([await(await fetch('./model-source-fixture.glb')).arrayBuffer()],'cloud-model.glb');
      const model=await saveAsset({kind:'model',name:'Cloud model',file});
      const canvas=document.createElement('canvas');canvas.width=canvas.height=32;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#dc526e';ctx.fillRect(0,0,32,32);
      const image=await new Promise(resolve=>canvas.toBlob(resolve));
      const fabric=await saveAsset({kind:'material',name:'Drop regression fabric',category:'面布',preview:image,
        physical:{mode:'physical',sizeSource:'manual',widthCm:12,heightCm:9},surface:{color:'#ffffff',roughness:.65},maps:{map:new File([image],'fabric.png',{type:'image/png'})}});
      return {model:model.id,fabric:fabric.id};
    });
    assert.ok(cloud.assets.has(ids.model),'Model is saved in the cloud fixture');
    await page.goto(`${base}/design.html?asset=${ids.model}`);
    await page.waitForFunction(()=>document.getElementById('loading').hidden && document.querySelectorAll('.material-item').length>0,null,{timeout:60000});
    assert.equal(await page.locator('#modelName').textContent(),'cloud-model.glb');
    assert.equal(await page.locator('#importModel,#importSecondary,#modelFile,#dropOverlay').count(),0);
    for (const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
      await page.setViewportSize(viewport);
      const before = {url:page.url(),model:await page.locator('#modelName').textContent(),count:await page.locator('.material-item').count()};
      const drops = await page.evaluate(()=>{
        const results=[];window.droppedFileReads=0;
        const read=File.prototype.arrayBuffer;
        File.prototype.arrayBuffer=function(){if(this.name.startsWith('dropped-'))droppedFileReads++;return read.call(this);};
        for(const target of [document.getElementById('canvas'),document.querySelector('.topbar')]) {
          const data=new DataTransfer();
          for(const name of ['dropped-model.glb','dropped-model.fbx','dropped-map.png'])data.items.add(new File(['invalid'],name));
          target.dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:data}));
          const over=new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data});target.dispatchEvent(over);
          const drop=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data});target.dispatchEvent(drop);
          results.push({blocked:over.defaultPrevented && drop.defaultPrevented,effect:data.dropEffect});
        }
        return results;
      });
      assert.ok(drops.every(drop=>drop.blocked && drop.effect==='none'),'File drops cannot import models or navigate the browser');
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(()=>droppedFileReads),0);
      assert.equal(page.url(),before.url);
      assert.equal(await page.locator('#modelName').textContent(),before.model);
      assert.equal(await page.locator('.material-item').count(),before.count);
      assert.equal(await page.locator('#loading').isVisible(),false);
      const pixels=await page.locator('#canvas').evaluate(canvas=>{
        const copy=document.createElement('canvas');copy.width=copy.height=32;
        const ctx=copy.getContext('2d');ctx.drawImage(canvas,0,0,32,32);
        return new Set(ctx.getImageData(0,0,32,32).data).size;
      });
      assert.ok(pixels>20,'Cloud model remains rendered');
      await page.screenshot({path:`checks/design-model-source-${viewport.width}.png`});
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('#addDockAsset').click();
    await page.locator(`.picker-card[data-asset-id="${ids.fabric}"]`).click();
    await page.locator('#confirmAssetPicker').click();
    await page.waitForFunction(()=>!document.getElementById('assetPicker').open && document.getElementById('materialName').value==='Drop regression fabric');
    const swatch=page.locator('#materialList .material-item.active .material-thumb');
    await swatch.scrollIntoViewIfNeeded();const box=await swatch.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    let hit=false;
    for(let y=350;y<760&&!hit;y+=40)for(let x=380;x<1040&&!hit;x+=60){
      await page.mouse.move(x,y,{steps:2});
      hit=await page.locator('#materialDropHint').isVisible();
    }
    assert.ok(hit,'Material drag continues to find the model');await page.mouse.up();
    await page.waitForFunction(()=>!document.getElementById('undoMaterial').disabled);
    const {saveOnlineProject,openOnlineProject}=require('./project-roundtrip.cjs');
    const project=await saveOnlineProject(page);
    await openOnlineProject(page,project);
    await page.waitForFunction(()=>document.getElementById('modelName').textContent==='cloud-model.glb' && document.querySelectorAll('.material-item').length>0);
    assert.equal(await page.locator('#importModel,#importSecondary,#modelFile,#dropOverlay').count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS: import controls, handlers and styles removed; file drops blocked on desktop/mobile; cloud model, material drag, project save and restoration preserved');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
