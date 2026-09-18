import { Float32BufferAttribute, Vector3 } from './vendor/three/build/three.module.js';

export const defaultPhysical = () => ({mode:'physical',widthCm:10,heightCm:10,angle:0,locked:true,initialized:false,sizeSource:'dpi',fallbackDpi:null});

export function readPhysical(value, legacy=false) {
  if (!value) return {...defaultPhysical(),mode:legacy?'legacy':'physical'};
  const result={...defaultPhysical(),...value,sizeSource:value.sizeSource||'manual'};
  if (!['dpi','manual'].includes(result.sizeSource)||!['physical','legacy'].includes(result.mode) ||
      ![result.widthCm,result.heightCm].every(n=>Number.isFinite(n)&&n>=.01&&n<=100000) ||
      !Number.isFinite(result.angle) || Math.abs(result.angle)>360) throw new Error('贴图物理尺寸无效');
  result.locked=!!result.locked;result.initialized=!!result.initialized;
  return result;
}

// Measure dPosition/dUV in the imported model's units BEFORE display normalization.
// A physically unwrapped, uniformly scaled UV chart has a constant metric.
// Average by surface area so tessellation density does not alter fabric size.
export function measureUVMetric(geometry, matrix, start=0, count=Infinity) {
  const position=geometry.attributes.position,uv=geometry.attributes.uv,index=geometry.index;
  if(!position||!uv)return null;
  const end=Math.min(start+count,index?index.count:position.count);
  const a=new Vector3(),b=new Vector3(),c=new Vector3(),cross=new Vector3(),du=new Vector3(),dv=new Vector3();
  let weight=0,sumU=0,sumV=0,squaredU=0,squaredV=0,skew=0,valid=0;
  for(let i=start;i+2<end;i+=3){
    const ia=index?index.getX(i):i,ib=index?index.getX(i+1):i+1,ic=index?index.getX(i+2):i+2;
    a.fromBufferAttribute(position,ia).applyMatrix4(matrix);
    b.fromBufferAttribute(position,ib).applyMatrix4(matrix).sub(a);
    c.fromBufferAttribute(position,ic).applyMatrix4(matrix).sub(a);
    const ux=uv.getX(ib)-uv.getX(ia),uy=uv.getY(ib)-uv.getY(ia),vx=uv.getX(ic)-uv.getX(ia),vy=uv.getY(ic)-uv.getY(ia);
    const det=ux*vy-vx*uy,area=cross.crossVectors(b,c).length();
    if(!Number.isFinite(det)||Math.abs(det)<1e-14||area<1e-14)continue;
    du.copy(b).multiplyScalar(vy).addScaledVector(c,-uy).divideScalar(det);
    dv.copy(c).multiplyScalar(ux).addScaledVector(b,-vx).divideScalar(det);
    const u=du.length(),v=dv.length();
    if(!Number.isFinite(u)||!Number.isFinite(v)||u<=0||v<=0)continue;
    sumU+=u*area;sumV+=v*area;squaredU+=u*u*area;squaredV+=v*v*area;
    skew+=Math.abs(du.dot(dv)/(u*v))*area;weight+=area;valid++;
  }
  if(!weight)return null;
  const u=sumU/weight,v=sumV/weight;
  const variation=Math.max(Math.sqrt(Math.max(0,squaredU/weight-u*u))/u,Math.sqrt(Math.max(0,squaredV/weight-v*v))/v);
  return {u,v,variation,skew:skew/weight,triangles:valid};
}

export function preparePhysicalUV(object) {
  object.updateMatrixWorld(true);
  const report={meshes:0,missing:0,distorted:0};
  object.traverse(mesh=>{
    if(!mesh.isMesh)return;
    report.meshes++;
    const original=mesh.geometry;
    if(!original?.attributes.uv){mesh.userData.physicalUV={valid:false};report.missing++;return;}
    // Split indexed corners so two material slots with different UV densities
    // cannot overwrite each other's calibrated coordinates. Original UVs survive.
    const geometry=original.index?original.toNonIndexed():original.clone();
    const uv=geometry.attributes.uv,coords=new Float32Array(uv.count*2);
    const ranges=Array.isArray(mesh.material)&&geometry.groups.length?geometry.groups:[{start:0,count:uv.count,materialIndex:0}];
    const slots={};
    // Keep each original drawing range's density, including packed UV charts.
    const bySlot=new Map();for(const group of ranges){const list=bySlot.get(group.materialIndex)||[];list.push(group);bySlot.set(group.materialIndex,list);}
    for(const [slot,groups] of bySlot){
      const metrics=groups.map(g=>measureUVMetric(geometry,mesh.matrixWorld,g.start,g.count));
      for(let n=0;n<groups.length;n++){
        const group=groups[n],metric=metrics[n];
        if(!metric){slots[slot]={valid:false};report.missing++;continue;}
        const distorted=metric.variation>.15||metric.skew>.15;
        slots[slot]={valid:true,distorted,...metric};if(distorted)report.distorted++;
        for(let i=group.start;i<Math.min(group.start+group.count,uv.count);i++){
          coords[i*2]=uv.getX(i)*metric.u;coords[i*2+1]=uv.getY(i)*metric.v;
        }
      }
    }
    geometry.setAttribute('uv2',new Float32BufferAttribute(coords,2));
    mesh.geometry=geometry;mesh.userData.physicalUV={valid:true,slots};
  });
  return report;
}

export function setPhysicalTransform(texture,physical,cmPerUnit) {
  const p=readPhysical(physical);
  if(!Number.isFinite(cmPerUnit)||cmPerUnit<=0)throw new Error('模型物理单位无效');
  const r=p.angle*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
  const u=cmPerUnit/p.widthCm,v=cmPerUnit/p.heightCm;
  // Rotate in the physical fabric plane, THEN divide by image width/height.
  // This also keeps rectangular fabrics correct at non-zero angles.
  texture.channel=2;texture.matrixAutoUpdate=false;
  texture.matrix.set(c*u,s*u,0,-s*v,c*v,0,0,0,1);
}
