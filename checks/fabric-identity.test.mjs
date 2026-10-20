import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFabricIdentity, hasFabricIdentity, validateScannedFabric } from '../shared/fabric-identity.js';
import { fabricQrSvg, fabricLabelSvg } from '../shared/fabric-label.js';
const id = '12345678-abcd-4321-8765-123456789abc';
const fabric = { id, kind: 'material', materialType: 'fabric', fabricIdentityVersion: 1, category: '边布', name: '389<&', fabricColorCode: 'WBR' };
test('identity accepts only the UUID payload, normalizes case and rejects external URLs', () => {
  assert.equal(parseFabricIdentity(' ' + id.toUpperCase() + '\r\n'), id);
  for (const value of ['', null, '389WBR', 'https://example.com/' + id, id + '?asset=1']) assert.throws(() => parseFabricIdentity(value), /无效/);
});
test('only enrolled fabric assets can be scanned; missing, pattern and invalid category fail', () => {
  assert.equal(hasFabricIdentity(fabric), true); assert.equal(validateScannedFabric(fabric), fabric);
  assert.equal(hasFabricIdentity({ ...fabric, fabricIdentityVersion: undefined }), false);
  assert.throws(() => validateScannedFabric(null), /不存在/);
  assert.throws(() => validateScannedFabric({ ...fabric, materialType: 'pattern' }), /不是面料/);
  assert.throws(() => validateScannedFabric({ ...fabric, fabricIdentityVersion: undefined }), /没有可用/);
  assert.throws(() => validateScannedFabric({ ...fabric, category: '' }), /分类无效/);
});
test('downloaded label includes category, color and identity with escaped text and a quiet zone', () => {
  const svg = fabricLabelSvg(fabric);
  assert.match(svg, /389&lt;&amp;/); assert.match(svg, /边布 · 色号 WBR/); assert.ok(svg.includes(id));
  assert.match(fabricQrSvg(id), /viewBox="0 0 37 37"/);
  assert.throws(() => fabricLabelSvg({ ...fabric, fabricIdentityVersion: undefined }), /尚未成功保存/);
});
