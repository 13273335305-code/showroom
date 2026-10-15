import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchFabricColorPreview } from '../shared/fabric-color-preview.js';
import { syncFabricColorProgress } from '../shared/fabric-color-progress.js';

test('preview progress follows streamed bytes, with manifest size when the header is absent', async t => {
  for (const headers of [{ 'content-length': '10' }, {}]) {
    const progress = [];
    t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(3)); controller.enqueue(new Uint8Array(7)); controller.close();
      },
    }), { headers: { ...headers, 'content-type': 'image/jpeg' } }));
    const blob = await fetchFabricColorPreview('https://assets.test/preview', { size: 10, onProgress: value => progress.push(value) });
    assert.equal(blob.size, 10); assert.equal(blob.type, 'image/jpeg');
    assert.equal(progress[0], .3); assert.equal(progress.at(-1), 1);
    assert.ok(progress.every(value => value >= 0 && value <= 1));
    t.mock.restoreAll();
  }
});

test('unknown lengths complete when the stream ends, and blobs need no download', async t => {
  const progress = [];
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('preview'));
  await fetchFabricColorPreview('https://assets.test/preview', { onProgress: value => progress.push(value) });
  assert.deepEqual(progress, [1]);
  const blob = new Blob(['cached']);
  assert.equal(await fetchFabricColorPreview(blob), blob);
  assert.equal(fetch.mock.callCount(), 1);
});

test('failed or cancelled downloads never report completion', async t => {
  const progress = [];
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 403 }));
  await assert.rejects(fetchFabricColorPreview('https://assets.test/preview', { onProgress: value => progress.push(value) }), /无法下载/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchFabricColorPreview(new Blob(['cached']), { signal: controller.signal, onProgress: value => progress.push(value) }), { name: 'AbortError' });
  assert.deepEqual(progress, []);
});

const source = readFileSync(new URL('../entries/asset-library.js', import.meta.url), 'utf8');
const start = source.indexOf('      let colorRequest = 0,');
const end = source.indexOf('      const renderColorPage', start);
function fixture() {
  const buttons = ['old', 'new', 'last'].map(id => ({
    dataset: { variantId: id }, attributes: {}, progress: null,
    setAttribute(key, value) { this.attributes[key] = value; },
    getAttribute() { return '切换色号 ' + id; },
    querySelector() { return this.progress; },
    append(progress) { this.progress = progress; progress.remove = () => { this.progress = null; }; },
  }));
  const images = [], timers = [], covers = new Map(), requests = [], messages = [];
  const card = { isConnected: true, dataset: {}, classList: { toggle() {} }, style: { setProperty() {} },
    append() {}, querySelectorAll: () => [], querySelector: selector => selector === '.asset-description' ? {} : null };
  const art = { querySelectorAll: () => [], prepend(image) { this.image = image; } };
  const document = { createElement(tag) {
    if (tag === 'img') {
      const image = { style: {}, decode: () => new Promise((resolve, reject) => { image.ready = resolve; image.fail = reject; }) };
      images.push(image); return image;
    }
    const value = { style: {} }, label = {};
    return { attributes: {}, setAttribute(key, item) { this.attributes[key] = item; }, querySelector: selector => selector === '.color-progress-value' ? value : label };
  } };
  const asset = { id: 'old' };
  buttons.forEach(button => { button.ownerDocument = document; });
  const getAsset = id => new Promise(resolve => { covers.set(id, () => resolve({ preview: 'preview-' + id })); });
  const fetchPreview = async (preview, { signal, onProgress }) => { requests.push({ preview, signal }); onProgress(.5); return new Blob(['image']); };
  const switchColor = new Function('syncFabricColorProgress', 'bar', 'card', 'document', 'asset', 'getAsset', 'fetchFabricColorPreview', 'imageUrl', 'fitMaterialPreview', 'openMenu', 'closeMenu', 'cardUrls', 'renderedCards', 'selectedFabricColors', 'key', 'art', 'createMenu', 'syncCardSelection', 'selectedAssetIds', 'cardSignature', 'status', 'setTimeout', 'clearTimeout', source.slice(start, end) + '\nreturn switchColor;')(
    syncFabricColorProgress,
    { querySelectorAll: () => buttons }, card, document, asset, getAsset, fetchPreview,
    () => 'blob:fixture', () => {}, null, () => {}, new Map(), new Map(), new Map(), 'group', art,
    () => [], () => {}, new Set(), () => '', message => messages.push(message), callback => { timers.push(callback); return callback; },
    callback => { const index = timers.indexOf(callback); if (index >= 0) timers.splice(index, 1); });
  return { buttons, images, timers, covers, requests, messages, asset, art, switchColor };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const variant = id => ({ id, name: '389', fabricColorCode: id });

test('new ball starts at zero, waits for decode before 100, then clears the ring', async () => {
  const f = fixture(), loading = f.switchColor(variant('new')), button = f.buttons[1];
  assert.equal(button.progress.attributes['aria-valuenow'], '0');
  assert.equal(button.attributes['aria-busy'], 'true');
  f.covers.get('new')(); await flush();
  assert.equal(button.progress.attributes['aria-valuenow'], '50');
  assert.equal(f.asset.id, 'old'); assert.equal(f.art.image, undefined);
  f.images[0].ready(); await loading;
  assert.equal(f.asset.id, 'new'); assert.equal(f.art.image, f.images[0]);
  assert.equal(button.progress.attributes['aria-valuenow'], '100');
  assert.equal(button.attributes['aria-busy'], 'false');
  f.timers[0](); assert.equal(button.progress, null);
});

test('newer choices cancel the prior download and stale decodes never replace them', async () => {
  const f = fixture(), first = f.switchColor(variant('new'));
  f.covers.get('new')(); await flush();
  const last = f.switchColor(variant('last'));
  assert.equal(f.requests[0].signal.aborted, true); assert.equal(f.buttons[1].progress, null);
  f.covers.get('last')(); await flush();
  f.images[1].ready(); await last;
  f.images[0].ready(); await first;
  assert.equal(f.asset.id, 'last'); assert.equal(f.art.image, f.images[1]);
  assert.equal(f.buttons[2].progress.attributes['aria-valuenow'], '100');
});

test('decode failure keeps the previous color and clears loading; clicking the active color cancels', async () => {
  const f = fixture(), loading = f.switchColor(variant('new'));
  f.covers.get('new')(); await flush();
  f.images[0].fail(new Error('broken')); await loading;
  assert.equal(f.asset.id, 'old'); assert.equal(f.buttons[1].progress, null);
  assert.match(f.messages[0], /色号预览加载失败/);
  const retry = f.switchColor(variant('new'));
  await f.switchColor(variant('old'));
  assert.equal(f.buttons[1].progress, null);
  f.covers.get('new')(); await retry;
  assert.equal(f.asset.id, 'old');
});
