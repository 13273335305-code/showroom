export const materialType = asset => asset?.materialType === 'pattern' ? 'pattern' : 'fabric';
export const ASSET_PAGE_SIZE = 30;
export function assetPage(items, requestedPage, pageSize = ASSET_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(totalPages, Math.max(1, Math.floor(requestedPage) || 1));
  return { page, totalPages, total: items.length, items: items.slice((page - 1) * pageSize, page * pageSize) };
}
