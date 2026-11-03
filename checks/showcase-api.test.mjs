import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createShowcaseHandler } from '../api/showcase.js';

const projectId = '11111111-1111-1111-1111-111111111111', photoId = '22222222-2222-2222-2222-222222222222';
const token = 'a'.repeat(64), hash = createHash('sha256').update(token).digest('hex');
const visitorToken = 'c'.repeat(64), authorHash = createHash('sha256').update(visitorToken).digest('hex'), commentId = '33333333-3333-3333-3333-333333333333';
function harness() {
  let enabled = true, member = true; const requests = [];
  const ref = { kind: 'cloud', path: 'owner/' + 'b'.repeat(64), hash: 'b'.repeat(64), size: 5, name: 'model.glb' };
  const tables = {
    spenic_showcase_shares: [{ showcase_id: 'show', token_hash: hash, enabled: true }], spenic_showcases: [{ id: 'show', owner_id: 'owner', name: '客户演示' }],
    spenic_showcase_items: [{ showcase_id: 'show', project_id: projectId, position: 0, config: {} }],
    spenic_projects: [{ id: projectId, owner_id: 'owner', kind: 'project', name: '方案', manifest: { modelPath: 'model', files: { model: ref } } }],
    spenic_album_photos: [{ id: photoId, owner_id: 'owner', project_id: projectId, name: 'AI.png', source: 'ai', image_path: 'owner/photo/image.png', thumbnail_path: 'owner/photo/thumbnail.png', bytes: 5, created_at: new Date().toISOString() }],
    spenic_project_comments: [{ id: commentId, project_id: projectId, author_name: '客户', body: '反馈', model_hash: ref.hash, host: 0, point: [1, 2, 3], author_token_hash: authorHash, created_at: new Date().toISOString() }],
  };
  const handler = createShowcaseHandler({ base: 'https://cloud.test', serviceKey: () => 'server-only-test-key', fetchImpl: async (url, options) => {
    requests.push({ url, options }); const parsed = new URL(url);
    if (parsed.pathname.startsWith('/storage/')) return Response.json({ signedURL: '/object/sign/private/file?token=temporary' });
    const table = parsed.pathname.split('/').at(-1);
    if (table === 'spenic_submit_project_comment') { const body = JSON.parse(options.body); assert.equal(body.share_hash, hash); return Response.json(tables.spenic_project_comments[0]); }
    if (table === 'spenic_delete_guest_comment') {
      const body = JSON.parse(options.body); assert.equal(body.share_hash, hash); assert.equal(body.project_id_value, projectId);
      const row = tables.spenic_project_comments.find(c => c.id === body.comment_id_value && c.author_token_hash === body.author_hash);
      if (!row) return Response.json({code:'42501',message:'Comment unavailable or not owned'}, {status:403});
      tables.spenic_project_comments = tables.spenic_project_comments.filter(c => c !== row); return Response.json(null);
    }
    let result = tables[table] || [];
    if (table === 'spenic_showcase_shares' && !enabled) result = [];
    if (table === 'spenic_showcase_items' && !member) result = [];
    for (const [key, value] of parsed.searchParams) if (value.startsWith('eq.')) result = result.filter(row => String(row[key]) === value.slice(3));
    return Response.json(result);
  } });
  async function call(action, values = {}) {
    let body; const headers = {}; const res = { statusCode: 200, setHeader(k, v) { headers[k] = v; }, end(data) { body = JSON.parse(data); } };
    await handler({ method: 'POST', headers: { 'content-type': 'application/json' }, body: { token, action, projectId, ...values } }, res);
    assert.equal(headers['Cache-Control'], 'no-store'); assert.ok(!JSON.stringify(body).includes('server-only-test-key'));
    return { status: res.statusCode, body };
  }
  return { call, requests, ref, disable: () => { enabled = false; }, remove: () => { member = false; } };
}
test('share gateway signs only a referenced resource or a photo in the selected project', async () => {
  const h = harness();
  const resource = await h.call('resource', { path: h.ref.path }); assert.equal(resource.status, 200); assert.match(resource.body.url, /storage\/v1\/object\/sign/);
  const before = h.requests.filter(r => r.url.includes('/storage/')).length;
  assert.equal((await h.call('resource', { path: 'owner/private-unrelated-file' })).status, 404);
  assert.equal((await h.call('photo', { photoId: crypto.randomUUID() })).status, 404);
  assert.equal(h.requests.filter(r => r.url.includes('/storage/')).length, before);
  assert.equal((await h.call('photo', { photoId })).status, 200);
  assert.equal((await h.call('photos')).body[0].source, 'ai'); assert.equal((await h.call('comments')).body[0].authorName, '客户');
});
test('every operation checks revocation and membership, including comments and originals', async () => {
  const h = harness(); h.remove();
  for (const action of ['project', 'resource', 'photos', 'photo', 'comments', 'comment', 'delete-comment']) assert.equal((await h.call(action)).status, 404);
  const other = harness(); other.disable(); for (const action of ['collection', 'project', 'comments', 'delete-comment']) assert.equal((await other.call(action)).status, 404);
  assert.equal((await harness().call('project', { token: 'bad' })).status, 404);
});
test('guest deletion requires the private browser credential, and public results never expose ownership hashes', async () => {
  const h = harness();
  const own = await h.call('comments', { visitorToken }); assert.equal(own.body[0].canDelete, true);
  assert.ok(!JSON.stringify(own.body).includes(authorHash)); assert.ok(!JSON.stringify(own.body).includes(visitorToken));
  assert.equal((await h.call('comments', { visitorToken: 'd'.repeat(64) })).body[0].canDelete, false);
  assert.equal((await h.call('comments')).body[0].canDelete, false);
  assert.equal((await h.call('delete-comment', { commentId })).status, 403);
  assert.equal((await h.call('delete-comment', { commentId, visitorToken: 'd'.repeat(64) })).status, 403);
  assert.equal((await h.call('delete-comment', { commentId: projectId, visitorToken })).status, 403);
  assert.equal((await h.call('delete-comment', { commentId, visitorToken })).status, 200);
  assert.equal((await h.call('comments')).body.length, 0);
  assert.equal((await h.call('delete-comment', { commentId, visitorToken })).status, 403);
});
test('comment writes reject a mismatched project and malformed positions before the RPC', async () => {
  const h = harness(), comment = { projectId, requestId: crypto.randomUUID(), authorName: '客户甲', body: '请修改这里', modelHash: h.ref.hash, host: 0, point: [1, 2, 3] };
  assert.equal((await h.call('comment', { comment })).status, 200);
  const before = h.requests.filter(r => r.url.includes('/rpc/')).length;
  assert.equal((await h.call('comment', { comment: { ...comment, point: [null, 0, 0] } })).status, 400);
  assert.equal((await h.call('comment', { comment: { ...comment, projectId: photoId } })).status, 403);
  assert.equal(h.requests.filter(r => r.url.includes('/rpc/')).length, before);
});
