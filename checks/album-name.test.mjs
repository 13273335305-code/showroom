import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { albumPhotoName, albumPhotoTitle, albumDownloadName, albumPhotoBadge } from '../shared/album-name.js';

test('photo names use the model and local calendar date without capture prefixes or image extensions', () => {
  const captured = new Date(2026, 9, 17, 23, 59, 59);
  for (const extension of ['fbx', 'FBX', 'glb', 'gltf', 'spmodel']) {
    assert.equal(albumPhotoName('MM06-展厅版.' + extension, captured), 'MM06-展厅版-20261017');
  }
  assert.equal(albumPhotoName('模型.v2.glb', new Date(2026, 0, 2)), '模型.v2-20260102');
  assert.equal(albumPhotoName('', captured), '模型-20261017');
});

test('photo titles omit PNG extensions while explicit downloads retain a usable PNG filename', () => {
  assert.equal(albumPhotoTitle('MM06-20261017.png'), 'MM06-20261017');
  assert.equal(albumPhotoTitle('旧图.PNG'), '旧图');
  assert.equal(albumPhotoTitle('模型.v2-20261017'), '模型.v2-20261017');
  assert.equal(albumDownloadName('MM06-20261017'), 'MM06-20261017.png');
  assert.equal(albumDownloadName('旧图.png'), '旧图.png');
});

test('photo names remain usable as cloud labels and filenames', () => {
  const captured = new Date(2026, 9, 17);
  assert.equal(albumPhotoName('模型/测试:版本?.fbx', captured), '模型_测试_版本_-20261017');
  const long = albumPhotoName('模'.repeat(200) + '.fbx', captured);
  assert.equal(long.length, 180); assert.ok(long.endsWith('-20261017'));
});

test('badges hide all ordinary captures and identify AI independently of the photo name', () => {
  assert.equal(albumPhotoBadge({ name: '模型-20261017', transparent: true, source: 'capture' }), '');
  assert.equal(albumPhotoBadge({ name: '模型-20261017', transparent: false, source: 'capture' }), '');
  assert.equal(albumPhotoBadge({ name: '模型-20261017', transparent: false, source: 'ai' }), 'AI');
  assert.equal(albumPhotoBadge({ name: '模型-20261017', transparent: true, source: 'ai' }), 'AI');
  assert.equal(albumPhotoBadge({ name: 'AI-2026-10-17-204248-176-4K.png' }), 'AI');
  assert.equal(albumPhotoBadge({ name: 'AI-2026-10-17-204248-176-4K' }), 'AI');
  assert.equal(albumPhotoBadge({ name: 'FORM-2026-10-17-203839-735-transparent.png', transparent: true }), '');
  assert.equal(albumPhotoBadge({ name: 'AI-模型-20261017', source: 'capture' }), '');
});

test('album markup removes the annotated controls and card metadata while preserving preview and actions', async () => {
  const html = await readFile(new URL('../album.html', import.meta.url), 'utf8');
  const entry = await readFile(new URL('../entries/album.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /album-workspace-link|album-heading|albumCount|id="albumTitle"/);
  assert.doesNotMatch(entry, /albumCount|album-card-meta span|album-photo-size/);
  assert.match(entry, /album-download/); assert.match(html, /id="albumPreviewDelete"/);
  assert.doesNotMatch(entry, /class="album-delete"|album-card-actions/);
  assert.doesNotMatch(entry, /透明背景/);
  assert.match(entry, /badge\.hidden = !label/);
  assert.match(html, /id="albumPreviewDialog"/);
});

test('regular and AI capture freeze the same model-based name when capture begins', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const regular = app.slice(app.indexOf('async function captureImage(){'), app.indexOf('async function captureAiGenerate(){'));
  const ai = app.slice(app.indexOf('async function captureAiGenerate(){'), app.indexOf('function formatCount'));
  for (const source of [regular, ai]) {
    assert.match(source, /photoName=captureFilename\(\)/);
    assert.match(source, /name:photoName/);
  }
  assert.match(regular, /source:'capture'/);
  assert.match(ai, /source:'ai'/);
});
