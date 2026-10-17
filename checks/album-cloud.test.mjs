import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlbumCloud, ALBUM_BUCKET } from '../shared/album-cloud.js';
import { albumPhotoBadge } from '../shared/album-name.js';

const alice = '11111111-1111-1111-1111-111111111111', bob = '22222222-2222-2222-2222-222222222222';
const blob = new Blob(['original'], { type: 'image/png' });
const metadata = { name: 'private.png', width: 1920, height: 1080, transparent: true };
function harness({ sourceColumn = true, missingSourceCode = 'PGRST204' } = {}) {
  const rows = new Map(), objects = new Map(), calls = [];
  let userId = alice, failUpload = 0, uploads = 0, failInsert = false, switchAfterThumbnail = false;
  const client = {
    from(table) {
      const filters = {}, query = {}; let operation = 'select';
      return {
        select(fields) { query.fields=fields; return this; }, eq(key,value) { filters[key]=value; return this; },
        order() { return this; }, range(start,end) { query.start=start; query.end=end; return this; },
        maybeSingle() { query.single=true; return this; }, single() { query.single=true; return this; },
        insert(row) { operation='insert'; query.row=row; return this; }, delete() { operation='delete'; return this; },
        then(resolve,reject) { return Promise.resolve().then(() => {
          calls.push({ table, operation, filters: { ...filters }, fields:query.fields, row:query.row });
          if (!sourceColumn && (query.fields?.split(',').includes('source') || (operation === 'insert' && 'source' in query.row))) {
            return {error:{code:missingSourceCode,message:missingSourceCode === '42703' ? 'column "source" of relation "spenic_album_photos" does not exist' : "Could not find the 'source' column of 'spenic_album_photos' in the schema cache"}};
          }
          if(operation === 'insert') {
            if(failInsert) throw new Error('Insert response lost');
            const row={...query.row,created_at:new Date().toISOString()}; rows.set(row.id,row); return {data:row};
          }
          const selected=[...rows.values()].filter(row=>row.owner_id===userId&&Object.entries(filters).every(([k,v])=>row[k]===v)).sort((a,b)=>b.created_at.localeCompare(a.created_at));
          if(operation==='delete') selected.forEach(row=>rows.delete(row.id));
          return {data:query.single?selected[0]||null:selected.slice(query.start||0,(query.end??199)+1)};
        }).then(resolve,reject); }
      };
    },
    storage: { from(bucket) { assert.equal(bucket,ALBUM_BUCKET); return {
      async upload(path,file) { uploads++; if(uploads===failUpload) return {error:{message:'Upload failed'}}; objects.set(path,file); calls.push({upload:path}); return {data:{path}}; },
      async remove(paths) { paths.forEach(p=>objects.delete(p)); calls.push({remove:paths}); return {data:[]}; },
      async createSignedUrls(paths,seconds) { calls.push({signed:paths,seconds}); return {data:paths.map(path=>({path,signedUrl:'https://example.test/'+path}))}; },
      async download(path) { calls.push({download:path}); return {data:objects.get(path)}; }
    }; } }
  };
  const access=async()=>({client,userId});
  const cloud=createAlbumCloud(access,{thumbnail:async()=>{if(switchAfterThumbnail)userId=bob;return new Blob(['preview'],{type:'image/png'});}});
  return {cloud,rows,objects,calls,client,access,setUser:id=>{userId=id;},failUpload:n=>{failUpload=n;},failInsert:()=>{failInsert=true;},switchAfterThumbnail:()=>{switchAfterThumbnail=true;}};
}

test('private photos use an isolated bucket and full originals download only on demand', async()=>{
  const h=harness(), saved=await h.cloud.add(blob,metadata);
  assert.equal(saved.ownerId,alice); assert.equal(saved.transparent,true); assert.equal(h.objects.size,2);
  assert.ok([...h.objects.keys()].every(p=>p.startsWith(alice+'/'+saved.id+'/')));
  const listed=await h.cloud.list(); assert.equal(listed.length,1); assert.equal(listed[0].name,'private.png');
  assert.equal('blob' in listed[0],false); assert.equal(h.calls.some(c=>c.download),false);
  const signing=h.calls.find(c=>c.signed); assert.equal(signing.seconds,300); assert.ok(signing.signed.every(p=>p.endsWith('/thumbnail.png')));
  const fresh=createAlbumCloud(h.access); const restored=await fresh.list(); assert.equal(restored[0].id,saved.id);
  const file=await fresh.download(saved.id); assert.equal(file.name,metadata.name); assert.equal(await file.blob.text(),'original');
  h.setUser(bob); assert.deepEqual(await h.cloud.list(),[]);
  await assert.rejects(h.cloud.download(saved.id),/不存在|访问权限/); await assert.rejects(h.cloud.remove(saved.id),/不存在|访问权限/);
  assert.equal(h.rows.size,1); h.setUser(alice); await h.cloud.remove(saved.id); assert.equal(h.rows.size,0); assert.equal(h.objects.size,0);
});

test('failed thumbnail upload cleans partial files and never reports a saved photo', async()=>{
  const h=harness();h.failUpload(2);
  await assert.rejects(h.cloud.add(blob,metadata),/Upload failed/);assert.equal(h.rows.size,0);assert.equal(h.objects.size,0);
});

test('cloud saves and restores capture and AI source independently of identical photo names', async()=>{
  const h=harness();
  const regular=await h.cloud.add(blob,{...metadata,name:'模型-20261017'});
  const ai=await h.cloud.add(blob,{...metadata,name:'模型-20261017',source:'ai',transparent:false});
  assert.equal(regular.source,'capture'); assert.equal(ai.source,'ai');
  assert.equal(h.rows.get(ai.id).source,'ai');
  const restored=await createAlbumCloud(h.access).list();
  assert.equal(restored.find(photo=>photo.id===regular.id).source,'capture');
  assert.equal(restored.find(photo=>photo.id===ai.id).source,'ai');
  await assert.rejects(h.cloud.add(blob,{...metadata,source:'unknown'}),/来源无效/);
  assert.equal(h.rows.size,2);
});

