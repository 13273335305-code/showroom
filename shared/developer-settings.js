import { readEnvironment, sceneName } from './scene-file.js';

export const DEVELOPER_STORAGE_KEY = 'spenic.developer-settings.v1';
export const PHASE_IDS = ['morning', 'evening', 'night'];
export const DEFAULT_TIMING = Object.freeze({ transition: 5000, hold: 3000 });
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
  return { format: 'SPENIC-DEVELOPER', version: 1, presets, timing: readTiming(value.timing) };
}
export function defaultDeveloperSettings() {
  return { format: 'SPENIC-DEVELOPER', version: 1, presets: {}, timing: { ...DEFAULT_TIMING } };
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
