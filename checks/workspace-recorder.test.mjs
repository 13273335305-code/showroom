import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceRecorder, recordingCsv, safeResource } from '../shared/workspace-recorder.js';

test('CSV handles Chinese text, embedded quotes and newlines, and protects formula-like filenames', () => {
  const csv = recordingCsv([{ time: '2026-10-15 15:00:00.000 +08:00', page: '资产库', action: '点击', mouse: '左键', content: '=SUM(1,2)', detail: '名称"一"\n第二行' }]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('资产库'));
  assert.ok(csv.includes('"\'=SUM(1,2)"'));
  assert.ok(csv.includes('"名称""一""\n第二行"'));
  assert.ok(csv.endsWith('\r\n'));
});

test('Log URLs omit signed queries, fragments and non-network payloads', () => {
  assert.equal(safeResource('https://example.com/model.glb?token=secret#private'), 'https://example.com/model.glb');
  assert.equal(safeResource('data:image/png;base64,SECRET'), 'data:');
  assert.equal(safeResource('blob:https://example.com/secret'), 'blob:');
});

test('Recorder tracks streamed downloads, mouse events, page changes, shared stop, and export/restart', async t => {
  // Exercise the recorder with native streams and lightweight browser storage/event
  // adapters. Visual layout and actual browser IndexedDB remain browser-test work.
  const rows = [], storage = new Map(); let key = 0;
  const memoryDatabase = {
    transaction() {
      const tx = { objectStore: () => ({
        add(row) { rows.push({ ...row, key: ++key }); return { result: key }; },
        clear() { rows.length = 0; return {}; },
        index: () => ({ getAll: session => ({ result: rows.filter(row => row.session === session).map(row => ({ ...row })) }) })
      }) };
      queueMicrotask(() => tx.oncomplete?.()); return tx;
    }
  };
  class ElementStub {}
  class XhrStub extends EventTarget {
    open(method, url) { this.url = url; }
    send() {
      this.status = 200;
      queueMicrotask(() => { this.dispatchEvent(Object.assign(new Event('progress'), { loaded: 1234 })); this.dispatchEvent(new Event('loadend')); });
    }
  }
  const windowStub = new EventTarget(), documentStub = new EventTarget();
  documentStub.title = '工作空间'; documentStub.hidden = false;
  windowStub.fetch = async url => {
    if (url.includes('/fail')) return new Response('missing', { status: 404 });
    if (url.includes('/abort')) return new Response(new ReadableStream({ pull() { throw new DOMException('Aborted', 'AbortError'); } }));
    if (url.includes('/json')) return Response.json({ ok: true });
    let sent = 0;
    const response = new Response(new ReadableStream({ async pull(controller) {
      if (sent === 2) { controller.close(); return; }
      await new Promise(resolve => setTimeout(resolve, 650)); sent++; controller.enqueue(new Uint8Array(4096).fill(65));
    } }), { headers: { 'content-type': 'application/octet-stream' } });
    Object.defineProperty(response, 'url', { value: 'https://test.local/file.bin?token=SECRET' }); return response;
  };
  const replacements = {
    window: windowStub, document: documentStub, Element: ElementStub, XMLHttpRequest: XhrStub,
    location: { href: 'https://test.local/index.html', pathname: '/index.html' },
    localStorage: { getItem: name => storage.get(name) || null, setItem: (name, value) => storage.set(name, value) },
    indexedDB: { open() { const request = { result: memoryDatabase }; queueMicrotask(() => request.onsuccess?.()); return request; } },
    PerformanceObserver: class { observe() {} }
  };
  const descriptors = new Map(Object.keys(replacements).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(replacements)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const recorder = createWorkspaceRecorder();
  t.after(async () => {
    await recorder.stop();
    for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  await recorder.ready;
  assert.equal(recorder.snapshot().session, null);
  await recorder.start();
  const sessionId = recorder.snapshot().session.id;
  await assert.rejects(recorder.export(), /先结束记录/);
  documentStub.dispatchEvent(Object.assign(new Event('click'), { button: 2, clientX: 42, clientY: 72 }));
  const downloading = windowStub.fetch('/file.bin?token=SECRET').then(async response => {
    assert.equal(response.url, 'https://test.local/file.bin?token=SECRET');
    return (await response.arrayBuffer()).byteLength;
  });
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.ok(recorder.snapshot().speed > 0); assert.equal(recorder.snapshot().content, 'file.bin');
  assert.equal(await downloading, 8192);
  assert.equal((await windowStub.fetch('/fail')).status, 404);
  await assert.rejects((await windowStub.fetch('/abort')).blob(), { name: 'AbortError' });
  assert.deepEqual(await (await windowStub.fetch('/json')).json(), { ok: true });
  const xhr = new XhrStub(); xhr.open('GET', '/xhr.bin'); xhr.send();
  await new Promise(resolve => setTimeout(resolve, 10));
  globalThis.location.pathname = '/design.html'; globalThis.location.href = 'https://test.local/design.html';
  windowStub.dispatchEvent(new Event('hashchange'));
  const state = JSON.parse(storage.get('spenic.workspace-recording.v1'));
  storage.set('spenic.workspace-recording.v1', JSON.stringify({ ...state, recording: false, stoppedAt: Date.now() }));
  windowStub.dispatchEvent(Object.assign(new Event('storage'), { key: 'spenic.workspace-recording.v1' }));
  assert.equal(recorder.snapshot().session.recording, false);
  const exported = await recorder.export(), csv = await exported.blob.text();
  assert.ok(exported.count > 5);
  assert.equal(csv.includes('SECRET'), false);
  for (const expected of ['工作空间', '设计台', '右键', '(42, 72)', '8192', '1234', '下载失败', '下载已取消', '结束页面记录']) assert.ok(csv.includes(expected), expected);
  const stoppedCount = rows.length;
  documentStub.dispatchEvent(Object.assign(new Event('click'), { button: 0, clientX: 1, clientY: 2 }));
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(rows.length, stoppedCount);
  await recorder.start(); assert.notEqual(recorder.snapshot().session.id, sessionId);
  await recorder.stop();
  assert.equal((await (await recorder.export()).blob.text()).includes('file.bin'), false);
});
