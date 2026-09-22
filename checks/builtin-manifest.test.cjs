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
