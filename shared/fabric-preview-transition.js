import { fitMaterialPreview } from './material-preview.js';

const previews = new WeakMap();
const decodedPreviews = new WeakMap();

// Start the saved preview request alongside runtime textures, before model changes.
export function preloadFabricPreview(source, document = globalThis.document) {
  if (!source) return Promise.resolve();
  let cache = decodedPreviews.get(document);
  if (!cache) { cache = new Map(); decodedPreviews.set(document, cache); }
  if (!cache.has(source)) {
    const image = document.createElement('img');
    const ready = image.decode ? Promise.resolve().then(() => image.decode()) : new Promise((resolve, reject) => {
      image.onload = resolve; image.onerror = reject;
    });
    image.src = source;
    cache.set(source, { image, ready: ready.catch(error => { cache.delete(source); throw error; }) });
    if (cache.size > 16) cache.delete(cache.keys().next().value);
  }
  return cache.get(source).ready;
}

// Keep the displayed image until its replacement has decoded, including rapid switches.
export function renderFabricPreview(host, { source, info, pending, identity }) {
  let state = previews.get(host);
  if (!state || state.identity !== identity) {
    if (state) { state.version++; clearTimeout(state.cleanup); }
    host.replaceChildren();
    state = { identity, version: 0, source: undefined, current: null };
    previews.set(host, state);
  }
  state.pending = !!pending;
  host.setAttribute('aria-busy', String(state.pending));
  host.classList.toggle('fabric-preview-loading', state.pending || !!state.loadingSource);
  if (state.source === source) return;
  state.source = source;
  const version = ++state.version;
  clearTimeout(state.cleanup);
  host.querySelectorAll('.fabric-preview-leaving').forEach(image => image.remove());
  state.incoming?.remove(); state.incoming = null;
  if (!source) {
    state.loadingSource = false;
    host.classList.toggle('fabric-preview-loading', state.pending);
    state.current = null; host.replaceChildren();
    const empty = host.ownerDocument.createElement('span');
    empty.className = 'material-preview-empty'; empty.textContent = '无预览图'; host.append(empty);
    return;
  }
  const cached = decodedPreviews.get(host.ownerDocument)?.get(source);
  const reusable = cached && !cached.image.parentNode;
  const image = reusable ? cached.image : host.ownerDocument.createElement('img');
  state.loadingSource = !!state.current;
  host.classList.toggle('fabric-preview-loading', state.pending || state.loadingSource);
  image.alt = ''; image.draggable = false; image.className = 'fabric-preview-image';
  fitMaterialPreview(image, info, 4 / 3);
  if (!reusable) image.src = source;
  const ready = reusable ? cached.ready : image.decode ? image.decode() : new Promise((resolve, reject) => {
    image.onload = resolve; image.onerror = reject;
    if (image.complete && image.naturalWidth) resolve();
  });
  ready.then(() => {
    if (version !== state.version || previews.get(host) !== state) return;
    const previous = state.current;
    if (!previous) host.replaceChildren();
    else image.classList.add('fabric-preview-incoming');
    state.incoming = image; host.append(image);
    const view = host.ownerDocument.defaultView;
    view.requestAnimationFrame(() => view.requestAnimationFrame(() => {
      if (version !== state.version || previews.get(host) !== state) return;
      image.classList.remove('fabric-preview-incoming');
      previous?.classList.add('fabric-preview-leaving');
      state.loadingSource = false;
      host.classList.toggle('fabric-preview-loading', state.pending);
      state.current = image; state.incoming = null;
      state.cleanup = setTimeout(() => previous?.remove(), 220);
    }));
  }).catch(() => {
    if (version !== state.version || previews.get(host) !== state) return;
    // A failed preview must not leave the previous picture permanently blurred.
    host.classList.remove('fabric-preview-loading');
    host.setAttribute('aria-busy', 'false'); state.source = undefined; state.loadingSource = false;
  });
}
