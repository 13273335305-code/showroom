(function (root) {
  'use strict';
  const SVG = 'http://www.w3.org/2000/svg';

  root.mountBmpCropTool = function ({ viewport, canvas, view, button, toolbar, progress, reset, cancel, apply, showInput, onApply, onError }) {
    let active = false, points = [], hover = null, press = null, space = false;
    const overlay = document.createElementNS(SVG, 'svg');
    overlay.classList.add('crop-overlay'); overlay.setAttribute('aria-hidden', 'true'); overlay.setAttribute('hidden', '');
    viewport.append(overlay);
    const make = (name, attributes) => {
      const element = document.createElementNS(SVG, name);
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
      overlay.append(element); return element;
    };
    const line = (a, b, color = '#20ad55', dash = '') => make('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: color, 'stroke-width': 1.5, 'stroke-dasharray': dash });
    function render() {
      if (!active) return;
      overlay.replaceChildren();
      const bounds = viewport.getBoundingClientRect(), image = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height || !canvas.width) return;
      overlay.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
      const sx = image.width / canvas.width, sy = image.height / canvas.height;
      const left = image.left - bounds.left, top = image.top - bounds.top;
      const screen = point => ({ x: left + point.x * sx, y: top + point.y * sy });
      // Show individual pixel cells only when they are large enough to see.
      if (sx >= 7 && sy >= 7) {
        const startX = Math.max(0, Math.ceil(-left / sx)), endX = Math.min(canvas.width, Math.floor((bounds.width - left) / sx));
        const startY = Math.max(0, Math.ceil(-top / sy)), endY = Math.min(canvas.height, Math.floor((bounds.height - top) / sy));
        let path = '';
        for (let x = startX; x <= endX; x++) path += `M${left + x * sx},${Math.max(0, top)}V${Math.min(bounds.height, top + image.height)}`;
        for (let y = startY; y <= endY; y++) path += `M${Math.max(0, left)},${top + y * sy}H${Math.min(bounds.width, left + image.width)}`;
        make('path', { d: path, fill: 'none', stroke: '#527193', 'stroke-opacity': .24, 'stroke-width': .7 });
      }
      const projected = hover && BmpCrop.projectPoint(points, hover);
      const preview = points.length < 3 && projected ? [...points, projected] : points;
      const rect = BmpCrop.rectangle(preview);
      if (rect) {
        const a = screen(rect), width = rect.width * sx, height = rect.height * sy;
        const x1 = Math.max(0, left), y1 = Math.max(0, top), x2 = Math.min(bounds.width, left + image.width), y2 = Math.min(bounds.height, top + image.height);
        if (x2 > x1 && y2 > y1) make('path', { d: `M${x1},${y1}H${x2}V${y2}H${x1}Z M${a.x},${a.y}v${height}h${width}v${-height}Z`, fill: '#203246', 'fill-opacity': .24, 'fill-rule': 'evenodd' });
        make('rect', { x: a.x, y: a.y, width, height, fill: '#20ad550a', stroke: '#20ad55', 'stroke-width': 2 });
      } else if (preview.length === 2) line(screen(preview[0]), screen(preview[1]));
      const target = points.length === 3 ? points[2] : projected;
      if (target) {
        const p = screen(target);
        line({ x: Math.max(0, left), y: p.y }, { x: Math.min(bounds.width, left + image.width), y: p.y }, '#20ad55', '5 4');
        line({ x: p.x, y: Math.max(0, top) }, { x: p.x, y: Math.min(bounds.height, top + image.height) }, '#20ad55', '5 4');
      }
      points.forEach((point, index) => {
        const p = screen(point);
        make('circle', { cx: p.x, cy: p.y, r: 4, fill: '#fff', stroke: '#20ad55', 'stroke-width': 2 });
        const text = make('text', { x: p.x + 8, y: p.y - 8, fill: '#167537', stroke: '#fff', 'stroke-width': 3, 'paint-order': 'stroke', 'font-size': 11, 'font-family': 'Segoe UI, sans-serif' });
        text.textContent = index + 1;
      });
      const selected = BmpCrop.rectangle(points);
      progress.textContent = selected ? `${selected.width} × ${selected.height} px` : `${points.length} / 3`;
      apply.disabled = !selected; reset.disabled = !points.length;
    }
    function exit() {
      active = false; points = []; hover = press = null; space = false;
      view.canPan = null; view.onTransform = null; viewport.classList.remove('is-cropping');
      button.setAttribute('aria-pressed', 'false'); toolbar.hidden = true; overlay.setAttribute('hidden', ''); overlay.replaceChildren();
      canvas.removeAttribute('tabindex');
    }
    function start() {
      if (button.disabled || !canvas.width) return;
      if (active) { exit(); return; }
      active = true; points = []; hover = null;
      view.dragging = null; viewport.classList.remove('is-panning');
      view.canPan = event => event.button === 1 || (space && event.button === 0);
      view.onTransform = render;
      toolbar.hidden = false; overlay.removeAttribute('hidden'); viewport.classList.add('is-cropping');
      button.setAttribute('aria-pressed', 'true');
      showInput(); viewport.scrollIntoView({ block: 'nearest' });
      canvas.tabIndex = 0; canvas.focus({ preventScroll: true }); render();
    }
    function fromEvent(event) {
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height || event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return null;
      return BmpCrop.snapPoint((event.clientX - bounds.left) * canvas.width / bounds.width, (event.clientY - bounds.top) * canvas.height / bounds.height, canvas.width, canvas.height);
    }
    function addPoint(candidate) {
      const point = BmpCrop.projectPoint(points, candidate);
      if (!point) return;
      if (points.length && point.x === points.at(-1).x && point.y === points.at(-1).y) return;
      points.push(point); hover = candidate; render();
    }
    button.addEventListener('click', start);
    reset.addEventListener('click', () => { points = []; hover = null; render(); });
    cancel.addEventListener('click', () => { exit(); button.focus(); });
    apply.addEventListener('click', () => {
      const rect = BmpCrop.rectangle(points);
      if (!active || !rect) return;
      try { onApply(rect); exit(); button.focus(); } catch (error) { onError(error); }
    });
    viewport.addEventListener('pointerdown', event => {
      if (!active || event.button !== 0 || space || press) return;
      press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.focus({ preventScroll: true });
      viewport.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    viewport.addEventListener('pointermove', event => { if (active) { hover = fromEvent(event); render(); } });
    viewport.addEventListener('pointerleave', () => { if (active) { hover = null; render(); } });
    viewport.addEventListener('pointerup', event => {
      if (!active || !press || press.pointerId !== event.pointerId) return;
      const clicked = Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 4; press = null;
      if (clicked) addPoint(fromEvent(event));
    });
    const cancelPress = () => { press = null; };
    viewport.addEventListener('pointercancel', cancelPress); viewport.addEventListener('lostpointercapture', cancelPress);
    window.addEventListener('blur', () => { space = false; press = null; });
    window.addEventListener('keydown', event => {
      if (!active || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
      if (event.key === 'Escape') { event.preventDefault(); exit(); button.focus(); }
      else if (event.code === 'Space' && event.target === canvas) { event.preventDefault(); space = true; }
      else if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); points.pop(); render(); }
      else if (event.target === canvas && /^Arrow/.test(event.key)) {
        event.preventDefault(); const p = hover || points.at(-1) || { x: 0, y: 0 };
        hover = BmpCrop.snapPoint(p.x + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0), p.y + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0), canvas.width, canvas.height); render();
      } else if (event.target === canvas && event.key === 'Enter') { event.preventDefault(); addPoint(hover || { x: 0, y: 0 }); }
    });
    window.addEventListener('keyup', event => { if (event.code === 'Space') space = false; });
    return { cancel: exit, get active() { return active; } };
  };
})(globalThis);
