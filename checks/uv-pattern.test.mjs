import assert from 'node:assert/strict';
import * as T from '../vendor/three/build/three.module.js';
import {uvPatternGeometry} from '../uv-pattern.js';
const host=new T.Mesh(new T.SphereGeometry(2,64,64),new T.MeshStandardMaterial());
const g=uvPatternGeometry(host,0,[.5,.5],70,50,.3,.01);
assert.ok(g.attributes.position.count>30);
for(let i=0;i<g.attributes.position.count;i++){const p=new T.Vector3().fromBufferAttribute(g.attributes.position,i);assert.ok(Math.abs(p.length()-2)<.008);assert.ok(g.attributes.uv.getX(i)>=-.00001&&g.attributes.uv.getX(i)<=1.00001);}
const moved=uvPatternGeometry(host,0,[.6,.5],70,50,.3,.01);g.computeBoundingBox();moved.computeBoundingBox();assert.ok(g.boundingBox.getCenter(new T.Vector3()).distanceTo(moved.boundingBox.getCenter(new T.Vector3()))>.2);
assert.equal(host.material.transparent,false);assert.equal(host.material.map,null);
console.log('PASS: UV image follows curved surface, moves in UV space, clips alpha sampling bounds and preserves original material');
