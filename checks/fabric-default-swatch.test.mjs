import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBatchFabricSwatches, renderFabricColorList } from '../shared/fabric-color-swatch.js';

test('inspector lists all colors without folding, names or switching controls', () => {
  const document = { createElement(tagName) { return { tagName, children: [], dataset: {}, style: { setProperty() {} }, setAttribute(key, value) { this[key] = value; }, removeAttribute(key) { delete this[key]; }, append(...children) { this.children.push(...children); } }; } };
  const host = { ownerDocument: document, replaceChildren(...children) { this.children = children; } };
  const codes = ['WBR', 'DBW', 'WBK', 'WLG', 'WWW', 'ZGW', 'GWW', 'KGW', 'OTHER', 'EXTRA'];
  renderFabricColorList(host, [...codes, ' wbr ']);
  assert.equal(host.children.length, 10); assert.equal(host.hidden, false);
  assert.ok(host.children.every(ball => ball.tagName === 'span' && ball.role === 'img' && !ball.onclick && !ball.title));
  assert.equal(host.children[0]['aria-label'].startsWith('WBR'), true);
  renderFabricColorList(host, []); assert.equal(host.hidden, true); assert.equal(host.children.length, 0);
});

test('interactive inspector balls switch only on click and expose active and loading states', () => {
  const document = { createElement(tagName) { return { tagName, ownerDocument: document, children: [], dataset: {}, style: { setProperty() {} },
    setAttribute(key, value) { this[key] = value; }, getAttribute(key) { return this[key]; }, removeAttribute(key) { delete this[key]; },
    querySelector(selector) { return this.children.find(child => '.' + child.className === selector); },
    set innerHTML(value) { this.children = ['color-progress-value', 'color-progress-label'].map(className => ({ className, style: {} })); },
    append(...children) { this.children.push(...children); } }; } };
  const host = { ownerDocument: document, replaceChildren(...children) { this.children = children; } }, calls = [];
  renderFabricColorList(host, ['WBR', 'DBW'], { active: 'wbr', pending: 'dbw', onSelect: code => calls.push(code) });
  assert.deepEqual(calls, []);
  assert.ok(host.children.every(button => button.tagName === 'button' && button.type === 'button' && button.children[0].className === 'fabric-color-swatch' && !button.title));
  assert.equal(host.children[0]['aria-pressed'], 'true');
  assert.equal(host.children[1]['aria-busy'], 'true');
  assert.equal(host.children[0].children.length, 1);
  assert.equal(host.children[1].children[1].role, 'progressbar');
  assert.equal(host.children[1].children[1]['aria-valuenow'], '0');
  assert.equal(host.children[1].children[1].className, 'fabric-color-progress');
  host.children[1].onclick(); assert.deepEqual(calls, ['DBW']);
  renderFabricColorList(host, ['WBR', 'DBW'], { active: 'DBW', pending: 'DBW', progress: 100, onSelect: code => calls.push(code) });
  const completed = host.children[1];
  assert.equal(completed['aria-pressed'], 'true');
  assert.equal(completed['aria-busy'], 'false');
  assert.equal(completed.children[1]['aria-valuenow'], '100');
  assert.equal(completed.children[1].querySelector('.color-progress-label').textContent, '100%');
});

test('default color picker shows only balls and selects one color per fabric group', () => {
  const document = { createElement(tagName) { return { tagName, children: [], dataset: {}, style: { setProperty() {} }, setAttribute(key, value) { this[key] = value; }, append(...children) { this.children.push(...children); } }; } };
  const host = { ownerDocument: document, replaceChildren(...children) { this.children = children; } };
  const variant = (code, name = '389') => ({ name, fabricColorCode: code, file: { name: name + code + '.jpg' } });
  const variants = [variant('DBW'), variant('WBR'), variant('WBK', '390'), variant('WWW', '390')];
  renderBatchFabricSwatches(host, variants);
  const buttons = host.children.map(item => item.children[0]);
  assert.deepEqual(variants.map(item => item.isDefaultColor), [true, false, true, false]);
  assert.ok(buttons.every(button => button.type === 'button' && button.children.length === 1 && button.children[0].className === 'fabric-color-swatch'));
  buttons[1].onclick();
  assert.deepEqual(variants.map(item => item.isDefaultColor), [false, true, true, false]);
  assert.equal(buttons[1]['aria-pressed'], 'true');
  assert.equal(buttons[0]['aria-pressed'], 'false');
  renderBatchFabricSwatches(host, variants);
  assert.equal(host.children.length, 4);
  assert.equal(host.children[1].children[0]['aria-pressed'], 'true');
});
