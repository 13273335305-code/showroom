import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderFabricPreview, preloadFabricPreview } from '../shared/fabric-preview-transition.js';

function fixture() {
  const frames = [], images = [];
  function element() {
    const classes = new Set();
    return { style: {}, classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle(c, on) { on ? classes.add(c) : classes.delete(c); } },
      setAttribute(k, v) { this[k] = v; }, remove() { host.children = host.children.filter(child => child !== this); } };
  }
  const document = { defaultView: { requestAnimationFrame: callback => frames.push(callback) }, createElement(tag) {
    const image = element();
    if (tag === 'img') {
      image.decode = () => new Promise((resolve, reject) => { image.ready = resolve; image.fail = reject; }); images.push(image);
    }
    return image;
  } };
  const host = { ...element(), ownerDocument: document, children: [], replaceChildren(...items) { this.children = items; }, append(item) { this.children.push(item); }, querySelectorAll(selector) { return this.children.filter(child => child.classList.contains(selector.slice(1))); } };
  const identity = {}, info = { widthCm: 40, heightCm: 30 };
  const render = (source, pending = null) => renderFabricPreview(host, { source, pending, identity, info });
  const paint = () => { while (frames.length) frames.shift()(); };
  return { host, images, render, paint };
}

test('keeps old preview blurred until new image decodes, then crossfades without changing ratio', async () => {
  const f = fixture(); f.render('default'); f.images[0].ready(); await Promise.resolve(); f.paint();
  const old = f.images[0];
  f.render('default', 'DBW');
  assert.equal(f.images.length, 1); assert.equal(f.host.classList.contains('fabric-preview-loading'), true);
  f.render('new', 'DBW'); f.render('new');
  assert.equal(f.host.children[0], old); assert.equal(f.host.classList.contains('fabric-preview-loading'), true);
  f.images[1].ready(); await Promise.resolve();
  assert.equal(f.images[1].classList.contains('fabric-preview-incoming'), true);
  f.paint();
  assert.equal(old.classList.contains('fabric-preview-leaving'), true);
  assert.equal(f.host.classList.contains('fabric-preview-loading'), false);
  assert.equal(f.images[1].style.width, '100%'); assert.equal(f.images[1].style.height, '100%');
});

test('stale decodes never replace the latest color and cancelling loading restores clarity', async () => {
  const f = fixture(); f.render('default'); f.images[0].ready(); await Promise.resolve(); f.paint();
  f.render('slow', 'DBW'); f.render('last', 'WBK');
  f.images[2].ready(); await Promise.resolve(); f.paint();
  f.render('last'); f.images[1].ready(); await Promise.resolve(); f.paint();
  assert.equal(f.host.children.includes(f.images[1]), false);
  assert.equal(f.host.children.includes(f.images[2]), true);
  assert.equal(f.host.classList.contains('fabric-preview-loading'), false);
  f.render('last', 'DBW'); f.render('last');
  assert.equal(f.host.classList.contains('fabric-preview-loading'), false);
});

test('failed preview decode leaves previous image visible and clears blur', async () => {
  const f = fixture(); f.render('default'); f.images[0].ready(); await Promise.resolve(); f.paint();
  f.render('broken'); f.images[1].fail(new Error('bad image'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.host.children[0], f.images[0]);
  assert.equal(f.host.classList.contains('fabric-preview-loading'), false);
});

test('committing a color reuses its preloaded decoded preview without a second image request', async () => {
  const f = fixture();
  const ready = preloadFabricPreview('preloaded-400x300', f.host.ownerDocument);
  await Promise.resolve();
  assert.equal(f.images.length, 1);
  f.images[0].ready(); await ready;
  f.render('preloaded-400x300'); await Promise.resolve(); f.paint();
  assert.equal(f.images.length, 1);
  assert.equal(f.host.children[0], f.images[0]);
});
