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
// Magnification retains full strength. Fade only through mip levels 0..3.
const detailSampling = `
#if defined( USE_NORMALMAP ) || defined( USE_BUMPMAP )
float fabricDetailWeight( vec2 uv, vec2 size ) {
  vec2 texelUv = uv * size;
  float footprint = max( length( dFdx( texelUv ) ), length( dFdy( texelUv ) ) );
  float mipLevel = log2( max( footprint, 1.0 ) );
  return 1.0 - smoothstep( 0.0, 3.0, mipLevel );
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

export function applyDetailSampling(shader) {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <normal_fragment_maps>', normalSampling)
    .replace('#include <bumpmap_pars_fragment>', detailSampling + '\n' + bumpSampling);
}
