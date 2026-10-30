(function (root) {
  function hsvToHex({ h, s, v }) {
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return '#' + [r, g, b].map(value => Math.round((value + m) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  function hexToHsv(hex) {
    const value = hex.replace('#', ''), [r, g, b] = [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    let h = 0;
    if (delta) h = max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
    return { h: (h + 360) % 360, s: max ? delta / max : 0, v: max };
  }
  function mount(host, { prefix, onConfirm, onCancel }) {
    const document = host.ownerDocument, view = document.defaultView;
    host.classList.add('compact-procedural-color-editor');
    host.setAttribute('aria-label', '程序化材质颜色编辑器');
    host.innerHTML = `<div class="compact-procedural-picker-grid"><canvas id="${prefix}Saturation" width="220" height="156" tabindex="0" aria-label="选择颜色的饱和度和明度"></canvas><canvas id="${prefix}Hue" width="18" height="156" tabindex="0" role="slider" aria-valuemin="0" aria-valuemax="359" aria-orientation="vertical" aria-label="选择颜色色相"></canvas></div><div class="compact-procedural-color-actions"><input id="${prefix}Value" type="text" maxlength="7" spellcheck="false" autocomplete="off" aria-label="颜色值（HEX）"><button type="button" class="compact-procedural-confirm">确定</button></div>`;
    const grid = host.querySelector('.compact-procedural-picker-grid');
    const [canvas, hueCanvas] = host.querySelectorAll('canvas');
    const ctx = canvas.getContext('2d'), hueCtx = hueCanvas.getContext('2d');
    const input = host.querySelector('input'), confirm = host.querySelector('button');
    let active = false, disabled = false, hsv = { h: 0, s: 0, v: 1 };
    function sync() {
      host.classList.toggle('is-placeholder', !active);
      host.inert = !active;
      grid.inert = !active || disabled;
      input.disabled = confirm.disabled = !active || disabled;
    }
    function draw() {
      if (!active) return;
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      // Match backing pixels to the display so the selection ring stays round.
      const ratio = view.devicePixelRatio || 1, pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      ctx.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, '#fff'); gradient.addColorStop(1, `hsl(${hsv.h} 100% 50%)`);
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
      const shade = ctx.createLinearGradient(0, 0, 0, height);
      shade.addColorStop(0, '#0000'); shade.addColorStop(1, '#000');
      ctx.fillStyle = shade; ctx.fillRect(0, 0, width, height);
      ctx.beginPath(); ctx.arc(hsv.s * width, (1 - hsv.v) * height, 6, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = '#263246'; ctx.lineWidth = 1; ctx.stroke();
      const hueGradient = hueCtx.createLinearGradient(0, 0, 0, hueCanvas.height);
      ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'].forEach((color, index, colors) => hueGradient.addColorStop(index / (colors.length - 1), color));
      hueCtx.fillStyle = hueGradient; hueCtx.fillRect(0, 0, hueCanvas.width, hueCanvas.height);
      const hueY = hsv.h / 360 * hueCanvas.height;
      hueCtx.strokeStyle = '#fff'; hueCtx.lineWidth = 2;
      hueCtx.strokeRect(1, Math.max(1, Math.min(hueCanvas.height - 3, hueY - 2)), hueCanvas.width - 2, 4);
      hueCanvas.setAttribute('aria-valuenow', String(Math.round(hsv.h)));
    }
    function read() {
      const value = input.value.trim().replace(/^#?/, '#').toUpperCase();
      const valid = /^#[\da-f]{6}$/i.test(value);
      input.setCustomValidity(valid ? '' : '请输入六位十六进制颜色值，例如 #336699');
      if (!valid) return null;
      hsv = hexToHsv(value); draw();
      return value;
    }
    function update() { input.value = hsvToHex(hsv); input.setCustomValidity(''); draw(); }
    function pick(event, hue) {
      if (!active || disabled) return;
      const rect = (hue ? hueCanvas : canvas).getBoundingClientRect();
      if (hue) hsv.h = Math.max(0, Math.min(359, (event.clientY - rect.top) / rect.height * 360));
      else {
        hsv.s = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        hsv.v = Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height));
      }
      update();
    }
    for (const control of [canvas, hueCanvas]) {
      control.addEventListener('pointerdown', event => {
        if (!active || disabled || event.button !== 0) return;
        control.setPointerCapture?.(event.pointerId); pick(event, control === hueCanvas);
      });
      control.addEventListener('pointermove', event => { if (event.buttons) pick(event, control === hueCanvas); });
    }
    canvas.addEventListener('keydown', event => {
      if (!active || disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const step = event.shiftKey ? .1 : .01;
      hsv.s = Math.max(0, Math.min(1, hsv.s + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0)));
      hsv.v = Math.max(0, Math.min(1, hsv.v + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0)));
      update();
    });
    hueCanvas.addEventListener('keydown', event => {
      if (!active || disabled || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      hsv.h = event.key === 'Home' ? 0 : event.key === 'End' ? 359 : Math.max(0, Math.min(359, hsv.h + (event.key === 'ArrowDown' ? 1 : -1) * (event.shiftKey ? 10 : 1)));
      update();
    });
    input.addEventListener('input', read);
    input.addEventListener('change', () => { const value = read(); if (value) input.value = value; });
    confirm.onclick = () => {
      if (!active || disabled) return;
      const value = read();
      if (value) onConfirm(value);
      else input.reportValidity();
    };
    host.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
      else if (event.key === 'Enter' && event.target === input) { event.preventDefault(); confirm.click(); }
    });
    function clear() {
      active = false;
      for (const control of [canvas, hueCanvas]) {
        const context = control.getContext('2d');
        context.save(); context.resetTransform(); context.clearRect(0, 0, control.width, control.height); context.restore();
      }
      input.value = ''; input.setCustomValidity(''); sync();
    }
    new view.ResizeObserver(draw).observe(canvas);
    clear();
    return {
      open(color) {
        active = true; hsv = hexToHsv(color); input.value = color; input.setCustomValidity('');
        sync(); draw(); canvas.focus({ preventScroll: true });
      },
      clear,
      setDisabled(value) { disabled = value; sync(); }
    };
  }
  // Also loaded as a classic script by the standalone, file-openable BMP tool.
  root.ProceduralColorPicker = { mount };
})(globalThis);
