import test from 'node:test';
import assert from 'node:assert/strict';
import { MeshPhysicalMaterial, Texture } from '../vendor/three/build/three.module.js';
import { zipSync, unzipSync, strToU8, strFromU8 } from '../vendor/three/addons/libs/fflate.module.js';
import { MATERIAL_MAPS, readSurface, applySurface } from '../shared/material-data.js';
import { packMaterial, unpackMaterial } from '../shared/material-package.js';
import { validateProjectManifest } from '../shared/project-manifest.js';

const retiredSurface = { emissive: '#ffffff', emissiveStrength: 3, bumpStrength: .2 };

test('surface loading clears retired channels and surface snapshots omit their settings', () => {
  const material = new MeshPhysicalMaterial({ bumpMap: new Texture(), bumpScale: .2, emissiveMap: new Texture(), emissive: '#ffffff', emissiveIntensity: 3 });
  applySurface(material, { ...retiredSurface, roughness: .42, normalStrength: 1.5 });
  assert.equal(material.bumpMap, null); assert.equal(material.emissiveMap, null);
  assert.equal(material.bumpScale, 0); assert.equal(material.emissiveIntensity, 0);
  assert.equal(material.emissive.getHex(), 0);
  assert.equal(material.roughness, .42); assert.equal(material.normalScale.x, 1.5);
  for (const key of Object.keys(retiredSurface)) assert.equal(key in readSurface(material), false);
  assert.deepEqual(MATERIAL_MAPS.map(([key]) => key), ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']);
});

test('legacy packages ignore missing retired textures and never re-export retired settings', async () => {
  const metadata = { format: 'SPENIC-MATERIAL', version: 1, name: 'Legacy', surface: { color: '#ffffff', ...retiredSurface }, maps: { bumpMap: { path: 'missing-bump' }, emissiveMap: { path: 'missing-emissive' } }, density: { bumpMap: {} }, legacyMaps: { emissiveMap: {} } };
  const legacy = new Blob([zipSync({ 'material.json': strToU8(JSON.stringify(metadata)) })]);
  const asset = await unpackMaterial(legacy);
  assert.deepEqual(asset.maps, {}); assert.deepEqual(asset.surface, { color: '#ffffff' });
  assert.deepEqual(asset.density, {}); assert.deepEqual(asset.legacyMaps, {});
  const exported = await packMaterial({ ...asset, surface: metadata.surface, maps: { bumpMap: new Blob(['old']), emissiveMap: new Blob(['old']) } });
  const archive = unzipSync(new Uint8Array(await exported.arrayBuffer()));
  const saved = JSON.parse(strFromU8(archive['material.json']));
  assert.deepEqual(saved.maps, {}); assert.deepEqual(saved.surface, { color: '#ffffff' });
  assert.deepEqual(Object.keys(archive), ['material.json']);
});

test('old projects can open without unavailable retired maps or runtime URLs', () => {
  const hash = 'a'.repeat(64), owner = '11111111-1111-1111-1111-111111111111';
  const config = { format: 'SPENIC-PROJECT', version: 1, modelPath: 'model', files: { model: { kind: 'cloud', hash, path: owner + '/' + hash, name: 'model.glb', size: 1 }, old: { kind: 'runtime', name: 'old.png', reference: { key: 'bumpMap' } } }, materials: [{ maps: { bumpMap: { path: 'missing' }, emissiveMap: { path: 'missing' } } }] };
  assert.equal(validateProjectManifest(config), config);
  config.materials[0].maps.normalMap = { path: 'missing-normal' };
  assert.throws(() => validateProjectManifest(config), /缺少资源/);
});
