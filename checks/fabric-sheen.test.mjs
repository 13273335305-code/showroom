import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../vendor/three/build/three.module.js';
import { readSurface, applySurface } from '../shared/material-data.js';
import { installRoughnessShader } from '../shared/roughness-map.js';
import { defaultPhysical } from '../physical-textures.js';
import { packMaterial, unpackMaterial } from '../shared/material-package.js';
import { revealPattern, revealMaterial, fadeMaterial } from '../material-reveal.js';

test('old surfaces default to disabled sheen; edits retain neutral multiplier and bounded fiber parameters', () => {
  const material = new THREE.MeshPhysicalMaterial();
  applySurface(material, { color: '#31465f', roughness: .65 });
  assert.equal(material.sheen, 0);
  assert.equal(material.sheenRoughness, 1);
  assert.equal(material.sheenColor.getHex(), 0xffffff);
  applySurface(material, { sheen: .46, sheenRoughness: .82 });
  applySurface(material, { roughness: .43 });
  assert.equal(readSurface(material).sheen, .46);
  assert.equal(readSurface(material).sheenRoughness, .82);
  applySurface(material, { sheen: NaN, sheenRoughness: 'invalid' });
  assert.equal(material.sheen, .46);
  assert.equal(material.sheenRoughness, .82);
  applySurface(material, { sheen: 5, sheenRoughness: -2 });
  assert.equal(material.sheen, 2);
  assert.equal(material.sheenRoughness, 0);
  applySurface(material, { sheen: -1, sheenRoughness: 5 });
  assert.equal(material.sheen, 0);
  assert.equal(material.sheenRoughness, 1);
  const legacy = new THREE.MeshStandardMaterial();
  assert.doesNotThrow(() => applySurface(legacy, { sheen: .5 }));
  assert.equal(readSurface(legacy).sheen, 0);
});

test('material packages and serialized project surfaces retain sheen and all existing channels', async () => {
  const material = new THREE.MeshPhysicalMaterial();
  applySurface(material, { color: '#31465f', bumpStrength: .02, sheen: 1.56, sheenRoughness: .87, roughnessGrayscale: true, roughnessInvert: true, normalStrength: 1.4, flip: true });
  assert.equal(readSurface(material).sheen, 1.56);
  const asset = { name: '绒毛面料', kind: 'material', materialType: 'fabric', category: '面布', surface: readSurface(material), physical: defaultPhysical(), repeat: [1, 1], maps: {} };
  const restored = await unpackMaterial(new File([await packMaterial(asset)], 'sheen.formmat'));
  const target = new THREE.MeshPhysicalMaterial();
  applySurface(target, restored.surface);
  assert.deepEqual(readSurface(target), readSurface(material));
  const projectSurface = JSON.parse(JSON.stringify({ surface: readSurface(target) })).surface;
  const reopened = new THREE.MeshPhysicalMaterial();
  applySurface(reopened, projectSurface);
  assert.deepEqual(readSurface(reopened), readSurface(material));
});

test('design material factories support sheen, variants, clones and baseline reset', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const factory = source.slice(source.indexOf('function createLibraryEntry('), source.indexOf('async function refreshLibrary('));
  const createLibraryEntry = new Function('THREE', 'installRoughnessShader', 'defaultPhysical', factory + '; return createLibraryEntry;')(THREE, installRoughnessShader, defaultPhysical);
  const original = createLibraryEntry(0), variant = createLibraryEntry(1);
  assert.equal(original.material.isMeshPhysicalMaterial, true);
  applySurface(original.material, { sheen: .4, sheenRoughness: .8 });
  applySurface(variant.material, { sheen: .7, sheenRoughness: .9 });
  // Same material.copy path used by design color switches.
  const userData = original.material.userData;
  original.material.copy(variant.material); original.material.userData = userData; installRoughnessShader(original.material);
  assert.equal(original.material.sheen, .7);
  assert.equal(original.material.sheenRoughness, .9);
  const clone = original.material.clone(); installRoughnessShader(clone);
  assert.equal(clone.sheen, .7);
  original.material.copy(original.baseline);
  assert.equal(original.material.sheen, 0);

  const conversion = source.slice(source.indexOf('function convertMaterials('), source.indexOf('function disposeObject('));
  const convertMaterials = new Function('THREE', 'installRoughnessShader', 'MAPS', 'placeholder', 'renderer', 'configureTextureSampling', 'defaultPhysical', 'imageData', conversion + '; return convertMaterials;')(THREE, installRoughnessShader, [], '', null, () => {}, defaultPhysical, () => null);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial({ color: '#31465f', roughness: .65 }));
  const result = convertMaterials(mesh);
  assert.equal(result.entries[0].material.isMeshPhysicalMaterial, true);
  assert.equal(result.entries[0].baseline.isMeshPhysicalMaterial, true);
  assert.equal(result.entries[0].material.sheen, 0);
  applySurface(result.entries[0].material, { sheen: .62 });
  assert.equal(mesh.material.sheen, .62);
});

