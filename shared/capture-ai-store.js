export const CAPTURE_AI_DEFAULT_BASE = 'http://64.186.244.43:12001';
import { createCaptureAiPromptStore } from './capture-ai-prompts.js';
export { CAPTURE_AI_PROMPT_DEFAULTS, readCaptureAiPrompts, createCaptureAiPromptStore } from './capture-ai-prompts.js';

export const CAPTURE_AI_DEFAULTS = Object.freeze({ apiKey: '', model: 'gemini-3.1-flash-image-preview', aspect: 'AUTO', size: '1K' });
const SITE = 'spenic_capture_ai_site', ACCOUNTS = 'spenic_capture_ai_accounts';
const missingSchema = error => ['42P01', 'PGRST202', 'PGRST205'].includes(error?.code);

function failure(error, action) {
  if (missingSchema(error)) return new Error('AI 云端配置尚未初始化，请先执行 supabase/capture-ai.sql');
  if (error?.code === '42501' || [401, 403].includes(error?.status)) return new Error(action === 'site' ? '只有系统配置管理员或授权的开发者账号可以修改全站 API 地址' : '无权访问此账号的 AI 配置，请重新登录');
  return new Error('AI 配置读取或保存失败，请检查网络后重试');
}
export function validateCaptureAiBase(value) {
  const base = String(value || '').trim().replace(/\/+$/, '');
  let url; try { url = new URL(base); } catch { throw new Error('请填写完整的 API 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API 地址须使用 HTTP 或 HTTPS，且不包含 Key、查询参数或账号密码');
  return base;
}
function accountConfig(value = {}) {
  return Object.fromEntries(Object.entries(CAPTURE_AI_DEFAULTS).map(([key, fallback]) => [key, typeof value[key] === 'string' ? value[key] : fallback]));
}
export function createCaptureAiStore({ access }) {
  const promptStore = createCaptureAiPromptStore({ access });
  async function assertAccount(ownerId) {
    const session = await access();
    if (!ownerId || session.userId !== ownerId) throw new Error('账号已切换，请重新打开 AI 配置');
    return session;
  }
  async function query(run, action) {
    let result;
    try { result = await run(); } catch { throw failure(null, action); }
    if (result.error) throw failure(result.error, action);
    return result.data;
  }
  async function loadSite(ownerId) {
    const { client } = await assertAccount(ownerId);
    const row = await query(() => client.from(SITE).select('base').eq('id', 'site').single(), 'read');
    await assertAccount(ownerId);
    if (!row) throw new Error('全站 API 地址尚未配置');
    return validateCaptureAiBase(row.base);
  }
  async function load() {
    const { client, userId, canManageSite = false } = await access();
    const [base, row] = await Promise.all([
      loadSite(userId),
      query(() => client.from(ACCOUNTS).select('api_key,preferences').eq('owner_id', userId).maybeSingle(), 'read'),
    ]);
    await assertAccount(userId);
    return { ownerId: userId, canManageSite, base, ...accountConfig(row ? { ...row.preferences, apiKey: row.api_key } : {}) };
  }
  async function saveAccount(ownerId, value) {
    const { client } = await assertAccount(ownerId);
    const { apiKey, ...preferences } = accountConfig(value);
    const row = await query(() => client.from(ACCOUNTS).upsert({ owner_id: ownerId, api_key: apiKey.trim(), preferences }, { onConflict: 'owner_id' }).select('owner_id').single(), 'account');
    await assertAccount(ownerId);
    if (row?.owner_id !== ownerId) throw new Error('未收到当前账号的配置保存确认，请重试');
  }
  async function saveSite(ownerId, value) {
    const base = validateCaptureAiBase(value), { client } = await assertAccount(ownerId);
    const row = await query(() => client.from(SITE).upsert({ id: 'site', base }, { onConflict: 'id' }).select('base').single(), 'site');
    await assertAccount(ownerId);
    if (row?.base !== base) throw new Error('未收到全站 API 地址的保存确认，请重试');
    return base;
  }
  return { load, loadSite, saveAccount, saveSite, loadPrompts: promptStore.load, savePrompts: promptStore.save, assertAccount };
}
