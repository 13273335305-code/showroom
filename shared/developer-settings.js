import { readEnvironment, sceneName } from './scene-file.js';

export const DEVELOPER_STORAGE_KEY = 'spenic.developer-settings.v1';
export const PHASE_IDS = ['morning', 'evening', 'night'];
export const DEFAULT_TIMING = Object.freeze({ transition: 5000, hold: 3000 });
// `framing` keeps older configurations useful while `distance` and `offset`
// preserve the exact composition captured from OrbitControls.  The offset is
// the translation of the controls target from the model's fitted center.
export const DEFAULT_VIEW = Object.freeze({ azimuth: 40, elevation: 26, framing: 1.18, distance: null, offset: Object.freeze([0, 0, 0]) });
export const DEFAULT_SHOWROOM_SCALE = 1;
export function readDefaultView(value = DEFAULT_VIEW) {
  if (!value || !Number.isFinite(value.azimuth) || value.azimuth < -180 || value.azimuth > 180 ||
      !Number.isFinite(value.elevation) || value.elevation < 0 || value.elevation > 89 ||
      !Number.isFinite(value.framing) || value.framing < .5 || value.framing > 3) throw new Error('默认视角参数超出范围');
  const distance = value.distance == null ? null : value.distance;
  if (distance !== null && (!Number.isFinite(distance) || distance <= 0 || distance > 1000)) throw new Error('默认视角距离超出范围');
  const offset = value.offset === undefined ? DEFAULT_VIEW.offset : value.offset;
  if (!Array.isArray(offset) || offset.length !== 3 || !offset.every(Number.isFinite) || offset.some(v => Math.abs(v) > 1000)) throw new Error('默认视角平移偏移超出范围');
  return { azimuth: value.azimuth, elevation: value.elevation, framing: value.framing, distance, offset: [...offset] };
}
export function readShowroomScale(value = DEFAULT_SHOWROOM_SCALE) {
  if (!Number.isFinite(value) || value < .5 || value > 2) throw new Error('展台大小比例需为 0.5–2');
  return value;
}
export function readTiming(value) {
  if (!value || !Number.isFinite(value.transition) || value.transition < 100 || value.transition > 120000 ||
      !Number.isFinite(value.hold) || value.hold < 0 || value.hold > 600000) throw new Error('过渡时间需为 0.1–120 秒，停留时间需为 0–600 秒');
  return { transition: value.transition, hold: value.hold };
}
export function readDeveloperSettings(value) {
  if (!value || value.format !== 'SPENIC-DEVELOPER' || value.version !== 1 || !value.presets || Array.isArray(value.presets)) throw new Error('不是有效的开发者配置文件');
  const presets = {};
  for (const id of PHASE_IDS) if (Object.hasOwn(value.presets, id)) {
    presets[id] = { name: sceneName(value.presets[id]?.name), scene: readEnvironment(value.presets[id]?.scene) };
  }
  return { format: 'SPENIC-DEVELOPER', version: 1, presets, timing: readTiming(value.timing), defaultView: readDefaultView(value.defaultView || DEFAULT_VIEW), showroomScale: readShowroomScale(value.showroomScale ?? DEFAULT_SHOWROOM_SCALE) };
}
export function defaultDeveloperSettings() {
  return { format: 'SPENIC-DEVELOPER', version: 1, presets: {}, timing: { ...DEFAULT_TIMING }, defaultView: readDefaultView(), showroomScale: DEFAULT_SHOWROOM_SCALE };
}
export function loadDeveloperSettings(storage) {
  const raw = storage.getItem(DEVELOPER_STORAGE_KEY);
  return raw ? readDeveloperSettings(JSON.parse(raw)) : defaultDeveloperSettings();
}
export function saveDeveloperSettings(storage, value) {
  const checked = readDeveloperSettings(value);
  storage.setItem(DEVELOPER_STORAGE_KEY, JSON.stringify(checked));
  return checked;
}
