import * as T from './vendor/three/build/three.module.js';
import {measureUVMetric} from './physical-textures.js';
export function uvPatternGeometry(host,slot,center,width,height,angle,unit){
 const g=host.geometry,uv=g.attributes.uv,pos=g.attributes.position,norm=g.attributes.normal;
 if(!uv)throw new Error('此部件没有 UV，无法放置 UV 图案');
 host.updateWorldMatrix(true,false);
 const ranges=Array.isArray(host.material)?g.groups.filter(r=>r.materialIndex===slot):[{start:0,count:g.index?g.index.count:pos.count}];
 const positions=[],normals=[],coords=[],c=Math.cos(angle),s=Math.sin(angle);
 for(const range of ranges){
 const metric=measureUVMetric(g,host.matrixWorld,range.start,range.count);if(!metric)continue;
 for(let i=range.start;i<range.start+range.count;i+=3){let poly=[];
 for(let j=0;j<3;j++){const k=g.index?g.index.getX(i+j):i+j,x=(uv.getX(k)-center[0])*metric.u/unit,y=(uv.getY(k)-center[1])*metric.v/unit;poly.push({q:new T.Vector2((c*x+s*y)/width+.5,(-s*x+c*y)/height+.5),p:new T.Vector3().fromBufferAttribute(pos,k),n:new T.Vector3().fromBufferAttribute(norm,k)});}
 for(let axis=0;axis<2;axis++)for(const sign of [-1,1]){const out=[];for(let j=0;j<poly.length;j++){const a=poly[j],b=poly[(j+1)%poly.length],da=sign*(a.q.getComponent(axis)-(sign===1?1:0)),db=sign*(b.q.getComponent(axis)-(sign===1?1:0));if(da<=0)out.push(a);if((da<=0)!==(db<=0)){const t=da/(da-db);out.push({q:a.q.clone().lerp(b.q,t),p:a.p.clone().lerp(b.p,t),n:a.n.clone().lerp(b.n,t).normalize()});}}poly=out;}
 for(let j=1;j+1<poly.length;j++)for(const v of [poly[0],poly[j],poly[j+1]]){positions.push(...v.p.toArray());normals.push(...v.n.toArray());coords.push(...v.q.toArray());}
 }}
 const result=new T.BufferGeometry();result.setAttribute('position',new T.Float32BufferAttribute(positions,3));result.setAttribute('normal',new T.Float32BufferAttribute(normals,3));result.setAttribute('uv',new T.Float32BufferAttribute(coords,2));return result;
}
