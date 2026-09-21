import test from 'node:test';
import assert from 'node:assert/strict';
import { alphaBounds, grayscalePixels } from '../shared/image-pixels.js';
import { MeshStandardMaterial, Texture, Mesh, PlaneGeometry } from '../vendor/three/build/three.module.js';
import { applySurface, readSurface } from '../shared/material-data.js';
import { installRoughnessShader } from '../shared/roughness-map.js';
import { revealPattern } from '../material-reveal.js';

test('alpha bounds exclude transparent padding, keep faint pixels and handle empty images', () => {
  const data = new Uint8ClampedArray(10 * 8 * 4);
  assert.equal(alphaBounds({ data, width: 10, height: 8 }), null);
  data[(2 * 10 + 3) * 4 + 3] = 1; data[(5 * 10 + 7) * 4 + 3] = 255;
  assert.deepEqual(alphaBounds({ data, width: 10, height: 8 }), { x: .3, y: .25, width: .5, height: .5 });
});
test('roughness grayscale uses RGB luminance, inversion preserves source pixels and alpha', () => {
  const source = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 64, 64, 64, 255]);
  assert.deepEqual([...grayscalePixels(source)], [76, 76, 76, 255, 150, 150, 150, 128, 29, 29, 29, 0, 64, 64, 64, 255]);
  assert.deepEqual([...grayscalePixels(source, true)], [179, 179, 179, 255, 105, 105, 105, 128, 226, 226, 226, 0, 191, 191, 191, 255]);
  assert.equal(source[0], 255);
});
test('roughness flags survive surface roundtrip, clones and reveal shaders', () => {
  const m = new MeshStandardMaterial({ roughnessMap: new Texture() });
  applySurface(m, { roughnessGrayscale: true, roughnessInvert: true });
  const restored = new MeshStandardMaterial(); applySurface(restored, readSurface(m));
  assert.equal(restored.userData.roughnessInvert, true);
  const copy = m.clone(); installRoughnessShader(copy);
  const shader = () => ({ uniforms: {}, vertexShader: '#include <uv_vertex>', fragmentShader: '#include <roughnessmap_fragment>\n#include <opaque_fragment>' });
  const fragment = shader(); copy.onBeforeCompile(fragment);
  assert.match(fragment.fragmentShader, /1\.0 - dot\(texelRoughness.rgb/);
  const mesh = new Mesh(new PlaneGeometry(), copy), effect = revealPattern(mesh), revealed = shader();
  mesh.material.onBeforeCompile(revealed);
  assert.match(revealed.fragmentShader, /1\.0 - dot\(texelRoughness.rgb/); assert.match(revealed.fragmentShader, /patternRevealRadius/);
  assert.match(mesh.material.customProgramCacheKey(), /spenic-roughness-1-1/); effect.dispose();
  applySurface(restored, { roughnessInvert: false });
  const normal = shader(); restored.onBeforeCompile(normal); assert.doesNotMatch(normal.fragmentShader, /1\.0 - dot/);
});
