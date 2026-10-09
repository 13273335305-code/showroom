import { MATERIAL_MAPS } from './material-map-definitions.js';
import { compressImageFile } from './asset-thumbnail.js';

const channels = new Set(MATERIAL_MAPS.map(([key]) => key));
const runtimeConfigs = new Map(), runtimeFiles = new Map();
function webUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('项目资源地址无效');
  return url;
}
function localResource(value) {
  const hostname = webUrl(value).hostname;
  return /^(localhost|127\.|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
}
export function validateProjectManifest(config) {
  if (config?.format !== 'SPENIC-PROJECT' || config.version !== 1 || !config.files || typeof config.files !== 'object' || Array.isArray(config.files) || !config.modelPath) throw new Error('项目清单格式无效');
  const files = Object.entries(config.files);
  if (files.length > 3000 || JSON.stringify(config).length > 4 * 1024 * 1024) throw new Error('项目清单过大');
  for (const [key, reference] of files) {
    if (!key || !reference || typeof reference.name !== 'string') throw new Error('项目资源引用无效');
    if (reference.kind === 'cloud') {
      if (!/^[a-f0-9]{64}$/.test(reference.hash) || !/^[a-f0-9-]{36}\/[a-f0-9]{64}$/.test(reference.path) || reference.path.split('/')[1] !== reference.hash || !Number.isSafeInteger(reference.size) || reference.size <= 0 || reference.size > 512 * 1024 * 1024) throw new Error('云端资源引用无效');
    } else if (reference.kind === 'runtime') {
      const source = reference.reference;
      if (!source || !channels.has(source.key) || !/^[a-f0-9]{64}$/.test(source.version)) throw new Error('运行材质引用无效');
      webUrl(source.runtimeUrl); webUrl(source.url);
    } else throw new Error('不支持的项目资源引用');
  }
  const requireFile = path => { if (!Object.hasOwn(config.files, path)) throw new Error('项目清单缺少资源：' + path); };
  requireFile(config.modelPath);
  if (config.files[config.modelPath].kind !== 'cloud') throw new Error('项目模型引用无效');
  for (const resource of config.resources || []) requireFile(resource.path);
  for (const entry of config.materials || []) for (const map of Object.values(entry.maps || {})) if (map?.path) requireFile(map.path);
  for (const pattern of config.patterns || []) {
    requireFile(pattern.path);
    for (const map of Object.values(pattern.pbr?.maps || {})) requireFile(map.path);
  }
  for (const source of config.patternSources || []) {
    if (!source.asset?.maps?.map) throw new Error('项目图案素材无效');
    for (const map of Object.values(source.asset.maps)) requireFile(map.path);
    if (source.asset.preview?.path) requireFile(source.asset.preview.path);
  }
  return config;
}
export async function createProjectResource(file, reference, upload) {
  if (reference?.runtimeUrl) {
    if (localResource(reference.runtimeUrl)) return { ...await upload(await compressImageFile(file, 2048)), prepared: true };
    return { kind: 'runtime', reference: { ...reference }, name: file.name, type: file.type, prepared: true };
  }
  return upload(file);
}
export async function createProjectPreview(preview, upload) {
  if (typeof preview === 'string') {
    if (!preview.startsWith('blob:') && !localResource(preview)) return { url: webUrl(preview).href };
    preview = await fetchResource(preview, async response => {
      if (Number(response.headers.get('content-length')) > 16 * 1024 * 1024) throw new Error('预览图超过 16 MB');
      const blob = await response.blob(); if (!blob.size || blob.size > 16 * 1024 * 1024) throw new Error('预览图大小无效'); return blob;
    });
  }
  return preview instanceof Blob ? { file: await upload(preview) } : null;
}
async function fetchResource(url, read) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error('项目资源下载失败：HTTP ' + response.status);
    return await read(response);
  } finally { clearTimeout(timer); }
}
export async function resolveProjectResource(descriptor, download) {
  if (descriptor.kind === 'cloud') return download(descriptor);
  const source = descriptor.reference, configKey = source.runtimeUrl + '\n' + source.version;
  if (!runtimeConfigs.has(configKey)) runtimeConfigs.set(configKey, fetchResource(webUrl(source.runtimeUrl), async response => {
    const text = await response.text(); if (text.length > 1024 * 1024) throw new Error('运行材质配置过大');
    const data = JSON.parse(text);
    if (data.format !== 'SPENIC-MATERIAL-RUNTIME' || data.version !== 1 || data.sourceVersion !== source.version) throw new Error('项目材质版本不一致');
    return data;
  }).catch(error => { runtimeConfigs.delete(configKey); throw error; }));
  const data = await runtimeConfigs.get(configKey), map = data.maps?.[source.key];
  if (!map?.url || !/^image\/(png|jpeg|webp|bmp)$/.test(map.type)) throw new Error('项目缺少运行贴图：' + source.key);
  const url = webUrl(new URL(map.url, source.runtimeUrl).href), key = url.href;
  if (!runtimeFiles.has(key)) runtimeFiles.set(key, fetchResource(url, async response => {
    if (Number(response.headers.get('content-length')) > 64 * 1024 * 1024) throw new Error('运行贴图超过 64 MB');
    const blob = await response.blob();
    if (!blob.size || blob.size > 64 * 1024 * 1024) throw new Error('运行贴图大小无效');
    const file = new File([blob], map.name || descriptor.name, { type: map.type });
    return map.prepared === true ? file : compressImageFile(file, 2048);
  }).catch(error => { runtimeFiles.delete(key); throw error; }));
  return runtimeFiles.get(key);
}
