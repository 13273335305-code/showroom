import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupFabricCards } from '../shared/fabric-card-groups.js';

const fabric = (id, code, extra = {}) => ({ id, kind: 'material', materialType: 'fabric', name: '389', category: '面布', ownerId: 'alice', fabricColorCode: code, updatedAt: Number(id) || 1, ...extra });
test('color variants share one card, keep their assets and switch the active color', () => {
  const input = [fabric('1', 'WBR'), fabric('2', 'DBW')];
  const [card] = groupFabricCards(input);
  assert.equal(groupFabricCards(input).length, 1);
  assert.deepEqual(card.fabricVariants.map(asset => asset.fabricColorCode), ['DBW', 'WBR']);
  assert.equal(card.id, '2');
  const [selected] = groupFabricCards(input, new Map([[card.fabricCardKey, '1']]));
  assert.equal(selected.id, '1'); assert.equal(selected.updatedAt, 2);
  assert.equal(input[0].fabricVariants, undefined);
  assert.equal(groupFabricCards([input[1]], new Map([[card.fabricCardKey, '1']]))[0].id, '2');
});
test('groups separate batches, owners, folders, names and categories', () => {
  const input = [fabric('1', 'WBK', {fabricGroupId:'a'}), fabric('2', 'WBR', {fabricGroupId:'a'}),
    fabric('3', 'DBW', {fabricGroupId:'b'}), fabric('4', 'DBW', {ownerId:'bob'}),
    fabric('5', 'DBW', {parentId:'folder'}), fabric('6', 'DBW', {category:'边布'}), fabric('7', 'DBW', {name:'390'})];
  assert.equal(groupFabricCards(input).length, 6);
});
test('saved default sets the initial cover; temporary selection does not replace the saved default', () => {
  const input = [fabric('1', 'DBW', {fabricDefaultColorCode:' wbr '}), fabric('2', 'WBR', {fabricDefaultColorCode:'WBR'})];
  const [card] = groupFabricCards(input);
  assert.equal(card.id, '2');
  assert.deepEqual(card.fabricVariants.map(asset => asset.fabricColorCode), ['WBR', 'DBW']);
  assert.equal(groupFabricCards(input, new Map([[card.fabricCardKey, '1']]))[0].id, '1');
  assert.equal(groupFabricCards(input, new Map([[card.fabricCardKey, '1']]))[0].fabricVariants[0].id, '2');
  assert.equal(groupFabricCards(input)[0].id, '2');
  assert.equal(groupFabricCards([input[0]])[0].id, '1');
});
test('all colors remain accessible beyond eight and unrelated assets stay separate', () => {
  const input = Array.from({length:10}, (_,i) => fabric(String(i), 'COLOR'+i));
  assert.equal(groupFabricCards(input)[0].fabricVariants.length, 10);
  const other = [fabric('p', 'DBW', {materialType:'pattern'}), fabric('m', '', {kind:'model'}), fabric('f', '', {kind:'folder'}), fabric('x', 'DBW', {name:'自定义'})];
  assert.deepEqual(groupFabricCards(other), other);
});
