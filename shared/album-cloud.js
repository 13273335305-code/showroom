export const ALBUM_BUCKET = 'spenic-album-photos';
const TABLE = 'spenic_album_photos';
// Read optional metadata without requiring older albums to add columns.
const FIELDS = '*';
const LEGACY_AI_PREFIX = 'AI::';
const MAX_BYTES = 256 * 1024 * 1024;

export async function createAlbumThumbnail(blob) {
  if (!(blob instanceof Blob)) throw new Error('无法生成图册预览图');
  const image = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 300;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前环境不支持生成图册预览图');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('图册预览图生成失败')), 'image/png');
    });
  } finally { image.close?.(); }
}

function checked(result) {
  if (result.error) {
    if (['42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(result.error.code) || /bucket not found/i.test(result.error.message || '')) {
      throw new Error('云端图册尚未初始化或需要更新，请执行最新版 supabase/album.sql');
    }
    if (result.error.code === '42501') throw new Error('只能访问本人账号的图册图片');
    throw new Error('云端图册操作失败：' + (result.error.message || '请稍后重试'));
  }
  return result.data;
}

function record(row, thumbnailUrl = null) {
  const legacyAi = row.name.startsWith(LEGACY_AI_PREFIX);
  return { id: row.id, ownerId: row.owner_id, name: legacyAi ? row.name.slice(LEGACY_AI_PREFIX.length) : row.name, width: row.width, height: row.height,
    transparent: row.transparent, source: legacyAi ? 'ai' : row.source, size: Number(row.bytes), createdAt: Date.parse(row.created_at), thumbnailUrl };
}

export function createAlbumCloud(access, { thumbnail = createAlbumThumbnail } = {}) {
  let sourceColumnAvailable = true;
  function compatibleRow(row) {
    const { source, ...legacy } = row;
    if (source === 'ai') {
      const maxLength = 180 - LEGACY_AI_PREFIX.length;
      const name = legacy.name;
      const shortened = name.length <= maxLength ? name
        : /-\d{8}$/.test(name) ? name.slice(0, maxLength - 9) + name.slice(-9) : name.slice(0, maxLength);
      legacy.name = LEGACY_AI_PREFIX + shortened;
    }
    return legacy;
  }
  async function sameAccount(userId) {
    if ((await access()).userId !== userId) throw new Error('账号已切换，请返回原账号重试');
  }
  async function read(client, userId, id) {
    const row = checked(await client.from(TABLE).select(FIELDS).eq('owner_id', userId).eq('id', id).maybeSingle());
    if (!row || row.owner_id !== userId) throw new Error('图片不存在或没有访问权限');
    return row;
  }
  async function add(blob, metadata = {}) {
    if (!(blob instanceof Blob) || !blob.size || blob.type !== 'image/png' || blob.size > MAX_BYTES) throw new Error('拍摄图片必须是小于 256 MB 的 PNG');
    const { width, height } = metadata;
    if (![width, height].every(value => Number.isInteger(value) && value >= 1 && value <= 8192)) throw new Error('拍摄尺寸无效');
    const source = metadata.source ?? 'capture';
    if (!['capture', 'ai'].includes(source)) throw new Error('图片来源无效');
    const { client, userId } = await access();
    if (metadata.ownerId && metadata.ownerId !== userId) throw new Error('账号已切换，请返回原账号重试');
    const id = crypto.randomUUID(), prefix = userId + '/' + id;
    const storage = client.storage.from(ALBUM_BUCKET), uploaded = [];
    const row = { id, owner_id: userId, name: String(metadata.name || 'Spenic-拍摄.png').trim().slice(0, 180),
      width, height, transparent: Boolean(metadata.transparent), source, bytes: blob.size, image_path: prefix + '/image.png', thumbnail_path: prefix + '/thumbnail.png' };
    const preview = await thumbnail(blob);
    await sameAccount(userId);
    let commitStarted = false;
    try {
      for (const [path, file] of [[row.image_path, blob], [row.thumbnail_path, preview]]) {
        await sameAccount(userId);
        checked(await storage.upload(path, file, { upsert: false, contentType: 'image/png', cacheControl: '300' }));
        uploaded.push(path);
      }
      await sameAccount(userId);
      commitStarted = true;
      let result = await client.from(TABLE).insert(sourceColumnAvailable ? row : compatibleRow(row)).select(FIELDS).single();
      if (sourceColumnAvailable && ['42703', 'PGRST204'].includes(result.error?.code) && /\bsource\b/i.test(result.error.message || '')) {
        // A missing-column rejection cannot commit an insert; retry using the original schema.
        sourceColumnAvailable = false;
        await sameAccount(userId);
        result = await client.from(TABLE).insert(compatibleRow(row)).select(FIELDS).single();
      }
      const saved = checked(result);
      await sameAccount(userId);
      return record(saved);
    } catch (error) {
      // An interrupted insert response may already be committed on the server.
      if (!commitStarted && uploaded.length) try { await sameAccount(userId); await storage.remove(uploaded); } catch {}
      throw error;
    }
  }
  async function list() {
    const { client, userId } = await access(), rows = [];
    for (let offset = 0; ; offset += 200) {
      const page = checked(await client.from(TABLE).select(FIELDS).eq('owner_id', userId)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 199));
      rows.push(...page.filter(row => row.owner_id === userId));
      if (page.length < 200) break;
    }
    const urls = new Map();
    for (let offset = 0; offset < rows.length; offset += 100) {
      await sameAccount(userId);
      const paths = rows.slice(offset, offset + 100).map(row => row.thumbnail_path);
      const signed = checked(await client.storage.from(ALBUM_BUCKET).createSignedUrls(paths, 300));
      for (const item of signed) if (item.signedUrl && !item.error) urls.set(item.path, item.signedUrl);
    }
    await sameAccount(userId);
    return rows.map(row => record(row, urls.get(row.thumbnail_path)));
  }
  async function download(id) {
    const { client, userId } = await access(), row = await read(client, userId, id);
    const blob = checked(await client.storage.from(ALBUM_BUCKET).download(row.image_path));
    if (!(blob instanceof Blob) || blob.size !== Number(row.bytes)) throw new Error('图片原文件读取不完整，请重试');
    await sameAccount(userId);
    return { blob, name: record(row).name };
  }
  async function remove(id) {
    const { client, userId } = await access(), row = await read(client, userId, id);
    const removed = checked(await client.from(TABLE).delete().eq('id', id).eq('owner_id', userId).select('id'));
    if (!removed.length) throw new Error('图片已删除或没有删除权限');
    try { await sameAccount(userId); checked(await client.storage.from(ALBUM_BUCKET).remove([row.image_path, row.thumbnail_path])); }
    catch (error) { console.warn('图册图片已删除，云端文件清理暂未完成', error); }
  }
  return { add, list, download, remove };
}
