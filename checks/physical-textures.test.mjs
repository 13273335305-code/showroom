import assert from 'node:assert/strict';
import {PlaneGeometry,Mesh,Group,MeshStandardMaterial,Texture,Vector2,Matrix4,BufferGeometry,Float32BufferAttribute} from '../vendor/three/build/three.module.js';
import {preparePhysicalUV,measureUVMetric,setPhysicalTransform,defaultPhysical,readPhysical} from '../physical-textures.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
const group=new Group(),material=new MeshStandardMaterial();
const first=new Mesh(new PlaneGeometry(200,100,4,2),material),second=new Mesh(new PlaneGeometry(2,1),material);second.scale.setScalar(100);group.add(first,second);
const before=Array.from(first.geometry.attributes.uv.array);const stats=preparePhysicalUV(group);assert.equal(stats.missing,0);assert.equal(stats.distorted,0);
const texture=new Texture(),physical={...defaultPhysical(),widthCm:20,heightCm:10};setPhysicalTransform(texture,physical,1);
for(const mesh of [first,second]){const uv=mesh.geometry.attributes.uv2;const points=Array.from({length:uv.count},(_,i)=>new Vector2(uv.getX(i),uv.getY(i)).applyMatrix3(texture.matrix));close(Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),10);close(Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y)),10);}
assert.equal(texture.channel,2);assert.equal(texture.matrixAutoUpdate,false);
// Preview normalization must not rescale the baked physical UVs.
const original=first.geometry.attributes.uv2.array.slice();group.scale.setScalar(.021);group.updateMatrixWorld(true);assert.deepEqual(first.geometry.attributes.uv2.array,original);
// UV density can differ between target meshes without changing fabric size.
const geo=new PlaneGeometry(200,100);for(let i=0;i<geo.attributes.uv.count;i++)geo.attributes.uv.setXY(i,geo.attributes.uv.getX(i)*4,geo.attributes.uv.getY(i)*2);
const density=measureUVMetric(geo,new Matrix4());close(density.u,50);close(density.v,50);
const metric=measureUVMetric(new PlaneGeometry(2,1),new Matrix4());close(metric.u,2);close(metric.v,1);
// A model in metres: 2 units * 100 cm / 20 cm = 10 repeats.
setPhysicalTransform(texture,physical,100);close(new Vector2(2,0).applyMatrix3(texture.matrix).x,10);
// Rotate in real space, including non-square tile dimensions.
setPhysicalTransform(texture,{...physical,angle:90},1);const rotated=new Vector2(0,20).applyMatrix3(texture.matrix);close(rotated.x,1);close(rotated.y,0);
const mirrored=new PlaneGeometry(200,100);for(let i=0;i<mirrored.attributes.uv.count;i++)mirrored.attributes.uv.setX(i,-mirrored.attributes.uv.getX(i));close(measureUVMetric(mirrored,new Matrix4()).u,200);
assert.equal(measureUVMetric(new BufferGeometry(),new Matrix4()),null);
const degenerate=new PlaneGeometry(2,1);degenerate.attributes.uv.array.fill(0);assert.equal(measureUVMetric(degenerate,new Matrix4()),null);
assert.throws(()=>readPhysical({...physical,widthCm:0}));assert.throws(()=>setPhysicalTransform(texture,physical,NaN));
assert.equal(readPhysical(undefined,true).mode,'legacy');assert.deepEqual(readPhysical(JSON.parse(JSON.stringify(physical))),physical);
console.log('PASS: centimetre tile size, FBX units, transformed meshes, different UV densities, preview independence, rectangular rotation, mirrored/degenerate UVs, project settings');
