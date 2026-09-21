import assert from 'node:assert/strict';
import * as T from '../vendor/three/build/three.module.js';
import {surfacePatternGeometry} from '../surface-pattern.js';
const sphere=new T.Mesh(new T.SphereGeometry(2,64,64),new T.MeshStandardMaterial());sphere.scale.set(1.3,.8,1.2);sphere.updateMatrixWorld(true);
const geometry=surfacePatternGeometry(sphere,0,new T.Vector3(0,0,2.4),new T.Vector3(0,0,1),1,1);
const p=geometry.attributes.position,uv=geometry.attributes.uv;
assert.ok(p.count>100);let min=Infinity,max=-Infinity;
for(let i=0;i<p.count;i++){const v=new T.Vector3().fromBufferAttribute(p,i);assert.ok(Math.abs(v.length()-2)<.006,'Vertices follow the sphere, not a tangent plane');min=Math.min(min,v.z);max=Math.max(max,v.z);assert.ok(uv.getX(i)>=-.0001&&uv.getX(i)<=1.0001);}
assert.ok(max-min>.03,'Decal has curved depth');assert.equal(sphere.material.transparent,false);console.log('PASS: clipped decal follows curved, nonuniformly scaled surface; host material untouched');
