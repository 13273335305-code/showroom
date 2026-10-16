import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FABRIC_COLORS } from '../shared/fabric-color-config.js';
import { createFabricColorEditor } from '../shared/fabric-color-editor.js';

test('editing and cancelling a row never publishes changes or modifies other rows', () => {
  const editor = createFabricColorEditor(() => { throw new Error('Unexpected save'); });
  editor.reset(DEFAULT_FABRIC_COLORS);
  assert.equal(editor.begin(0), true); assert.equal(editor.dirty, false);
  assert.equal(editor.begin(1), false); assert.equal(editor.add(), false);
  editor.update('base', '#123456'); editor.update('code', 'ABC');
  assert.equal(editor.dirty, true); assert.equal(editor.editing.value.base, '#123456');
  assert.deepEqual(editor.colors, DEFAULT_FABRIC_COLORS);
  const snapshot = editor.editing; snapshot.value.line = '#000000';
  assert.equal(editor.editing.value.line, '#080808');
  editor.cancel(); assert.equal(editor.editing, null); assert.equal(editor.dirty, false);
  assert.deepEqual(editor.colors, DEFAULT_FABRIC_COLORS);
});

test('a new row disappears on cancel and becomes shared only after confirmed save', async () => {
  const writes = [], editor = createFabricColorEditor(async value => { writes.push(value); return value; });
  editor.reset(DEFAULT_FABRIC_COLORS); editor.add();
  assert.equal(editor.editing.isNew, true); assert.equal(editor.dirty, true);
  assert.equal(editor.colors.length, 8);
  editor.cancel(); assert.equal(editor.colors.length, 8); assert.deepEqual(writes, []);
  editor.add(); editor.update('code', 'abc'); editor.update('base', '#AABBCC');
  const saved = await editor.commit();
  assert.deepEqual(saved.at(-1), { code: 'ABC', base: '#aabbcc', line: '#080808' });
  assert.equal(saved.length, 9); assert.equal(writes.length, 1); assert.equal(editor.editing, null);
  assert.deepEqual(saved.slice(0, 8), DEFAULT_FABRIC_COLORS);
});

test('row save rejects duplicate codes and invalid colors without calling persistence', async () => {
  let writes = 0;
  const editor = createFabricColorEditor(async value => { writes++; return value; });
  editor.reset(DEFAULT_FABRIC_COLORS); editor.begin(1); editor.update('code', 'WBK');
  await assert.rejects(editor.commit(), /重复/);
  editor.update('code', 'WL'); await assert.rejects(editor.commit(), /三个英文字母/);
  editor.update('code', 'ABC'); editor.update('line', '#fff'); await assert.rejects(editor.commit(), /六位 HEX/);
  assert.equal(writes, 0); assert.deepEqual(editor.colors, DEFAULT_FABRIC_COLORS);
  assert.equal(editor.editing.index, 1);
});

test('pending saves cannot be cancelled or changed, and failures retain edits for retry', async () => {
  let complete;
  const editor = createFabricColorEditor(value => new Promise((resolve, reject) => { complete = { resolve: () => resolve(value), reject }; }));
  editor.reset(DEFAULT_FABRIC_COLORS); editor.begin(0); editor.update('line', '#123456');
  const failing = editor.commit(); editor.cancel(); editor.update('line', '#ffffff');
  assert.equal(editor.editing.value.line, '#123456'); assert.equal(editor.begin(1), false);
  await assert.rejects(editor.commit(), /请先选择/);
  complete.reject(new Error('Network unavailable')); await assert.rejects(failing, /Network unavailable/);
  assert.equal(editor.colors[0].line, '#080808'); assert.equal(editor.editing.value.line, '#123456');
  const saving = editor.commit(); complete.resolve(); await saving;
  assert.equal(editor.colors[0].line, '#123456'); assert.equal(editor.editing, null);
  assert.deepEqual(editor.colors.slice(1), DEFAULT_FABRIC_COLORS.slice(1));
});
