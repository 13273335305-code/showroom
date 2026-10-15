import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { planFabricBatch, enqueueFabricBatch } from '../shared/fabric-batch.js';

function file(name, folder = '389') {
  const result = new File(['image'], name, { type: 'image/jpeg' });
  Object.defineProperty(result, 'webkitRelativePath', { value: folder + '/' + name });
  return result;
}
const template = {
  id: 'existing-asset', ownerId: 'old-owner', revision: 'old-revision',
  category: '边布', surface: { color: '#aabbcc', roughness: .43, normalStrength: 1.5, flip: true },
  physical: { mode: 'physical', widthCm: 20, heightCm: 10, sizeSource: 'dpi', fallbackDpi: null },
  repeat: [2, 3], maps: { map: file('oldRED.jpg'), normalMap: file('old-F.jpg'), roughnessMap: file('roughness.jpg') },
  density: {}, legacyMaps: { map: { repeat: [4, 4] }, normalMap: { repeat: [5, 5] }, roughnessMap: { repeat: [2, 2] } },
  previewInfo: { widthCm: 40, heightCm: 30, widthPx: 400, heightPx: 300 },
};

test('folder color files each use the shared -F normal; other files are skipped', () => {
  const names = ['389DBW.jpg', '389-F.jpg', '389GWW.jpg', '389KGW.jpg', '389WBK.jpg', '389WBR.jpg', '389WLG.jpg', '389WWW.jpg', '389ZGW.jpg'];
  const files = names.map(name => file(name));
  const plan = planFabricBatch([...files, file('notes.txt'), file('preview.png')]);
  assert.equal(plan.variants.length, 8);
  assert.equal(plan.skipped, 2);
  assert.deepEqual(plan.variants.map(item => item.fabricColorCode), ['DBW', 'GWW', 'KGW', 'WBK', 'WBR', 'WLG', 'WWW', 'ZGW']);
  for (const variant of plan.variants) { assert.equal(variant.name, '389'); assert.equal(variant.normal, files[1]); }
  assert.equal(planFabricBatch([file('390WBR_Diffuse.jpg'), file('390-f.JPG')]).variants[0].fabricColorCode, 'WBR');
});

test('normal selection respects subfolders and fabric numbers', () => {
  const a = file('389-F.jpg', 'batch/389'), b = file('390-f.jpg', 'batch/390');
  const plan = planFabricBatch([file('389DBW.jpg', 'batch/389'), a, file('390WBR.jpg', 'batch/390'), b]);
  assert.deepEqual(plan.variants.map(item => item.normal), [a, b]);
  const sameFolder = planFabricBatch([file('389DBW.jpg'), file('390WBR.jpg'), file('389-F.jpg'), file('390-F.jpg')]);
  assert.deepEqual(sameFolder.variants.map(item => item.normal.name), ['389-F.jpg', '390-F.jpg']);
});

test('missing normals are optional; ambiguous normals and folders with no color files report clear errors', () => {
  assert.equal(planFabricBatch([file('389DBW.jpg')]).variants[0].normal, null);
  assert.throws(() => planFabricBatch([file('389-F.jpg'), file('readme.txt')]), /没有可识别的色号图片/);
  assert.throws(() => planFabricBatch([file('389DBW.jpg'), file('389-F.jpg'), file('389-f.png')]), /无法确定共用法线图/);
});

test('colors without normals upload with the chosen category and do not inherit an old normal map', async () => {
  const original = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({ width: 100, height: 50, close() {} });
  try {
    const assets = [];
    const result = await enqueueFabricBatch(planFabricBatch([file('389DBW.jpg'), file('389WBR.jpg')]), {
      ...template, category: '包边条', density: { normalMap: { widthCm: 99 } },
    }, {
      enqueue: async asset => { assets.push(asset); },
      createPreview: async () => new Blob(['preview']),
    });
    assert.equal(result.queued, 2); assert.deepEqual(result.failures, []);
    for (const asset of assets) {
      assert.equal(asset.category, '包边条');
      assert.equal('normalMap' in asset.maps, false);
      assert.equal('normalMap' in asset.density, false);
      assert.equal('normalMap' in asset.legacyMaps, false);
      assert.ok(asset.maps.map); assert.ok(asset.preview);
    }
    assert.equal(template.category, '边布'); assert.ok(template.maps.normalMap);
  } finally { if (original) globalThis.createImageBitmap = original; else delete globalThis.createImageBitmap; }
});