test('fiber tint uses the mapped linear surface before lighting, with or without a texture', () => {
  for (const map of [null, new THREE.Texture()]) {
    const material = new THREE.MeshPhysicalMaterial({ map, sheen: .75, sheenRoughness: .3 });
    installRoughnessShader(material);
    const shader = { fragmentShader: THREE.ShaderLib.physical.fragmentShader };
    material.onBeforeCompile(shader);
    const fragment = shader.fragmentShader;
    assert.ok(fragment.indexOf('#include <map_fragment>') < fragment.indexOf('vec3 fabricBaseColor'));
    assert.ok(fragment.indexOf('#include <color_fragment>') < fragment.indexOf('vec3 fabricBaseColor'));
    assert.ok(fragment.indexOf('#include <lights_physical_fragment>') < fragment.indexOf('vec3 fabricBaseColor'));
    assert.ok(fragment.indexOf('material.sheenColor *= fabricSheenTint;') < fragment.indexOf('#include <lights_fragment_begin>'));
    assert.match(fragment, /#ifdef USE_SHEEN\s+vec3 fabricBaseColor = clamp\( diffuseColor.rgb/);
    assert.match(fragment, /mix\( fabricBaseColor, vec3\( max3\( fabricBaseColor \) \), 0\.28 \) \* 1\.3/);
    assert.equal((fragment.match(/texture2D\( map,/g) || []).length, 0, 'reuse the correctly transformed color-map sample');
    assert.match(material.customProgramCacheKey(), /fabric-sheen-tint-v2/);
  }
  const legacy = new THREE.MeshStandardMaterial();
  installRoughnessShader(legacy);
  const shader = { fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  legacy.onBeforeCompile(shader);
  assert.doesNotMatch(shader.fragmentShader, /fabricSheenTint/);
});

test('fiber sheen survives reveal and crossfade alongside roughness and normal sampling hooks', () => {
  const material = new THREE.MeshPhysicalMaterial({ roughnessMap: new THREE.Texture() });
  applySurface(material, { sheen: .6, sheenRoughness: .85, roughnessGrayscale: true, roughnessInvert: true });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material), scene = new THREE.Scene(); scene.add(mesh);
  const shader = () => ({ uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader });
  const reveal = revealPattern(mesh);
  assert.equal(mesh.material.sheen, .6);
  const compiled = shader(); mesh.material.onBeforeCompile(compiled);
  assert.match(compiled.fragmentShader, /1\.0 - dot\(texelRoughness.rgb/);
  assert.match(compiled.fragmentShader, /patternRevealRadius/);
  assert.match(compiled.fragmentShader, /material.sheenColor \*= fabricSheenTint/);
  assert.match(mesh.material.customProgramCacheKey(), /detail-sampling-v1/);
  reveal.dispose();
  const swap = revealMaterial(scene, mesh, 0, material, new THREE.Vector3());
  const overlay = scene.children.find(item => item !== mesh);
  assert.equal(overlay.material.sheen, .6);
  assert.equal(overlay.material.sheenRoughness, .85);
  const radial = shader(); overlay.material.onBeforeCompile(radial);
  assert.match(radial.fragmentShader, /material.sheenColor \*= fabricSheenTint/);
  assert.match(radial.fragmentShader, /revealRadius/);
  assert.match(overlay.material.customProgramCacheKey(), /fabric-sheen-tint-v2/);
  swap.update(.5); swap.dispose();
  const fade = fadeMaterial(scene, mesh, 0, material);
  const fading = scene.children.find(item => item !== mesh);
  const faded = shader(); fading.material.onBeforeCompile(faded);
  assert.match(faded.fragmentShader, /material.sheenColor \*= fabricSheenTint/);
  assert.match(faded.fragmentShader, /1\.0 - dot\(texelRoughness.rgb/);
  assert.equal(fading.material.customProgramCacheKey(), material.customProgramCacheKey());
  fade.update(.5);
  assert.equal(fading.material.opacity, material.opacity * .5);
  fade.dispose();
  assert.equal(mesh.material, material);
});
