export const DEFAULT_FABRIC_COLORS = Object.freeze([
  { code: 'WBK', base: '#f6f6f6', line: '#080808' },
  { code: 'WLG', base: '#f6f6f6', line: '#989898' },
  { code: 'WBR', base: '#f6f6f6', line: '#4e4124' },
  { code: 'WWW', base: '#f6f6f6', line: '#ededed' },
  { code: 'ZGW', base: '#4a4f55', line: '#f6f6f6' },
  { code: 'DBW', base: '#4e4124', line: '#f6f6f6' },
  { code: 'GWW', base: '#8c8c8c', line: '#f6f6f6' },
  { code: 'KGW', base: '#bdb285', line: '#f6f6f6' },
].map(Object.freeze));

export function readFabricColors(value) {
  if (!Array.isArray(value) || !value.length || value.length > 500) throw new Error('请配置 1–500 个色号球');
  const codes = new Set();
  return value.map((item, index) => {
    const code = String(item?.code ?? '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) throw new Error(`第 ${index + 1} 行的色号须为三个英文字母`);
    if (codes.has(code)) throw new Error(`色号 ${code} 重复，请使用不同的三个字母`);
    codes.add(code);
    if (![item.base, item.line].every(color => typeof color === 'string' && /^#[\da-f]{6}$/i.test(color))) {
      throw new Error(`色号 ${code} 的底色和线色须为六位 HEX 色号，例如 #F6F6F6`);
    }
    return { code, base: item.base.toLowerCase(), line: item.line.toLowerCase() };
  });
}

export function createFabricColorStore({ access, fetch: request = globalThis.fetch, location = globalThis.location } = {}) {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location?.hostname);
  const table = 'spenic_fabric_colors';
  async function load() {
    if (!local) {
      const { client } = await access();
      const { data, error } = await client.from(table).select('colors').eq('id', 'site').maybeSingle();
      if (error && !['42P01', 'PGRST205'].includes(error.code)) throw new Error('全站色号配置读取失败，请检查网络后重试');
      if (data) return readFabricColors(data.colors);
    }
    const response = await request('./fabric-colors.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('色号配置文件读取失败，请重试');
    return readFabricColors(await response.json());
  }
  async function save(value) {
    const colors = readFabricColors(value);
    if (local) {
      const response = await request('./__form_fabric_colors', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(colors),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.saved !== true) throw new Error('色号配置未保存，请重新启动最新版本地服务后重试');
      return colors;
    }
    const { client } = await access();
    const { data, error } = await client.from(table).upsert({ id: 'site', colors }, { onConflict: 'id' }).select('colors').single();
    if (error) {
      if (['42P01', 'PGRST205'].includes(error.code)) throw new Error('全站色号配置尚未初始化，请先执行 supabase/fabric-colors.sql');
      if (error.code === '42501' || [401, 403].includes(error.status)) throw new Error('当前账号没有修改全站配置的权限，请由管理员授权');
      throw new Error('全站色号配置保存失败，请检查网络后重试');
    }
    if (!data) throw new Error('未收到保存确认，请重试');
    return readFabricColors(data.colors);
  }
  return { load, save };
}