test('unknown insert result preserves originals rather than breaking a potentially committed photo', async()=>{
  const h=harness();h.failInsert();
  await assert.rejects(h.cloud.add(blob,metadata),/Insert response lost/);assert.equal(h.objects.size,2);
});

for (const missingSourceCode of ['PGRST204', '42703']) {
  test('albums without a source column can list, save, preview, download and delete: '+missingSourceCode, async()=>{
    const h=harness({sourceColumn:false,missingSourceCode});
    const id=crypto.randomUUID(), prefix=alice+'/'+id;
    h.rows.set(id,{id,owner_id:alice,name:'已有模型-20261017',width:1920,height:1080,transparent:false,bytes:blob.size,image_path:prefix+'/image.png',thumbnail_path:prefix+'/thumbnail.png',created_at:new Date().toISOString()});
    h.objects.set(prefix+'/image.png',blob);
    const existing=await h.cloud.list();
    assert.equal(existing[0].name,'已有模型-20261017'); assert.equal(albumPhotoBadge(existing[0]),'');
    const normal=await h.cloud.add(blob,{...metadata,name:'模型-20261017',transparent:false});
    const ai=await h.cloud.add(blob,{...metadata,name:'模型-20261017',source:'ai'});
    assert.equal(normal.name,'模型-20261017'); assert.equal(albumPhotoBadge(normal),'');
    assert.equal(ai.name,'模型-20261017'); assert.equal(albumPhotoBadge(ai),'AI');
    assert.equal(h.calls.filter(call=>call.operation==='insert'&&'source' in call.row).length,1);
    assert.equal(h.rows.size,3);
    const fresh=createAlbumCloud(h.access), listed=await fresh.list();
    assert.equal(listed.find(photo=>photo.id===ai.id).name,'模型-20261017');
    assert.equal(albumPhotoBadge(listed.find(photo=>photo.id===ai.id)),'AI');
    assert.equal(albumPhotoBadge(listed.find(photo=>photo.id===normal.id)),'');
    const file=await fresh.download(ai.id);
    assert.equal(file.name,'模型-20261017'); assert.equal(await file.blob.text(),'original');
    h.setUser(bob); assert.deepEqual(await fresh.list(),[]);
    await assert.rejects(fresh.download(ai.id),/不存在|访问权限/);
    await assert.rejects(fresh.remove(ai.id),/不存在|访问权限/);
    h.setUser(alice); await fresh.remove(ai.id);
    assert.equal(h.rows.has(ai.id),false); assert.equal(h.objects.has(alice+'/'+ai.id+'/image.png'),false);
  });
}

test('legacy AI markers preserve the date for long names and still work after a schema upgrade', async()=>{
  const h=harness({sourceColumn:false});
  const saved=await h.cloud.add(blob,{...metadata,name:'模'.repeat(171)+'-20261017',source:'ai'});
  assert.ok(h.rows.get(saved.id).name.length<=180);
  assert.ok(saved.name.endsWith('-20261017'));
  h.rows.get(saved.id).source='capture';
  const restored=(await createAlbumCloud(h.access).list())[0];
  assert.equal(restored.name,saved.name); assert.equal(albumPhotoBadge(restored),'AI');
  assert.equal((await h.cloud.download(saved.id)).name,saved.name);
});

test('account changes during image preparation stop upload before files are sent', async()=>{
  const h=harness();h.switchAfterThumbnail();
  await assert.rejects(h.cloud.add(blob,metadata),/账号已切换/);assert.equal(h.objects.size,0);assert.equal(h.rows.size,0);
});

test('an AI result cannot be saved under a different account from its original request',async()=>{
 const h=harness();h.setUser(bob);
 await assert.rejects(h.cloud.add(blob,{...metadata,source:'ai',ownerId:alice}),/账号已切换/);
 assert.equal(h.calls.length,0);assert.equal(h.rows.size,0);assert.equal(h.objects.size,0);
});

test('invalid PNG inputs, output dimensions and incomplete original downloads are rejected', async()=>{
  const h=harness(); await assert.rejects(h.cloud.add(new Blob([]),metadata),/PNG/);
  await assert.rejects(h.cloud.add(new Blob(['jpeg'],{type:'image/jpeg'}),metadata),/PNG/);
  await assert.rejects(h.cloud.add(blob,{...metadata,width:8193}),/尺寸无效/);
  const saved=await h.cloud.add(blob,metadata), row=h.rows.get(saved.id);h.objects.set(row.image_path,new Blob(['x']));
  await assert.rejects(h.cloud.download(saved.id),/读取不完整/);
});

test('cloud lists paginate metadata and sign thumbnails in bounded batches', async()=>{
  const h=harness();
  for(let i=0;i<205;i++)h.rows.set(String(i),{id:String(i),owner_id:alice,name:'photo-'+i,width:1,height:1,bytes:1,created_at:new Date(1000+i).toISOString(),image_path:alice+'/'+i+'/image.png',thumbnail_path:alice+'/'+i+'/thumbnail.png'});
  const photos=await h.cloud.list(); assert.equal(photos.length,205);
  assert.equal(h.calls.filter(c=>c.table).length,2);assert.equal(h.calls.filter(c=>c.signed).length,3);
  assert.ok(h.calls.filter(c=>c.signed).every(c=>c.signed.length<=100));assert.equal(photos[0].id,'204');
});

