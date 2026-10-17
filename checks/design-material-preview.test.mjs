import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fitMaterialPreview } from '../shared/material-preview.js';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const decorateSource = source.slice(source.indexOf('function decorateSwatch('), source.indexOf('function selectEntry('));
const context = vm.createContext({ Image: class { style = {}; }, fitMaterialPreview,
  renderConvexPreview(image, source, info, color) { image.convex = { source, info, color }; },
  renderFabricPreview(host, { source, info }) { const image = { src: source, style: {} }; fitMaterialPreview(image, info, 4 / 3); host.append(image); },
});
vm.runInContext(decorateSource, context);
const entry = { material: { color: { getHexString: () => 'ffffff' } }, previewUrl: 'saved-400x300.jpg', previewInfo: { widthCm: 40, heightCm: 30, widthPx: 400, heightPx: 300 } };
function preview(id, width, height) {
  const host = { id, clientWidth: width, clientHeight: height, classList: { contains: name => id === 'dockSwatch' && name === 'material-thumb' }, closest: () => null, style: {}, replaceChildren() {}, append(image) { this.image = image; } };
  context.decorateSwatch(host, entry);
  return host.image;
}

test('default and switched inspector previews keep the same framing while hidden, opening and fully expanded', () => {
  const initial = preview('compactSwatch', 0, 0);
  assert.equal(initial.src, 'saved-400x300.jpg');
  assert.equal(initial.style.width, '100%');
  assert.equal(initial.style.height, '100%');
  for (const [width, height] of [[40, 60], [180, 90], [384, 288]]) {
    assert.deepEqual(preview('compactSwatch', width, height).style, initial.style);
  }
});

test('square dock previews retain their own framing', () => {
  const image = preview('selectedSwatch', 45, 45);
  assert.equal(image.style.width, `${100 * (4 / 3)}%`);
  assert.equal(image.style.height, '100%');
});

test('fabric dock spheres use the convex projection while the inspector keeps the flat preview', () => {
  const image = preview('dockSwatch', 84, 84);
  assert.equal(image.convex.source, entry.previewUrl);
  assert.equal(image.convex.info, entry.previewInfo);
  assert.equal(image.convex.color, '#ffffff');
  assert.equal(preview('compactSwatch', 384, 288).convex, undefined);
});
