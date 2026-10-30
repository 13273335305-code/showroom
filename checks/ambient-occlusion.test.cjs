const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const base = process.env.FORM_BASE_URL || 'http://127.0.0.1:4186';
// Fixed fixtures reproduce the reported lighting without depending on future
// edits to the site's scene configuration or writing to any real cloud account.
const surround = { grid: false, floorVisible: true, reflection: true };
const sceneConfig = { format: 'SPENIC-SCENE-SET', version: 1, defaultScene: 'night', scenes: {
  night: { name: '夜晚场景', scene: { ...surround, preset: 'night', environment: .05, exposure: .25, keyLight: 2.7, fillLight: 5, lightAngle: -7, lightColor: '#dde8ff', backgroundColor: '#172232', shadows: false } },
  morning: { name: '清晨场景', scene: { ...surround, preset: 'studio', environment: .55, exposure: .45, keyLight: 3, fillLight: .7, lightAngle: -123, lightColor: '#fff4e6', backgroundColor: '#ddebf8', shadows: true } },
  evening: { name: '黄昏场景', scene: { ...surround, preset: 'daylight', environment: .35, exposure: .35, keyLight: 3.1, fillLight: 0, lightAngle: 123, lightColor: '#e2bf8d', backgroundColor: '#ece8df', shadows: true } },
} };

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [];
    context.on('page', page => {
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    });
    await require('./project-test-server.cjs').installProjectFixture(context);
    await context.route('**/scene-config.json', route => route.fulfill({ json: sceneConfig }));
    await context.route('**/__form_scene_config', route => route.fulfill({ json: sceneConfig }));
    await context.route('**/shared/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: `
      export async function requireAuth(){document.documentElement.classList.remove('auth-pending');document.getElementById('authBootLoading')?.remove();}
      export const authState=()=>({id:'11111111-1111-1111-1111-111111111111'});
      export const workspaceClient=async()=>(await import('./project-store.js')).fixtureAccess();
    ` }));
    await context.route('**/ao-test.html', route => route.fulfill({ contentType: 'text/html', body: '<script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/addons/"}}</script>' }));
    await context.route('**/app.js', async route => route.fulfill({ contentType: 'text/javascript', body: await fs.readFile(path.join(root, 'app.js'), 'utf8') + `
      window.aoReady = () => !!model && !loadingModel && !activeReveal;
      window.aoSnapshot = () => ({
        name: selected?.material.name, strength: selected?.material.aoMapIntensity,
        applied: selected?.meshes.size, key: selected?.material.customProgramCacheKey(),
        maps: Object.fromEntries(['map','aoMap'].map(key => {const texture=selected?.material[key];return [key,texture?{channel:texture.channel,colorSpace:texture.colorSpace,flipY:texture.flipY,uploaded:texture.userData.formUpload,matrix:texture.matrix.toArray()}:null];}))
      });
      window.aoCompare = () => {
        cameraTween?.cancel(); controls.autoRotate=false; controls.enableDamping=false; controls.update();
        const sphere=new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere()),direction=camera.position.clone().sub(controls.target).normalize();
        const fov=Math.min(THREE.MathUtils.degToRad(camera.fov),2*Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov)/2)*camera.aspect));
        controls.target.copy(sphere.center);camera.position.copy(sphere.center).addScaledVector(direction,sphere.radius/Math.sin(fov/2));controls.update();
        const material=selected.material, strength=material.aoMapIntensity, gl=renderer.getContext(), size=renderer.getDrawingBufferSize(new THREE.Vector2());
        const capture=value=>{material.aoMapIntensity=value;renderer.render(scene,camera);const pixels=new Uint8Array(size.x*size.y*4);gl.readPixels(0,0,size.x,size.y,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return {pixels,url:$('canvas').toDataURL()};};
        const off=capture(0),on=capture(strength);let total=0,changed=0;
        for(let i=0;i<off.pixels.length;i+=4){const delta=Math.abs(off.pixels[i]-on.pixels[i])+Math.abs(off.pixels[i+1]-on.pixels[i+1])+Math.abs(off.pixels[i+2]-on.pixels[i+2]);total+=delta;if(delta>6)changed++;}
        return {difference:total/(off.pixels.length*.75),changed,off:off.url,on:on.url};
      };
    ` }));
    await context.route('**/entries/material-editor.js*', async route => route.fulfill({ contentType: 'text/javascript', body: await fs.readFile(path.join(root, 'entries/material-editor.js'), 'utf8') + `
      window.editorAoSnapshot=()=>({strength:material.aoMapIntensity,uploaded:material.aoMap?.userData.formUpload,key:material.customProgramCacheKey()});
    ` }));
    const fixture = await context.newPage();
    await fixture.goto(base + '/ao-test.html');
    const result = await fixture.evaluate(async () => {
      const T = await import('three');
      const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
      const { installRoughnessShader } = await import('/shared/roughness-map.js');
      const { applySurface } = await import('/shared/material-data.js');
      const { revealMaterial, revealPattern } = await import('/material-reveal.js');
      const { sceneAppearance } = await import('/shared/scene-cycle.js');
      const { prepareModelRuntime } = await import('/shared/model-runtime.js');
      const { saveAsset } = await import('/shared/asset-store.js');
      const config = await (await fetch('/scene-config.json')).json();
      const renderer = new T.WebGLRenderer({ antialias: false }); renderer.setSize(128, 128);
      renderer.toneMapping = T.ACESFilmicToneMapping; renderer.outputColorSpace = T.SRGBColorSpace;
      const target = new T.WebGLRenderTarget(128, 128); renderer.setRenderTarget(target);
      const scene = new T.Scene(), camera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 100); camera.position.z = 5;
      const pmrem = new T.PMREMGenerator(renderer), room = new RoomEnvironment(), environment = pmrem.fromScene(room, .04); scene.environment = environment.texture;
      room.dispose(); pmrem.dispose();
      const hemi = new T.HemisphereLight(0xeaf3ff, 0x6d6e74, 1); scene.add(hemi);
      const key = new T.DirectionalLight(), fill = new T.DirectionalLight(0xe2edff); fill.position.set(-6, 4, 2); scene.add(key, fill);
      const rim = new T.DirectionalLight(0xffffff, 2); rim.position.set(1, 5, -7); scene.add(rim);
      const geometry = new T.PlaneGeometry(2, 2); geometry.setAttribute('uv2', geometry.attributes.uv.clone());
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 64, 64); ctx.fillStyle = '#404040'; ctx.fillRect(0, 0, 32, 64);
      const aoMap = new T.CanvasTexture(canvas); aoMap.channel = 2; aoMap.userData.formUpload = true;
      const material = new T.MeshPhysicalMaterial({ color: '#a3907c', roughness: .98, sheen: 1, sheenRoughness: .4, aoMap }); installRoughnessShader(material);
      const mesh = new T.Mesh(geometry, material); scene.add(mesh);
      const render = strength => { material.aoMapIntensity = strength; renderer.render(scene, camera); const pixels = new Uint8Array(128 * 128 * 4); renderer.readRenderTargetPixels(target, 0, 0, 128, 128, pixels); return pixels; };
      const region = (pixels, x0, x1) => { let sum = 0, count = 0; for (let y = 16; y < 112; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) { sum += pixels[(y * 128 + x) * 4 + c]; count++; } return sum / count; };
      const difference = (a, b) => a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length;
      const rows = [];
      for (const [name, preset] of Object.entries(config.scenes)) {
        const state = preset.scene; renderer.toneMappingExposure = state.exposure; scene.environmentIntensity = state.environment; hemi.intensity = sceneAppearance(state).hemi;
        key.color.set(state.lightColor); key.intensity = state.keyLight; const angle = T.MathUtils.degToRad(state.lightAngle); key.position.set(Math.sin(angle) * 7, 8, Math.cos(angle) * 7); fill.intensity = state.fillLight;
        aoMap.userData.formUpload = false; material.needsUpdate = true; const off = render(0), original = render(1);
        aoMap.userData.formUpload = true; material.needsUpdate = true; const on = render(1), strong = render(3), saturated = render(10), zero = render(0);
        material.aoMap = null; material.needsUpdate = true; const removed = render(1);
        material.aoMap = aoMap; material.needsUpdate = true;
        rows.push({ name, off: region(off, 12, 52), original: region(original, 12, 52), on: region(on, 12, 52), strong: region(strong, 12, 52), whiteDifference: Math.abs(region(off, 76, 116) - region(on, 76, 116)), zeroDifference: difference(off, zero), removedDifference: difference(off, removed), saturatedDifference: Math.abs(region(strong, 12, 52) - region(saturated, 12, 52)) });
      }
      // Imported baked AO must still affect only ambient light. Uploading a
      // cavity map to the same material must switch shader variants correctly.
      scene.environment = null; hemi.intensity = 0; key.intensity = 2; key.position.set(0, 0, 5); fill.intensity = rim.intensity = 0;
      aoMap.userData.formUpload = false; material.needsUpdate = true;
      const bakedOff = render(0), bakedOn = render(1), bakedKey = material.customProgramCacheKey();
      aoMap.userData.formUpload = true; material.needsUpdate = true;
      const cavityOn = render(1), cavityKey = material.customProgramCacheKey();
      // AO uses its own transform: swapping physical UV2 for UV0 with a half
      // offset must move the dark region, without an extra color-map lookup.
      aoMap.channel = 0; aoMap.offset.x = .5; aoMap.wrapS = T.RepeatWrapping; aoMap.needsUpdate = true; material.needsUpdate = true;
      const shifted = render(1);
      const shiftedDifference = Math.abs(region(cavityOn, 12, 52) - region(shifted, 76, 116));
      aoMap.channel = 2; aoMap.offset.x = 0; material.needsUpdate = true;
      // Compile together with the existing normal, roughness, sheen and reveal
      // hooks, including cloned materials whose maps share the upload marker.
      const normal = new T.DataTexture(new Uint8Array([128,128,255,255]), 1, 1); normal.needsUpdate = true;
      material.normalMap = normal; material.roughnessMap = aoMap; applySurface(material, { roughnessGrayscale: true, roughnessInvert: true });
      render(1); const pattern = revealPattern(mesh); pattern.update(.8); renderer.render(scene, camera); pattern.dispose();
      const reveal = revealMaterial(scene, mesh, 0, material, new T.Vector3()); reveal.update(.5); renderer.render(scene, camera); reveal.dispose();
      const glError = renderer.getContext().getError();
      // Small real GLB/runtime model and cloud material fixtures exercise the
      // same lazy map-loading, drag assignment and project restore as users.
      const modelRoot = new T.Group(); modelRoot.userData.unitScaleFactor = 100;
      const modelMesh = new T.Mesh(new T.SphereGeometry(1, 32, 24), new T.MeshStandardMaterial({ name: 'AO fixture base', color: '#b0b0b0' }));
      modelMesh.name = 'AO fixture'; modelRoot.add(modelMesh);
      const sourceGeometry = modelMesh.geometry.toNonIndexed();
      const positions = sourceGeometry.attributes.position.array, normals = sourceGeometry.attributes.normal.array, uvs = sourceGeometry.attributes.uv.array;
      const binary = new Float32Array(positions.length + normals.length + uvs.length); binary.set(positions); binary.set(normals, positions.length); binary.set(uvs, positions.length + normals.length);
      const gltfDocument = {
        asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'AO fixture' }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, material: 0 }] }],
        materials: [{ name: 'AO fixture base', pbrMetallicRoughness: { baseColorFactor: [.5,.5,.5,1], metallicFactor: 0, roughnessFactor: 1 } }],
        buffers: [{ byteLength: binary.byteLength }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }, { buffer: 0, byteOffset: positions.byteLength, byteLength: normals.byteLength }, { buffer: 0, byteOffset: positions.byteLength + normals.byteLength, byteLength: uvs.byteLength }],
        accessors: [{ bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: [-1,-1,-1], max: [1,1,1] }, { bufferView: 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' }, { bufferView: 2, componentType: 5126, count: uvs.length / 2, type: 'VEC2' }],
      };
      const json = new TextEncoder().encode(JSON.stringify(gltfDocument)), jsonLength = Math.ceil(json.length / 4) * 4;
      const glb = new ArrayBuffer(28 + jsonLength + binary.byteLength), view = new DataView(glb), bytes = new Uint8Array(glb);
      [0x46546c67, 2, glb.byteLength, jsonLength, 0x4e4f534a].forEach((value, i) => view.setUint32(i * 4, value, true));
      bytes.fill(32, 20, 20 + jsonLength); bytes.set(json, 20); view.setUint32(20 + jsonLength, binary.byteLength, true); view.setUint32(24 + jsonLength, 0x004e4942, true); bytes.set(new Uint8Array(binary.buffer), 28 + jsonLength);
      sourceGeometry.dispose();
      const runtime = await prepareModelRuntime(modelRoot, { name: 'ao-fixture.glb', textureConvention: 'gltf' });
      const modelAsset = await saveAsset({ kind: 'model', name: 'AO regression model', file: new File([glb], 'ao-fixture.glb'), runtimeModelFile: runtime });
      // Repeated shallow grooves make a more representative visual fixture.
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 64, 64); ctx.fillStyle = '#505050';
      for (let x = 0; x < 64; x += 8) ctx.fillRect(x, 0, 2, 64);
      const aoBlob = await new Promise(resolve => canvas.toBlob(resolve));
      const color = document.createElement('canvas'); color.width = color.height = 64; const colorCtx = color.getContext('2d'); colorCtx.fillStyle = '#ad9275'; colorCtx.fillRect(0, 0, 64, 64);
      const fabric = await saveAsset({ kind: 'material', materialType: 'fabric', name: 'AO cavity regression', category: '面布', surface: { color: '#ffffff', roughness: .9, metalness: 0, aoStrength: 1, sheen: 1, sheenRoughness: .4 }, physical: { mode: 'physical', sizeSource: 'manual', widthCm: 100, heightCm: 100, initialized: true }, maps: { map: new File([await new Promise(resolve => color.toBlob(resolve))], 'fabric.png', { type: 'image/png' }), aoMap: new File([aoBlob], 'fabric-ao.png', { type: 'image/png' }) } });
      normal.dispose(); aoMap.dispose(); material.dispose(); geometry.dispose(); target.dispose(); environment.dispose(); renderer.dispose();
      return { rows, bakedDifference: difference(bakedOff, bakedOn), cavityDifference: difference(bakedOn, cavityOn), bakedKey, cavityKey, shiftedDifference, glError, modelId: modelAsset.id, fabricId: fabric.id, ao: await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(aoBlob); }) };
    });
    console.log(JSON.stringify({ scenes: result.rows, bakedDifference: result.bakedDifference, cavityDifference: result.cavityDifference }, null, 2));
    for (const row of result.rows) {
      assert.ok(row.on < row.off - 5, row.name + ': cavities are visible');
      assert.ok(row.on <= row.original, row.name + ': direct lighting cannot erase cavity occlusion');
      assert.ok(row.strong <= row.on, row.name + ': intensity darkens monotonically');
      assert.equal(row.whiteDifference, 0, 'white AO is neutral');
      assert.equal(row.zeroDifference, 0, 'zero intensity disables AO');
      assert.equal(row.removedDifference, 0, 'removing AO restores original appearance');
      assert.equal(row.saturatedDifference, 0, 'strong AO saturates without negative lighting');
    }
    const night = result.rows.find(row => row.name === 'night');
    assert.ok(night.on < night.original * .8, 'Night lighting retains readable cavity contrast');
    assert.equal(result.bakedDifference, 0, 'Imported AO preserves its ambient-only behavior');
    assert.ok(result.cavityDifference > 2, 'Uploaded AO works under direct light alone');
    assert.notEqual(result.bakedKey, result.cavityKey, 'The two AO semantics cannot share a compiled shader');
    assert.equal(result.shiftedDifference, 0, 'AO follows its selected UV channel and transform');
    assert.equal(result.glError, 0);

    const design = await context.newPage(); await design.goto(base + '/design.html?asset=' + result.modelId);
    await design.waitForFunction(() => window.aoReady?.(), null, { timeout: 60000 });
    await design.locator('#addDockAsset').click(); await design.locator(`.picker-card[data-asset-id="${result.fabricId}"]`).click(); await design.locator('#confirmAssetPicker').click();
    await design.waitForFunction(() => document.getElementById('materialName').value === 'AO cavity regression');
    const swatch = await design.locator('#materialList .material-item.active .material-thumb').boundingBox();
    await design.mouse.move(swatch.x + swatch.width / 2, swatch.y + swatch.height / 2); await design.mouse.down();
    let hit = false;
    for (let y = 320; y < 700 && !hit; y += 45) for (let x = 400; x < 1000 && !hit; x += 45) { await design.mouse.move(x, y); hit = await design.locator('#materialDropHint').isVisible(); }
    await design.mouse.up(); assert.ok(hit, 'A real model hit accepts the material drag');
    await design.waitForFunction(() => aoReady() && !document.getElementById('undoMaterial').disabled && aoSnapshot().applied > 0 && aoSnapshot().maps.aoMap?.uploaded, null, { timeout: 60000 });
    const checkSnapshot = snapshot => {
      assert.equal(snapshot.strength, 1); assert.match(snapshot.key, /fabric-ao-v1-1/);
      assert.equal(snapshot.maps.aoMap.colorSpace, ''); assert.equal(snapshot.maps.aoMap.channel, 2);
      assert.equal(snapshot.maps.aoMap.flipY, false); assert.equal(snapshot.maps.aoMap.uploaded, true);
      assert.deepEqual(snapshot.maps.aoMap.matrix, snapshot.maps.map.matrix);
    };
    checkSnapshot(await design.evaluate(() => aoSnapshot()));
    const comparison = await design.evaluate(() => aoCompare());
    console.log('Design AO comparison:', JSON.stringify({ difference: comparison.difference, changed: comparison.changed }));
    assert.ok(comparison.changed > 500, 'Toggling AO changes rendered model pixels in the real design workspace');
    const { saveOnlineProject, openOnlineProject } = require('./project-roundtrip.cjs');
    const project = await saveOnlineProject(design); await openOnlineProject(design, project);
    await design.waitForFunction(() => aoReady() && aoSnapshot().name === 'AO cavity regression');
    checkSnapshot(await design.evaluate(() => aoSnapshot()));
    const restored = await design.evaluate(() => aoCompare()); assert.ok(restored.changed > 500, 'Project restore retains visible AO');
    await design.setViewportSize({ width: 390, height: 844 });
    await design.waitForFunction(() => document.getElementById('canvas').clientWidth < 500);
    const mobile = await design.evaluate(() => aoCompare()); assert.ok(mobile.changed > 100, 'AO also renders in the mobile viewport');

    const editor = await context.newPage(); await editor.goto(base + '/material-editor.html');
    await editor.waitForFunction(() => !document.getElementById('saveMaterial').disabled);
    await editor.locator('#map-aoMap').setInputFiles({ name: 'fabric-ao.png', mimeType: 'image/png', buffer: Buffer.from(result.ao, 'base64') });
    await editor.waitForFunction(() => window.editorAoSnapshot?.().uploaded);
    assert.match((await editor.evaluate(() => editorAoSnapshot())).key, /fabric-ao-v1-1/, 'Editor preview uses the same AO shader as the design workspace');
    // Save an easily reviewed comparison from the actual design canvas.
    const preview = await context.newPage();
    await preview.goto(base + '/ao-test.html');
    await preview.setViewportSize({ width: 1440, height: 780 });
    await preview.setContent('<style>body{margin:0;padding:32px;background:#edf1f6;color:#273448;font:16px "Microsoft YaHei",sans-serif}h1{font-size:24px;margin:0 0 12px}p{margin:0 0 24px;color:#566578}.row{display:flex;gap:24px}.card{flex:1;min-width:0;background:white;border-radius:16px;overflow:hidden}.label{padding:16px 20px;font-weight:600}img{width:100%;display:block}</style><h1>设计台 AO 渲染对比</h1><p>同一材质、同一视角与夜景灯光。条纹为测试 AO，用于确认凹缝遮蔽。</p><div class="row"><div class="card"><div class="label">AO 强度 0 · 关闭</div><img id="off"></div><div class="card"><div class="label">AO 强度 1 · 开启</div><img id="on"></div></div>');
    await preview.evaluate(({ off, on }) => { document.getElementById('off').src = off; document.getElementById('on').src = on; }, comparison);
    await preview.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    await preview.screenshot({ path: path.join(root, 'outputs/ao-comparison.png') });
    assert.deepEqual(errors, [], 'All shader variants and editor/design workflows compile without errors');
    console.log('PASS: AO under night/morning/evening and direct light, neutral white/zero/remove, bounded intensity, imported AO, UV0/UV2, roughness/normal/sheen/reveals, real material drag, project restore, mobile and editor upload');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
