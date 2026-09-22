import { Matrix3 } from '../vendor/three/build/three.module.js';

export const materialType = asset => asset?.materialType === 'pattern' ? 'pattern' : 'fabric';

export function readPlacement(value = {}) {
  const offset = value.offset || [0, 0], angle = value.angle ?? 0;
  if (!Array.isArray(offset) || offset.length !== 2 || !offset.every(n => Number.isFinite(n) && Math.abs(n) <= 100) || !Number.isFinite(angle) || Math.abs(angle) > 360) throw new Error('UV 偏移或角度无效');
  return { offset: [...offset], angle };
}

// Compose after the source mapping, so original UV transforms and physical
// centimetre calibration remain intact. Positive offsets move the image.
export function applyPlacement(texture, value) {
  const { offset: [u, v], angle } = readPlacement(value);
  const r = angle * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  if (texture.userData?.formPlacementBase) texture.matrix.copy(texture.userData.formPlacementBase);
  else {
    if (texture.matrixAutoUpdate) texture.updateMatrix();
    texture.userData ||= {};
    texture.userData.formPlacementBase = texture.matrix.clone();
  }
  const transform = new Matrix3().set(c, s, .5 - c * (.5 + u) - s * (.5 + v), -s, c, .5 + s * (.5 + u) - c * (.5 + v), 0, 0, 1);
  texture.matrix.premultiply(transform);
  texture.matrixAutoUpdate = false;
}
