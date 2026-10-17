export const CAPTURE_AI_PROMPT_DEFAULTS = Object.freeze([
  Object.freeze({ label: '极简摄影棚', prompt: '将这个产品放在极简摄影棚中，柔和侧光，高级电商产品图' }),
  Object.freeze({ label: '自然生活场景', prompt: '将这个产品融入自然、克制的生活方式场景，光线柔和，画面高级且真实' }),
  Object.freeze({ label: '材质细节特写', prompt: '突出这个产品的材质、纹理和工艺细节，使用干净的近距离产品摄影构图' }),
]);

const TABLE = 'spenic_capture_ai_prompts';
const missingSchema = error => ['42P01', 'PGRST202', 'PGRST205'].includes(error?.code);

export function readCaptureAiPrompts(value) {
  if (!Array.isArray(value) || value.length > 5) throw new Error('快捷提示词须为列表，最多 5 条');
  return value.map((item, index) => {
    const label = String(item?.label ?? '').trim();
    const prompt = String(item?.prompt ?? '').trim();
    if (!label || label.length > 80) throw new Error(`第 ${index + 1} 条快捷提示词名称须为 1–80 个字符`);
    if (!prompt || prompt.length > 2000) throw new Error(`第 ${index + 1} 条具体提示词须为 1–2000 个字符`);
    return { label, prompt };
  });
}

function failure(error, action) {
  if (missingSchema(error)) return new Error('AI 绘画配置尚未初始化，请先执行 supabase/capture-ai.sql');
  if (error?.code === '42501' || [401, 403].includes(error?.status)) {
    return new Error(action === 'save' ? '当前账号没有修改 AI 绘画配置的权限，请由管理员授权' : '无权读取 AI 绘画配置');
  }
  return new Error(action === 'save' ? 'AI 绘画配置保存失败，请检查网络后重试' : 'AI 绘画配置读取失败，请检查网络后重试');
}

export function createCaptureAiPromptStore({ access }) {
  async function assertAccount(ownerId) {
    const session = await access();
    if (!ownerId || session.userId !== ownerId) throw new Error('账号已切换，请重新打开 AI 绘画配置');
    return session;
  }
  async function load() {
    let session;
    try { session = await access(); } catch (error) { throw failure(error, 'read'); }
    let result;
    try { result = await session.client.from(TABLE).select('prompts').eq('id', 'site').maybeSingle(); }
    catch (error) { throw failure(error, 'read'); }
    if (result?.error) {
      if (missingSchema(result.error)) return CAPTURE_AI_PROMPT_DEFAULTS.map(item => ({ ...item }));
      throw failure(result.error, 'read');
    }
    if (!result.data?.prompts) return CAPTURE_AI_PROMPT_DEFAULTS.map(item => ({ ...item }));
    return readCaptureAiPrompts(result.data.prompts);
  }
  async function save(ownerId, value) {
    const prompts = readCaptureAiPrompts(value);
    const { client } = await assertAccount(ownerId);
    let result;
    try {
      result = await client.from(TABLE).upsert({ id: 'site', prompts }, { onConflict: 'id' }).select('prompts').single();
    } catch (error) { throw failure(error, 'save'); }
    if (result?.error) throw failure(result.error, 'save');
    await assertAccount(ownerId);
    if (!result?.data?.prompts) throw new Error('未收到 AI 绘画配置保存确认，请重试');
    return readCaptureAiPrompts(result.data.prompts);
  }
  return { load, save };
}
