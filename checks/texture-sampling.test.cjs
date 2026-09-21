const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const base = process.env.FORM_BASE_URL || 'http://127.0.0.1:4186';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(base + '/asset-library.html');
    const results = await page.evaluate(async () => {
      const T = await import('/vendor/three/build/three.module.js');
      const { configureTextureSampling } = await import('/shared/texture-sampling.js');
      const { installRoughnessShader } = await import('/shared/roughness-map.js');
      const { applySurface } = await import('/shared/material-data.js');
      const { revealPattern, revealMaterial } = await import('/material-reveal.js');
      const renderer = new T.WebGLRenderer({ antialias: false });
      renderer.setSize(256, 256); renderer.setPixelRatio(1);
      const target = new T.WebGLRenderTarget(256, 256);
      renderer.setRenderTarget(target);
      const scene = new T.Scene(), camera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 100);
      camera.position.z = 10;
      scene.add(new T.AmbientLight(0xffffff, .3));
      const light = new T.DirectionalLight(0xffffff, 2); light.position.set(1, 1, 2); scene.add(light);
      // An oversized plane keeps geometry/background edges out of the signal.
      // A wider orthographic view reproduces distance-dependent minification.
      const geometry = new T.PlaneGeometry(256, 256);
      geometry.setAttribute('uv2', geometry.attributes.uv.clone());
      const mesh = new T.Mesh(geometry); scene.add(mesh);
      function weave(normal, width = 126, height = 98) {
        const data = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4, u = Math.sin(x * 2 * Math.PI / 7), v = Math.sin(y * 2 * Math.PI / 7);
          if (normal) { data[i] = Math.round(128 + 75 * u); data[i + 1] = Math.round(128 + 75 * v); data[i + 2] = Math.round(128 + 127 * Math.sqrt(1 - .35 * (u * u + v * v))); }
          else data[i] = data[i + 1] = data[i + 2] = Math.round(128 + 60 * (u + v));
          data[i + 3] = 255;
        }
        const texture = new T.DataTexture(data, width, height);
        texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.repeat.set(128, 128);
        // Deliberately start with the bad inherited settings seen in imported maps.
        texture.generateMipmaps = false; texture.minFilter = T.NearestFilter;
        configureTextureSampling(texture, renderer);
        return texture;
      }
      const normal = weave(true), bump = weave(false);
      function render(material, span, offset = 0, angle = 0) {
        mesh.material = material; mesh.rotation.y = angle;
        camera.left = -span + offset; camera.right = span + offset;
        camera.top = span; camera.bottom = -span; camera.updateProjectionMatrix();
        renderer.render(scene, camera);
        const pixels = new Uint8Array(256 * 256 * 4); renderer.readRenderTargetPixels(target, 0, 0, 256, 256, pixels);
        return pixels;
      }
      function difference(a, b) {
        let sum = 0;
        for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) sum += Math.abs(a[i + c] - b[i + c]);
        return sum / (a.length * .75);
      }
      const output = [];
      for (const kind of ['normal', 'object-normal', 'bump']) {
        const props = { color: '#bba080', roughness: .45, bumpScale: .2 };
        if (kind === 'bump') props.bumpMap = bump;
        else { props.normalMap = normal; if (kind === 'object-normal') props.normalMapType = T.ObjectSpaceNormalMap; }
        const original = new T.MeshStandardMaterial(props), fixed = original.clone(), flat = new T.MeshStandardMaterial({ color: props.color, roughness: props.roughness });
        installRoughnessShader(fixed);
        const near = render(original, 1), nearFixed = render(fixed, 1), nearFlat = render(flat, 1);
        const far = render(original, 8), farFixed = render(fixed, 8), farFlat = render(flat, 8);
        const shifted = render(fixed, 8, .017);
        const originalShifted = render(original, 8, .017);
        const distant = render(fixed, 20), distantFlat = render(flat, 20);
        output.push({ kind, nearDifference: difference(near, nearFixed), nearDetail: difference(nearFixed, nearFlat), farOriginal: difference(far, farFlat), farFixed: difference(farFixed, farFlat), movement: difference(farFixed, shifted), originalMovement: difference(far, originalShifted), distantDetail: difference(distant, distantFlat) });
        // Exercise physical UV2, rotated rectangular maps and oblique views.
        const map = fixed.normalMap || fixed.bumpMap;
        map.channel = 2; map.rotation = .47; fixed.needsUpdate = true;
        render(fixed, 1, 0, 1.1); render(fixed, 16, 0, 1.1);
        map.channel = 0; map.rotation = 0;
        fixed.needsUpdate = true;
        // The same hook must coexist with roughness conversion and both reveals.
        fixed.roughnessMap = bump; applySurface(fixed, { roughnessGrayscale: true, roughnessInvert: true });
        mesh.material = fixed;
        const decal = revealPattern(mesh); decal.update(.5); render(mesh.material, 2); decal.dispose();
        const swap = revealMaterial(scene, mesh, 0, fixed, new T.Vector3()); swap.update(.5); render(fixed, 2); swap.dispose();
        original.dispose(); fixed.dispose(); flat.dispose();
      }
      const validFilters = [normal, bump].every(t => t.generateMipmaps && t.minFilter === T.LinearMipmapLinearFilter && t.magFilter === T.LinearFilter && t.anisotropy === Math.max(1, renderer.capabilities.getMaxAnisotropy()) && t.colorSpace === T.NoColorSpace);
      const glError = renderer.getContext().getError();
      normal.dispose(); bump.dispose(); geometry.dispose(); target.dispose(); renderer.dispose();
      return { output, validFilters, glError };
    });
    console.log(JSON.stringify(results, null, 2));
    assert.deepEqual(errors, [], 'All normal, bump, roughness and reveal shaders compile');
    assert.equal(results.glError, 0);
    assert.equal(results.validFilters, true);
    for (const row of results.output) {
      assert.ok(row.nearDifference < .1, row.kind + ': near detail matches unmodified rendering');
      assert.ok(row.nearDetail > .25, row.kind + ': close weave is visible');
      assert.ok(row.farFixed < row.farOriginal * .65, row.kind + ': unresolved shading is reduced');
      assert.ok(row.movement < row.originalMovement * .65, row.kind + ': distant motion is more stable');
      assert.ok(row.distantDetail < .1, row.kind + ': subpixel shading fades completely');
    }
    console.log('PASS: WebGL2 NPOT mipmaps, close detail, distant normal/bump stability, UV2, oblique views and both reveal shaders');

    // Read-only test probes inspect the actual materials without adding debug APIs
    // to production. All edits, assignment and project restore use the real UI.
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const probe = `m => ({ key: m.customProgramCacheKey(), maps: Object.fromEntries(['map','normalMap','bumpMap','roughnessMap'].filter(k => m[k]).map(k => [k, { mipmaps: m[k].generateMipmaps, min: m[k].minFilter, mag: m[k].magFilter, anisotropy: m[k].anisotropy, colorSpace: m[k].colorSpace, width: m[k].image.width, height: m[k].image.height, channel: m[k].channel }])) })`;
    await context.route('**/entries/material-editor.js', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + `\nwindow.samplingProbe = () => ({ materials: [(${probe})(material)], max: renderer.capabilities.getMaxAnisotropy() });` });
    });
    await context.route('**/app.js', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + `\nwindow.samplingProbe = () => ({ materials: entries.map(e => ({...(${probe})(e.material), name: e.name, used: e.meshes.size})), max: renderer.capabilities.getMaxAnisotropy() });` });
    });
    context.on('page', p => {
      p.on('pageerror', error => errors.push(error.message));
      p.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    });
    const editor = await context.newPage();
    await editor.goto(base + '/material-editor.html');
    await editor.waitForFunction(() => !document.getElementById('saveMaterial').disabled);
    const png = Buffer.from(await editor.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 126; c.height = 98;
      const x = c.getContext('2d'); x.fillStyle = '#8080ff'; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = '#6597d5'; for (let i = 0; i < c.width; i += 7) x.fillRect(i, 0, 2, c.height);
      return c.toDataURL().split(',')[1];
    }), 'base64');
    for (const key of ['map', 'normalMap', 'bumpMap', 'roughnessMap']) {
      await editor.locator('#map-' + key).setInputFiles({ name: key + '.png', mimeType: 'image/png', buffer: png });
      await editor.waitForFunction(k => document.getElementById('file-' + k).textContent === k + '.png', key);
    }
    function checkMaterials(snapshot) {
      for (const material of snapshot.materials) {
        assert.match(material.key, /detail-sampling-v1/, 'Material and restored clones retain sampling shader');
        for (const [key, map] of Object.entries(material.maps)) {
          assert.equal(map.mipmaps, true); assert.equal(map.min, 1008); assert.equal(map.mag, 1006);
          assert.equal(map.anisotropy, Math.max(1, snapshot.max));
          assert.equal(map.colorSpace, key === 'map' ? 'srgb' : '');
        }
      }
    }
    checkMaterials(await editor.evaluate(() => samplingProbe()));
    await editor.locator('#name').fill('Sampling regression');
    await editor.locator('#saveMaterial').click();
    await editor.waitForFunction(() => document.getElementById('status').textContent === '已保存到资产库');
    const assetId = new URL(editor.url()).searchParams.get('asset');
    await editor.reload();
    await editor.waitForFunction(() => document.getElementById('name').value === 'Sampling regression' && !document.getElementById('saveMaterial').disabled);
    checkMaterials(await editor.evaluate(() => samplingProbe()));
    const design = await context.newPage();
    await design.goto(base + '/?asset=' + assetId);
    await design.waitForFunction(() => document.getElementById('loading').hidden && document.getElementById('materialName').value === 'Sampling regression', null, { timeout: 60000 });
    const imported = await design.evaluate(() => samplingProbe());
    assert.equal(imported.materials.length, 10); checkMaterials(imported);
    const swatch = await design.locator('.material-item.active .material-thumb').boundingBox();
    await design.mouse.move(swatch.x + 30, swatch.y + 30); await design.mouse.down();
    await design.mouse.move(500, 400, { steps: 15 });
    let hit = false;
    for (let y = 250; y < 630 && !hit; y += 45) for (let x = 340; x < 800 && !hit; x += 45) {
      await design.mouse.move(x, y); hit = await design.locator('#materialDropHint').isVisible();
    }
    assert.ok(hit, 'Replacement targets a model surface'); await design.mouse.up();
    await design.waitForFunction(() => !document.getElementById('undoMaterial').disabled);
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sampling-regression-'));
    try {
      const [download] = await Promise.all([design.waitForEvent('download'), design.locator('#saveProject').click()]);
      const project = path.join(temp, 'sampling.form'); await download.saveAs(project);
      await design.locator('#projectFile').setInputFiles(project);
      await design.waitForFunction(() => document.getElementById('loading').hidden && document.getElementById('materialName').value === 'Sampling regression');
      const restored = await design.evaluate(() => samplingProbe()); checkMaterials(restored);
      const fabric = restored.materials.find(m => m.name === 'Sampling regression');
      assert.ok(fabric.used > 0); assert.equal(Object.keys(fabric.maps).length, 4);
      for (const map of Object.values(fabric.maps)) { assert.equal(map.width, 126); assert.equal(map.height, 98); assert.equal(map.channel, 2); }
      assert.deepEqual(errors, []);
      console.log('PASS: editor upload/save/reload, FBX maps, real material drag replacement and project restore preserve all sampling settings and source resolution');
    } finally {
      // Only this explicitly resolved test directory may be removed.
      assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
      assert.ok(path.basename(temp).startsWith('sampling-regression-'));
      await fs.rm(temp, { recursive: true, force: true });
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
