const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const base = process.env.FORM_BASE_URL || 'http://127.0.0.1:4186';
const root = path.resolve(__dirname, '..');
const alice = '11111111-1111-1111-1111-111111111111';
const first = '22222222-2222-2222-2222-222222222222', second = '33333333-3333-3333-3333-333333333333', collectionId = '44444444-4444-4444-4444-444444444444';
async function makeModel() {
  const THREE = await import(pathToFileURL(path.join(root, 'vendor/three/build/three.module.js')));
  const g = new THREE.BoxGeometry(2, 2, 2), p = g.attributes.position.array, n = g.attributes.normal.array, uv = g.attributes.uv.array;
  const binary = Buffer.concat([Buffer.from(p.buffer), Buffer.from(n.buffer), Buffer.from(uv.buffer), Buffer.from(g.index.array.buffer)]);
  const data = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ name: '面布', pbrMetallicRoughness: { baseColorFactor: [.5, .6, .8, 1], roughnessFactor: .6, metallicFactor: 0 } }], buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: p.byteLength }, { buffer: 0, byteOffset: p.byteLength, byteLength: n.byteLength }, { buffer: 0, byteOffset: p.byteLength + n.byteLength, byteLength: uv.byteLength }, { buffer: 0, byteOffset: p.byteLength + n.byteLength + uv.byteLength, byteLength: g.index.array.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: p.length / 3, type: 'VEC3', min: [-1, -1, -1], max: [1, 1, 1] }, { bufferView: 1, componentType: 5126, count: n.length / 3, type: 'VEC3' }, { bufferView: 2, componentType: 5126, count: uv.length / 2, type: 'VEC2' }, { bufferView: 3, componentType: 5123, count: g.index.array.length, type: 'SCALAR' }] };
  const json = Buffer.from(JSON.stringify(data)), padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded);
  const output = Buffer.alloc(28 + padded.length + binary.length); output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(padded.length, 12); output.writeUInt32LE(0x4e4f534a, 16); padded.copy(output, 20); output.writeUInt32LE(binary.length, 20 + padded.length); output.writeUInt32LE(0x004e4942, 24 + padded.length); binary.copy(output, 28 + padded.length);
  return output;
}
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  const state = { projects: new Map(), resources: new Map(), objects: new Map(), assets: new Map(), favorites: new Map() }, errors = [], anonymousAuth = [];
  const collections = new Map(), items = new Map(), shares = new Map(), comments = new Map(), photos = new Map();
  const tables = { spenic_showcases: collections, spenic_showcase_items: items, spenic_showcase_shares: shares, spenic_project_comments: comments, spenic_album_photos: photos, spenic_projects: state.projects };
  const model = await makeModel(), hash = createHash('sha256').update(model).digest('hex'), modelPath = alice + '/' + hash;
  state.objects.set(modelPath, { body: model, type: 'model/gltf-binary' });
  const { ENVIRONMENT_DEFAULTS } = await import(pathToFileURL(path.join(root, 'shared/scene-file.js')));
  const scene = { ...ENVIRONMENT_DEFAULTS, rotation: 0, scale: 1.2, autoRotate: false, renderMode: 'pbr' };
  let clock = Date.now(); const stamp = () => new Date(++clock).toISOString();
  function project(id, color, name) {
    return { id, owner_id: alice, kind: 'project', name, model_name: 'cube.glb', visibility: 'personal', created_at: stamp(), updated_at: stamp(),
      manifest: { format: 'SPENIC-PROJECT', version: 1, name: 'cube.glb', modelPath: 'model.glb', files: { 'model.glb': { kind: 'cloud', path: modelPath, hash, size: model.length, name: 'cube.glb', type: 'model/gltf-binary' } },
        scene, camera: { position: [12, 8, 12], target: [0, 2.1, 0] }, materials: [{ id: 0, name: '面布', color, roughness: .6, metalness: 0, normalStrength: 1, aoStrength: 1, flip: false, repeat: [1, 1], maps: {} }],
        annotations: [{ id: 'original-mark', host: 0, point: [0, .4, 1], text: '原有设计标记' }] } };
  }
  state.projects.set(first, project(first, '93adc7', '方案甲')); state.projects.set(second, project(second, 'd98f72', '方案乙'));
  collections.set(collectionId, { id: collectionId, owner_id: alice, name: '客户甲展示', created_at: stamp(), updated_at: stamp() });
  [first, second].forEach((id, i) => items.set(collectionId + ':' + id, { showcase_id: collectionId, project_id: id, position: i, config: {} }));
  const png = await fs.readFile(path.join(root, 'checks/fabric-no-dpi.png'));
  for (const [projectId, source] of [[first, 'capture'], [first, 'ai'], [second, 'ai']]) {
    const id = randomUUID(), image_path = alice + '/' + id + '/image.png', thumbnail_path = alice + '/' + id + '/thumbnail.png';
    photos.set(id, { id, owner_id: alice, project_id: projectId, name: source + '-' + projectId.slice(0, 4) + '.png', source, width: 32, height: 32, bytes: png.length, image_path, thumbnail_path, created_at: stamp() });
    state.objects.set(image_path, { body: png, type: 'image/png' }); state.objects.set(thumbnail_path, { body: png, type: 'image/png' });
  }
  function rpc(name, args) {
    if (name === 'spenic_save_showcase') {
      const data = args.showcase_data, old = collections.get(data.id); if (old && old.updated_at !== args.expected_revision) throw Error('Showcase changed');
      const id = data.id || randomUUID(), saved = { id, owner_id: alice, name: data.name, created_at: old?.created_at || stamp(), updated_at: stamp() }; collections.set(id, saved);
      for (const [key, item] of items) if (item.showcase_id === id) items.delete(key);
      data.items.forEach((item, index) => items.set(id + ':' + item.projectId, { showcase_id: id, project_id: item.projectId, position: index, config: item.config || {} })); return saved;
    }
    if (name === 'spenic_set_showcase_share') { const old = shares.get(args.target_id); shares.set(args.target_id, { showcase_id: args.target_id, token_hash: args.new_hash || old?.token_hash, enabled: args.active }); return null; }
    if (name === 'spenic_submit_project_comment') {
      const data = args.comment_data, share = args.share_hash ? [...shares.values()].find(s => s.enabled && s.token_hash === args.share_hash) : null;
      if (args.share_hash && (!share || !items.has(share.showcase_id + ':' + data.projectId))) throw Error('Share unavailable');
      const old = [...comments.values()].find(c => c.project_id === data.projectId && c.request_id === data.requestId); if (old) return old;
      const row = { id: randomUUID(), request_id: data.requestId, project_id: data.projectId, author_name: data.authorName, body: data.body, model_hash: data.modelHash, host: data.host, point: data.point, created_at: stamp() }; comments.set(row.id, row); return row;
    }
    if (name === 'spenic_reposition_project_comment') { const row = comments.get(args.comment_id); Object.assign(row, { model_hash: args.model_hash_value, host: args.host_value, point: args.point_value }); return row; }
    throw Error('Unknown RPC ' + name);
  }
  const { createShowcaseHandler } = await import(pathToFileURL(path.join(root, 'api/showcase.js')));
  const gateway = createShowcaseHandler({ base: 'https://fixture.test', serviceKey: () => 'test-server-key', fetchImpl: async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith('/storage/')) {
      const marker = parsed.pathname.includes('spenic-album-photos') ? 'spenic-album-photos/' : 'spenic-project-resources/';
      return Response.json({ signedURL: base + '/__showcase_browser/object/' + parsed.pathname.split(marker)[1] });
    }
    if (parsed.pathname.includes('/rpc/')) return Response.json(rpc(parsed.pathname.split('/').at(-1), JSON.parse(options.body)));
    const table = tables[parsed.pathname.split('/').at(-1)]; let rows = [...(table?.values() || [])];
    for (const [key, value] of parsed.searchParams) {
      if (value.startsWith('eq.')) rows = rows.filter(row => String(row[key]) === value.slice(3));
      if (value.startsWith('in.')) rows = rows.filter(row => value.slice(4, -1).split(',').includes(row[key]));
    }
    const offset = Number(parsed.searchParams.get('offset') || 0), limit = Number(parsed.searchParams.get('limit') || 1000);
    return Response.json(rows.slice(offset, offset + limit));
  } });
  async function setup(viewport, guest = false) {
    const context = await browser.newContext({ viewport, acceptDownloads: true }); await require('./project-test-server.cjs').installProjectFixture(context, { state });
    await context.route('**/shared/auth.js', route => route.fulfill({ contentType: 'text/javascript', body: `import {client} from '../checks/showcase-cloud-fixture.js'; export const authState=()=>({id:'${alice}'}); export async function requireAuth(){${guest ? "throw new Error('Guest auth requested')" : "document.documentElement.classList.remove('auth-pending');document.getElementById('authBootLoading')?.remove();"}} export async function workspaceClient(){${guest ? "throw new Error('Guest account requested')" : `return {client,userId:'${alice}'};`}}` }));
    await context.route('**/app.js', async route => route.fulfill({ contentType: 'text/javascript', body: (await fs.readFile(path.join(root, 'app.js'), 'utf8')) + '\nwindow.readShowcaseRuntime=()=>({model,entries,state,annotations,camera,controls,activeProjectId,workspaceMode});' }));
    await context.route('**/__showcase_browser/**', async route => {
      const req = route.request(), name = new URL(req.url()).pathname.slice('/__showcase_browser/'.length);
      if (guest && !name.startsWith('object/')) anonymousAuth.push(name);
      if (name.startsWith('object/')) {
        const key = decodeURIComponent(name.slice(7));
        if (req.method() === 'PUT') { state.objects.set(key, { body: req.postDataBuffer(), type: 'image/png' }); return route.fulfill({ json: { data: { path: key } } }); }
        const file = state.objects.get(key); return file ? route.fulfill({ body: file.body, contentType: file.type }) : route.fulfill({ status: 404 });
      }
      const data = req.postDataJSON();
      if (name === 'rpc') { try { return route.fulfill({ json: { data: rpc(data.name, data.args) } }); } catch (error) { return route.fulfill({ json: { error: { message: error.message } } }); } }
      const table = tables[data.table]; if (!table) return route.fulfill({ json: { data: [] } });
      if (data.operation === 'insert') { const row = { ...data.query.row, created_at: stamp() }; table.set(row.id, row); return route.fulfill({ json: { data: row } }); }
      let rows = [...table.values()].filter(row => Object.entries(data.filters).every(([k, v]) => row[k] === v));
      if (data.operation === 'delete') for (const row of rows) { table.delete(row.id); if (data.table === 'spenic_showcases') { for (const [key, item] of items) if (item.showcase_id === row.id) items.delete(key); shares.delete(row.id); } }
      rows = rows.slice(data.query.start || 0, (data.query.end ?? 199) + 1);
      return route.fulfill({ json: { data: data.query.single ? rows[0] || null : rows } });
    });
    await context.route('**/api/showcase', async route => {
      let result, code; await gateway({ method: 'POST', headers: { 'content-type': 'application/json' }, body: route.request().postDataJSON() }, { statusCode: 200, setHeader() {}, end(body) { code = this.statusCode; result = body; } });
      return route.fulfill({ status: code, contentType: 'application/json', body: result });
    });
    context.on('page', page => { page.on('pageerror', error => errors.push(error.message)); }); return context;
  }
  async function ready(page, id) { await page.waitForFunction(id => window.readShowcaseRuntime?.().activeProjectId === id && document.getElementById('loading').hidden && !document.getElementById('annotationMode').disabled, id, { timeout: 60000 }); }
  try {
    const ownerContext = await setup({ width: 1440, height: 1000 }), owner = await ownerContext.newPage();
    await owner.goto(base + '/showcase.html?collection=' + collectionId); await ready(owner, first);

    assert.equal(await owner.locator('.showcase-project-open').count(), 2); assert.equal(await owner.locator('.showcase-photo').count(), 2);
    assert.equal(await owner.locator('#compactMaterialPanel').isVisible(), false);
    // A new empty collection must release the previous model, album and comment context.
    await owner.locator('#showcaseCollection').selectOption('__new');
    await owner.locator('#showcaseName').fill('空清单切换验收');
    await owner.locator('#showcaseManageForm button[type=submit]').click();
    await owner.waitForFunction(() => !document.getElementById('showcaseManageDialog').open && !readShowcaseRuntime().model && !readShowcaseRuntime().activeProjectId);
    const emptyId = await owner.locator('#showcaseCollection').inputValue();
    assert.notEqual(emptyId, collectionId); assert.equal(await owner.locator('.showcase-photo').count(), 0);
    assert.equal(await owner.locator('.annotation-card').count(), 0); assert.equal(await owner.locator('#snapshot').isDisabled(), true);
    await owner.locator('#showcaseAdd').click();
    await owner.locator('#showcasePickerItems input').first().check();
    await owner.locator('#showcasePickerItems input').last().check();
    await owner.locator('#showcasePickerForm button[type=submit]').click(); await ready(owner, first);
    await owner.locator('.showcase-project').last().getByRole('button', { name: '向前移动项目' }).click();
    await owner.waitForFunction(() => !document.getElementById('showcaseCollection').disabled);
    assert.equal(items.get(emptyId + ':' + second).position, 0);
    await owner.locator('.showcase-project').last().getByRole('button', { name: '移出', exact: true }).click(); await ready(owner, second);
    assert.equal(state.projects.has(first), true, 'removing an item preserves its source project');
    await owner.locator('.showcase-project').getByRole('button', { name: '移出', exact: true }).click();
    await owner.waitForFunction(() => !readShowcaseRuntime().model && document.getElementById('showcaseProjectCount').textContent === '0');
    await owner.locator('#showcaseCollection').selectOption(collectionId); await ready(owner, first);
    await owner.locator('#showcaseCollection').selectOption(emptyId);
    await owner.waitForFunction(() => !readShowcaseRuntime().model && document.getElementById('snapshot').disabled);
    await owner.locator('#showcaseCollection').selectOption(collectionId); await ready(owner, first);

    // Refresh pulls the latest source without changing the collection's independent settings.
    state.projects.get(first).manifest = structuredClone(state.projects.get(first).manifest);
    state.projects.get(first).manifest.materials[0].color = '83bca2';
    state.projects.get(first).manifest.annotations[0].text = '更新后的设计标记';
    await owner.locator('#showcaseRefresh').click();
    await owner.waitForFunction(() => !document.getElementById('annotationMode').disabled && readShowcaseRuntime().entries[0].material.color.getHexString() === '83bca2');
    assert.match(await owner.locator('.annotation-label').first().textContent(), /更新后的设计标记/);
    await owner.locator('#showcaseLight').click(); await owner.locator('#keyLight').fill('4.2'); await owner.locator('#keyLight').dispatchEvent('input'); await owner.locator('#saveProject').click();
    await owner.waitForFunction(() => document.getElementById('toast').textContent === '展示清单与展示效果已保存');
    assert.equal(items.get(collectionId + ':' + first).config.scene.keyLight, 4.2); assert.equal(state.projects.get(first).manifest.scene.keyLight, scene.keyLight);
    await owner.locator('#annotationMode').click(); await owner.locator('.annotation-edit').first().click(); await owner.locator('.annotation-row-input').fill('仅供展示的标记'); await owner.locator('.annotation-row .annotation-confirm').click(); await owner.locator('#saveProject').click();
    await owner.waitForFunction(() => document.getElementById('toast').textContent === '展示清单与展示效果已保存');
    assert.equal(items.get(collectionId + ':' + first).config.annotations['original-mark'].text, '仅供展示的标记'); assert.equal(state.projects.get(first).manifest.annotations[0].text, '更新后的设计标记');
    await owner.locator('#showcaseLight').click(); await owner.locator('#resetScene').click(); await ready(owner, first);
    await owner.locator('#saveProject').click(); await owner.waitForFunction(() => document.getElementById('toast').textContent === '展示清单与展示效果已保存');
    assert.deepEqual(items.get(collectionId + ':' + first).config, {});
    await owner.locator('#showcaseAlbum').click(); await owner.locator('#showcasePhotoFilter').selectOption('ai'); assert.equal(await owner.locator('.showcase-photo').count(), 1);
    await owner.locator('.showcase-photo').click(); await owner.locator('#showcaseDownload:enabled').waitFor(); await owner.locator('#showcasePreviewClose').click();
    await owner.locator('#showcasePhotoFilter').selectOption('all');
    await owner.evaluate(() => { const cards = document.querySelectorAll('.showcase-project-open'); cards[1].click(); cards[0].click(); cards[1].click(); }); await ready(owner, second);
    await owner.waitForFunction(() => document.querySelectorAll('.showcase-photo').length === 1); assert.equal(await owner.evaluate(() => readShowcaseRuntime().entries[0].material.color.getHexString()), 'd98f72');
    await owner.locator('.showcase-project-open').first().click(); await ready(owner, first);
    await owner.locator('#snapshot').click(); await owner.locator('#captureWidth').fill('320'); await owner.locator('#captureHeight').fill('240'); await owner.locator('#captureShoot').click();
    await owner.waitForFunction(() => document.getElementById('toast').textContent.includes('项目画册')); assert.equal([...photos.values()].filter(p => p.project_id === first).length, 3);
    await owner.locator('#captureExit').click(); await owner.locator('.showcase-share-button').click(); await owner.locator('#showcaseNewShare').click();
    await owner.waitForFunction(() => document.getElementById('showcaseShareUrl').value.includes('#share=')); const link = await owner.locator('#showcaseShareUrl').inputValue();
    await owner.locator('#showcaseShareDialog [data-close]').click(); await owner.waitForFunction(()=>document.querySelector('.workspace').style.getPropertyValue('--inspector-progress')==='1'&&!document.body.classList.contains('capture-exiting')); await owner.screenshot({ path: path.join(root, '.codex-project-check/showcase-desktop.png') });

    const guestContext = await setup({ width: 1440, height: 1000 }, true), guest = await guestContext.newPage(); await guest.goto(link); await ready(guest, first);
    assert.equal(await guest.locator('#snapshot').isVisible(), false); assert.equal(await guest.locator('#developerPanel').count(), 0);
    assert.equal(await guest.locator('#captureAiPromptMenu').count(), 1); assert.deepEqual(anonymousAuth, []);
    await guest.locator('#annotationMode').click();
    const spot = await guest.evaluate(() => { const { model, camera } = readShowcaseRuntime(); let mesh; model.traverse(o => { if (o.isMesh) mesh = o; }); const p = mesh.position.clone().set(.65, -.35, 1); mesh.localToWorld(p); p.project(camera); const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.x + (p.x + 1) * r.width / 2, y: r.y + (1 - p.y) * r.height / 2 }; });
    await guest.mouse.click(spot.x, spot.y); await guest.locator('.annotation-draft-input').fill('客户确认：这里需要调整'); await guest.locator('.annotation-card.draft .annotation-confirm').click();
    await guest.locator('.feedback-name-dialog input').fill('客户甲'); await guest.locator('.feedback-name-dialog button[type=submit]').click();
    await guest.waitForFunction(() => document.querySelectorAll('.feedback-row').length === 1); assert.equal(comments.size, 1);
    await guest.reload(); await ready(guest, first); await guest.locator('#annotationMode').click(); await guest.locator('.feedback-row').waitFor();
    assert.equal(await guest.locator('.annotation-card.project-comment').count(), 1); assert.equal(await guest.locator('.feedback-actions').count(), 0);
    await guest.screenshot({ path: path.join(root, '.codex-project-check/showcase-guest.png') });
    const mobileContext = await setup({ width: 390, height: 844 }, true), mobile = await mobileContext.newPage(); await mobile.goto(link); await ready(mobile, first);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true); await mobile.locator('#showcaseAlbum').click();
    await mobile.waitForFunction(()=>document.querySelector('.workspace').style.getPropertyValue('--inspector-progress')==='1'); await mobile.screenshot({ path: path.join(root, '.codex-project-check/showcase-mobile.png') });
    assert.equal(await mobile.locator('#showcaseAlbumPanel').isVisible(), true);
    await mobile.locator('#closeInspector').click(); await mobile.waitForFunction(() => document.querySelector('.workspace').style.getPropertyValue('--inspector-progress') === '0');
    await owner.setViewportSize({ width: 390, height: 844 }); await owner.locator('#showcaseAlbum').click(); await owner.waitForFunction(() => document.querySelector('.workspace').style.getPropertyValue('--inspector-progress') === '1');
    await owner.screenshot({ path: path.join(root, '.codex-project-check/showcase-owner-mobile.png') });
    const headerBounds = await owner.locator('.header-actions').boundingBox(); assert.ok(headerBounds.x + headerBounds.width <= 390, 'mobile owner controls stay on screen');
    const design = await ownerContext.newPage(); await design.goto(base + '/design.html?project=' + first); await design.waitForFunction(() => document.getElementById('loading').hidden, null, { timeout: 60000 });
    await design.locator('#annotationMode').click(); await design.locator('.feedback-row').waitFor(); assert.match(await design.locator('.feedback-row').textContent(), /客户确认/);
    await design.locator('.feedback-actions button').last().click(); await design.waitForFunction(() => document.querySelectorAll('.feedback-row').length === 0); assert.equal(comments.size, 0);
    const invalid = await guestContext.newPage(); await invalid.goto(base + '/showcase.html#share=');
    await invalid.locator('.showcase-boot-error').waitFor(); assert.match(await invalid.locator('.showcase-boot-error').textContent(), /分享链接无效/);
    await owner.locator('.showcase-share-button').click(); await owner.locator('#showcaseDisableShare').click();
    await owner.waitForFunction(() => document.getElementById('showcaseShareStatus').textContent === '链接已停用');
    await guest.reload(); await guest.locator('.showcase-boot-error').waitFor(); assert.match(await guest.locator('.showcase-boot-error').textContent(), /分享链接无效或已停用/);
    assert.deepEqual(errors, []); assert.deepEqual(anonymousAuth, []);
    await ownerContext.close(); await guestContext.close(); await mobileContext.close(); console.log('Showcase collection create/add/order/remove, empty transitions, source refresh, desktop, guest, mobile, capture, share and design feedback passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
