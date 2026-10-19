const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { installProjectFixture } = require('./project-test-server.cjs');
const { saveOnlineProject, openOnlineProject } = require('./project-roundtrip.cjs');
const base = process.env.FORM_BASE_URL || 'http://127.0.0.1:4186';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const state = await installProjectFixture(context), requests = [], errors = [];
    context.on('request', request => requests.push({ method: request.method(), path: new URL(request.url()).pathname }));
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await context.route('**/shared/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export async function requireAuth() {} export const authState=()=>({id:"11111111-1111-1111-1111-111111111111"});' }));
    await context.route('**/entries/model-parts.js', async route => {
      const source = await fs.readFile(path.join(__dirname, '../entries/model-parts.js'), 'utf8');
      await route.fulfill({ contentType: 'text/javascript', body: source + '\nwindow.readPartsSource=()=>({root,sourceModel});' });
    });
    await context.route('**/app.js', async route => {
      let source = await fs.readFile(path.join(__dirname, '../app.js'), 'utf8');
      source = source.replace('async function parseFBX(buffer,files=[]){', 'async function parseFBX(buffer,files=[]){window.rawModelParses++;');
      source = source.replace('async function parseGLB(buffer,files=[]){', 'async function parseGLB(buffer,files=[]){window.rawModelParses++;');
      await route.fulfill({ contentType: 'text/javascript', body: source + '\nwindow.rawModelParses=0;window.readRuntimeScene=()=>({model,entries,physicalModel,modelSource});' });
    });
    const page = await context.newPage(); await page.goto(base + '/asset-library.html');
    const ids = await page.evaluate(async () => {
      const { saveAsset } = await import('./shared/asset-store.js');
      const positions = [-1,0,-1, 0,1,1, 1,0,-1], normals = [0,.894427,-.447214,0,.894427,-.447214,0,.894427,-.447214], uv = [0,0,.5,1,1,0];
      const binary = new Float32Array([...positions,...normals,...uv]);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
      const ctx = canvas.getContext('2d'); ctx.fillStyle='#de4861';ctx.fillRect(0,0,32,16);ctx.fillStyle='#3978ed';ctx.fillRect(0,16,32,16);
      const data = { asset:{version:'2.0',extras:{cmPerUnit:100}},scene:0,scenes:[{nodes:[0,1]}],nodes:[{mesh:0},{mesh:0,translation:[3,0,0]}],
        meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},material:0}]}],
        materials:[{name:'Original fabric',doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[.4,.7,.2,1],roughnessFactor:.65,metallicFactor:0,baseColorTexture:{index:0}}}],
        textures:[{source:0}],images:[{uri:canvas.toDataURL()}],buffers:[{byteLength:binary.byteLength}],
        bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:36},{buffer:0,byteOffset:72,byteLength:24}],
        accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-1,0,-1],max:[1,1,1]},{bufferView:1,componentType:5126,count:3,type:'VEC3'},{bufferView:2,componentType:5126,count:3,type:'VEC2'}] };
      const json = new TextEncoder().encode(JSON.stringify(data)), chunk = new Uint8Array(Math.ceil(json.length/4)*4);chunk.fill(32);chunk.set(json);
      const bytes = new ArrayBuffer(28+chunk.length+binary.byteLength), view = new DataView(bytes);
      view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,bytes.byteLength,true);view.setUint32(12,chunk.length,true);view.setUint32(16,0x4e4f534a,true);
      new Uint8Array(bytes,20,chunk.length).set(chunk);view.setUint32(20+chunk.length,binary.byteLength,true);view.setUint32(24+chunk.length,0x004e4942,true);new Uint8Array(bytes,28+chunk.length).set(new Uint8Array(binary.buffer));
      const model = await saveAsset({kind:'model',name:'Prepared model',file:new File([bytes],'original.glb'),resources:[new File(['unused-original-resource'],'unused.bin')]});
      const image=await new Promise(resolve=>canvas.toBlob(resolve));
      const fabric=await saveAsset({kind:'material',name:'Runtime fabric',category:'面布',surface:{color:'#ffffff',roughness:.65},physical:{mode:'physical',sizeSource:'manual',widthCm:12,heightCm:9},maps:{map:new File([image],'fabric.png',{type:'image/png'})},preview:image});
      return {model:model.id,fabric:fabric.id};
    });
    await page.goto(base + '/model-parts.html?asset=' + ids.model);
    await page.waitForFunction(() => document.getElementById('partsLoading').hidden);
    const original = await page.evaluate(() => {
      const {sourceModel}=readPartsSource(), meshes=[];sourceModel.traverse(mesh=>{if(mesh.isMesh)meshes.push(mesh);});
      return {color:meshes[0].material.color.getHexString(),positions:[...meshes[0].geometry.attributes.position.array],unit:sourceModel.userData.unitScaleFactor};
    });
    await page.locator('.part-category-select').selectOption('边布');
    await page.locator('#saveParts').click();
    await page.waitForFunction(() => document.getElementById('partsStatus').textContent === '已保存模型配置和预览图' && !document.getElementById('saveParts').disabled, null, {timeout:120000});
    const manifest = state.assets.get(ids.model).manifest;
    assert.equal(manifest.modelRuntimeVersion,1);assert.ok(manifest.files.runtime);
    assert.ok(state.objects.has(manifest.files.file.path),'Original model remains in cloud storage');
    const runtimePath=manifest.files.runtime.path, sourcePath=manifest.files.file.path, resourcePath=manifest.files['resources/0'].path;
    requests.length=0;
    await page.goto(base+'/design.html?asset='+ids.model);
    await page.waitForFunction(() => document.getElementById('loading').hidden && document.getElementById('viewport').dataset.cameraMotion === 'idle',null,{timeout:120000});
    const loaded = await page.evaluate(() => {
      const {model,entries,physicalModel,modelSource}=readRuntimeScene(),meshes=[];model.traverse(mesh=>{if(mesh.isMesh)meshes.push(mesh);});
      return {rawParses:rawModelParses,runtime:modelSource.runtime,name:modelSource.name,convention:modelSource.textureConvention,color:entries[0].material.color.getHexString(),positions:[...meshes[0].geometry.attributes.position.array],unit:physicalModel.cmPerUnit,rawSize:physicalModel.rawSize,types:[...entries[0].material.userData.partTypes],flipY:entries[0].material.map.flipY,hasUV2:!!meshes[0].geometry.attributes.uv2};
    });
    assert.equal(loaded.rawParses,0);assert.equal(loaded.runtime,true);assert.equal(loaded.name,'original.glb');assert.equal(loaded.convention,'gltf');
    assert.equal(loaded.color,original.color,'Configuration preview colors never overwrite original material');
    assert.deepEqual(loaded.positions,original.positions);assert.equal(loaded.unit,original.unit);assert.deepEqual(loaded.rawSize,[5,1,2]);
    assert.deepEqual(loaded.types,['边布']);assert.equal(loaded.flipY,false);assert.equal(loaded.hasUV2,true);
    assert.equal(requests.some(req=>req.method==='GET'&&req.path.endsWith(sourcePath)),false,'Design does not download original model');
    assert.equal(requests.some(req=>req.method==='GET'&&req.path.endsWith(resourcePath)),false,'Design does not download original sidecars');
    assert.ok(requests.some(req=>req.method==='GET'&&req.path.endsWith(runtimePath)),'Design downloads prepared model');
    for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
      await page.setViewportSize(viewport);
      const colors=await page.locator('#canvas').evaluate(canvas=>{const copy=document.createElement('canvas');copy.width=copy.height=32;const ctx=copy.getContext('2d');ctx.drawImage(canvas,0,0,32,32);return new Set(ctx.getImageData(0,0,32,32).data).size;});
      assert.ok(colors>20);await page.screenshot({path:`checks/model-runtime-${viewport.width}.png`});
    }
    await page.setViewportSize({width:1440,height:1000});await page.locator('#addDockAsset').click();
    await page.locator(`.picker-card[data-asset-id="${ids.fabric}"]`).click();await page.locator('#confirmAssetPicker').click();
    await page.waitForFunction(()=>!document.getElementById('assetPicker').open&&document.getElementById('materialName').value==='Runtime fabric');
    const swatch=page.locator('#materialList .material-item.active .material-thumb');await swatch.scrollIntoViewIfNeeded();const box=await swatch.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();let hit=false;
    for(let y=320;y<740&&!hit;y+=40)for(let x=350;x<1050&&!hit;x+=50){await page.mouse.move(x,y,{steps:2});hit=await page.locator('#materialDropHint').isVisible();}
    assert.ok(hit,'Saved picking tree finds runtime model');await page.mouse.up();await page.waitForFunction(()=>!document.getElementById('undoMaterial').disabled);
    const project=await saveOnlineProject(page);assert.equal(project.manifest.modelRuntimeVersion,1);assert.equal(project.manifest.files[project.manifest.modelPath].path,runtimePath);
    state.assets.delete(ids.model);await openOnlineProject(page,project);
    assert.equal(await page.evaluate(()=>readRuntimeScene().modelSource.runtime&&rawModelParses===0),true,'Project restores prepared model after asset deletion');
    assert.deepEqual(errors,[]);
    console.log('PASS: parts save creates cloud runtime; original colors, units, geometry and assignments preserved; design skips original files and parsers; desktop/mobile render, material dragging and project restoration preserved');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});

