import { ShaderChunk } from '../vendor/three/build/three.module.js';
import { applyDetailSampling } from './texture-sampling.js';

// Keep source files intact; rendering, material packages and projects share these flags.
function roughnessShader(shader) {
  applyDetailSampling(shader);
  const grayscale = this.userData.roughnessGrayscale === true, invert = this.userData.roughnessInvert === true;
  if (!grayscale && !invert) return;
  let sample = grayscale ? 'dot(texelRoughness.rgb, vec3(0.299, 0.587, 0.114))' : 'texelRoughness.g';
  if (invert) sample = '(1.0 - ' + sample + ')';
  shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', ShaderChunk.roughnessmap_fragment.replace('texelRoughness.g', sample));
}
function roughnessCacheKey() { return 'spenic-roughness-' + Number(!!this.userData.roughnessGrayscale) + '-' + Number(!!this.userData.roughnessInvert) + '-detail-sampling-v1'; }
export function installRoughnessShader(material) {
  // One shared hook keeps detail filtering active when surface flags change or
  // material clones are prepared for highlighting, placement and reveal effects.
  material.onBeforeCompile = roughnessShader;
  material.customProgramCacheKey = roughnessCacheKey;
}
