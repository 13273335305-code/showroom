import './procedural-color-picker.js';

const bindings = new WeakMap(), popups = new WeakMap();
const colorValue = value => /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : '#000000';

function popupFor(document) {
  if (popups.has(document)) return popups.get(document);
  const view = document.defaultView;
  const host = document.createElement('div');
  host.id = 'sharedColorPicker'; host.className = 'shared-color-picker-popup';
  host.setAttribute('popover', 'manual'); host.setAttribute('role', 'dialog');
  host.setAttribute('aria-label', '颜色选择器'); host.hidden = true;
  let target = null;
  const usable = () => target && target.input.isConnected && target.control.isConnected
    && !target.input.disabled && !target.control.matches(':disabled')
    && !target.control.closest('[hidden],[inert]') && target.control.getClientRects().length
    && view.getComputedStyle(target.control).visibility !== 'hidden';
  function close(restoreFocus = false) {
    const previous = target; target = null; observer.disconnect();
    previous?.control.setAttribute('aria-expanded', 'false');
    if (host.matches(':popover-open')) host.hidePopover();
    host.hidden = true; picker.clear();
    if (restoreFocus && previous?.control.isConnected) previous.control.focus({ preventScroll: true });
  }
  function position() {
    if (!usable()) { close(); return; }
    const anchor = target.control.getBoundingClientRect(), bounds = host.getBoundingClientRect();
    const viewport = view.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const width = viewport?.width || view.innerWidth, height = viewport?.height || view.innerHeight;
    const x = Math.max(left + 8, Math.min(left + width - bounds.width - 8, anchor.right - bounds.width));
    const below = anchor.bottom + 8;
    const y = below + bounds.height <= top + height - 8 ? below : anchor.top - bounds.height - 8;
    host.style.left = x + 'px';
    host.style.top = Math.max(top + 8, Math.min(top + height - bounds.height - 8, y)) + 'px';
  }
  const picker = globalThis.ProceduralColorPicker.mount(host, {
    prefix: 'sharedColorPicker',
    onCancel: () => close(true),
    onConfirm(value) {
      if (!usable()) { close(); return; }
      const input = target.input;
      close(true); input.value = value;
      input.dispatchEvent(new view.Event('input', { bubbles: true }));
      input.dispatchEvent(new view.Event('change', { bubbles: true }));
    }
  });
  const observer = new view.MutationObserver(() => { if (target && !usable()) close(); });
  const popup = {
    close,
    sourceChanged(input) { if (target?.input === input) close(); },
    open(binding) {
      if (target?.input === binding.input) { close(true); return; }
      close(); target = binding;
      if (!usable()) { close(); return; }
      // Keeping the popover inside its modal dialog also keeps it interactive.
      (binding.control.closest('dialog') || document.body).append(host);
      host.hidden = false;
      host.showPopover?.();
      binding.control.setAttribute('aria-expanded', 'true');
      host.setAttribute('aria-label', binding.control.getAttribute('aria-label') + '选择器');
      picker.open(colorValue(binding.input.value)); position();
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'inert', 'disabled', 'open'] });
    }
  };
  document.addEventListener('pointerdown', event => {
    if (target && !host.contains(event.target) && !target.control.contains(event.target)) close();
  }, true);
  document.addEventListener('focusin', event => {
    if (target && !host.contains(event.target) && !target.control.contains(event.target)) close();
  });
  document.addEventListener('keydown', event => {
    if (!target || event.key !== 'Escape') return;
    event.preventDefault(); event.stopImmediatePropagation(); close(true);
  }, true);
  document.addEventListener('scroll', event => { if (target && !host.contains(event.target)) position(); }, true);
  view.addEventListener('resize', () => { if (target) position(); });
  view.visualViewport?.addEventListener('resize', () => { if (target) position(); });
  view.visualViewport?.addEventListener('scroll', () => { if (target) position(); });
  view.addEventListener('blur', () => { if (target) close(); });
  popups.set(document, popup);
  return popup;
}

export function bindColorInput(input) {
  if (bindings.has(input)) return bindings.get(input).control;
  const document = input.ownerDocument, view = document.defaultView;
  if (!document.getElementById('sharedColorPickerStyles')) {
    const style = document.createElement('link');
    style.id = 'sharedColorPickerStyles'; style.rel = 'stylesheet';
    style.href = new URL('./procedural-color-picker.css', import.meta.url).href;
    document.head.append(style);
  }
  input.type = 'hidden'; input.dataset.colorInput = '';
  const control = document.createElement('button');
  control.type = 'button'; control.className = 'shared-color-control';
  control.setAttribute('aria-label', input.getAttribute('aria-label') || '选择颜色');
  control.setAttribute('aria-haspopup', 'dialog'); control.setAttribute('aria-controls', 'sharedColorPicker');
  control.setAttribute('aria-expanded', 'false');
  const nativeValue = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value');
  function sync() {
    control.style.setProperty('--color-value', colorValue(input.value));
    control.style.backgroundColor = colorValue(input.value);
    control.disabled = input.disabled;
    control.title = control.getAttribute('aria-label') + ' ' + colorValue(input.value).toUpperCase();
  }
  // Existing scene/material code can keep assigning .value without stale swatches.
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() { return nativeValue.get.call(input); },
    set(value) {
      const next = colorValue(value);
      if (next !== nativeValue.get.call(input)) popups.get(document)?.sourceChanged(input);
      nativeValue.set.call(input, next); sync();
    }
  });
  const binding = { input, control };
  bindings.set(input, binding);
  control.onclick = () => {
    if (input.disabled || control.matches(':disabled') || control.closest('[inert]')) return;
    popupFor(document).open(binding);
  };
  new view.MutationObserver(sync).observe(input, { attributes: true, attributeFilter: ['disabled', 'value'] });
  input.addEventListener('input', sync); input.addEventListener('change', sync);
  input.value = input.value; input.after(control);
  return control;
}

export function mountColorInputs(root) {
  for (const input of root.querySelectorAll('input[data-color-input]')) bindColorInput(input);
}

export function dismissColorPicker(root) {
  popups.get(root.ownerDocument || root)?.close();
}
