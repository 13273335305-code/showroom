export const CAPTURE_AI_MODEL = '「Rim」gemini-3.1-flash-image-preview';
export const CAPTURE_AI_REQUEST_LIMIT = 4 * 1024 * 1024;

export function captureAiModelId(value) {
  // Migrate the two shortened IDs shipped by the old UI; preserve custom routes.
  const model = String(value || '').trim();
  if (model === 'gemini-3.1-flash-image-preview') return CAPTURE_AI_MODEL;
  if (model === 'gemini-3-pro-image') return '「Rim」gemini-3-pro-image-preview';
  return model || CAPTURE_AI_MODEL;
}

export function buildCaptureAiUrl(base, model) {
  const root = String(base || '').trim().replace(/\/+$/, '');
  const name = String(model || '').trim().replace(/^.*\/models\//, '').replace(/^(?:models\/|v1beta\/)/, '');
  if (!root) throw new Error('请填写 API 地址');
  if (!name || name.length > 200 || /[/?#\r\n]/.test(name)) throw new Error('AI 模型名称无效');
  if (root.includes('{{model}}')) return root.replace('{{model}}', encodeURIComponent(name));
  if (root.includes(':generate')) return root;
  if (root.includes('/models/')) return root + ':generateContent';
  return `${root}/v1beta/models/${encodeURIComponent(name)}:generateContent`;
}

export function captureAiHttpError(status) {
  if ([401, 403].includes(status)) return `绘图接口鉴权失败（HTTP ${status}），请检查当前账号的 API Key 和模型权限`;
  if (status === 404) return '绘图接口或模型不存在（HTTP 404），请核对 API 地址和完整模型名称';
  if (status === 429) return '绘图接口请求过多或额度不足（HTTP 429），请稍后重试或检查额度';
  return `绘图接口返回错误（HTTP ${status}），请稍后重试或检查模型配置`;
}
