export const LEGACY_FABRIC_CATEGORY = '包边条';
export const FABRIC_CATEGORIES = ['面布', '边布', '辅料', '其他'];
export const FABRIC_PART_TYPES = ['面布', '边布', '辅料'];

/**
 * Keep assets created before the category rename readable while all newly
 * saved data uses the current label.
 */
export function normalizeFabricCategory(value, fallback = '面布') {
  const category = typeof value === 'string' ? value.trim() : '';
  if (category === LEGACY_FABRIC_CATEGORY) return '辅料';
  return FABRIC_CATEGORIES.includes(category) ? category : fallback;
}

export function normalizePartType(value) {
  return value === LEGACY_FABRIC_CATEGORY ? '辅料' : value;
}

export function normalizePartAssignments(assignments) {
  if (!assignments || typeof assignments !== 'object') return assignments;
  const normalized = {};
  for (const [key, value] of Object.entries(assignments)) {
    if (Array.isArray(value)) normalized[key] = value.map(normalizePartType);
    else if (typeof value === 'string') normalized[key] = normalizePartType(value);
    else if (value && typeof value === 'object' && Array.isArray(value.types)) normalized[key] = { ...value, types: value.types.map(normalizePartType) };
    else normalized[key] = value;
  }
  return normalized;
}

export function normalizeAssetCategories(asset) {
  if (!asset || typeof asset !== 'object') return asset;
  const normalized = { ...asset };
  if (asset.kind === 'material' && asset.materialType !== 'pattern') normalized.category = normalizeFabricCategory(asset.category, asset.category === '其他' ? '其他' : '面布');
  if (asset.partAssignments) normalized.partAssignments = normalizePartAssignments(asset.partAssignments);
  return normalized;
}
