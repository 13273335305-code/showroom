import assert from 'node:assert/strict';
import * as T from '../vendor/three/build/three.module.js';
import {surfacePatternGeometry} from '../surface-pattern.js';

const sphere=new T.Mesh(new T.SphereGeometry(2,64,64),new T.MeshStandardMaterial());sphere.scale.set(1.3,.8,1.2);sphere.updateMatrixWorld(true);
const sphereGeometry=surfacePatternGeometry(sphere,0,new T.Vector3(0,0,2.4),new T.Vector3(0,0,1),1,1);
const spherePositions=sphereGeometry.attributes.position,sphereUvs=sphereGeometry.attributes.uv;
assert.ok(spherePositions.count>100);let min=Infinity,max=-Infinity;
for(let i=0;i<spherePositions.count;i++){const v=new T.Vector3().fromBufferAttribute(spherePositions,i);assert.ok(Math.abs(v.length()-2)<.006,'Vertices follow the sphere, not a tangent plane');min=Math.min(min,v.z);max=Math.max(max,v.z);assert.ok(sphereUvs.getX(i)>=-.0001&&sphereUvs.getX(i)<=1.0001);}
assert.ok(max-min>.03,'Decal has curved depth');assert.equal(sphere.material.transparent,false);
 sphereGeometry.dispose();sphere.geometry.dispose();sphere.material.dispose();

function planeWithNormal(normal) {
 const geometry=new T.PlaneGeometry(2,2,1,1);
 for(let i=0;i<geometry.attributes.normal.count;i++)geometry.attributes.normal.setXYZ(i,...normal.toArray());
 return new T.Mesh(geometry,new T.MeshStandardMaterial());
}

for(const normal of [new T.Vector3(0,0,1),new T.Vector3(0,0,-1)]){
 const host=planeWithNormal(normal),geometry=surfacePatternGeometry(host,0,new T.Vector3(),normal,2,2,0);
 assert.ok(geometry.attributes.position.count>0);
 for(let i=0;i<geometry.attributes.position.count;i++){
  const y=geometry.attributes.position.getY(i),v=geometry.attributes.uv.getY(i);
  if(y>.99)assert.ok(v>.99,`top edge should use the top of the image for normal ${normal.z}`);
  if(y<-.99)assert.ok(v<.01,`bottom edge should use the bottom of the image for normal ${normal.z}`);
 }
 geometry.dispose();host.geometry.dispose();host.material.dispose();
}

console.log('PASS: clipped surface pattern keeps curved geometry and vertical orientation on front and back surfaces');
