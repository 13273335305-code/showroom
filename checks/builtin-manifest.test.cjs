const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const script = path.join(root, '更新内置素材.ps1');
function run(directory) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-BuiltinDirectory', directory], { encoding: 'utf8' });
  return result;
}
test('generator handles empty and single lists, Chinese filenames, stable IDs, updates and invalid packages', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spenic-builtin-'));
  try {
    const manifest = path.join(temp, 'manifest.json');
    assert.equal(run(temp).status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(manifest)), []);
    const file = path.join(temp, '测试边布.formmat');
    fs.copyFileSync(path.join(root, 'assets/builtin/测试边布.formmat'), file);
    assert.equal(run(temp).status, 0);
    const first = fs.readFileSync(manifest, 'utf8');
    const [entry] = JSON.parse(first);
    assert.equal(entry.id, 'builtin-test-edge-fabric');
    assert.equal(entry.category, '边布');
    assert.equal(decodeURIComponent(entry.url), './测试边布.formmat');
    assert.match(entry.version, /^[a-f0-9]{64}$/);
    const runtimePath = path.join(temp, entry.runtime);
    const runtime = JSON.parse(fs.readFileSync(runtimePath));
    assert.equal(runtime.format, 'SPENIC-MATERIAL-RUNTIME');
    assert.equal(runtime.sourceVersion, entry.version);
    assert.equal(runtime.physical.widthCm, 5.7);
    assert.ok(Object.keys(runtime.maps).length > 0);
    for (const map of Object.values(runtime.maps)) {
      assert.equal(map.prepared, true);
      assert.ok(map.width > 1 && map.width <= 2048);
      assert.ok(map.height > 1 && map.height <= 2048);
      assert.equal(fs.statSync(path.join(path.dirname(runtimePath), map.url)).size, map.bytes);
    }
    assert.equal(run(temp).status, 0);
    assert.equal(fs.readFileSync(manifest, 'utf8'), first);
    fs.copyFileSync(path.join(root, 'assets/builtin/测试面布.formmat'), file);
    assert.equal(run(temp).status, 0);
    const updated = JSON.parse(fs.readFileSync(manifest))[0];
    assert.equal(updated.id, entry.id);
    assert.notEqual(updated.version, entry.version);
    fs.copyFileSync(path.join(root, 'assets/builtin/测试刺绣.formmat'), path.join(temp, '花纹 #1.formmat'));
    assert.equal(run(temp).status, 0);
    const beforeInvalid = fs.readFileSync(manifest, 'utf8');
    assert.equal(JSON.parse(beforeInvalid).find(item => item.name === '花纹 #1').materialType, 'pattern');
    fs.writeFileSync(path.join(temp, '损坏.formmat'), 'invalid package');
    assert.notEqual(run(temp).status, 0);
    assert.equal(fs.readFileSync(manifest, 'utf8'), beforeInvalid);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('generator publishes the embedded preview separately with physical metadata', async () => {
  const { packMaterial } = await import('../shared/material-package.js');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spenic-preview-manifest-'));
  try {
    const preview = fs.readFileSync(path.join(root, 'checks/fabric-no-dpi.png'));
    const blob = await packMaterial({ kind: 'material', name: '带预览材质', surface: { color: '#ffffff' }, maps: {}, physical: { mode: 'physical', widthCm: 20, heightCm: 15 }, preview: new Blob([preview], { type: 'image/png' }), previewInfo: { widthCm: 20, heightCm: 15, widthPx: 400, heightPx: 300 } });
    fs.writeFileSync(path.join(temp, '带预览材质.formmat'), Buffer.from(await blob.arrayBuffer()));
    const result = run(temp); assert.equal(result.status, 0, result.stderr);
    const [item] = JSON.parse(fs.readFileSync(path.join(temp, 'manifest.json'), 'utf8'));
    assert.match(item.preview, /^\.\/previews\/[a-f0-9]{64}\.png$/);
    assert.deepEqual(fs.readFileSync(path.join(temp, item.preview)), preview);
    assert.equal(item.previewInfo.widthPx, 400); assert.equal(item.physical.widthCm, 20);
    assert.equal(run(temp).status, 0);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('generator indexes models with stable IDs and invalidates them when companion resources change', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spenic-model-manifest-'));
  try {
    fs.writeFileSync(path.join(temp, '展厅.glb'), 'model');
    fs.mkdirSync(path.join(temp, '展厅.glb.resources'));
    const resource = path.join(temp, '展厅.glb.resources', 'normal.png');
    fs.copyFileSync(path.join(root, 'checks/fabric-no-dpi.png'), resource);
    const first = run(temp); assert.equal(first.status, 0, first.stderr);
    const [item] = JSON.parse(fs.readFileSync(path.join(temp, 'manifest.json')));
    assert.equal(item.kind, 'model'); assert.equal(item.id, 'builtin-model-展厅.glb');
    assert.equal(item.resources.length, 1); assert.equal(item.resources[0].name, 'normal.png');
    const oldVersion = item.version;
    fs.appendFileSync(resource, 'changed'); assert.equal(run(temp).status, 0);
    const [next] = JSON.parse(fs.readFileSync(path.join(temp, 'manifest.json')));
    assert.equal(next.id, item.id); assert.notEqual(next.version, oldVersion);
    fs.writeFileSync(path.join(temp, '展厅.fbx'), 'another model'); assert.equal(run(temp).status, 0);
    const models = JSON.parse(fs.readFileSync(path.join(temp, 'manifest.json')));
    assert.equal(models.length, 2); assert.equal(new Set(models.map(model => model.id)).size, 2);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
