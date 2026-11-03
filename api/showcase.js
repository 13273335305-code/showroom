import { createHash } from 'node:crypto';
import { authConfig } from '../auth-config.js';
import { validateComment, commentRecord } from '../shared/showcase-data.js';

const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const fail = (status, message) => Object.assign(new Error(message), { status });
const PROJECT_BUCKET = 'spenic-project-resources', ALBUM_BUCKET = 'spenic-album-photos';
export function createShowcaseHandler({ fetchImpl = fetch, serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY, base = authConfig.url } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    const send = (status, data) => { res.statusCode = status; res.end(JSON.stringify(data)); };
    if (req.method !== 'POST') return send(405, { error: { message: '只支持 POST 请求' } });
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 25000);
    try {
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw fail(403, '请求来源无效');
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, '请求须使用 JSON');
      let input = req.body;
      if (input === undefined) {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 32768) throw fail(413, '请求内容过长'); chunks.push(chunk); }
        input = Buffer.concat(chunks).toString('utf8');
      }
      if (Buffer.isBuffer(input)) input = input.toString('utf8');
      if (typeof input === 'string') { if (Buffer.byteLength(input) > 32768) throw fail(413, '请求内容过长'); try { input = JSON.parse(input); } catch { throw fail(400, '请求格式无效'); } }
      if (!input || Buffer.byteLength(JSON.stringify(input)) > 32768) throw fail(400, '请求格式无效');
      if (!/^[a-f\d]{64}$/.test(input.token || '')) throw fail(404, '分享链接无效或已停用');
      const key = serviceKey(); if (!key) throw fail(503, '分享服务尚未配置，请联系展示者');
      const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
      async function cloud(path, options = {}) {
        const response = await fetchImpl(base + path, { ...options, headers, signal: controller.signal, redirect: 'error' });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          if (['42P01', '42703', 'PGRST202', 'PGRST205'].includes(data?.code)) throw fail(503, '展示服务尚未初始化，请联系展示者');
          if (data?.message?.includes('Too many comments')) throw fail(429, '留言过于频繁，请稍后重试');
          if (data?.message?.includes('Model changed')) throw fail(409, '模型已经更新，请重新打开项目后留言');
          if (['42501'].includes(data?.code)) throw fail(403, '分享链接无效或项目已移出');
          throw fail(502, '展示服务暂时不可用，请重试');
        }
        return data;
      }
      const rows = (table, params) => cloud('/rest/v1/' + table + '?' + new URLSearchParams({ select: '*', ...params }));
      async function allRows(table, params) {
        const result = [];
        for (let offset = 0; ; offset += 200) { const page = await rows(table, { ...params, limit: '200', offset: String(offset) }); result.push(...page); if (page.length < 200) return result; }
      }
      const hash = createHash('sha256').update(input.token).digest('hex');
      const [share] = await rows('spenic_showcase_shares', { token_hash: 'eq.' + hash, enabled: 'eq.true', limit: '1' });
      if (!share) throw fail(404, '分享链接无效或已停用');
      const [collection] = await rows('spenic_showcases', { id: 'eq.' + share.showcase_id, limit: '1' });
      if (!collection) throw fail(404, '分享链接无效或已停用');
      async function sign(bucket, path) {
        const result = await cloud('/storage/v1/object/sign/' + bucket + '/' + path.split('/').map(encodeURIComponent).join('/'), { method: 'POST', body: JSON.stringify({ expiresIn: 300 }) });
        const signed = result.signedURL || result.signedUrl;
        if (!signed) throw fail(502, '展示资源暂不可读取');
        return new URL(signed.startsWith('/object/') ? '/storage/v1' + signed : signed, base).href;
      }
      if (input.action === 'collection') {
        const items = await rows('spenic_showcase_items', { showcase_id: 'eq.' + collection.id, order: 'position.asc', limit: '200' });
        const projects = items.length ? await rows('spenic_projects', { id: 'in.(' + items.map(i => i.project_id).join(',') + ')', owner_id: 'eq.' + collection.owner_id, kind: 'eq.project', select: 'id,name,thumbnail_path,updated_at', limit: '200' }) : [];
        const mapped = new Map(projects.map(p => [p.id, p]));
        const summaries = await Promise.all(items.filter(i => mapped.has(i.project_id)).map(async i => {
          const p = mapped.get(i.project_id); let thumbnailUrl = null;
          if (p.thumbnail_path) try { thumbnailUrl = await sign(PROJECT_BUCKET, p.thumbnail_path); } catch {}
          return { projectId: p.id, name: p.name, thumbnailUrl, config: i.config };
        }));
        const optional = async (table, params, field) => { try { return (await rows(table, params))[0]?.[field] || null; } catch { return null; } };
        const [sceneConfig, defaultCamera] = await Promise.all([
          optional('spenic_scene_configs', { id: 'eq.site', select: 'config' }, 'config'),
          optional('spenic_default_camera_views', { page: 'eq.design', select: 'config' }, 'config'),
        ]);
        return send(200, { id: collection.id, name: collection.name, items: summaries, sceneConfig, defaultCamera });
      }
      if (!uuid.test(input.projectId || '')) throw fail(400, '项目无效');
      const [item] = await rows('spenic_showcase_items', { showcase_id: 'eq.' + collection.id, project_id: 'eq.' + input.projectId, limit: '1' });
      if (!item) throw fail(404, '项目已移出展示清单');
      const [project] = await rows('spenic_projects', { id: 'eq.' + input.projectId, owner_id: 'eq.' + collection.owner_id, kind: 'eq.project', limit: '1' });
      if (!project) throw fail(404, '项目不存在或已移出展示清单');
      if (input.action === 'project') return send(200, { id: project.id, name: project.name, revision: project.updated_at, manifest: project.manifest, config: item.config });
      if (input.action === 'resource') {
        const ref = Object.values(project.manifest?.files || {}).find(r => r.kind === 'cloud' && r.path === input.path);
        if (!ref) throw fail(404, '资源不属于此项目');
        return send(200, { url: await sign(PROJECT_BUCKET, ref.path) });
      }
      if (input.action === 'photos') {
        const photos = await allRows('spenic_album_photos', { project_id: 'eq.' + project.id, owner_id: 'eq.' + collection.owner_id, order: 'created_at.desc,id.desc' });
        return send(200, await Promise.all(photos.map(async p => ({ id: p.id, name: p.name.replace(/^AI::/, ''), source: p.name.startsWith('AI::') ? 'ai' : p.source,
          width: p.width, height: p.height, createdAt: Date.parse(p.created_at), thumbnailUrl: await sign(ALBUM_BUCKET, p.thumbnail_path) }))));
      }
      if (input.action === 'photo') {
        if (!uuid.test(input.photoId || '')) throw fail(400, '图片无效');
        const [photo] = await rows('spenic_album_photos', { id: 'eq.' + input.photoId, project_id: 'eq.' + project.id, owner_id: 'eq.' + collection.owner_id, limit: '1' });
        if (!photo) throw fail(404, '图片不存在或不属于此项目');
        return send(200, { url: await sign(ALBUM_BUCKET, photo.image_path), name: photo.name.replace(/^AI::/, ''), size: Number(photo.bytes) });
      }
      if (input.action === 'comments') return send(200, (await allRows('spenic_project_comments', { project_id: 'eq.' + project.id, order: 'created_at.asc,id.asc' })).map(commentRecord));
      if (input.action === 'comment') {
        let data; try { data = validateComment(input.comment); } catch (error) { throw fail(400, error.message); }
        if (data.projectId !== project.id) throw fail(403, '留言所属项目无效');
        const result = await cloud('/rest/v1/rpc/spenic_submit_project_comment', { method: 'POST', body: JSON.stringify({ comment_data: data, share_hash: hash }) });
        return send(200, commentRecord(Array.isArray(result) ? result[0] : result));
      }
      throw fail(400, '不支持此操作');
    } catch (error) { send(error.status || 503, { error: { message: error.status ? error.message : '展示服务连接失败，请稍后重试' } }); }
    finally { clearTimeout(timeout); }
  };
}
export default createShowcaseHandler();
