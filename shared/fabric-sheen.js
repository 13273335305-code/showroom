// diffuseColor already includes the color map, material tint and vertex color
// in linear space. Reuse it so the fibers follow each texel and its UV transform.
export function applyFabricSheen(shader) {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <lights_physical_fragment>',
    `#include <lights_physical_fragment>
#ifdef USE_SHEEN
  vec3 fabricBaseColor = clamp( diffuseColor.rgb, vec3( 0.0 ), vec3( 1.0 ) );
  // Soften saturation and lift brightness proportionally, without
  // adding a white floor that would wash out dark fabrics.
  vec3 fabricSheenTint = min(
    mix( fabricBaseColor, vec3( max3( fabricBaseColor ) ), 0.28 ) * 1.3,
    vec3( 1.0 ) );
  material.sheenColor *= fabricSheenTint;
#endif`
  );
}
