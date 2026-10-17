import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlbumDownloadHandler } from '../shared/album-download.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function harness(download) {
  const text = {}, errors = [], attributes = {};
  const button = { disabled: false, dataset: {}, querySelector: () => text, setAttribute: (key, value) => { attributes[key] = value; } };
  let requests = 0;
  const click = createAlbumDownloadHandler(button, {
    title: '图册图片',
    download: () => { requests++; return download(); },
    onStart: () => {},
    onError: error => errors.push(error),
  });
  return { button, attributes, text, errors, click, requests: () => requests };
}

test('success waits for the download action, blocks duplicates, then restores the icon after the feedback hold', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred(), h = harness(() => pending.promise);
  const first = h.click();
  await h.click();
  t.mock.timers.tick(10000);
  assert.equal(h.requests(), 1);
  assert.equal(h.button.dataset.downloadState, 'loading');
  assert.equal(h.attributes['aria-busy'], 'true');
  assert.equal(h.button.disabled, true);
  pending.resolve(); await first;
  assert.equal(h.button.dataset.downloadState, 'success');
  assert.equal(h.attributes['aria-busy'], 'false');
  assert.equal(h.button.disabled, false);
  t.mock.timers.tick(1599);
  assert.equal(h.button.dataset.downloadState, 'success');
  t.mock.timers.tick(1);
  assert.equal(h.button.dataset.downloadState, 'idle');
  assert.equal(h.attributes['aria-label'], '下载原图：图册图片');
});

test('a second click during success cancels the old reset; failure restores controls without showing success', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred(); let attempt = 0;
  const h = harness(() => ++attempt === 1 ? Promise.resolve() : pending.promise);
  await h.click();
  t.mock.timers.tick(800);
  const retry = h.click();
  t.mock.timers.tick(2000);
  assert.equal(h.button.dataset.downloadState, 'loading');
  assert.equal(h.button.disabled, true);
  const error = new Error('下载失败'); pending.reject(error); await retry;
  assert.deepEqual(h.errors, [error]);
  assert.equal(h.button.dataset.downloadState, 'idle');
  assert.equal(h.attributes['aria-busy'], 'false');
  assert.equal(h.button.disabled, false);
  t.mock.timers.tick(2000);
  assert.equal(h.button.dataset.downloadState, 'idle');
});

test('cards keep independent feedback and a saving failure never displays a completion check', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deferred(), a = harness(() => pending.promise);
  const error = new Error('浏览器下载失败'), b = harness(() => { throw error; });
  const first = a.click(); await b.click();
  assert.equal(a.button.dataset.downloadState, 'loading');
  assert.equal(b.button.dataset.downloadState, 'idle');
  assert.deepEqual(b.errors, [error]);
  pending.resolve(); await first;
  assert.equal(a.button.dataset.downloadState, 'success');
  assert.equal(b.button.dataset.downloadState, 'idle');
});
