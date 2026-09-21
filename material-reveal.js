import * as THREE from './vendor/three/build/three.module.js';

export const REVEAL_DURATION = 2200;

// Reveal a decal from its centre without changing the saved material or maps.
export function revealPattern(mesh) {
  const original = mesh.material, material = original.clone();
  const radius = { value: -.08 };
  material.onBeforeCompile = shader => {
    original.onBeforeCompile.call(material, shader);
    shader.uniforms.patternRevealRadius = radius;
    shader.vertexShader = 'varying vec2 patternRevealUV;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\npatternRevealUV = uv;');
    shader.fragmentShader = 'varying vec2 patternRevealUV;\nuniform float patternRevealRadius;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', 'diffuseColor.a *= 1.0 - smoothstep(patternRevealRadius - .1, patternRevealRadius + .1, distance(patternRevealUV, vec2(.5)));\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => 'form-pattern-reveal-v1-' + original.customProgramCacheKey.call(material);
  mesh.material = material;
  let disposed = false;
  return {
    update(progress) { radius.value = -.12 + progress * .98; },
    dispose() { if (disposed) return; disposed = true; if (mesh.material === material) mesh.material = original; material.dispose(); }
  };
}

// Keep the old surface above the replacement while the radial wave passes it.
export function revealMaterial(scene, mesh, slot, previous, point) {
  mesh.updateWorldMatrix(true,false);
  const box=new THREE.Box3().setFromObject(mesh),extent=box.getSize(new THREE.Vector3()).length();
  const uniforms={origin:{value:point.clone()},radius:{value:-extent*.04},feather:{value:Math.max(extent*.045,.001)}};
  const old=previous.clone();old.transparent=true;old.depthWrite=false;old.polygonOffset=true;old.polygonOffsetFactor=-2;old.polygonOffsetUnits=-2;
  old.onBeforeCompile=shader=>{
    previous.onBeforeCompile?.call(old,shader);
    shader.uniforms.revealOrigin=uniforms.origin;shader.uniforms.revealRadius=uniforms.radius;shader.uniforms.revealFeather=uniforms.feather;
    shader.vertexShader='varying vec3 revealPosition;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nrevealPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader='varying vec3 revealPosition;\nuniform vec3 revealOrigin;\nuniform float revealRadius;\nuniform float revealFeather;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','diffuseColor.a *= smoothstep(revealRadius - revealFeather, revealRadius + revealFeather, distance(revealPosition, revealOrigin));\n#include <opaque_fragment>');
  };
  old.customProgramCacheKey=()=> 'form-radial-reveal-v1';
  const invisible=new THREE.MeshBasicMaterial({visible:false});
  const overlay=mesh.clone(false);overlay.material=Array.isArray(mesh.material)?mesh.material.map((m,i)=>i===slot?old:invisible):old;
  overlay.matrix.copy(mesh.matrixWorld);overlay.matrixAutoUpdate=false;overlay.castShadow=false;overlay.receiveShadow=mesh.receiveShadow;overlay.renderOrder=10;
  overlay.userData={};scene.add(overlay);
  let finished=false;
  return {
    update(progress){uniforms.radius.value=extent*(progress*1.12-.06);},
    dispose(){if(finished)return;finished=true;scene.remove(overlay);old.dispose();invisible.dispose();}
  };
}

// Click replacement uses a full-surface crossfade instead of the drag wave.
export function fadeMaterial(scene, mesh, slot, previous) {
  mesh.updateWorldMatrix(true,false);
  const old=previous.clone();old.transparent=true;old.depthWrite=false;old.polygonOffset=true;old.polygonOffsetFactor=-2;old.polygonOffsetUnits=-2;
  const originalOpacity=Number.isFinite(previous.opacity)?previous.opacity:1;old.opacity=originalOpacity;
  const invisible=new THREE.MeshBasicMaterial({visible:false});
  const overlay=mesh.clone(false);overlay.material=Array.isArray(mesh.material)?mesh.material.map((m,i)=>i===slot?old:invisible):old;
  overlay.matrix.copy(mesh.matrixWorld);overlay.matrixAutoUpdate=false;overlay.castShadow=false;overlay.receiveShadow=mesh.receiveShadow;overlay.renderOrder=10;overlay.userData={};scene.add(overlay);
  let finished=false;
  return {update(progress){old.opacity=originalOpacity*(1-progress);},dispose(){if(finished)return;finished=true;scene.remove(overlay);old.dispose();invisible.dispose();}};
}
