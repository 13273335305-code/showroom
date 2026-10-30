import { readEnvironment, sceneName } from './scene-file.js';

export const SCENE_IDS = Object.freeze(['morning', 'evening', 'night']);
export const SCENE_LABELS = Object.freeze({ morning: '清晨', evening: '黄昏', night: '夜晚' });
export const SCENE_CONFIG_FORMAT = 'SPENIC-SCENE-SET';
export const SCENE_CONFIG_VERSION = 1;

const TABLE = 'spenic_scene_configs';
const FILES = Object.freeze({ morning: 'morning.json', evening: 'evening.json', night: 'night.json' });
const missingSchema = error => ['42P01', 'PGRST202', 'PGRST205'].includes(error?.code);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function sceneFilename(value) {
  if (value != null && typeof value !== 'string') throw new Error('场景文件名无效');
  const filename = String(value || '').trim().split(/[\\/]/).pop() || '';
  if (!filename || filename.length > 255 || /[\u0000-\u001f]/.test(filename)) return '';
  return filename;
}

export function readSceneConfig(value) {
  if (!isRecord(value) || value.format !== SCENE_CONFIG_FORMAT || value.version !== SCENE_CONFIG_VERSION) {
    throw new Error('光影流转配置格式无效');
  }
  const defaultScene = String(value.defaultScene || '').trim();
  if (!SCENE_IDS.includes(defaultScene)) throw new Error('默认场景无效');
  if (!isRecord(value.scenes)) throw new Error('光影流转场景缺失');
  const scenes = {};
  for (const id of SCENE_IDS) {
    const item = value.scenes[id];
    if (!isRecord(item)) throw new Error(`${SCENE_LABELS[id]}场景缺失`);
    scenes[id] = { name: sceneName(item.name), filename: sceneFilename(item.filename), scene: readEnvironment(item.scene) };
  }
  return { format: SCENE_CONFIG_FORMAT, version: SCENE_CONFIG_VERSION, defaultScene, scenes };
}

export function makeSceneConfig(scenes, defaultScene = 'morning') {
  return readSceneConfig({ format: SCENE_CONFIG_FORMAT, version: SCENE_CONFIG_VERSION, defaultScene, scenes });
}

async function loadBundledConfig(request) {
  const scenes = {};
  for (const id of SCENE_IDS) {
    const response = await request(new URL('../assets/scenes/' + FILES[id], import.meta.url), { cache: 'no-store' });
    if (!response.ok) throw new Error('无法读取部署内置场景');
    const value = await response.json();
    scenes[id] = { name: sceneName(value?.name), filename: FILES[id], scene: readEnvironment(value?.scene) };
  }
  return makeSceneConfig(scenes);
}

export function createSceneConfigStore({ access, fetch: request = globalThis.fetch, location = globalThis.location, warn = (...args) => console.warn(...args) } = {}) {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location?.hostname);
  async function load() {
    if (local) {
      try {
        const response = await request('./__form_scene_config', { cache: 'no-store' });
        if (response.ok) {
          const value = await response.json();
          if (value) return { ...readSceneConfig(value), source: 'local' };
        }
      } catch {}
    }
    if (!local) {
      try {
        const { client } = await access();
        const { data, error } = await client.from(TABLE).select('config').eq('id', 'site').maybeSingle();
        if (error) throw error;
        if (data?.config) return { ...readSceneConfig(data.config), source: 'cloud' };
      } catch (error) {
        if (!missingSchema(error)) warn('云端光影流转配置暂不可读取，使用部署内置场景', error);
      }
    }
    return { ...(await loadBundledConfig(request)), source: 'file' };
  }
  async function save(ownerId, value) {
    if (value === undefined) { value = ownerId; ownerId = ''; }
    const config = readSceneConfig(value);
    if (local) {
      let response;
      try {
        response = await request('./__form_scene_config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      } catch { throw new Error('无法连接本地服务，请确认服务窗口仍在运行后重试'); }
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.saved !== true) throw new Error('光影流转配置未保存，请通过“启动编辑器”重新打开最新服务');
      return { ...readSceneConfig(result.config || config), source: 'local' };
    }
    const session = await access();
    if (!ownerId || session.userId !== ownerId || !session.canManageSystemConfig) throw new Error('当前账号没有修改光影流转配置的权限，请由管理员操作');
    let result;
    try {
      result = await session.client.from(TABLE).upsert({ id: 'site', config }, { onConflict: 'id' }).select('config').single();
    } catch (error) {
      if (missingSchema(error)) throw new Error('光影流转配置尚未初始化，请先执行 supabase/system-config-admin.sql');
      throw new Error('全站光影流转配置保存失败，请检查网络后重试');
    }
    if (result?.error) {
      if (missingSchema(result.error)) throw new Error('光影流转配置尚未初始化，请先执行 supabase/system-config-admin.sql');
      if (result.error.code === '42501' || [401, 403].includes(result.error.status)) throw new Error('当前账号没有修改光影流转配置的权限，请由管理员操作');
      throw new Error('全站光影流转配置保存失败，请检查网络后重试');
    }
    if (!result?.data?.config) throw new Error('未收到光影流转配置保存确认，请重试');
    return { ...readSceneConfig(result.data.config), source: 'cloud' };
  }
  return { load, save };
}
