import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { groupFabricCards } from '../shared/fabric-card-groups.js';
import { mountPickerFabricColors } from '../shared/picker-fabric-colors.js';
globalThis.ResizeObserver = class { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} };

const source = readFileSync(new URL('../design-workspace.js', import.meta.url), 'utf8');
const renderSource = source.slice(source.indexOf('  function renderPicker()'), source.indexOf('  async function refresh()'));
const confirmSource = source.slice(source.indexOf('  pickerConfirm.onclick = async'), source.indexOf("  $('closeAssetPicker').onclick"));
function element(tagName) {
  return { tagName, ownerDocument: { createElement: element }, clientWidth: 214, children: [], dataset: {}, attributes: {}, style: { setProperty() {} },
    classList: { add() {}, remove() {} }, setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; delete this[key]; },
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; }, addEventListener() {},
    querySelector(selector) { for (const child of this.children) { if (child.className === selector.slice(1)) return child; const found = child.querySelector(selector); if (found) return found; } return null; } };
}
const fabric = (id, code, extra = {}) => ({ id, kind: 'material', materialType: 'fabric', name: '389', category: '面布', fabricColorCode: code, fabricDefaultColorCode: 'WBR', preview: id + '-cover', ...extra });
function fixture(assets, options = {}) {
  const elements = Object.fromEntries(['pickerGrid', 'pickerSearch', 'pickerBack'].map(id => [id, element('div')]));
  elements.pickerSearch.value = options.query || '';
  const added = [], loaded = [], context = { assets, type: options.type || 'fabric', pickerFolderId: options.folder || null,
    pickerCategoryValue: options.category || 'all', pickerSelected: new Map(), pickerAdding: false, pickerAssetsLoading: false, urls: [],
    $: id => elements[id], document: { createElement: element }, groupFabricCards, mountPickerFabricColors, pickerColorCleanups: [],
    pickerLibrary: asset => asset.kind === 'folder' ? asset.library || 'fabric' : asset.materialType || 'fabric',
    pickerFolder: id => assets.find(asset => asset.kind === 'folder' && asset.id === id),
    pickerLoading: { begin() {}, finish() {} }, release() {}, syncPickerCategory() {}, syncPickerSelection() {}, closePickerCategory() {},
    navigatePicker(id) { context.navigated = id; }, assetImageUrl: preview => preview, fitMaterialPreview() {},
    pickerConfirm: {}, dialog: { close() { context.closed = true; } },
    getAsset: async (id, options) => { loaded.push({ id, options }); return { ...assets.find(asset => asset.id === id), full: true }; },
    api: { add: async asset => added.push(asset), notify: message => { throw new Error(message); } } };
  vm.createContext(context); vm.runInContext(renderSource + confirmSource, context); context.renderPicker();
  return { context, cards: elements.pickerGrid.children, added, loaded };
}

test('picker groups variants using the saved default cover and adds the real default asset', async () => {
  const f = fixture([fabric('dark', 'DBW'), fabric('white', 'WBR')]);
  assert.equal(f.cards.length, 1);
  const card = f.cards[0], art = card.children[0], bar = art.children[1];
  assert.equal(card.dataset.assetId, 'white');
  assert.equal(art.children[0].src, 'white-cover');
  const balls = bar.children[0].children;
  assert.equal(balls[0].dataset.default, 'true');
  assert.equal(balls[0].children[0].attributes['aria-label'].startsWith('WBR'), true);
  assert.equal(balls[0].children[0].title, undefined);
  assert.ok(balls.every(item => item.tagName === 'span' && !item.onclick && !item.tabIndex));
  card.onclick();
  assert.equal(f.context.pickerSelected.size, 1);
  assert.equal(card.dataset.assetId, 'white');
  await f.context.pickerConfirm.onclick();
  assert.equal(f.loaded[0].id, 'white'); assert.equal(f.loaded[0].options.runtime, true);
  assert.equal(f.added[0].full, true); assert.deepEqual(Array.from(f.added[0].fabricVariants, item => item.id), ['white', 'dark']);
  assert.ok(f.added[0].fabricVariants.every(item => Object.keys(item).length === 2));
  assert.deepEqual(Array.from(f.added[0].fabricColorCodes), ['WBR', 'DBW']);
  assert.equal(f.context.closed, true);
});

test('overflow count expands all remaining balls without selecting or switching the card', () => {
  const f = fixture(Array.from({ length: 10 }, (_, index) => fabric(String(index), index === 9 ? 'WBR' : 'C' + index)));
  const card = f.cards[0], bar = card.children[0].children[1];
  const row = bar.children[0], extra = bar.children[1], more = row.children.at(-1);
  assert.equal(f.cards.length, 1); assert.equal(row.children.length, 6);
  assert.equal(more.textContent, '+5'); assert.equal(extra.children.length, 5); assert.equal(extra.hidden, true);
  let stopped = false;
  more.onclick({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true); assert.equal(extra.hidden, false);
  assert.equal(more.attributes['aria-expanded'], 'true');
  assert.equal(f.context.pickerSelected.size, 0);
  assert.equal(card.children[0].children[0].src, '9-cover');
  more.onclick({ stopPropagation() {} }); assert.equal(extra.hidden, true);
  f.context.pickerAdding = true; more.onclick({ stopPropagation() {} }); assert.equal(extra.hidden, true);
  f.context.pickerAdding = false;
  assert.equal(card.dataset.assetId, '9');
  card.onclick(); assert.equal(f.context.pickerSelected.get('9').fabricVariants.length, 10);
});

test('folders, categories and pattern cards retain their existing picker behavior', () => {
  const assets = [fabric('1', 'DBW'), fabric('2', 'WBR'), fabric('3', 'WBR', { parentId: 'folder' }),
    fabric('4', 'WBR', { category: '边布' }), { id: 'folder', kind: 'folder', name: '子目录' },
    fabric('p1', 'DBW', { materialType: 'pattern' }), fabric('p2', 'WBR', { materialType: 'pattern' })];
  const root = fixture(assets, { category: '面布' });
  assert.equal(root.cards.length, 2);
  root.cards[1].onclick(); assert.equal(root.context.navigated, 'folder');
  assert.equal(fixture(assets, { folder: 'folder' }).cards[0].dataset.assetId, '3');
  assert.equal(fixture(assets, { query: 'missing' }).cards.length, 0);
  const patterns = fixture(assets, { type: 'pattern' });
  assert.equal(patterns.cards.length, 2);
  assert.ok(patterns.cards.every(card => card.children[0].children.length === 1));
});

test('overflow adapts to resizing and releases its observer when the picker closes', () => {
  const OriginalObserver = globalThis.ResizeObserver;
  let observer, disconnected = false;
  globalThis.ResizeObserver = class { constructor(callback) { observer = callback; } observe() {} disconnect() { disconnected = true; } };
  try {
    const bar = element('div'); bar.clientWidth = 214;
    const asset = groupFabricCards(Array.from({ length: 8 }, (_, i) => fabric(String(i), i === 0 ? 'WBR' : 'C' + i)))[0];
    const cleanup = mountPickerFabricColors(bar, asset);
    assert.equal(bar.children[0].children.at(-1).textContent, '+3');
    bar.clientWidth = 150; observer();
    assert.equal(bar.children[0].children.length, 4);
    assert.equal(bar.children[0].children.at(-1).textContent, '+5');
    bar.clientWidth = 300; observer();
    assert.equal(bar.children.length, 1);
    assert.equal(bar.children[0].children.length, 8);
    cleanup(); assert.equal(disconnected, true);
  } finally { globalThis.ResizeObserver = OriginalObserver; }
});
