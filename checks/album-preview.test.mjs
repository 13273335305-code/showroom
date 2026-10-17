import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { albumPhotoTitle, albumDownloadName } from '../shared/album-name.js';

const source = await readFile(new URL('../entries/album.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('async function openPreview('), source.indexOf('async function load('));
const listeners = source.slice(source.indexOf("$('albumRetry').addEventListener"), source.lastIndexOf('\nload();'));
const photo = { id: 'one', name: 'original.png', width: 1920, height: 1080, createdAt: 1000 };
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function harness(downloadPhoto, decode = async () => {}, options = {}) {
  const nodes = new Map(), revoked = [], downloads = []; let urls = 0;
  const grid = { childElementCount: 1 }, empty = { hidden: true }, removed = [];
  const card = { remove() { grid.childElementCount--; } };
  function $(id) {
    if (!nodes.has(id)) {
      const node = new EventTarget();
      Object.assign(node, { hidden: false, disabled: false, open: false, textContent: '', attributes: {},
        showModal() { this.open = true; }, close() { this.open = false; this.dispatchEvent(new Event('close')); },
        removeAttribute(key) { delete this.attributes[key]; }, setAttribute(key, value) { this.attributes[key] = value; }, decode,
        getBoundingClientRect() { return { left: 20, top: 20, right: 800, bottom: 600 }; } });
      Object.defineProperty(node, 'src', { get() { return this.attributes.src; }, set(value) { this.attributes.src = value; } });
      nodes.set(id, node);
    }
    return nodes.get(id);
  }
  const create = new Function('$', 'downloadPhoto', 'downloadFile', 'URL', 'albumPhotoTitle', 'albumDownloadName', 'removePhoto', 'window', 'grid', 'empty',
    "let previewUrl=null,previewFile=null,previewRequest=0,previewPhoto=null,previewCard=null,previewDeleting=false; function load() {} function formatDate() { return 'date'; }\n" + functions + listeners + '; return {openPreview,closePreview,deletePreviewPhoto};');
  const api = create($, downloadPhoto, (...args) => downloads.push(args), { createObjectURL: () => 'blob:' + (++urls), revokeObjectURL: url => revoked.push(url) }, albumPhotoTitle, albumDownloadName,
    async id => { removed.push(id); await options.removePhoto?.(id); }, { confirm: () => options.confirm !== false }, grid, empty);
  return { ...api, $, revoked, downloads, removed, grid, empty, card };
}

test('preview reads the original without downloading, then downloads only on button click and releases it on close', async () => {
  const file = { blob: new Blob(['original']), name: photo.name };
  const h = harness(async id => { assert.equal(id, photo.id); return file; });
  await h.openPreview(photo);
  assert.equal(h.$('albumPreviewDialog').open, true); assert.equal(h.$('albumPreviewTitle').textContent, 'original');
  assert.equal(h.$('albumOriginalImage').src, 'blob:1'); assert.equal(h.$('albumOriginalDownload').disabled, false);
  assert.equal(h.$('albumPreviewStatus').hidden, true); assert.deepEqual(h.downloads, []);
  h.$('albumOriginalDownload').dispatchEvent(new Event('click'));
  assert.deepEqual(h.downloads, [[file.blob, file.name]]);
  h.$('albumPreviewClose').dispatchEvent(new Event('click'));
  assert.equal(h.$('albumPreviewDialog').open, false); assert.equal(h.$('albumOriginalImage').src, undefined);
  assert.deepEqual(h.revoked, ['blob:1']);
});

test('a closed preview cannot replace another image when its download completes late', async () => {
  const first = deferred(), second = deferred();
  const h = harness(id => id === 'one' ? first.promise : second.promise);
  const old = h.openPreview(photo); h.closePreview();
  const next = h.openPreview({ ...photo, id: 'two', name: 'second.png' });
  second.resolve({ blob: new Blob(['second']), name: 'second.png' }); await next;
  first.resolve({ blob: new Blob(['first']), name: 'first.png' }); await old;
  assert.equal(h.$('albumOriginalImage').src, 'blob:1');
  h.$('albumOriginalDownload').dispatchEvent(new Event('click'));
  assert.equal(h.downloads[0][1], 'second.png');
  assert.equal(h.$('albumPreviewTitle').textContent, 'second');
});

test('Escape during decoding clears the image and prevents late download enablement', async () => {
  const decode = deferred(), h = harness(async () => ({ blob: new Blob(['original']), name: photo.name }), () => decode.promise);
  const opened = h.openPreview(photo); await Promise.resolve();
  h.$('albumPreviewDialog').dispatchEvent(new Event('cancel', { cancelable: true }));
  decode.resolve(); await opened;
  assert.equal(h.$('albumPreviewDialog').open, false); assert.equal(h.$('albumOriginalDownload').disabled, true);
  assert.deepEqual(h.revoked, ['blob:1']);
});

test('a failed original read leaves a visible error and cannot trigger a download', async () => {
  const h = harness(async () => { throw new Error('读取失败'); });
  await h.openPreview(photo);
  assert.equal(h.$('albumPreviewStatus').hidden, false); assert.equal(h.$('albumPreviewStatus').textContent, '读取失败');
  assert.equal(h.$('albumOriginalDownload').disabled, true);
  h.$('albumOriginalDownload').dispatchEvent(new Event('click')); assert.deepEqual(h.downloads, []);
});

test('only a click outside the dialog bounds closes the preview', async () => {
  const h = harness(async () => ({ blob: new Blob(['original']), name: photo.name }));
  await h.openPreview(photo);
  for (const [x, expected] of [[30, true], [5, false]]) {
    const event = new Event('click'); Object.assign(event, { clientX: x, clientY: 30 });
    h.$('albumPreviewDialog').dispatchEvent(event); assert.equal(h.$('albumPreviewDialog').open, expected);
  }
});

test('album loads once and retries manually without focus, online or timer refreshes', () => {
  const nodes = new Map(), window = new EventTarget(), timers = []; let reads = 0;
  const $ = id => { if (!nodes.has(id)) nodes.set(id, new EventTarget()); return nodes.get(id); };
  const startup = source.slice(source.indexOf("$('albumRetry').addEventListener"));
  const run = new Function('$', 'load', 'closePreview', 'resetPreview', 'deletePreviewPhoto', 'window', 'document', 'setInterval', startup);
  run($, () => reads++, () => {}, () => {}, () => {}, window, { visibilityState: 'visible' }, callback => timers.push(callback));
  assert.equal(reads, 1);
  window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online'));
  for (const tick of timers) tick();
  assert.equal(reads, 1); assert.equal(timers.length, 0);
  $('albumRetry').dispatchEvent(new Event('click')); assert.equal(reads, 2);
});

test('preview deletion requires confirmation and cancellation preserves the image and card', async () => {
  const h = harness(async () => ({ blob: new Blob(['original']), name: photo.name }), undefined, { confirm: false });
  await h.openPreview(photo, h.card); await h.deletePreviewPhoto();
  assert.deepEqual(h.removed, []);
  assert.equal(h.$('albumPreviewDialog').open, true);
  assert.equal(h.grid.childElementCount, 1);
  assert.equal(h.$('albumOriginalDownload').disabled, false);
});

test('deleting the final photo removes its card, closes preview, releases the image and shows the empty state', async () => {
  const h = harness(async () => ({ blob: new Blob(['original']), name: photo.name }));
  await h.openPreview(photo, h.card); await h.deletePreviewPhoto();
  assert.deepEqual(h.removed, [photo.id]);
  assert.equal(h.grid.childElementCount, 0);
  assert.equal(h.empty.hidden, false);
  assert.equal(h.$('albumPreviewDialog').open, false);
  assert.equal(h.$('albumPreviewDelete').disabled, true);
  assert.equal(h.$('albumOriginalDownload').disabled, true);
  assert.deepEqual(h.revoked, ['blob:1']);
});

test('pending deletion blocks duplicate requests and closing; failure keeps the preview and restores its controls for retry', async () => {
  const removal = deferred();
  const h = harness(async () => ({ blob: new Blob(['original']), name: photo.name }), undefined, { removePhoto: () => removal.promise });
  await h.openPreview(photo, h.card);
  const deleting = h.deletePreviewPhoto(); await h.deletePreviewPhoto(); h.closePreview();
  assert.equal(h.$('albumPreviewDialog').open, true);
  assert.equal(h.$('albumPreviewClose').disabled, true);
  assert.equal(h.$('albumOriginalDownload').disabled, true);
  assert.deepEqual(h.removed, [photo.id]);
  removal.reject(new Error('删除失败')); await deleting;
  assert.equal(h.$('albumPreviewError').textContent, '删除失败');
  assert.equal(h.$('albumPreviewError').hidden, false);
  assert.equal(h.grid.childElementCount, 1);
  for (const id of ['albumPreviewClose', 'albumOriginalDownload', 'albumPreviewDelete']) assert.equal(h.$(id).disabled, false);
  h.closePreview(); assert.equal(h.$('albumPreviewDialog').open, false);
});

test('deletion during an original read prevents its late result from restoring the removed preview', async () => {
  const original = deferred();
  const h = harness(() => original.promise);
  const opening = h.openPreview(photo, h.card);
  assert.equal(h.$('albumPreviewDelete').disabled, false);
  await h.deletePreviewPhoto();
  original.resolve({ blob: new Blob(['original']), name: photo.name }); await opening;
  assert.equal(h.$('albumPreviewDialog').open, false);
  assert.equal(h.$('albumOriginalImage').src, undefined);
  assert.equal(h.$('albumOriginalDownload').disabled, true);
  assert.equal(h.grid.childElementCount, 0);
});
