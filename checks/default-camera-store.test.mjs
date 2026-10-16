import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultCameraStore } from '../shared/default-camera-store.js';
import { readDefaultView } from '../shared/developer-settings.js';

const published = JSON.parse(fs.readFileSync(new URL('../design-default-view.json', import.meta.url), 'utf8'));
const validate = value => {
  assert.equal(value.format, 'SPENIC-DESIGN-VIEW'); assert.equal(value.version, 1);
  return readDefaultView(value.view);
};
const response = (value, ok = true) => ({ ok, json: async () => value });
function cloudHarness({ row = null, loadError = null, saveError = null } = {}) {
  const calls = [];
  let stored = row;
  const client = { from(table) {
    calls.push(['from', table]);
    return {
      select(column) { return { eq(field, value) { calls.push(['read', column, field, value]); return { maybeSingle: async () => ({ data: stored, error: loadError }) }; } }; },
      upsert(value, options) {
        calls.push(['upsert', structuredClone(value), options]);
        return { select: () => ({ single: async () => {
          if (saveError) return { error: saveError };
          stored = { config: structuredClone(value.config) }; return { data: stored, error: null };
        } }) };
      },
    };
  } };
  return { calls, access: async () => ({ client }), get row() { return stored; } };
}

test('local default views read published files and save through the original file API', async () => {
  const requests = [];
  const store = createDefaultCameraStore({ validate, location: { hostname: '127.0.0.1' },
    access: () => { throw new Error('Local files must not need cloud access'); },
    fetch: async (url, options) => { requests.push([url, options]); return response(options.method ? { saved: true } : published); } });
  assert.deepEqual(await store.load('design'), { view: validate(published), source: 'file' });
  assert.equal(requests[0][0], './design-default-view.json');
  assert.equal(requests[0][1].cache, 'no-store');
  assert.equal((await store.save('design', published)).source, 'file');
  assert.equal(requests[1][0], './__form_design_view');
  assert.deepEqual(JSON.parse(requests[1][1].body).view, validate(published));
});

test('static hosting uses deployed camera JSON when the cloud table is not installed', async () => {
  const cloud = cloudHarness({ loadError: { code: 'PGRST205' } }), requests = [];
  const store = createDefaultCameraStore({ validate, access: cloud.access, location: { hostname: 'showroom-ivory.vercel.app' },
    fetch: async (url, options) => { requests.push([url, options]); return response(published); } });
  const restored = await store.load('design');
  assert.deepEqual(restored.view, validate(published));
  assert.equal(restored.view.distance, published.view.distance, 'Exact saved distance survives deployment');
  assert.deepEqual(restored.view.offset, published.view.offset, 'Panning survives deployment');
  assert.equal(requests[0][0], './design-default-view.json');
  assert.ok(!requests.some(([url]) => url.includes('__form_')), 'No local server API on static hosting');
});

test('online global saves survive a new store instance and override published defaults', async () => {
  const cloud = cloudHarness(), request = () => { throw new Error('Cloud configuration must take precedence'); };
  const settings = { validate, access: cloud.access, location: { hostname: 'example.com' }, fetch: request };
  const first = createDefaultCameraStore(settings);
  const changed = { ...published, view: { ...published.view, azimuth: -25, distance: 6.5 } };
  assert.deepEqual(await first.save('design', changed), { view: validate(changed), source: 'cloud' });
  const second = createDefaultCameraStore(settings);
  assert.deepEqual(await second.load('design'), { view: validate(changed), source: 'cloud' });
  assert.equal(cloud.calls.find(([type]) => type === 'upsert')[2].onConflict, 'page');
});