test('batch creates independent assets and previews, inherits parameters and continues after a failed color', async () => {
  const original = globalThis.createImageBitmap, bitmaps = [], decoded = [], assets = [], progress = [];
  globalThis.createImageBitmap = async source => {
    decoded.push(source.name);
    if (source.name === '389BAD.jpg') throw new Error('损坏图片');
    const image = { width: 100, height: 50, closed: false, close() { this.closed = true; } };
    bitmaps.push(image); return image;
  };
  try {
    const files = [file('389DBW.jpg'), file('389BAD.jpg'), file('389WBR.jpg'), file('389-F.jpg')];
    const plan = planFabricBatch(files);
    plan.variants[2].isDefaultColor = true;
    const result = await enqueueFabricBatch(plan, template, {
      enqueue: async asset => { assets.push(asset); },
      createPreview: async (image, physical, info) => {
        assert.equal(image.closed, false); assert.equal(physical.widthCm, 20); assert.equal(physical.sizeSource, 'manual');
        assert.deepEqual(info, template.previewInfo);
        return new Blob(['preview'], { type: 'image/png' });
      },
      onProgress: value => progress.push(value.completed),
    });
    assert.equal(result.queued, 2); assert.equal(result.failures.length, 1);
    assert.ok(assets[0].fabricGroupId);
    assert.equal(assets[0].fabricGroupId, assets[1].fabricGroupId);
    assert.ok(assets.every(asset => asset.fabricDefaultColorCode === 'WBR'));
    assert.match(result.failures[0].name, /389BAD.jpg/);
    assert.deepEqual(progress, [0, 1, 2, 3]);
    assert.equal(decoded.filter(name => name === '389-F.jpg').length, 2, 'Shared normal is decoded once by the image reader (including compression)');
    for (const [index, asset] of assets.entries()) {
      assert.equal(asset.id, undefined); assert.equal(asset.ownerId, undefined); assert.equal(asset.revision, undefined);
      assert.equal(asset.materialType, 'fabric'); assert.equal(asset.category, '边布'); assert.equal(asset.name, '389');
      assert.equal(asset.fabricColorCode, ['DBW', 'WBR'][index]);
      assert.equal(asset.maps.map, files[index * 2]); assert.equal(asset.maps.normalMap, files[3]);
      assert.equal(asset.maps.roughnessMap, template.maps.roughnessMap);
      assert.equal(asset.surface.color, '#ffffff'); assert.equal(asset.surface.roughness, .43); assert.equal(asset.surface.normalStrength, 1.5);
      assert.equal(asset.legacyMaps.map, undefined); assert.equal(asset.legacyMaps.normalMap, undefined);
      assert.deepEqual(asset.repeat, [2, 3]); assert.ok(asset.preview instanceof Blob);
    }
    assert.equal(template.surface.color, '#aabbcc'); assert.equal(template.physical.sizeSource, 'dpi');
    assert.ok(bitmaps.every(image => image.closed));
  } finally { if (original) globalThis.createImageBitmap = original; else delete globalThis.createImageBitmap; }
});

test('batch reads physical dimensions from each original color image and reports queue failures', async () => {
  const original = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({ width: 120, height: 60, close() {} });
  try {
    const color = new File([await readFile(new URL('./fabric-300dpi.png', import.meta.url))], '390WBR.png', { type: 'image/png' });
    const assets = [];
    const result = await enqueueFabricBatch(planFabricBatch([color, file('390-f.jpg', '')]), template, {
      createPreview: async (image, physical) => {
        assert.equal(physical.sizeSource, 'dpi'); assert.ok(physical.widthCm > 0); assert.notEqual(physical.widthCm, template.physical.widthCm);
        return new Blob(['preview']);
      },
      enqueue: async asset => { assets.push(asset); throw new Error('队列存储失败'); },
    });
    assert.equal(assets.length, 1); assert.equal(result.queued, 0); assert.equal(result.failures[0].message, '队列存储失败');
  } finally { if (original) globalThis.createImageBitmap = original; else delete globalThis.createImageBitmap; }
});
