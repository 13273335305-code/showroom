const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:4186';
const retired = { emissive: '#ffffff', emissiveStrength: 3, bumpStrength: .2 };

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.route(origin + '/**', async route => {
      const name = decodeURIComponent(new URL(route.request().url()).pathname).slice(1);
      try {
        await route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' }[path.extname(name)] || 'application/octet-stream', body: await fs.readFile(path.join(root, name)) });
      } catch { await route.fulfill({ status: 404, body: '' }); }
    });
    const fixture = await require('./project-test-server.cjs').installProjectFixture(context);
    await context.route('**/shared/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export async function requireAuth(){document.documentElement.classList.remove("auth-pending");document.getElementById("authBootLoading")?.remove();} export const authState=()=>({id:"11111111-1111-1111-1111-111111111111"}); export const workspaceClient=async()=>(await import("./project-store.js")).fixtureAccess();' }));
    await context.route('**/entries/material-editor.js*', async route => route.fulfill({ contentType: 'text/javascript', body: await fs.readFile(path.join(root, 'entries/material-editor.js'), 'utf8') + '\nwindow.retiredEditorProbe=()=>({surface:currentAsset().surface,maps:Object.keys(currentAsset().maps)});' }));
    await context.route('**/app.js', async route => route.fulfill({ contentType: 'text/javascript', body: await fs.readFile(path.join(root, 'app.js'), 'utf8') + `
      window.retiredDesignProbe={
        read:()=>entries.map(e=>({bump:!!e.material.bumpMap,emissive:!!e.material.emissiveMap,bumpScale:e.material.bumpScale,intensity:e.material.emissiveIntensity,color:e.material.emissive.getHex(),surface:readSurface(e.material)})),
        async add(id){await addMaterialAsset(await getAsset(id));await loadMaterialMaps(selected);const mesh=[...entries[0].meshes][0];assignMaterial(mesh,0,selected.material);rebuildMaterialUsage(model,entries);},
        inspect(){showPanel('material');setInspectorCollapsed(false);},
        pixels(){renderer.render(scene,camera);const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const ctx=canvas.getContext('2d');ctx.drawImage($('canvas'),0,0,32,32);return new Set([...ctx.getImageData(0,0,32,32).data].filter((_,i)=>i%4!==3)).size;}
      };` }));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(origin + '/material-editor.html');
    const editorReady = () => page.waitForFunction(() => window.retiredEditorProbe && !document.getElementById('saveMaterial').disabled);
    await editorReady();
    const assetId = await page.evaluate(async () => {
      const { saveAsset } = await import('./shared/asset-store.js');
      const blob = await (await fetch('./checks/fabric-no-dpi.png')).blob();
      return (await saveAsset({ kind: 'material', materialType: 'fabric', name: 'Legacy Fabric', category: '面布', surface: { color: '#ffffff', roughness: .65 }, physical: { mode: 'physical', sizeSource: 'manual', widthCm: 12, heightCm: 9 }, maps: { map: new File([blob], 'base.png', { type: 'image/png' }) } })).id;
    });
    const row = fixture.assets.get(assetId);
    row.metadata.surface = { ...row.metadata.surface, ...retired };
    for (const key of ['bumpMap', 'emissiveMap']) { row.manifest.maps[key] = 'missing/' + key; row.manifest.runtimeMaps[key] = 'missing/' + key; }
    await page.goto(origin + '/material-editor.html?asset=' + assetId);
    await page.waitForFunction(() => document.getElementById('name').value === 'Legacy Fabric'); await editorReady();
    assert.deepEqual(await page.locator('#materialMaps [data-map]').evaluateAll(rows => rows.map(row => row.dataset.map)), ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']);
    assert.equal(await page.locator('#bumpStrength,#emissiveStrength,#emissive').count(), 0);
    await page.locator('#roughness').fill('0.72');
    await page.locator('#normalStrengthValue').fill('1.75'); await page.locator('#normalStrengthValue').press('Tab');
    const editor = await page.evaluate(() => retiredEditorProbe());
    assert.deepEqual(editor.maps, ['map']);
    for (const key of Object.keys(retired)) assert.equal(key in editor.surface, false);
    await page.locator('#saveMaterial').click(); await page.locator('#confirmPreviewGeneration').click();
    await page.waitForFunction(() => document.getElementById('status').textContent === '已生成预览图并保存到资产库');
    assert.deepEqual(Object.keys(fixture.assets.get(assetId).manifest.maps), ['map']);
    await page.reload(); await editorReady();
    await page.waitForFunction(() => document.getElementById('name').value === 'Legacy Fabric');
    assert.equal(await page.locator('#roughnessValue').inputValue(), '0.72');
    assert.equal(await page.locator('#normalStrengthValue').inputValue(), '1.75');
    await fs.mkdir(path.join(root, 'outputs'), { recursive: true });
    await page.locator('#aoStrength').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(root, 'outputs/retired-channels-editor.png') });

    await page.goto(origin + '/design.html');
    const designReady = () => page.waitForFunction(() => window.retiredDesignProbe && document.getElementById('loading').hidden && !document.getElementById('dayCycle').disabled, null, { timeout: 90000 });
    await designReady();
    assert.equal(await page.locator('#bumpStrength,#emissiveStrength,#texture-bumpMap,#texture-emissiveMap').count(), 0);
    assert.equal(await page.locator('#textureSlots .texture-slot').count(), 5);
    await page.evaluate(id => retiredDesignProbe.add(id), assetId);
    const checkMaterials = async () => {
      const materials = await page.evaluate(() => retiredDesignProbe.read());
      for (const m of materials) {
        assert.equal(m.bump, false); assert.equal(m.emissive, false);
        assert.equal(m.bumpScale, 0); assert.equal(m.intensity, 0); assert.equal(m.color, 0);
        for (const key of Object.keys(retired)) assert.equal(key in m.surface, false);
      }
    };
    await checkMaterials();
    const { saveOnlineProject, openOnlineProject } = require('./project-roundtrip.cjs');
    const project = await saveOnlineProject(page);
    for (const m of project.manifest.materials) for (const key of Object.keys(retired)) assert.equal(key in m, false);
    for (const m of fixture.projects.get(project.id).manifest.materials) {
      Object.assign(m, retired); m.surface = { ...m.surface, ...retired };
      m.maps.bumpMap = { path: 'missing-bump' }; m.maps.emissiveMap = { path: 'missing-emissive' };
    }
    await openOnlineProject(page, project); await designReady(); await checkMaterials();
    await page.evaluate(() => retiredDesignProbe.inspect());
    assert.ok(await page.evaluate(() => retiredDesignProbe.pixels()) > 20, 'The model canvas contains rendered content');
    await page.screenshot({ path: path.join(root, 'outputs/retired-channels-design-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => retiredDesignProbe.pixels()) > 20);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(root, 'outputs/retired-channels-design-mobile.png') });
    assert.deepEqual(errors, []);
    console.log('PASS: legacy maps skipped, editor controls removed, remaining edits save/reload, design has five channels, model and old project channels disabled, snapshots omit retired settings, desktop/mobile render.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
