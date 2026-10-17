import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { albumPhotoName } from '../shared/album-name.js';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('async function captureFrameBlob('), app.indexOf('async function captureAiGenerate(){'));
function harness(save) {
  const nodes = { captureWidth: { value: '1920' }, captureHeight: { value: '1080' }, captureTransparent: { checked: true }, captureShoot: { disabled: false, textContent: '拍摄' } };
  const frame = { left: 0, top: 0, width: 100, height: 60 }, rendered = [], notifications = [];
  const canvas = { width: 100, height: 60, getBoundingClientRect: () => frame, toBlob: resolve => resolve(new Blob(['canvas'], { type: 'image/png' })) };
  nodes.canvas = canvas; nodes.captureFrame = { getBoundingClientRect: () => frame };
  const output = { getContext: () => ({ drawImage() {} }), toBlob: resolve => resolve(new Blob(['output'], { type: 'image/png' })) };
  const bitmap = { close() {} };
  const create = new Function('$', 'notify', 'renderDesignScene', 'createImageBitmap', 'document', 'addPhoto', 'console', 'setCaptureTransparent', 'albumPhotoName', 'modelSource',
    "let captureMode=true,renderer={},camera={},captureFlashTimer; " + source + ';return captureImage;');
  const capture = create(id=>nodes[id], message=>notifications.push(message), ()=>rendered.push(true), async()=>bitmap,
    { createElement: ()=>output }, save, { warn() {} }, () => {}, albumPhotoName, { name: 'MM06-展厅版.fbx' });
  return {capture,nodes,notifications,rendered,output};
}

test('capture waits for cloud save, suppresses duplicate clicks and preserves output settings', async()=>{
  let resolveSave, count=0, saved;
  const h=harness((blob,metadata)=>{count++;saved={blob,metadata};return new Promise(resolve=>{resolveSave=resolve;});});
  const promise=h.capture();
  for(let i=0;i<20&&!resolveSave;i++)await Promise.resolve();
  assert.equal(h.nodes.captureShoot.disabled,true);assert.match(h.nodes.captureShoot.textContent,/保存到云端/);
  await h.capture();assert.equal(count,1);assert.equal(h.notifications.length,0);
  assert.equal(h.output.width,1920);assert.equal(h.output.height,1080);
  assert.equal(saved.metadata.transparent,true);assert.equal(saved.metadata.name,albumPhotoName('MM06-展厅版.fbx'));
  assert.equal(saved.metadata.source,'capture');
  resolveSave();await promise;
  assert.equal(h.nodes.captureShoot.disabled,false);assert.equal(h.nodes.captureShoot.textContent,'拍摄');
  assert.match(h.notifications[0],/已保存到云端图册/);assert.equal(h.rendered.length,1);
  assert.doesNotMatch(source,/\bdownload\s*\(|downloadFile\s*\(|\.download\s*=/);
});

test('failed cloud capture shows the failure and restores the capture button', async()=>{
  const h=harness(async()=>{throw new Error('上传失败');});await h.capture();
  assert.deepEqual(h.notifications,['上传失败']);assert.equal(h.nodes.captureShoot.disabled,false);
});

