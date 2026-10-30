const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.env.FORM_BASE_URL || 'http://127.0.0.1:4186';
const root = path.resolve(__dirname, '..');

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
    await context.route('**/shared/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: `
      export async function requireAuth(){document.documentElement.classList.remove('auth-pending');document.getElementById('authBootLoading')?.remove();}
      export const authState=()=>({id:'11111111-1111-1111-1111-111111111111'});
      export const workspaceClient=async()=>(await import('./project-store.js')).fixtureAccess();
    ` }));
    await context.route('**/normal-fixture.html', route => route.fulfill({ contentType: 'text/html', body: '<script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/addons/"}}</script>' }));
    await context.route('**/app.js', async route => route.fulfill({ contentType: 'text/javascript', body: await fs.readFile(path.join(root, 'app.js'), 'utf8') + `
      window.normalTarget = () => draggedMaterial?.lastHit?.mesh?.name;
      window.patternConventionProbe = () => {
        const texture = new THREE.Texture(); configurePatternProjectionTexture(texture);
        const value = { gltf: useGLTFTextureConvention(), flipY: texture.flipY };
        texture.dispose(); return value;
      };
      window.normalProbe = () => {
        const meshes=[];
        model?.traverse(mesh=>{if(mesh.isMesh)meshes.push({name:mesh.name,tangent:!!mesh.geometry.attributes.tangent,materials:(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(m=>({name:m.name,scale:m.normalScale.toArray(),key:m.customProgramCacheKey(),flipY:m.normalMap?.flipY,uploaded:m.normalMap?.userData.formUpload,imported:m.normalMap?.userData.formGLTFNormalMap}))});});
        return {meshes,entries:entries.map(e=>({name:e.name,flip:e.flip,scale:e.material.normalScale.toArray()}))};
      };
    ` }));
    const fixture = await context.newPage();
    await fixture.goto(base + '/normal-fixture.html');
    const result = await fixture.evaluate(async () => {
      const T = await import('three');
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const { installRoughnessShader } = await import('/shared/roughness-map.js');
      const { readSurface, applySurface } = await import('/shared/material-data.js');
      const { prepareModelRuntime } = await import('/shared/model-runtime.js');
      const { revealMaterial, revealPattern } = await import('/material-reveal.js');
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d'), image = ctx.createImageData(64, 64);
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const nx = .3 * Math.sin(x / 64 * Math.PI * 2), ny = .65 * Math.sin(y / 64 * Math.PI * 2 + .3), i = (y * 64 + x) * 4;
        image.data.set([Math.round((nx + 1) * 127.5), Math.round((ny + 1) * 127.5), Math.round((Math.sqrt(1 - nx * nx - ny * ny) + 1) * 127.5), 255], i);
      }
      ctx.putImageData(image, 0, 0);
      const normalUrl = canvas.toDataURL(), normalBlob = await (await fetch(normalUrl)).blob();
      const geometry = new T.PlaneGeometry(2, 2).toNonIndexed();
      const values = [...geometry.attributes.position.array, ...geometry.attributes.normal.array, ...geometry.attributes.uv.array];
      for (let i = 0; i < 6; i++) values.push(1, 0, 0, -1);
      const binary = new Float32Array(values), bytes = new Uint8Array(binary.buffer);
      const data = {
        asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1] }],
        nodes: [{ name: 'Derivative', mesh: 0, translation: [-1.2, 1, 0] }, { name: 'Tangent', mesh: 1, translation: [1.2, 1, 0] }],
        meshes: [false, true].map(tangent => ({ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, ...(tangent ? { TANGENT: 3 } : {}) }, material: 0 }] })),
        materials: [{ name: 'Embedded OpenGL', normalTexture: { index: 0 }, pbrMetallicRoughness: { baseColorFactor: [.6, .6, .6, 1], metallicFactor: 0, roughnessFactor: 1 } }],
        textures: [{ source: 0 }], images: [{ uri: normalUrl }], buffers: [{ byteLength: bytes.length }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 72 }, { buffer: 0, byteOffset: 72, byteLength: 72 }, { buffer: 0, byteOffset: 144, byteLength: 48 }, { buffer: 0, byteOffset: 192, byteLength: 96 }],
        accessors: [{ bufferView: 0, componentType: 5126, count: 6, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5126, count: 6, type: 'VEC3' }, { bufferView: 2, componentType: 5126, count: 6, type: 'VEC2' }, { bufferView: 3, componentType: 5126, count: 6, type: 'VEC4' }],
      };
      const json = new TextEncoder().encode(JSON.stringify(data)), jsonLength = Math.ceil(json.length / 4) * 4;
      const glb = new ArrayBuffer(28 + jsonLength + bytes.length), view = new DataView(glb), output = new Uint8Array(glb);
      [0x46546c67, 2, glb.byteLength, jsonLength, 0x4e4f534a].forEach((v, i) => view.setUint32(i * 4, v, true));
      output.fill(32, 20, 20 + jsonLength); output.set(json, 20);
      view.setUint32(20 + jsonLength, bytes.length, true); view.setUint32(24 + jsonLength, 0x004e4942, true); output.set(bytes, 28 + jsonLength);
      const loaded = await new GLTFLoader().parseAsync(glb, '');
      const renderer = new T.WebGLRenderer({ antialias: false }); renderer.setSize(128, 128);
      const target = new T.WebGLRenderTarget(128, 128); renderer.setRenderTarget(target);
      const scene = new T.Scene(), camera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 10); camera.position.z = 3;
      const light = new T.DirectionalLight(0xffffff, 2); light.position.set(.3, 1, 1); scene.add(light);
      const mesh = new T.Mesh(); scene.add(mesh);
      const render = material => { mesh.material = material; renderer.render(scene, camera); const pixels = new Uint8Array(128 * 128 * 4); renderer.readRenderTargetPixels(target, 0, 0, 128, 128, pixels); return pixels; };
      const difference = (a, b) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
      const rows = [];
      for (const source of loaded.scene.children) {
        mesh.geometry = source.geometry;
        const original = source.material; original.color.set('#aaaaaa');
        const expected = render(original);
        const fixed = original.clone(); fixed.normalMap = original.normalMap.clone(); fixed.normalMap.userData.formUpload = true;
        fixed.normalScale.set(1, 1); installRoughnessShader(fixed);
        const actual = render(fixed);
        const wrong = fixed.clone(); wrong.normalScale.y = -1; installRoughnessShader(wrong);
        const reversed = render(wrong);
        const saved = readSurface(fixed), restored = fixed.clone(); applySurface(restored, saved);
        const restoreDifference = difference(actual, render(restored));
        applySurface(restored, { normalStrength: 2, flip: true });
        const explicitFlip = readSurface(restored);
        // Physical UVs and rotated placement use the same convention.
        mesh.geometry.setAttribute('uv2', mesh.geometry.attributes.uv.clone());
        const originalUv = original.normalMap.clone(); originalUv.channel = 2; originalUv.rotation = .45;
        original.normalMap = originalUv; original.needsUpdate = true;
        fixed.normalMap.channel = 2; fixed.normalMap.rotation = .45; fixed.needsUpdate = true;
        const rotated = difference(render(original), render(fixed));
        const decal = revealPattern(mesh); decal.update(.5); renderer.render(scene, camera); decal.dispose();
        const reveal = revealMaterial(scene, mesh, 0, fixed, new T.Vector3()); reveal.update(.5); renderer.render(scene, camera); reveal.dispose();
        rows.push({ tangent: !!source.geometry.attributes.tangent, difference: difference(expected, actual), wrongDifference: difference(actual, reversed), savedFlip: saved.flip, restoreDifference, explicitFlip: explicitFlip.flip, explicitStrength: explicitFlip.normalStrength, rotated });
        fixed.dispose(); wrong.dispose(); restored.dispose();
      }
      // FBX and projected patterns retain their normal TextureLoader convention.
      const texture = new T.TextureLoader();
      mesh.geometry = geometry;
      const fbx = new T.MeshStandardMaterial({ normalMap: await texture.loadAsync(normalUrl), roughness: 1 });
      const fixedFbx = fbx.clone(); fixedFbx.normalMap = fbx.normalMap.clone(); fixedFbx.normalMap.userData.formUpload = true; installRoughnessShader(fixedFbx);
      const fbxDifference = difference(render(fbx), render(fixedFbx));
      const { saveAsset } = await import('/shared/asset-store.js');
      const runtime = await prepareModelRuntime(loaded.scene, { name: 'normal-convention.glb', textureConvention: 'gltf' });
      const model = await saveAsset({ kind: 'model', name: 'Normal convention GLB', file: new File([glb], 'normal-convention.glb') });
      const runtimeModel = await saveAsset({ kind: 'model', name: 'Normal convention runtime', file: new File([glb], 'normal-convention.glb'), runtimeModelFile: runtime });
      const fabric = await saveAsset({ kind: 'material', materialType: 'fabric', name: 'OpenGL regression', category: '\u9762\u5e03', fabricColorCode: 'TEST', surface: { color: '#aaaaaa', roughness: 1, normalStrength: 1, flip: false }, physical: { mode: 'physical', sizeSource: 'manual', widthCm: 2, heightCm: 2 }, maps: { normalMap: new File([normalBlob], 'normal-opengl.png', { type: 'image/png' }) } });
      target.dispose(); renderer.dispose();
      return { rows, fbxDifference, modelId: model.id, runtimeModelId: runtimeModel.id, fabricId: fabric.id, normal: normalUrl.split(',')[1] };
    });
    console.log(JSON.stringify({ rows: result.rows, fbxDifference: result.fbxDifference }, null, 2));
    for (const row of result.rows) {
      assert.ok(row.difference < .1, 'OpenGL replacement matches GLTFLoader with tangent=' + row.tangent);
      assert.ok(row.wrongDifference > 10, 'The fixture detects an inverted green channel');
      assert.ok(row.rotated < .1, 'Rotated physical UV2 preserves normal direction');
      assert.equal(row.savedFlip, false); assert.ok(row.restoreDifference < .1);
      assert.equal(row.explicitFlip, true); assert.equal(row.explicitStrength, 2);
    }
    assert.ok(result.fbxDifference < .1, 'FBX and projection image convention is unchanged');

    const editor = await context.newPage();
    await editor.goto(base + '/material-editor.html?asset=' + result.fabricId);
    await editor.waitForFunction(() => document.getElementById('file-normalMap').textContent === 'normal-opengl.png');
    assert.equal(await editor.locator('#flip').isChecked(), false);

    const design = await context.newPage();
    await design.goto(base + '/design.html?asset=' + result.modelId);
    await design.waitForFunction(() => document.getElementById('loading').hidden, null, { timeout: 60000 });
    assert.deepEqual(await design.evaluate(() => patternConventionProbe()), { gltf: true, flipY: false });
    let snapshot = await design.evaluate(() => normalProbe());
    assert.equal(snapshot.meshes.length, 2);
    for (const mesh of snapshot.meshes) {
      assert.deepEqual(mesh.materials[0].scale, [1, 1], 'Imported GLB exposes image convention in controls');
      assert.equal(mesh.materials[0].imported, true);
      assert.equal(mesh.materials[0].flipY, false);
      assert.match(mesh.materials[0].key, /normal-y-1/);
    }
    // Upload directly to one imported material as well as replacing via the dock.
    await design.locator('#sizeSource').selectOption('manual', { force: true });
    await design.locator('#texture-normalMap').setInputFiles({ name: 'normal-opengl.png', mimeType: 'image/png', buffer: Buffer.from(result.normal, 'base64') });
    await design.waitForFunction(() => normalProbe().meshes.some(m => m.materials[0].uploaded));
    await design.locator('#addDockAsset').click();
    await design.locator(`.picker-card[data-asset-id="${result.fabricId}"]`).click();
    await design.locator('#confirmAssetPicker').click();
    await design.waitForFunction(() => !document.getElementById('assetPicker').open && document.getElementById('materialName').value === 'OpenGL regression');
    for (const name of ['Derivative', 'Tangent']) {
      const swatch = await design.locator('#materialList .material-item.active .material-thumb').boundingBox();
      await design.mouse.move(swatch.x + swatch.width / 2, swatch.y + swatch.height / 2); await design.mouse.down();
      let hit = false;
      // The real raycaster distinguishes the two GLB meshes during dragging.
      for (let y = 250; y < 700 && !hit; y += 35) for (let x = 280; x < 1100 && !hit; x += 40) {
        await design.mouse.move(x, y);
        if (await design.locator('#materialDropHint').isVisible()) {
          hit = await design.evaluate(target => normalTarget() === target, name);
        }
      }
      await design.mouse.up();
      assert.ok(hit, 'Drag found ' + name);
      await design.waitForFunction(target => normalProbe().meshes.find(m => m.name === target)?.materials[0].name === 'OpenGL regression', name);
    }
    snapshot = await design.evaluate(() => normalProbe());
    for (const mesh of snapshot.meshes) {
      assert.deepEqual(mesh.materials[0].scale, [1, 1]); assert.equal(mesh.materials[0].flipY, false);
      assert.match(mesh.materials[0].key, /normal-y-1/);
    }
    const { saveOnlineProject, openOnlineProject } = require('./project-roundtrip.cjs');
    const project = await saveOnlineProject(design);
    await openOnlineProject(design, project);
    snapshot = await design.evaluate(() => normalProbe());
    assert.ok(snapshot.meshes.every(m => m.materials[0].name === 'OpenGL regression' && m.materials[0].scale[1] === 1 && /normal-y-1/.test(m.materials[0].key)));
    await design.waitForTimeout(1500);
    await design.screenshot({ path: 'outputs/normal-convention-desktop.png' });
    await design.setViewportSize({ width: 390, height: 844 });
    await design.screenshot({ path: 'outputs/normal-convention-mobile.png' });
    await design.goto(base + '/design.html?asset=' + result.runtimeModelId);
    await design.waitForFunction(() => document.getElementById('loading').hidden, null, { timeout: 60000 });
    snapshot = await design.evaluate(() => normalProbe());
    assert.equal(snapshot.meshes.length, 2);
    assert.ok(snapshot.meshes.every(m => m.materials[0].scale[1] === 1 && m.materials[0].imported === true && /normal-y-1/.test(m.materials[0].key)), 'Cached runtime GLB retains the same normal convention');
    assert.deepEqual(errors, []);
    console.log('PASS: OpenGL normals, tangent/derivative GLB, UV2 rotation, FBX/projection, reveals, editor, direct upload, material replacement, project restore and cached runtime GLB');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
