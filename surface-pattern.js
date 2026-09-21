import * as T from './vendor/three/build/three.module.js';

// Clip the actual model triangles to a projector box. Output retains the
// model surface and normals; it is not a plane hovering above the mesh.
export function surfacePatternGeometry(host,slot,point,normal,width,height,angle=0){
 host.updateWorldMatrix(true,false);
 const orientation=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,1),normal);
 orientation.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),angle));
 const projector=new T.Matrix4().compose(point,orientation,new T.Vector3(1,1,1)),inverse=projector.clone().invert();
 const local=host.matrixWorld.clone().invert(),nm=new T.Matrix3().getNormalMatrix(host.matrixWorld);
 const g=host.geometry,p=g.attributes.position,n=g.attributes.normal,index=g.index;
 const depth=Math.max(width,height)*.65,half=[width/2,height/2,depth/2];
 const positions=[],normals=[],uvs=[];
 const ranges=Array.isArray(host.material)?g.groups.filter(x=>x.materialIndex===slot):[{start:0,count:index?index.count:p.count}];
 for(const range of ranges)for(let i=range.start;i<range.start+range.count;i+=3){
  let polygon=[];
  for(let j=0;j<3;j++){const k=index?index.getX(i+j):i+j;polygon.push({p:new T.Vector3().fromBufferAttribute(p,k).applyMatrix4(host.matrixWorld).applyMatrix4(inverse),n:new T.Vector3().fromBufferAttribute(n,k)});}
  // Exclude reverse-facing surfaces inside the projection volume.
  if(polygon[0].n.clone().applyMatrix3(nm).normalize().dot(normal)<=.05)continue;
  for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
   const out=[];
   for(let j=0;j<polygon.length;j++){
    const a=polygon[j],b=polygon[(j+1)%polygon.length],da=sign*a.p.getComponent(axis)-half[axis],db=sign*b.p.getComponent(axis)-half[axis];
    if(da<=0)out.push(a);
    if((da<=0)!==(db<=0)){const t=da/(da-db);out.push({p:a.p.clone().lerp(b.p,t),n:a.n.clone().lerp(b.n,t).normalize()});}
   }polygon=out;
  }
  for(let j=1;j+1<polygon.length;j++)for(const v of [polygon[0],polygon[j],polygon[j+1]]){
   uvs.push(v.p.x/width+.5,v.p.y/height+.5);
   const pos=v.p.clone().applyMatrix4(projector).applyMatrix4(local);positions.push(pos.x,pos.y,pos.z);normals.push(v.n.x,v.n.y,v.n.z);
  }
 }
 const result=new T.BufferGeometry();result.setAttribute('position',new T.Float32BufferAttribute(positions,3));result.setAttribute('normal',new T.Float32BufferAttribute(normals,3));result.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));return result;
}
