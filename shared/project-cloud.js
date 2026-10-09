const PROJECTS = 'spenic_projects', FILES = 'spenic_resource_files';
export const PROJECT_BUCKET = 'spenic-project-resources';
const SUMMARY = 'id,owner_id,kind,name,model_name,parent_id,visibility,thumbnail_path,created_at,updated_at';

function checked(result) {
  if (result.error) {
    if (['42P01', 'PGRST202', 'PGRST205'].includes(result.error.code) || /bucket not found/i.test(result.error.message || '')) throw new Error('线上项目库尚未初始化，请先完成 Supabase 项目库配置');
    if (result.error.code === '40001') throw new Error('项目已在其他页面更新，请重新打开后保存');
    if (result.error.code === '42501') throw new Error('没有操作此项目或资源的权限');
    throw new Error('线上项目操作失败：' + (result.error.message || '请稍后重试'));
  }
  return result.data;
}
function projectRecord(row) {
  if (!row) return null;
  return { id: row.id, ownerId: row.owner_id, kind: row.kind, name: row.name, modelName: row.model_name, parentId: row.parent_id, visibility: row.visibility, manifest: row.manifest, thumbnailPath: row.thumbnail_path, createdAt: Date.parse(row.created_at), updatedAt: Date.parse(row.updated_at), revision: row.updated_at };
}

export function createProjectCloud(access) {
  const uploadJobs = new Map(), downloadJobs = new Map();
  async function read(id) {
    const { client } = await access();
    return projectRecord(checked(await client.from(PROJECTS).select('*').eq('id', id).maybeSingle()));
  }
  async function list() {
    const { client } = await access(), rows = [];
    for (let offset = 0; ; offset += 200) {
      const page = checked(await client.from(PROJECTS).select(SUMMARY).order('id').range(offset, offset + 199));
      rows.push(...page); if (page.length < 200) break;
    }
    const paths = [...new Set(rows.map(row => row.thumbnail_path).filter(Boolean))];
    const signed = paths.length ? checked(await client.storage.from(PROJECT_BUCKET).createSignedUrls(paths, 3600)) : [];
    const previews = new Map(signed.filter(row => !row.error).map(row => [row.path, row.signedUrl]));
    return rows.map(row => ({ ...projectRecord(row), thumbnailUrl: previews.get(row.thumbnail_path) || null }));
  }
  async function upload(file) {
    if (!(file instanceof Blob) || !file.size || file.size > 512 * 1024 * 1024) throw new Error('项目资源必须为有效文件且小于 512 MB');
    const { client, userId } = await access();
    const bytes = await file.arrayBuffer(), hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    const path = userId + '/' + hash, key = userId + ':' + hash;
    if (!uploadJobs.has(key)) uploadJobs.set(key, (async () => {
      const existing = checked(await client.from(FILES).select('storage_path,bytes').eq('owner_id', userId).eq('hash', hash).maybeSingle());
      if (existing) {
        if (Number(existing.bytes) !== file.size || existing.storage_path !== path) throw new Error('资源版本记录无效');
        return;
      }
      const result = await client.storage.from(PROJECT_BUCKET).upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream', cacheControl: '31536000' });
      if (result.error && ![409, '409'].includes(result.error.statusCode) && !/already exists|duplicate/i.test(result.error.message || '')) checked(result);
      checked(await client.from(FILES).upsert({ owner_id: userId, hash, storage_path: path, bytes: file.size, mime: file.type || 'application/octet-stream' }, { onConflict: 'owner_id,hash', ignoreDuplicates: true }));
    })().catch(error => { uploadJobs.delete(key); throw error; }));
    await uploadJobs.get(key);
    return { kind: 'cloud', path, hash, name: file.name || 'resource', type: file.type || 'application/octet-stream', size: file.size };
  }
  async function download(reference) {
    const { client, userId } = await access(), key = userId + ':' + reference.path;
    if (!downloadJobs.has(key)) downloadJobs.set(key, (async () => {
      const blob = checked(await client.storage.from(PROJECT_BUCKET).download(reference.path));
      if (blob.size !== reference.size) throw new Error('项目资源大小与清单不一致');
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(value => value.toString(16).padStart(2, '0')).join('');
      if (hash !== reference.hash) throw new Error('项目资源内容与清单版本不一致');
      return blob;
    })().catch(error => { downloadJobs.delete(key); throw error; }));
    const file = await downloadJobs.get(key);
    if (file.size !== reference.size) throw new Error('项目资源大小与清单不一致');
    return new File([file], reference.name, { type: reference.type });
  }
  async function save(project) {
    if (!project.name?.trim()) throw new Error('项目名称无效');
    const { client, userId } = await access();
    const existing = project.id ? await read(project.id) : null;
    if (project.id && !existing) throw new Error('项目已删除，请重新创建');
    const fork = existing && existing.ownerId !== userId;
    const id = fork ? crypto.randomUUID() : project.id || crypto.randomUUID();
    const manifest = project.manifest || existing?.manifest;
    const kind = project.kind || existing?.kind || 'project';
    if (kind === 'project' && !manifest) throw new Error('缺少项目清单');
    const thumbnailPath = project.thumbnail ? (await upload(project.thumbnail)).path : existing?.thumbnailPath || null;
    const row = { id, kind, name: project.name.trim(), model_name: project.modelName ?? existing?.modelName ?? '', parent_id: project.parentId === undefined ? (fork ? null : existing?.parentId || null) : project.parentId, visibility: fork ? 'personal' : project.visibility ?? existing?.visibility ?? 'personal', manifest: kind === 'project' ? manifest : null, thumbnail_path: kind === 'project' ? thumbnailPath : null };
    const result = checked(await client.rpc('spenic_save_project', { project_data: row, expected_revision: fork ? null : project.revision || existing?.revision || null }));
    return projectRecord(Array.isArray(result) ? result[0] : result);
  }
  async function update(id, changes) {
    const current = await read(id); if (!current) throw new Error('项目不存在');
    const { userId } = await access(); if (current.ownerId !== userId) throw new Error('只有项目所有者可以修改项目信息');
    return save({ ...current, ...changes });
  }
  async function remove(id) {
    const { client, userId } = await access();
    const rows = checked(await client.from(PROJECTS).delete().eq('id', id).eq('owner_id', userId).select('id'));
    if (!rows.length) throw new Error('项目已删除或没有删除权限');
  }
  async function visibility(id, isPublic) {
    const { client } = await access();
    checked(await client.rpc('spenic_set_project_visibility', { project_id: id, make_public: Boolean(isPublic) }));
  }
  return { list, read, save, update, remove, visibility, upload, download };
}
