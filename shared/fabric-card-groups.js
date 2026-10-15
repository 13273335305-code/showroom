// Keep each color asset intact; grouping only changes the library presentation.
export function groupFabricCards(assets, selectedColors = new Map()) {
  const groups = new Map(), cards = [];
  for (const asset of assets) {
    if (asset.kind !== 'material' || asset.materialType === 'pattern' || !asset.fabricColorCode?.trim()
      || (!asset.fabricGroupId && !/^\d+$/.test(asset.name?.trim()))) {
      cards.push(asset); continue;
    }
    const key = JSON.stringify([asset.ownerId, asset.parentId || null, asset.category, asset.name.trim(), asset.fabricGroupId || 'legacy']);
    let group = groups.get(key);
    if (!group) {
      group = { key, variants: [] }; groups.set(key, group); cards.push(group);
    }
    group.variants.push(asset);
  }
  return cards.map(card => {
    if (!card.variants) return card;
    const variants = card.variants.sort((a, b) => a.fabricColorCode.localeCompare(b.fabricColorCode, 'en', { numeric: true }) || a.id.localeCompare(b.id));
    const defaultCode = variants.find(asset => asset.fabricDefaultColorCode)?.fabricDefaultColorCode?.trim().toUpperCase();
    const defaultIndex = variants.findIndex(asset => asset.fabricColorCode.trim().toUpperCase() === defaultCode);
    if (defaultIndex > 0) variants.unshift(...variants.splice(defaultIndex, 1));
    const active = variants.find(asset => asset.id === selectedColors.get(card.key))
      || variants.find(asset => asset.fabricColorCode.trim().toUpperCase() === defaultCode) || variants[0];
    return { ...active, fabricCardKey: card.key, fabricVariants: variants,
      updatedAt: Math.max(...variants.map(asset => asset.updatedAt || 0)) };
  });
}
