(function (root) {
  const FAVORITES_KEY = 'spenic-procedural-color-favorites-v1';
  const FAVORITES_EVENT = 'procedural-color-favorites-change';
  const palettes = [
    { id: 'favorites', name: '收藏' },
    { id: 'common', name: '常用', colors: ['#FFFFFF', '#F1F5F9', '#94A3B8', '#1E293B', '#FEE2E2', '#FECACA', '#F87171', '#EF4444', '#FFEDD5', '#FDBA74', '#F59E0B', '#FACC15', '#DCFCE7', '#86EFAC', '#22C55E', '#15803D', '#DBEAFE', '#60A5FA', '#6366F1', '#A855F7'] },
    { id: 'warm', name: '暖色', colors: ['#FFF1F2', '#FECDD3', '#FB7185', '#E11D48', '#FEE2E2', '#FCA5A5', '#EF4444', '#B91C1C', '#FFEDD5', '#FDBA74', '#F97316', '#C2410C', '#FEF3C7', '#FCD34D', '#F59E0B', '#B45309', '#FAE8D4', '#D6B08C', '#A47148', '#6F4E37'] },
    { id: 'cool', name: '冷色', colors: ['#ECFDF5', '#A7F3D0', '#34D399', '#047857', '#CCFBF1', '#5EEAD4', '#14B8A6', '#0F766E', '#CFFAFE', '#67E8F9', '#06B6D4', '#0E7490', '#DBEAFE', '#93C5FD', '#3B82F6', '#1D4ED8', '#EDE9FE', '#C4B5FD', '#8B5CF6', '#6D28D9'] },
    { id: 'neutral', name: '中性色', colors: ['#FFFFFF', '#F5F5F4', '#E7E5E4', '#D6D3D1', '#A8A29E', '#78716C', '#57534E', '#292524', '#F8FAFC', '#E2E8F0', '#94A3B8', '#475569', '#FEFCE8', '#E8DFC8', '#BDB285', '#8C8063', '#D1D5DB', '#6B7280', '#374151', '#000000'] }
  ];
  let fallbackFavorites = [], useMemoryFavorites = false;
  function normalizeHex(value) {
    const hex = typeof value === 'string' ? '#' + value.trim().replace(/^#/, '').toUpperCase() : '';
    return /^#[\dA-F]{6}$/.test(hex) ? hex : null;
  }
  function readFavorites(view) {
    if (useMemoryFavorites) return [...fallbackFavorites];
    try {
      const value = JSON.parse(view.localStorage.getItem(FAVORITES_KEY) || '[]');
      return Array.isArray(value) ? [...new Set(value.map(normalizeHex).filter(Boolean))] : [];
    } catch { return [...fallbackFavorites]; }
  }
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
    host.innerHTML = `<div class="compact-procedural-picker-grid"><canvas id="${prefix}Saturation" width="220" height="156" tabindex="0" aria-label="选择颜色的饱和度和明度"></canvas><canvas id="${prefix}Hue" width="18" height="156" tabindex="0" role="slider" aria-valuemin="0" aria-valuemax="359" aria-orientation="vertical" aria-label="选择颜色色相"></canvas></div>
      <div id="${prefix}Palettes" class="compact-procedural-palette-browser" hidden>
        <div class="compact-procedural-palette-tabs" role="tablist" aria-label="色板分类" aria-orientation="vertical"></div>
        <div id="${prefix}PaletteColors" class="compact-procedural-palette-colors" role="tabpanel" tabindex="0"></div>
      </div>
      <div class="compact-procedural-color-actions">
        <button type="button" class="compact-procedural-palette-toggle" aria-label="色板" aria-expanded="false" aria-controls="${prefix}Palettes" title="打开色板"><span class="compact-procedural-palette-icon" aria-hidden="true"></span></button>
        <div class="compact-procedural-value-field">
          <input id="${prefix}Value" type="text" maxlength="7" spellcheck="false" autocomplete="off" placeholder="HEX色号" aria-label="颜色值（HEX）">
          <button type="button" class="compact-procedural-favorite" aria-label="收藏当前颜色" aria-pressed="false" title="收藏当前颜色"><span class="compact-procedural-favorite-icon" aria-hidden="true"></span></button>
        </div>
        <button type="button" class="compact-procedural-confirm">确定</button>
      </div>
      <span class="compact-procedural-color-status" role="status"></span>`;
    const grid = host.querySelector('.compact-procedural-picker-grid');
    const paletteBrowser = host.querySelector('.compact-procedural-palette-browser');
    const tabs = host.querySelector('.compact-procedural-palette-tabs');
    const colors = host.querySelector('.compact-procedural-palette-colors');
    const paletteToggle = host.querySelector('.compact-procedural-palette-toggle');
    const favorite = host.querySelector('.compact-procedural-favorite');
    const status = host.querySelector('.compact-procedural-color-status');
    const [canvas, hueCanvas] = host.querySelectorAll('canvas');
    const ctx = canvas.getContext('2d'), hueCtx = hueCanvas.getContext('2d');
    const input = host.querySelector('input'), confirm = host.querySelector('.compact-procedural-confirm');
    let active = false, disabled = false, hsv = { h: 0, s: 0, v: 1 };
    let favorites = readFavorites(view), selectedPalette = 'common';
    function syncSelection() {
      const value = normalizeHex(input.value), saved = !!value && favorites.includes(value);
      favorite.setAttribute('aria-pressed', String(saved));
      favorite.title = saved ? '取消收藏当前颜色' : '收藏当前颜色';
      favorite.setAttribute('aria-label', favorite.title);
      for (const swatch of colors.querySelectorAll('button')) {
        swatch.setAttribute('aria-pressed', String(swatch.dataset.color === value));
      }
    }
    function renderPalette() {
      const palette = palettes.find(item => item.id === selectedPalette);
      for (const tab of tabs.children) {
        const selected = tab.dataset.palette === selectedPalette;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
      }
      colors.setAttribute('aria-labelledby', `${prefix}Palette-${selectedPalette}`);
      colors.replaceChildren();
      const values = selectedPalette === 'favorites' ? favorites : palette.colors;
      if (!values.length) {
        const empty = document.createElement('div');
        empty.className = 'compact-procedural-palette-empty';
        empty.innerHTML = '<span class="compact-procedural-favorite-icon" aria-hidden="true"></span><span>暂无收藏</span><small>点击下方图标收藏颜色</small>';
        colors.append(empty);
      }
      for (const value of values) {
        const swatch = document.createElement('button');
        swatch.type = 'button'; swatch.className = 'compact-procedural-palette-color';
        swatch.dataset.color = value; swatch.style.setProperty('--palette-color', value);
        swatch.title = value; swatch.setAttribute('aria-label', '选择颜色 ' + value);
        swatch.disabled = !active || disabled;
        swatch.onclick = () => {
          if (!active || disabled) return;
          hsv = hexToHsv(value); update();
        };
        colors.append(swatch);
      }
      syncSelection();
    }
    for (const palette of palettes) {
      const tab = document.createElement('button');
      tab.type = 'button'; tab.id = `${prefix}Palette-${palette.id}`;
      tab.dataset.palette = palette.id; tab.textContent = palette.name;
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', colors.id);
      tab.onclick = () => {
        if (!active || disabled) return;
        selectedPalette = palette.id; renderPalette();
      };
      tabs.append(tab);
    }
    tabs.addEventListener('keydown', event => {
      if (!active || disabled || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = palettes.findIndex(palette => palette.id === selectedPalette);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? palettes.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + palettes.length) % palettes.length;
      tabs.children[next].click(); tabs.children[next].focus({ preventScroll: true });
    });
    function showPalettes(show) {
      grid.hidden = show; paletteBrowser.hidden = !show;
      paletteToggle.setAttribute('aria-expanded', String(show));
      paletteToggle.title = show ? '返回调色' : '打开色板';
      if (show) { favorites = readFavorites(view); renderPalette(); }
      else draw();
    }
    paletteToggle.onclick = () => { if (active && !disabled) showPalettes(paletteBrowser.hidden); };
    function refreshFavorites() {
      favorites = readFavorites(view);
      if (!paletteBrowser.hidden && selectedPalette === 'favorites') renderPalette();
      else syncSelection();
    }
    view.addEventListener(FAVORITES_EVENT, refreshFavorites);
    view.addEventListener('storage', event => { if (event.key === FAVORITES_KEY || event.key === null) refreshFavorites(); });
    favorite.onclick = () => {
      if (!active || disabled) return;
      const value = read();
      if (!value) { input.reportValidity(); return; }
      input.value = value;
      favorites = readFavorites(view);
      const saved = favorites.includes(value);
      favorites = saved ? favorites.filter(color => color !== value) : [value, ...favorites];
      fallbackFavorites = [...favorites];
      let persisted = true;
      try { view.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites)); useMemoryFavorites = false; }
      catch { persisted = false; useMemoryFavorites = true; }
      view.dispatchEvent(new view.Event(FAVORITES_EVENT));
      status.textContent = (saved ? '已取消收藏 ' : '已收藏 ') + value + (persisted ? '' : '，浏览器存储不可用，仅在本次使用中保留');
    };
    function sync() {
      host.classList.toggle('is-placeholder', !active);
      host.inert = !active;
      grid.inert = !active || disabled;
      paletteBrowser.inert = !active || disabled;
      input.disabled = !active || disabled;
      for (const button of host.querySelectorAll('button')) button.disabled = !active || disabled;
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
      const value = normalizeHex(input.value);
      input.setCustomValidity(value ? '' : '请输入六位十六进制颜色值，例如 #336699');
      syncSelection();
      if (!value) return null;
      hsv = hexToHsv(value); draw();
      return value;
    }
    function update() { input.value = hsvToHex(hsv); input.setCustomValidity(''); syncSelection(); draw(); }
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
      showPalettes(false); status.textContent = '';
      for (const control of [canvas, hueCanvas]) {
        const context = control.getContext('2d');
        context.save(); context.resetTransform(); context.clearRect(0, 0, control.width, control.height); context.restore();
      }
      input.value = ''; input.setCustomValidity(''); syncSelection(); sync();
    }
    new view.ResizeObserver(draw).observe(canvas);
    clear();
    return {
      open(color) {
        active = true; hsv = hexToHsv(color); input.value = color; input.setCustomValidity('');
        favorites = readFavorites(view); showPalettes(false); syncSelection();
        sync(); draw(); canvas.focus({ preventScroll: true });
      },
      clear,
      setDisabled(value) { disabled = value; sync(); }
    };
  }
  // Also loaded as a classic script by the standalone, file-openable BMP tool.
  root.ProceduralColorPicker = { mount };
})(globalThis);
