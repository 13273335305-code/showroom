import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('Windows proxy preserves drawing credentials on the actual HttpClient wire', { skip: process.platform !== 'win32' }, async () => {
  const token = 'fixture-drawing-key-0123456789', login = 'fixture-login-token';
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    calls.push({ url: req.url, headers: req.headers, body });
    res.setHeader('Content-Type', 'application/json');
    const send = (status, value) => { res.statusCode = status;res.end(JSON.stringify(value)); };
    if (req.url === '/auth/v1/user') return send(req.headers.authorization === `Bearer ${login}` ? 200 : 401, { id: 'alice' });
    if (req.url.startsWith('/rest/v1/spenic_capture_ai_site')) return send(200, [{ base: `http://127.0.0.1:${server.address().port}` }]);
    if (req.url.startsWith('/rest/v1/spenic_capture_ai_accounts')) return send(200, [{ api_key: token }]);
    if (req.headers.authorization !== `Bearer ${token}` || req.headers['x-api-key'] !== token) return send(401, { error: { message: 'Invalid token' } });
    send(200, { candidates: [{ content: { parts: [{ inlineData: { data: 'fixture-image', mimeType: 'image/png' } }] } }] });
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const directory = await mkdtemp(join(tmpdir(), 'spenic-ai-wire-'));
  try {
    await writeFile(join(directory, 'auth-config.js'), `export const authConfig = { url: 'http://127.0.0.1:${server.address().port}', publishableKey: 'fixture-public-key' };`);
    const quote = value => "'" + value.replaceAll("'", "''") + "'";
    const script = `
$ErrorActionPreference='Stop'
. ${quote(resolve('utils/capture-ai-proxy.ps1'))}
# This fixture alone permits its loopback provider; production retains validation.
function Test-CaptureAiPublicAddress($address){return $true}
$payload=ConvertTo-Json -InputObject @{model='「Rim」gemini-3.1-flash-image-preview';body=@{contents=@(@{role='user';parts=@(@{text='测试鉴权'})})}} -Depth 20 -Compress
$reply=Invoke-CaptureAiProxy $payload 'Bearer ${login}' ${quote(directory)}
if($reply.Code -ne 200){throw ('Proxy returned HTTP '+$reply.Code)}
Write-Output 'PASS actual HttpClient round trip'
`;
    const scriptPath = join(directory, 'verify.ps1');
    await writeFile(scriptPath, '\ufeff' + script, 'utf8');
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true });
    let output = '';child.stdout.on('data', value => { output += value; });child.stderr.on('data', value => { output += value; });
    const [code] = await once(child, 'exit');assert.equal(code, 0, output);
    assert.equal(calls.length, 4);
    const generated = calls.at(-1);
    assert.equal(generated.headers.authorization, `Bearer ${token}`);
    assert.equal(generated.headers['x-api-key'], token);
    assert.equal(generated.headers['x-banana-client'], 'comfyui-banana-li');
    assert.equal(JSON.parse(generated.body).contents[0].parts[0].text, '测试鉴权');
    assert.ok(decodeURIComponent(generated.url).includes('「Rim」gemini-3.1-flash-image-preview:generateContent'));
  } finally {
    await new Promise(resolve => { server.close(resolve);server.closeAllConnections(); });
    for (const name of ['verify.ps1', 'auth-config.js']) {
      try { await unlink(join(directory, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await rmdir(directory);
  }
});
