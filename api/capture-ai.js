import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { authConfig } from '../auth-config.js';
import { buildCaptureAiUrl, CAPTURE_AI_REQUEST_LIMIT, captureAiHttpError } from '../shared/capture-ai-protocol.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
function publicAddress(address) {
  if (isIP(address) === 6) return /^(?:2|3)[0-9a-f]{3}:/i.test(address);
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return !([0, 10, 127].includes(a) || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
}

export function createCaptureAiHandler({ fetchImpl = fetch, resolve = lookup, timeoutMs = 180000 } = {}) {
  return async function captureAiHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, value) => { res.statusCode = status; res.end(JSON.stringify(value)); };
    if (req.method === 'GET') return send(200, { ready: true });
    if (req.method !== 'POST') return send(405, { error: { message: '只支持 POST 请求' } });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', onClose);
    try {
      // No client-supplied target URL or API Key: both come from authenticated RLS reads.
      const authorization = req.headers.authorization || '';
      if (!/^Bearer \S+$/i.test(authorization)) throw fail(401, '请重新登录后使用 AI 绘图');
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw fail(403, '请求来源无效');
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, '请求须使用 JSON');
      let input = req.body;
      if (input === undefined) {
        let length = 0;
        const chunks = [];
        for await (const chunk of req) {
          length += chunk.length;
          if (length > CAPTURE_AI_REQUEST_LIMIT) throw fail(413, '参考图过大，请降低拍摄尺寸后重试');
          chunks.push(chunk);
        }
        input = Buffer.concat(chunks).toString('utf8');
      }
      if (Buffer.isBuffer(input)) input = input.toString('utf8');
      if (typeof input === 'string') {
        if (Buffer.byteLength(input) > CAPTURE_AI_REQUEST_LIMIT) throw fail(413, '参考图过大，请降低拍摄尺寸后重试');
        try { input = JSON.parse(input); } catch { throw fail(400, '绘图请求格式无效'); }
      }
      if (!input || typeof input.model !== 'string' || !Array.isArray(input.body?.contents) || !input.body.contents.length) throw fail(400, '绘图请求格式无效');
      if (Buffer.byteLength(JSON.stringify(input)) > CAPTURE_AI_REQUEST_LIMIT) throw fail(413, '参考图过大，请降低拍摄尺寸后重试');
      const cloudHeaders = { apikey: authConfig.publishableKey, Authorization: authorization };
      const cloud = async (path, message) => {
        const response = await fetchImpl(authConfig.url + path, { headers: cloudHeaders, signal: controller.signal, redirect: 'error' });
        if (!response.ok) throw fail([401, 403].includes(response.status) ? 401 : 503, [401, 403].includes(response.status) ? '登录已失效，请重新登录' : message);
        return response.json();
      };
      const user = await cloud('/auth/v1/user', '暂时无法验证登录，请稍后重试');
      if (!user.id) throw fail(401, '登录已失效，请重新登录');
      const [sites, accounts] = await Promise.all([
        cloud('/rest/v1/spenic_capture_ai_site?select=base&id=eq.site', '全站 AI 地址读取失败，请检查云端配置'),
        cloud(`/rest/v1/spenic_capture_ai_accounts?select=api_key&owner_id=eq.${encodeURIComponent(user.id)}`, '当前账号 AI 配置读取失败，请检查云端配置'),
      ]);
      const key = accounts[0]?.api_key?.trim();
      if (!key) throw fail(400, '请先填写并保存当前账号的 API Key');
      let target;
      try {
        target = new URL(buildCaptureAiUrl(sites[0]?.base, input.model));
        if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash) throw new Error();
        const addresses = await resolve(target.hostname.replace(/^\[|\]$/g, ''), { all: true });
        if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error();
      } catch { throw fail(400, '全站 API 地址或模型名称无效，请联系管理员检查'); }
      const upstream = await fetchImpl(target.href, {
        method: 'POST', signal: controller.signal, redirect: 'error',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'X-API-Key': key, 'X-Banana-Client': 'comfyui-banana-li' },
        body: JSON.stringify(input.body),
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        throw fail(upstream.status, captureAiHttpError(upstream.status));
      }
      res.statusCode = upstream.status;
      // Stream large 2K/4K results instead of buffering them in a function response.
      if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), res);
      else res.end('{}');
    } catch (error) {
      if (!res.headersSent) send(error.status || (controller.signal.aborted ? 504 : 502), { error: { message: error.status ? error.message : controller.signal.aborted ? 'AI 生成超时，请稍后重试' : 'AI 服务连接失败，请检查全站 API 地址或稍后重试' } });
      else res.destroy();
    } finally {
      clearTimeout(timer);
      res.off('close', onClose);
    }
  };
}

export default createCaptureAiHandler();
