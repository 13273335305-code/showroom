import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createCaptureAiHandler } from '../api/capture-ai.js';
import { buildCaptureAiUrl, CAPTURE_AI_MODEL, captureAiModelId } from '../shared/capture-ai-protocol.js';

async function fixture(options = {}) {
  const calls = [];
  let base = 'http://64.186.244.43:12001';
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), ...init });
    if (String(url).includes('/auth/v1/user')) return Response.json({ id: init.headers.Authorization === 'Bearer bob-session' ? 'bob' : 'alice' });
    if (String(url).includes('spenic_capture_ai_site')) return Response.json([{ base }]);
    if (String(url).includes('spenic_capture_ai_accounts')) return Response.json([{ api_key: String(url).endsWith('bob') ? 'bob-private-key' : 'alice-private-key' }]);
    if (options.wait) return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('Abort'))));
    return options.error ? Response.json({ error: { message: 'alice-private-key must never appear' } }, { status: options.error }) : new Response(options.large ? 'x'.repeat(5 * 1024 * 1024) : JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'fixture-image' } }] } }] }));
  };
  const handler = createCaptureAiHandler({ fetchImpl, resolve: async host => [{ address: host === 'localhost' ? '127.0.0.1' : '64.186.244.43' }], timeoutMs: options.wait ? 30 : 5000 });
  const server = createServer(handler).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/capture-ai`;
  const post = (value = {}, token = 'alice-session') => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ model: CAPTURE_AI_MODEL, body: { contents: [{ role: 'user', parts: [{ text: 'test' }] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { imageSize: '4K' } } }, ...value }) });
  return { calls, post, url, set base(value) { base = value; }, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}

test('proxy reads current endpoint and account Key under RLS, then sends the original full model and payload', async () => {
  const h = await fixture();
  try {
    let response = await h.post({ url: 'http://localhost/ignored', apiKey: 'ignored-key' });
    assert.equal(response.status, 200);assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).candidates[0].content.parts[0].inlineData.data, 'fixture-image');
    let outbound = h.calls.at(-1);
    assert.equal(outbound.url, buildCaptureAiUrl('http://64.186.244.43:12001', CAPTURE_AI_MODEL));
    assert.equal(outbound.headers['X-API-Key'], 'alice-private-key');assert.equal(outbound.redirect, 'error');
    assert.equal(JSON.parse(outbound.body).generationConfig.imageConfig.imageSize, '4K');
    h.base = 'http://64.186.244.43:12002';
    response = await h.post({}, 'bob-session');await response.text();outbound = h.calls.at(-1);
    assert.match(outbound.url, /:12002/);assert.equal(outbound.headers.Authorization, 'Bearer bob-private-key');
    assert.ok(h.calls.some(call => call.url.endsWith('owner_id=eq.bob')));
  } finally { await h.close(); }
});
test('missing login, private destinations, invalid model and oversized requests do not reach the provider', async () => {
  const h = await fixture();
  try {
    assert.equal((await h.post({}, '')).status, 401);assert.equal(h.calls.length, 0);
    h.base = 'http://localhost';assert.equal((await h.post()).status, 400);
    h.base = 'http://64.186.244.43:12001';assert.equal((await h.post({ model: 'model?key=bad' })).status, 400);
    assert.equal((await h.post({ padding: 'a'.repeat(4 * 1024 * 1024) })).status, 413);
    assert.ok(h.calls.every(call => call.url.includes('.supabase.co/')));
  } finally { await h.close(); }
});
test('provider errors are useful and never echo credentials', async () => {
  for (const status of [401, 404, 429, 500]) {
    const h = await fixture({ error: status });
    try { const response = await h.post();assert.equal(response.status, status);const text = await response.text();assert.ok(text.includes(String(status)));assert.ok(!text.includes('private-key')); }
    finally { await h.close(); }
  }
});
test('large generated images stream completely and timed out generation returns a clear error', async () => {
  const large = await fixture({ large: true });
  try { const response = await large.post();assert.equal(response.status, 200);assert.equal((await response.text()).length, 5 * 1024 * 1024); }
  finally { await large.close(); }
  const timeout = await fixture({ wait: true });
  try { const response = await timeout.post();assert.equal(response.status, 504);assert.match(await response.text(), /超时/); }
  finally { await timeout.close(); }
});
test('model routing preserves the provider prefix and supports endpoint templates', () => {
  assert.equal(captureAiModelId('gemini-3.1-flash-image-preview'), CAPTURE_AI_MODEL);
  assert.equal(captureAiModelId('gemini-3-pro-image'), '「Rim」gemini-3-pro-image-preview');
  assert.equal(captureAiModelId('custom-route'), 'custom-route');
  assert.equal(new URL(buildCaptureAiUrl('http://example.test', CAPTURE_AI_MODEL)).pathname, '/v1beta/models/' + encodeURIComponent(CAPTURE_AI_MODEL) + ':generateContent');
  assert.equal(buildCaptureAiUrl('http://example.test/v1beta/models/{{model}}:generateContent', CAPTURE_AI_MODEL), buildCaptureAiUrl('http://example.test', CAPTURE_AI_MODEL));
});
