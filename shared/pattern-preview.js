import { imageAlphaBounds } from './image-pixels.js';
const formatCm = value => Number(value.toFixed(4)).toLocaleString('zh-CN', { maximumFractionDigits: 4 }) + ' cm';

// A flat, unlit image with measurements in physical space, fitted to the available pane.
export function createPatternPreview(host) {
  host.innerHTML = `<div class="pattern-preview-empty">上传基础颜色贴图后显示图案与厘米尺寸</div>
    <svg class="pattern-drawing" role="img" aria-label="图案二维尺寸预览" hidden>
      <defs>
        <pattern id="patternChecker" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#fff"/><path d="M0 0h8v8H0zM8 8h8v8H8z" fill="#e9eef3"/></pattern>
        <filter id="patternTint" color-interpolation-filters="sRGB"><feComponentTransfer><feFuncR type="linear" slope="1"/><feFuncG type="linear" slope="1"/><feFuncB type="linear" slope="1"/></feComponentTransfer></filter>
      </defs>
      <rect data-checker fill="url(#patternChecker)"/>
      <svg data-image-frame viewBox="0 0 1 1" preserveAspectRatio="none" overflow="hidden"><image data-image width="1" height="1" preserveAspectRatio="none" filter="url(#patternTint)"/></svg>
      <rect data-outline fill="none" stroke="#b1bfce" stroke-width="1"/>
      <g data-dimensions>
      <path data-extensions fill="none" stroke="#a8b7c7" stroke-width="1"/>
      <path data-measures fill="none" stroke="#627b94" stroke-width="1.2"/>
      <text data-width text-anchor="middle"/><text data-height text-anchor="middle"/>
      </g>
    </svg>`;
  const svg = host.querySelector('svg.pattern-drawing'), empty = host.querySelector('.pattern-preview-empty');
  const part = name => host.querySelector('[data-' + name + ']');
  let current = null, zoom = 1, pan = { x: 0, y: 0 }, drag = null, measuredImage, measuredAngle, bounds = null;
  function reset() { zoom = 1; pan = { x: 0, y: 0 }; draw(); }
  host.tabIndex = 0; host.setAttribute('aria-label', '图案画板，滚轮缩放，拖动平移，F 适应画板');
  function draw() {
    if (!current || host.hidden) return;
    const { url, widthCm, heightCm, angle, color, sourceImage } = current;
    empty.hidden = !!url; svg.toggleAttribute('hidden', !url);
    if (!url) { part('image').removeAttribute('href'); return; }
    if (sourceImage !== measuredImage || angle !== measuredAngle) {
      bounds = sourceImage ? imageAlphaBounds(sourceImage, angle) : null;
      measuredImage = sourceImage; measuredAngle = angle;
    }
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const scale = Math.min(Math.max(1, width - 160) / widthCm, Math.max(1, height - 140) / heightCm) * zoom;
    const w = widthCm * scale, h = heightCm * scale;
    const x = (width - 76 - w) / 2 + pan.x, y = (height - h) / 2 + 16 + pan.y;
    host.dataset.zoom = zoom.toFixed(4);
    for (const name of ['checker', 'image-frame', 'outline']) {
      const el = part(name);
      for (const [key, value] of Object.entries({ x, y, width: w, height: h })) el.setAttribute(key, value);
    }
    const image = part('image');
    image.setAttribute('href', url); image.setAttribute('transform', `rotate(${-angle} .5 .5)`);
    for (const [i, channel] of ['R', 'G', 'B'].entries()) host.querySelector('feFunc' + channel).setAttribute('slope', parseInt(color.slice(1 + i * 2, 3 + i * 2), 16) / 255);
    part('dimensions').toggleAttribute('hidden', !bounds);
    if (!bounds) { part('width').textContent = ''; part('height').textContent = ''; svg.setAttribute('aria-label', '透明图案，无可测量内容'); return; }
    const left = x + bounds.x * w, upper = y + bounds.y * h, bw = bounds.width * w, bh = bounds.height * h;
    const measuredWidth = widthCm * bounds.width, measuredHeight = heightCm * bounds.height;
    const top = upper - 30, right = left + bw + 32;
    part('extensions').setAttribute('d', `M${left} ${upper - 5}V${top - 8}M${left + bw} ${upper - 5}V${top - 8}M${left + bw + 5} ${upper}H${right + 8}M${left + bw + 5} ${upper + bh}H${right + 8}`);
    part('measures').setAttribute('d', `M${left} ${top}H${left + bw}M${left - 3} ${top + 4}l6 -8M${left + bw - 3} ${top + 4}l6 -8M${right} ${upper}V${upper + bh}M${right - 4} ${upper + 3}l8 -6M${right - 4} ${upper + bh + 3}l8 -6`);
    const widthLabel = part('width'), heightLabel = part('height');
    widthLabel.setAttribute('x', left + bw / 2); widthLabel.setAttribute('y', top - 10); widthLabel.textContent = formatCm(measuredWidth);
    heightLabel.setAttribute('transform', `translate(${right + 20} ${upper + bh / 2}) rotate(90)`); heightLabel.textContent = formatCm(measuredHeight);
    svg.setAttribute('aria-label', `实际图案宽度 ${formatCm(measuredWidth)}，高度 ${formatCm(measuredHeight)}`);
  }
  host.addEventListener('wheel', event => {
    if (!current?.url) return;
    event.preventDefault();
    const rect = host.getBoundingClientRect(), unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
    const next = Math.max(.1, Math.min(16, zoom * Math.exp(-Math.max(-600, Math.min(600, event.deltaY * unit)) * .0015))), factor = next / zoom;
    const x = event.clientX - rect.left - (rect.width - 76) / 2, y = event.clientY - rect.top - rect.height / 2 - 16;
    pan = { x: x - (x - pan.x) * factor, y: y - (y - pan.y) * factor }; zoom = next; draw();
  }, { passive: false });
  host.addEventListener('pointerdown', event => {
    if (!current?.url || ![0, 1].includes(event.button)) return;
    event.preventDefault(); host.focus({ preventScroll: true }); host.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, pan: { ...pan } }; host.classList.add('panning');
  });
  host.addEventListener('pointermove', event => { if (drag?.id !== event.pointerId) return; pan = { x: drag.pan.x + event.clientX - drag.x, y: drag.pan.y + event.clientY - drag.y }; draw(); });
  const release = () => { drag = null; host.classList.remove('panning'); };
  host.addEventListener('pointerup', release); host.addEventListener('pointercancel', release); host.addEventListener('lostpointercapture', release);
  window.addEventListener('keydown', event => {
    if (host.hidden || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,textarea,select,[contenteditable=true]')) return;
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); reset(); }
  });
  new ResizeObserver(draw).observe(host);
  return { update(value) { const changed = current?.url !== value.url; current = value; if (changed) reset(); else draw(); }, reset };
}
