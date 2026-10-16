const TABLE = 'spenic_default_camera_views';
const PAGES = Object.freeze({
  design: { file: 'design-default-view.json', endpoint: '__form_design_view' },
  parts: { file: 'parts-default-view.json', endpoint: '__form_parts_view' },
});
const missingSchema = error => ['42P01', 'PGRST202', 'PGRST205'].includes(error?.code);

export function createDefaultCameraStore({ access, validate, fetch: request = globalThis.fetch, location = globalThis.location, warn = (...args) => console.warn(...args) }) {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location?.hostname);
  const pageConfig = page => {
    if (!Object.hasOwn(PAGES, page)) throw new Error('不支持的默认视角页面');
    return PAGES[page];
  };
  async function load(page) {
    const { file } = pageConfig(page);
    if (!local) {
      try {
        const { client } = await access();
        const { data, error } = await client.from(TABLE).select('config').eq('page', page).maybeSingle();
        if (error) throw error;
        if (data) return { view: validate(data.config), source: 'cloud' };
      } catch (error) {
        // A new deployment remains usable before the optional cloud schema is installed.
        if (!missingSchema(error)) warn('云端默认视角暂不可读取，使用发布配置', error);
      }
    }
    const response = await request('./' + file, { cache: 'no-store' });
    if (!response.ok) throw new Error('默认视角配置文件不可读取');
    const value = await response.json();
    return value ? { view: validate(value), source: 'file' } : null;
  }
  async function save(page, value) {
    const { endpoint } = pageConfig(page);
    const view = validate(value), config = { ...value, view };
    if (local) {
      const response = await request('./' + endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.saved !== true) throw new Error('本地文件未能保存，请确认已启动最新版本地服务');
      return { view, source: 'file' };
    }
    const { client } = await access();
    const { data, error } = await client.from(TABLE).upsert({ page, config }, { onConflict: 'page' }).select('config').single();
    if (error) {
      if (missingSchema(error)) throw new Error('全站默认视角尚未初始化，请先执行 supabase/default-camera.sql 并授权开发者账号');
      if (error.code === '42501' || [401, 403].includes(error.status)) throw new Error('当前账号没有保存全站默认视角的权限，请由管理员授权开发者账号');
      throw new Error('全站默认视角保存失败，请检查网络后重试');
    }
    if (!data) throw new Error('未收到全站默认视角的保存确认，请重试');
    return { view: validate(data.config), source: 'cloud' };
  }
  return { load, save };
}
