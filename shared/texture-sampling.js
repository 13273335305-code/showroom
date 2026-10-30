import { LinearFilter, LinearMipmapLinearFilter, ShaderChunk } from '../vendor/three/build/three.module.js';

// Image maps must keep the same filtering after upload, FBX conversion and restore.
// WebGL 2 supports mipmaps for non-power-of-two images too; keep the source size.
export function configureTextureSampling(texture, renderer) {
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = Math.max(1, renderer.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;
}

// Use each map's transformed UV and actual GPU dimensions, so physical scale,
// rotation, oblique views and maps with different resolutions all behave alike.
// Magnification retains full strength. Fade through mip levels 0..3, then
// keep a reduced floor so the material relief remains readable at a distance.
const detailSampling = `
#if defined( USE_NORMALMAP ) || defined( USE_BUMPMAP )
float fabricDetailWeight( vec2 uv, vec2 size ) {
  vec2 texelUv = uv * size;
  float footprint = max( length( dFdx( texelUv ) ), length( dFdy( texelUv ) ) );
  float mipLevel = log2( max( footprint, 1.0 ) );
  // Keep a visible portion of the normal/bump signal after minification. The
  // old curve reached zero at mip 3, which made fabric normals disappear as
  // soon as the camera moved away from the model. A small floor still damps
  // high-frequency shimmer while preserving the material's relief at a
  // normal viewing distance.
  return mix( 0.65, 1.0, 1.0 - smoothstep( 0.0, 3.0, mipLevel ) );
}
#endif
`;

const normalSampling = ShaderChunk.normal_fragment_maps
  .replace('normal = texture2D', 'vec3 fabricBaseNormal = normal;\n\tnormal = texture2D')
  .replace('normal = normalize( normalMatrix * normal );', `normal = normalize( mix( fabricBaseNormal, normalize( normalMatrix * normal ),
    fabricDetailWeight( vNormalMapUv, vec2( textureSize( normalMap, 0 ) ) ) ) );`)
  .replace('mapN.xy *= normalScale;', `mapN.xy *= normalScale;
  mapN = mix( vec3( 0.0, 0.0, 1.0 ), mapN,
    fabricDetailWeight( vNormalMapUv, vec2( textureSize( normalMap, 0 ) ) ) );`);

// All three height taps must select the same mip footprint. Implicit derivatives
// at the offset taps can otherwise pick different levels on curved surfaces.
const bumpSampling = ShaderChunk.bumpmap_pars_fragment
  .replace('texture2D( bumpMap, vBumpMapUv )', 'textureGrad( bumpMap, vBumpMapUv, dSTdx, dSTdy )')
  .replace('texture2D( bumpMap, vBumpMapUv + dSTdx )', 'textureGrad( bumpMap, vBumpMapUv + dSTdx, dSTdx, dSTdy )')
  .replace('texture2D( bumpMap, vBumpMapUv + dSTdy )', 'textureGrad( bumpMap, vBumpMapUv + dSTdy, dSTdx, dSTdy )')
  .replace('return vec2( dBx, dBy );', `return vec2( dBx, dBy ) *
    fabricDetailWeight( vBumpMapUv, vec2( textureSize( bumpMap, 0 ) ) );`);

export function needsDerivativeNormalYFlip(material) {
  const texture = material?.normalMap;
  return !!texture && texture.flipY === false &&
    (texture.userData.formUpload === true || texture.userData.formGLTFNormalMap === true);
}

export function applyDetailSampling(shader, material) {
  // glTF image rows run downwards. Vertex tangents encode that convention;
  // derivative tangents need the same Y correction as GLTFLoader applies.
  const normalMaps = needsDerivativeNormalYFlip(material) ? normalSampling.replace('mapN.xy *= normalScale;', `mapN.xy *= normalScale;
  #ifndef USE_TANGENT
    mapN.y = -mapN.y;
  #endif`) : normalSampling;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <normal_fragment_maps>', normalMaps)
    .replace('#include <bumpmap_pars_fragment>', detailSampling + '\n' + bumpSampling);
}