test('missing cloud setup, denied writes and network errors never claim a successful save', async () => {
  for (const [error, message] of [[{ code: '42P01' }, /尚未初始化/], [{ code: 'PGRST205' }, /尚未初始化/], [{ code: '42501' }, /没有.*权限/], [{ message: 'Network failed' }, /保存失败/]]) {
    const cloud = cloudHarness({ saveError: error });
    const store = createDefaultCameraStore({ validate, access: cloud.access, location: { hostname: 'example.com' } });
    await assert.rejects(store.save('design', published), message);
    assert.equal(cloud.row, null);
  }
  const local = createDefaultCameraStore({ validate, location: { hostname: 'localhost' }, fetch: async () => response({ saved: false }) });
  await assert.rejects(local.save('design', published), /本地文件未能保存/);
});

test('invalid or unavailable cloud settings fall back to validated deployment data', async () => {
  for (const state of [{ row: { config: { ...published, version: 99 } } }, { loadError: { message: 'Offline' } }, {}]) {
    const cloud = cloudHarness(state), warnings = [];
    const store = createDefaultCameraStore({ validate, access: cloud.access, location: { hostname: 'example.com' },
      warn: (...args) => warnings.push(args), fetch: async () => response(published) });
    assert.equal((await store.load('design')).source, 'file');
  }
  const cloud = cloudHarness();
  const store = createDefaultCameraStore({ validate, access: cloud.access, location: { hostname: 'example.com' }, fetch: async () => response({}, false) });
  await assert.rejects(store.load('design'), /不可读取/);
  await assert.rejects(store.save('unknown', published), /不支持/);
});

test('parts and design views use independent published files and cloud records', async () => {
  const value = JSON.parse(fs.readFileSync(new URL('../parts-default-view.json', import.meta.url), 'utf8'));
  const requests = [];
  const store = createDefaultCameraStore({ location: { hostname: 'localhost' }, validate: config => {
    assert.equal(config.format, 'SPENIC-MODEL-VIEW'); return config.view;
  }, fetch: async (url, options) => { requests.push(url); return response(options.method ? { saved: true } : value); } });
  assert.deepEqual((await store.load('parts')).view, value.view);
  await store.save('parts', value);
  assert.deepEqual(requests, ['./parts-default-view.json', './__form_parts_view']);
});

test('developer save preserves captured distance, honors framing edits and reports cloud confirmation', async () => {
  const source = fs.readFileSync(new URL('../shared/developer-panel.js', import.meta.url), 'utf8');
  const begin = source.indexOf("  $('developerViewForm').onsubmit");
  const end = source.indexOf("  $('developerSaveShowroomScale')", begin);
  for (const [framing, fail] of [[published.view.framing, false], [1.1, false], [0.9, true]]) {
    const button = { disabled: false }, status = {}, notifications = [];
    const form = { querySelector: () => button };
    const nodes = { developerViewForm: form, developerSaveStatus: status,
      developerAzimuth: { valueAsNumber: 60 }, developerElevation: { valueAsNumber: 30 }, developerFraming: { valueAsNumber: framing } };
    let saved;
    new Function('$', 'pendingView', 'getDefaultView', 'getSettings', 'readDefaultView', 'saveDefaultView', 'commit', 'syncView', 'notify', source.slice(begin, end))(
      id => nodes[id], null, () => published.view, () => ({ defaultView: published.view }), readDefaultView,
      async view => { assert.equal(button.disabled, true); if (fail) throw new Error('Permission denied'); saved = view; return '已保存全站默认视角'; },
      () => assert.fail('Global save cannot fall back to browser storage'), () => {}, value => notifications.push(value));
    await form.onsubmit({ preventDefault() {} });
    assert.equal(button.disabled, false);
    if (fail) {
      assert.equal(saved, undefined); assert.equal(status.textContent, undefined); assert.match(notifications[0], /保存失败/);
    } else {
      assert.equal(saved.distance, framing === published.view.framing ? published.view.distance : null);
      assert.deepEqual(saved.offset, published.view.offset);
      assert.equal(saved.azimuth, 60); assert.equal(saved.framing, framing);
      assert.equal(status.textContent, '已保存全站默认视角');
    }
  }
});
