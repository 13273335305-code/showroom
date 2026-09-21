// Keep reusable environments independent of model, material and camera state.
export const ENVIRONMENT_DEFAULTS = Object.freeze({
  preset: 'studio', backgroundColor: '#e8edf2', exposure: 1.1, environment: .7,
  keyLight: 3, lightAngle: 45, lightColor: '#fff4e6', fillLight: 1.5,
  shadows: true, reflection: true, floorVisible: true, grid: false
});
const ranges = { exposure: [.2, 2.5], environment: [0, 3], keyLight: [0, 8], lightAngle: [-180, 180], fillLight: [0, 5] };
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function readEnvironment(value) {
  if (!isRecord(value)) throw new Error('场景设置缺失或无效');
  const scene = {};
  for (const [key, fallback] of Object.entries(ENVIRONMENT_DEFAULTS)) {
    const item = value[key];
    let valid = typeof item === typeof fallback;
    if (ranges[key]) valid = valid && Number.isFinite(item) && item >= ranges[key][0] && item <= ranges[key][1];
    if (key === 'preset') valid = ['studio', 'daylight', 'night'].includes(item);
    if (key === 'backgroundColor' || key === 'lightColor') valid = valid && /^#[\da-f]{6}$/i.test(item);
    if (!valid) throw new Error('场景参数无效：' + key);
    scene[key] = item;
  }
  return scene;
}

export function sceneName(value) {
  return (typeof value === 'string' ? value.trim().slice(0, 80) : '') || '未命名场景';
}

export function sceneFilename(name) {
  return sceneName(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '') + '.formscene';
}

export function packScene(state, name) {
  return new Blob([JSON.stringify({ format: 'SPENIC-SCENE', version: 1, name: sceneName(name), scene: readEnvironment(state) }, null, 2)], { type: 'application/json' });
}

export async function unpackScene(file) {
  if (file.size > 1024 * 1024) throw new Error('场景文件不能超过 1 MB');
  let data;
  try { data = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); }
  catch { throw new Error('文件不是有效的场景 JSON'); }
  if (!isRecord(data) || data.format !== 'SPENIC-SCENE') throw new Error('请选择 .formscene 场景文件');
  if (data.version !== 1) throw new Error('不支持此场景文件版本');
  return { name: sceneName(data.name), scene: readEnvironment(data.scene) };
}
