import { validateComment, commentRecord } from './showcase-data.js';

function checked(result) {
  if (result.error) {
    if (['42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(result.error.code)) throw new Error('展示台尚未初始化，请先执行 supabase/showcase.sql');
    if (result.error.code === '40001') throw new Error('展示清单已在其他页面更新，请重新打开后保存');
    if (result.error.code === '42501') throw new Error('没有此展示项目的操作权限');
    throw new Error(result.error.message || '展示台操作失败，请重试');
  }
  return result.data;
}
const one = data => Array.isArray(data) ? data[0] : data;
const record = row => ({ id: row.id, name: row.name, ownerId: row.owner_id, revision: row.updated_at });
export async function hashShareToken(token) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function createShowcaseStore(access) {
  return {
    async list() { const { client } = await access(); return checked(await client.from('spenic_showcases').select('*').order('updated_at', { ascending: false })).map(record); },
    async read(id) {
      const { client } = await access();
      const row = checked(await client.from('spenic_showcases').select('*').eq('id', id).maybeSingle());
      if (!row) throw new Error('展示清单不存在或已删除');
      const items = checked(await client.from('spenic_showcase_items').select('*').eq('showcase_id', id).order('position'));
      const share = checked(await client.from('spenic_showcase_shares').select('token_hash,enabled').eq('showcase_id', id).maybeSingle());
      return { ...record(row), items: items.map(i => ({ projectId: i.project_id, config: i.config })), share };
    },
    async save(collection) {
      const { client } = await access();
      const row = one(checked(await client.rpc('spenic_save_showcase', { showcase_data: { id: collection.id, name: collection.name, items: collection.items || [] }, expected_revision: collection.revision || null })));
      return { ...collection, ...record(row) };
    },
    async remove(id) { const { client } = await access(); const rows = checked(await client.from('spenic_showcases').delete().eq('id', id).select('id')); if (!rows.length) throw new Error('展示清单已删除或没有权限'); },
    async share(id) {
      const { client } = await access(), token = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
      const hash = await hashShareToken(token);
      checked(await client.rpc('spenic_set_showcase_share', { target_id: id, new_hash: hash, active: true }));
      return { token, hash };
    },
    async disableShare(id) { const { client } = await access(); checked(await client.rpc('spenic_set_showcase_share', { target_id: id, new_hash: null, active: false })); },
    async comments(projectId) {
      const { client } = await access(); const rows = [];
      for (let offset = 0; ; offset += 200) {
        const page = checked(await client.from('spenic_project_comments').select('*').eq('project_id', projectId).order('created_at').order('id').range(offset, offset + 199));
        rows.push(...page); if (page.length < 200) break;
      }
      return rows.map(commentRecord);
    },
    async addComment(input) { const { client } = await access(); return commentRecord(one(checked(await client.rpc('spenic_submit_project_comment', { comment_data: validateComment(input), share_hash: null })))); },
    async removeComment(id) { const { client } = await access(); const rows = checked(await client.from('spenic_project_comments').delete().eq('id', id).select('id')); if (!rows.length) throw new Error('留言已删除或没有权限'); },
  };
}
export function createGuestShowcase(token, { request = fetch } = {}) {
  let visitor = null;
  function visitorToken() {
    if (visitor) return visitor;
    try { const saved = localStorage.getItem('spenic-feedback-visitor-token'); if (/^[a-f\d]{64}$/.test(saved || '')) return visitor = saved; } catch {}
    visitor = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem('spenic-feedback-visitor-token', visitor); } catch {}
    return visitor;
  }
  async function call(action, values = {}) {
    const response = await request('./api/showcase', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, action, token }), cache: 'no-store' });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) throw new Error(result?.error?.message || '展示内容读取失败，请重试');
    return result;
  }
  return {
    read: () => call('collection'), project: projectId => call('project', { projectId }),
    photos: projectId => call('photos', { projectId }), comments: projectId => call('comments', { projectId, visitorToken: visitorToken() }),
    addComment: input => call('comment', { comment: validateComment(input), projectId: input.projectId, visitorToken: visitorToken() }),
    removeComment: (projectId, commentId) => call('delete-comment', { projectId, commentId, visitorToken: visitorToken() }),
    async resource(projectId, reference) {
      const result = await call('resource', { projectId, path: reference.path });
      const response = await request(result.url); if (!response.ok) throw new Error('项目资源读取失败');
      const blob = await response.blob();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('');
      if (blob.size !== reference.size || hash !== reference.hash) throw new Error('项目资源与保存版本不一致');
      return new File([blob], reference.name, { type: reference.type });
    },
    async photo(projectId, id) {
      const result = await call('photo', { projectId, photoId: id });
      const response = await request(result.url); if (!response.ok) throw new Error('原图读取失败');
      const blob = await response.blob(); if (blob.size !== result.size) throw new Error('原图读取不完整');
      return { blob, name: result.name };
    },
  };
}
