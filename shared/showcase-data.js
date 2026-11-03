// Pure helpers shared by the browser, server and regression tests.
export function annotationId(annotation, index = 0) {
  return annotation.id || `legacy:${annotation.host}:${(annotation.point || []).join(',')}:${index}`;
}
export function projectModelHash(manifest) { return manifest?.files?.[manifest.modelPath]?.hash || ''; }
export function applyShowcaseConfig(manifest, config = {}) {
  const result = structuredClone(manifest);
  if (config.scene) result.scene = { ...result.scene, ...config.scene };
  if (config.camera) result.camera = structuredClone(config.camera);
  const sameModel = !config.modelHash || config.modelHash === projectModelHash(manifest);
  const changes = sameModel ? config.annotations || {} : {};
  result.annotations = (result.annotations || []).map((a, i) => ({ ...a, id: annotationId(a, i) }))
    .filter(a => changes[a.id] !== null).map(a => ({ ...a, ...(changes[a.id] || {}) }));
  for (const [id, a] of Object.entries(changes)) if (a && !result.annotations.some(item => item.id === id)) result.annotations.push({ ...a, id });
  return result;
}
export function annotationChanges(base, current) {
  const originals = new Map((base || []).map((a, i) => [annotationId(a, i), { ...a, id: annotationId(a, i) }]));
  const now = new Map(current.map(a => [a.id, a])), result = {};
  for (const id of originals.keys()) if (!now.has(id)) result[id] = null;
  for (const [id, a] of now) {
    const old = originals.get(id);
    if (!old || old.host !== a.host || old.text !== a.text || JSON.stringify(old.point) !== JSON.stringify(a.point)) result[id] = a;
  }
  return result;
}
export function updatePresentationConfig(base, loaded, current, previous = {}) {
  const result = structuredClone(previous);
  const scene = { ...result.scene };
  for (const [key, value] of Object.entries(current.scene)) if (value !== loaded.scene[key]) {
    if (value === base.scene?.[key]) delete scene[key]; else scene[key] = value;
  }
  if (Object.keys(scene).length) result.scene = scene; else delete result.scene;
  if (JSON.stringify(loaded.camera) !== JSON.stringify(current.camera)) result.camera = current.camera;
  if (JSON.stringify(loaded.annotations) !== JSON.stringify(current.annotations)) {
    result.annotations = annotationChanges(base.annotations, current.annotations); result.modelHash = projectModelHash(base);
  }
  return result;
}
export function validateComment(input) {
  const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
  if (!uuid.test(input?.projectId || '') || !uuid.test(input?.requestId || '')) throw new Error('留言所属项目无效');
  const authorName = String(input.authorName || '').trim(), body = String(input.body || '').trim();
  if (!authorName || authorName.length > 40) throw new Error('请输入 1–40 字的称呼');
  if (!body || body.length > 300) throw new Error('请输入 1–300 字的留言');
  if (!/^[a-f\d]{64}$/.test(input.modelHash || '') || !Number.isInteger(input.host) || input.host < 0 || input.host > 100000
    || !Array.isArray(input.point) || input.point.length !== 3 || input.point.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e12)) throw new Error('留言位置无效，请重新点选模型');
  return { projectId: input.projectId, requestId: input.requestId, authorName, body, modelHash: input.modelHash, host: input.host, point: input.point };
}
export function commentRecord(row) {
  return { id: row.id, projectId: row.project_id, authorName: row.author_name, body: row.body, modelHash: row.model_hash,
    host: row.host, point: row.point, createdAt: row.created_at };
}
