import { ShaderChunk } from '../vendor/three/build/three.module.js';
import { applyDetailSampling, needsDerivativeNormalYFlip } from './texture-sampling.js';
import { applyFabricSheen } from './fabric-sheen.js';
import { applyFabricOcclusion, usesFabricOcclusion } from './ambient-occlusion.js';

// Keep source files intact; rendering, material packages and projects share these flags.
function roughnessShader(shader) {
  applyDetailSampling(shader, this);
  if (this.isMeshPhysicalMaterial) applyFabricSheen(shader);
  applyFabricOcclusion(shader, this);
  const grayscale = this.userData.roughnessGrayscale === true, invert = this.userData.roughnessInvert === true;
  if (!grayscale && !invert) return;
  let sample = grayscale ? 'dot(texelRoughness.rgb, vec3(0.299, 0.587, 0.114))' : 'texelRoughness.g';
  if (invert) sample = '(1.0 - ' + sample + ')';
  shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', ShaderChunk.roughnessmap_fragment.replace('texelRoughness.g', sample));
}
function roughnessCacheKey() { return 'spenic-roughness-' + Number(!!this.userData.roughnessGrayscale) + '-' + Number(!!this.userData.roughnessInvert) + '-detail-sampling-v1-fabric-sheen-tint-v2-normal-y-' + Number(needsDerivativeNormalYFlip(this)) + '-fabric-ao-v1-' + Number(usesFabricOcclusion(this)); }
export function installRoughnessShader(material) {
  // One shared hook keeps detail filtering active when surface flags change or
  // material clones are prepared for highlighting, placement and reveal effects.
  material.onBeforeCompile = roughnessShader;
  material.customProgramCacheKey = roughnessCacheKey;
}
