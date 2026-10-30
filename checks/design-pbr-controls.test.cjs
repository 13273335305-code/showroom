const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:4186';
const keys = ['roughness', 'metalness', 'normalStrength', 'aoStrength', 'sheen', 'sheenRoughness'];

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.route(origin + '/**', async route => {
      const name = decodeURIComponent(new URL(route.request().url()).pathname).slice(1);
      try {
        let body = await fs.readFile(path.join(root, name));
        if (name === 'app.js') body = body.toString() + `
          window.designPbrProbe = {
            read(id) {
              const entry = entries.find(e => e.id === id);
              return { surface: readSurface(entry.material), flip: entry.flip, normal: entry.material.normalScale.toArray(), used: entry.meshes.size,
                assigned: [...entry.meshes].every(mesh => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).includes(entry.material)),
                loaded: entry.assetMapsLoaded, maps: MAPS.filter(([key]) => !!entry.material[key]).map(([key]) => key) };
            },
            async add(id) { await addDesignAsset(await getAsset(id)); return selected.id; },
            select(id) { designUI.setType('fabric'); selectEntry(entries.find(e => e.id === id)); showPanel('material'); },
            async apply(id) {
              const entry = entries.find(e => e.id === id), host = entries.find(e => e.modelOwned && e.meshes.size), mesh = [...host.meshes][0];
              const slot = Array.isArray(mesh.material) ? mesh.material.indexOf(host.material) : 0;
              await loadMaterialMaps(entry); assignMaterial(mesh, slot, entry.material); rebuildMaterialUsage(model, entries); this.select(id);
            },
            async pattern(id) { await addDesignAsset(await getAsset(id)); },
            procedural(id) { const entry = entries.find(e => e.id === id); entry.proceduralMapping = { palette: [{ index: 0, loopHex: '#FFFFFF' }] }; this.select(id); }
          };`;
        await route.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' }[path.extname(name)] || 'application/octet-stream', body });
      } catch { await route.fulfill({ status: 404, body: '' }); }
    });
    const fixture = await require('./project-test-server.cjs').installProjectFixture(context);
    await context.route('**/shared/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export async function requireAuth(){document.documentElement.classList.remove("auth-pending");document.getElementById("authBootLoading")?.remove();} export const authState=()=>({id:"11111111-1111-1111-1111-111111111111"}); export const workspaceClient=async()=>(await import("./project-store.js")).fixtureAccess();' }));
    page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/material-editor.html');
    await page.waitForFunction(() => !document.getElementById('saveMaterial').disabled);
    const editorRanges = await page.evaluate(keys => Object.fromEntries(keys.map(key => {
      const input = document.getElementById(key + 'Value');
      return [key, { min: input.min, max: input.max, step: input.step }];
    })), keys);
    const ids = await page.evaluate(async () => {
      const { saveAsset } = await import('./shared/asset-store.js');
      const c = document.createElement('canvas'); c.width = c.height = 32;
      const x = c.getContext('2d'); x.fillStyle = '#A5B8C8'; x.fillRect(0,0,32,32); x.fillStyle = '#657D93'; x.fillRect(0,0,16,16);
      const file = new File([await new Promise(resolve => c.toBlob(resolve))], 'fabric.png', { type: 'image/png' });
      const surface = { color: '#DDEEFF', roughness: .72, metalness: .28, normalStrength: 1.4, aoStrength: 1.2, sheen: .1, sheenRoughness: .4, flip: true, roughnessGrayscale: true, roughnessInvert: true };
      const base = { kind: 'material', category: '面布', physical: { mode: 'physical', sizeSource: 'manual', widthCm: 12, heightCm: 12, initialized: true }, repeat: [1,1] };
      const a = await saveAsset({ ...base, materialType: 'fabric', name: 'PBR 面料 A', surface, maps: { map: file, normalMap: file, roughnessMap: file, metalnessMap: file, aoMap: file } });
      const b = await saveAsset({ ...base, materialType: 'fabric', name: 'PBR 面料 B', surface: { ...surface, roughness: .96, sheen: 0 }, maps: { map: file } });
      const pattern = await saveAsset({ ...base, materialType: 'pattern', name: 'PBR 图案', surface, maps: { map: file } });
      return { a: a.id, b: b.id, pattern: pattern.id };
    });
    await page.goto(origin + '/design.html?new=1');
    const ready = () => page.waitForFunction(() => window.designPbrProbe && document.getElementById('loading').hidden && !document.getElementById('dayCycle').disabled, null, { timeout: 90000 });
    await ready();
    const a = await page.evaluate(id => designPbrProbe.add(id), ids.a);
    const section = page.locator('#compactPbr'), summary = section.locator('summary');
    const input = key => page.locator('#compactPbr-' + key);
    const read = () => page.evaluate(id => designPbrProbe.read(id), a);
    assert.equal(await section.isVisible(), true);
    assert.equal(await section.evaluate(el => el.open), false, 'PBR controls start collapsed');
    assert.equal(await section.evaluate(el => el === el.parentElement.lastElementChild), true, 'PBR is the final material property section');
    assert.equal(await section.locator('input:not([type=number]),img,canvas,select').count(), 0, 'Only numeric strength values are included');
    assert.equal(await section.locator('input').count(), 6);
    await summary.press('Enter');
    assert.equal(await section.evaluate(el => el.open), true, 'Native disclosure supports the keyboard');
    assert.equal(await input('roughness').inputValue(), '0.72');
    for (const key of keys) assert.deepEqual(await input(key).evaluate(el => ({ min: el.min, max: el.max, step: el.step })), editorRanges[key]);
    const initial = await read(), changed = { roughness: .37, metalness: .63, normalStrength: 2.15, aoStrength: 2.35, sheen: .78, sheenRoughness: .24 };
    for (const [key, value] of Object.entries(changed)) {
      await input(key).fill(String(value));
      assert.equal((await read()).surface[key], value, key + ' applies while typing');
      await input(key).press('Tab');
      assert.equal(await input(key).inputValue(), value.toFixed(2));
    }
    assert.equal((await read()).surface.color, initial.surface.color);
    assert.equal((await read()).surface.roughnessGrayscale, true);
    assert.equal((await read()).surface.roughnessInvert, true);
    await input('normalStrength').fill('0'); await input('normalStrength').press('Tab');
    await input('normalStrength').fill('2.15'); await input('normalStrength').press('Tab');
    assert.deepEqual((await read()).normal, [2.15,-2.15], 'Passing through zero preserves the normal direction');
    await input('aoStrength').fill('4'); await input('aoStrength').press('Tab');
    assert.equal((await read()).surface.aoStrength, 2.35);
    assert.equal(await input('aoStrength').inputValue(), '2.35');
    await input('sheen').fill(''); await input('sheen').press('Tab');
    assert.equal((await read()).surface.sheen, .78);
    assert.equal(await input('sheen').inputValue(), '0.78');

    const beforeApply = (await read()).surface;
    assert.equal((await read()).loaded, false);
    await page.evaluate(id => designPbrProbe.apply(id), a);
    const applied = await read();
    assert.equal(applied.used > 0, true);
    assert.equal(applied.assigned, true, 'The edited material is assigned to the rendered mesh');
    assert.deepEqual(applied.surface, beforeApply, 'Lazy map loading preserves the complete edited surface');
    assert.deepEqual(applied.maps, ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']);
    await input('metalness').fill('0'); await input('metalness').press('Tab');
    assert.equal((await read()).surface.metalness, 0, 'PBR edits update the rendered material');
    await input('metalness').fill(String(changed.metalness)); await input('metalness').press('Tab');
    await page.evaluate(id => designPbrProbe.procedural(id), a);
    assert.equal(await section.evaluate(el => el === el.parentElement.lastElementChild), true);
    assert.equal(await page.locator('#compactProcedural').isVisible(), true);
    await section.scrollIntoViewIfNeeded();
    await fs.mkdir(path.join(root, 'outputs'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'outputs/design-pbr-strengths-desktop.png') });

    const b = await page.evaluate(id => designPbrProbe.add(id), ids.b);
    assert.equal(await input('roughness').inputValue(), '0.96');
    assert.equal(await input('sheen').inputValue(), '0.00');
    assert.equal((await read()).surface.roughness, changed.roughness, 'Selecting a second material does not change the first');
    await page.evaluate(id => designPbrProbe.pattern(id), ids.pattern);
    assert.equal(await section.isVisible(), false, 'PBR strength section is specific to fabrics');
    await page.evaluate(id => designPbrProbe.select(id), a);
    assert.equal(await section.evaluate(el => el.open), false);

    const { saveOnlineProject, openOnlineProject } = require('./project-roundtrip.cjs');
    const project = await saveOnlineProject(page);
    assert.deepEqual(Object.fromEntries(keys.map(key => [key, project.manifest.materials[a].surface[key]])), changed);
    assert.equal(fixture.assets.get(ids.a).metadata.surface.roughness, .72, 'Scene tuning does not change the library asset');
    await openOnlineProject(page, project); await ready();
    await page.evaluate(id => designPbrProbe.select(id), a);
    assert.equal(await section.evaluate(el => el.open), false);
    await summary.click();
    for (const [key, value] of Object.entries(changed)) assert.equal(await input(key).inputValue(), value.toFixed(2));
    assert.deepEqual((await read()).normal, [2.15,-2.15]);
    assert.equal((await page.evaluate(id => designPbrProbe.read(id), b)).surface.roughness, .96);

    await page.setViewportSize({ width: 390, height: 844 });
    await input('sheenRoughness').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    for (const element of await section.locator('input').all()) {
      const rect = await element.boundingBox(); assert.ok(rect.x >= 0 && rect.x + rect.width <= 390);
    }
    await page.screenshot({ path: path.join(root, 'outputs/design-pbr-strengths-mobile.png') });
    await summary.click();
    assert.equal(await section.evaluate(el => el.open), false);
    assert.deepEqual(errors, []);
    console.log('PASS: collapsed numeric-only fabric PBR controls, editor ranges, live rendering, validation, normal direction, lazy textures, material isolation, project save/reopen and desktop/mobile layout.');
  } catch (error) {
    await page?.screenshot({ path: path.join(root, 'outputs/design-pbr-strengths-error.png') }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
