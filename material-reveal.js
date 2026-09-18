import * as THREE from './vendor/three/build/three.module.js';

// Keep the old surface above the replacement until the radial wave passes it.
export function revealMaterial(scene, mesh, slot, previous, point) {
  mesh.updateWorldMatrix(true,false);
  const box=new THREE.Box3().setFromObject(mesh),extent=box.getSize(new THREE.Vector3()).length();
  const uniforms={origin:{value:point.clone()},radius:{value:-extent*.04},feather:{value:Math.max(extent*.045,.001)}};
  const old=previous.clone();old.transparent=true;old.depthWrite=false;old.polygonOffset=true;old.polygonOffsetFactor=-2;old.polygonOffsetUnits=-2;
  old.onBeforeCompile=shader=>{
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
