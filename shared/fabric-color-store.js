import { DEFAULT_FABRIC_COLORS, createFabricColorStore } from './fabric-color-config.js';

let colors = DEFAULT_FABRIC_COLORS.map(item => ({ ...item }));
let pending = null, generation = 0;
const listeners = new Set();
const store = createFabricColorStore({ access: async () => (await import('./auth.js')).workspaceClient() });
const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('spenic-fabric-colors') : null;

export const fabricColors = () => colors.map(item => ({ ...item }));
export const fabricColor = code => colors.find(item => item.code === code);
export function subscribeFabricColors(listener) { listeners.add(listener); return () => listeners.delete(listener); }
function apply(value) { colors = value; listeners.forEach(listener => listener()); return fabricColors(); }
export function refreshFabricColors({ force = false } = {}) {
  if (!pending || force) {
    const started = ++generation;
    const request = store.load().then(value => started === generation ? apply(value) : fabricColors()).finally(() => { if (pending === request) pending = null; });
    pending = request;
  }
  return pending;
}
export async function saveFabricColors(value) {
  const result = await store.save(value);
  generation++;
  apply(result);
  channel?.postMessage('saved');
  return fabricColors();
}
if (typeof window !== 'undefined') {
  const refresh = () => { refreshFabricColors().catch(() => {}); };
  channel?.addEventListener('message', () => { refreshFabricColors({ force: true }).catch(() => {}); });
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  refresh();
}
