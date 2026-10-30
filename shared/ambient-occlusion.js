import { ShaderChunk } from '../vendor/three/build/three.module.js';

export function usesFabricOcclusion(material) {
  return material.aoMap?.userData.formUpload === true;
}

// Library/uploaded AO describes cavities between fibers. Indirect-only AO is
// almost invisible under the design workspace's direct studio lights. Occlude
// half of direct diffuse/fiber sheen too, leaving direct specular highlights
// intact. Reuse the existing sample and strength, with neutral white/zero AO.
// Imported model AO keeps Three's baked ambient-occlusion behavior.
const fabricOcclusion = ShaderChunk.aomap_fragment
  .replace(
    '( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0',
    'clamp( ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0, 0.0, 1.0 )'
  )
  .replace('reflectedLight.indirectDiffuse *= ambientOcclusion;', `reflectedLight.indirectDiffuse *= ambientOcclusion;
  float fabricCavityVisibility = mix( 1.0, ambientOcclusion, 0.5 );
  reflectedLight.directDiffuse *= fabricCavityVisibility;
  #ifdef USE_SHEEN
    sheenSpecularDirect *= fabricCavityVisibility;
  #endif`);

export function applyFabricOcclusion(shader, material) {
  if (usesFabricOcclusion(material)) {
    shader.fragmentShader = shader.fragmentShader.replace('#include <aomap_fragment>', fabricOcclusion);
  }
}
