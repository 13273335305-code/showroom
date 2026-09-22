import { ENVIRONMENT_DEFAULTS, readEnvironment } from './scene-file.js';
import { PHASE_IDS, readTiming, readDefaultView, readShowroomScale, readDeveloperSettings, saveDeveloperSettings } from './developer-settings.js';
import { createDeveloperPerformance } from './developer-performance.js';
import { createDeveloperLogger } from './developer-logging.js';

export function createDeveloperPanel({ renderer, read, apply, cycle, showroom, status, readCamera, getSettings, setSettings, notify, download }) {
  const $ = id => document.getElementById(id);
  const panel = $('developerPanel'), toggle = $('developerToggle'), brand = document.querySelector('.brand-logo');
  const metrics = createDeveloperPerformance(renderer);
  const logger = createDeveloperLogger({ download });
  let hovered = false, sequence = '', lastKey = 0, open = false, pendingView = null;
  let latestMetrics = {};
  const labels = ['清晨', '黄昏', '夜晚'];
  const range = (key, label, min, max, step) => `<label class="dev-range">${label}<output data-dev-output="${key}"></output><input data-dev-scene="${key}" type="range" min="${min}" max="${max}" step="${step}"></label>`;
  $('developerLighting').innerHTML = `
    <label class="dev-row">环境类型<select data-dev-scene="preset"><option value="studio">柔光展厅</option><option value="daylight">清晨日光</option><option value="night">深色影棚</option></select></label>
    <label class="dev-row">背景颜色<input data-dev-scene="backgroundColor" type="color"></label>
    ${range('exposure', '曝光', .2, 2.5, .05)}${range('environment', '环境反射强度', 0, 3, .05)}
    ${range('keyLight', '主光强度', 0, 8, .1)}${range('lightAngle', '主光方向', -180, 180, 1)}
    <label class="dev-row">主光颜色<input data-dev-scene="lightColor" type="color"></label>
    ${range('fillLight', '补光强度', 0, 5, .1)}
    <div class="dev-checks">${[['shadows', '地面阴影'], ['reflection', '地面反射'], ['floorVisible', '展示地台'], ['grid', '辅助网格']].map(([key, label]) => `<label><input data-dev-scene="${key}" type="checkbox">${label}</label>`).join('')}</div>`;
  const inputs = [...panel.querySelectorAll('[data-dev-scene]')];
  function syncScene() {
    const state = read();
    for (const input of inputs) {
      const key = input.dataset.devScene;
      if (document.activeElement !== input) {
        if (input.type === 'checkbox') input.checked = state[key]; else input.value = state[key];
      }
      const output = panel.querySelector(`[data-dev-output="${key}"]`);
      if (output) output.value = key === 'lightAngle' ? Math.round(state[key]) + '°' : state[key].toFixed(2);
    }
    const busy = !!showroom()?.active || !!cycle()?.transitioning || !cycle();
    $('developerSceneControls').disabled = !!showroom()?.active || !cycle();
    $('developerSavePhase').disabled = busy;
    $('developerSceneHint').textContent = showroom()?.active ? '展厅运行中；退出展厅后可编辑灯光。' : cycle()?.transitioning ? '日光过渡中，完成后可保存。' : '调节后保存到所选时段；刷新后继续使用。';
  }
  function syncTiming() {
    $('developerTransition').value = getSettings().timing.transition / 1000;
    $('developerHold').value = getSettings().timing.hold / 1000;
  }
  function syncView(view = getSettings().defaultView) {
    const values = { azimuth: view.azimuth, elevation: view.elevation, framing: view.framing, showroomScale: getSettings().showroomScale };
    for (const [key, value] of Object.entries(values)) {
      const input = $('developer' + ({ azimuth: 'Azimuth', elevation: 'Elevation', framing: 'Framing', showroomScale: 'ShowroomScale' }[key]));
      if (input && document.activeElement !== input) input.value = value;
      const output = panel.querySelector(`[data-dev-view-output="${key}"]`);
      if (output) output.value = key === 'azimuth' || key === 'elevation' ? Math.round(value) + '°' : Number(value).toFixed(2) + '×';
    }
  }
  function syncCameraStatus() {
    const output = $('developerCameraStatus'), view = readCamera?.();
    if (!output) return;
    if (!view) { output.textContent = '当前视角：等待模型'; return; }
    const angle = value => Math.round(value) + '°';
    output.textContent = `实时视角：水平 ${angle(view.azimuth)} · 俯视 ${angle(view.elevation)} · 构图 ${view.framing.toFixed(2)}×`;
  }
  function refresh() {
    if (!open && !logger.isRecording()) return;
    const m = metrics.sample(); latestMetrics = m; logger.sample(m);
    if (!open) return;
    const page = status();
    $('developerPageStatus').textContent = m.lost ? '渲染已暂停' : document.hidden ? '页面在后台' : page.loading ? '模型载入中' : page.ready ? '运行正常' : '等待模型';
    $('developerMode').textContent = showroom()?.active ? '展厅模式' : '设计台';
    $('developerModel').textContent = page.name;
    $('developerPhaseStatus').textContent = $('dayCycle').getAttribute('aria-label')?.split('，')[0] || '准备日光场景';
    $('developerFps').textContent = m.fps === null ? '—' : m.fps.toFixed(0) + ' FPS';
    $('developerCpu').textContent = m.cpu === null ? '等待采样' : m.cpu.toFixed(2) + ' ms / 帧';
    $('developerGpu').textContent = !m.gpuSupported ? '浏览器不支持' : m.gpu === null ? '等待采样' : m.gpu.toFixed(2) + ' ms / 帧';
    $('developerNetwork').textContent = Number.isFinite(m.networkKbps) ? m.networkKbps.toFixed(1) + ' Kbps' : '等待采样';
    $('developerMemory').textContent = Number.isFinite(m.heap) ? (m.heap / 1048576).toFixed(1) + ' MB' : '浏览器不支持';
    $('developerMemory').title = m.heapLimit ? 'JS 堆上限：' + (m.heapLimit / 1048576).toFixed(0) + ' MB' : '';
    if (m.memoryPercent !== null) $('developerMemory').title += '；占用率：' + m.memoryPercent.toFixed(1) + '%';
    if (m.cpuPercent !== null) $('developerCpu').title = 'CPU 占用率估算：' + m.cpuPercent.toFixed(1) + '%';
    if (m.gpuPercent !== null) $('developerGpu').title = 'GPU 占用率估算：' + m.gpuPercent.toFixed(1) + '%';
    $('developerDraws').textContent = m.calls.toLocaleString();
    $('developerTriangles').textContent = m.triangles.toLocaleString();
    $('developerResources').textContent = m.geometries + ' 几何体 · ' + m.textures + ' 纹理';
    syncCameraStatus();
    syncScene();
  }
  function setOpen(value) {
    if (value === open) return;
    open = value; panel.hidden = !value; toggle.setAttribute('aria-expanded', String(value));
    toggle.setAttribute('aria-pressed', String(value)); document.body.classList.toggle('developer-open', value);
    metrics.setEnabled(value || logger.isRecording());
    if (value) { syncTiming(); syncView(); refresh(); $('developerClose').focus({ preventScroll: true }); }
    else if (!toggle.hidden) toggle.focus({ preventScroll: true });
  }
  brand.addEventListener('pointerenter', () => { hovered = true; sequence = ''; });
  brand.addEventListener('pointerleave', () => { hovered = false; sequence = ''; });
  window.addEventListener('blur', () => { hovered = false; sequence = ''; });
  document.addEventListener('keydown', event => {
    if (!hovered || event.ctrlKey || event.altKey || event.metaKey || event.repeat || event.isComposing || event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) { sequence = ''; return; }
    if (performance.now() - lastKey > 2000) sequence = '';
    lastKey = performance.now();
    const key = event.key.toLowerCase();
    if (key.length !== 1) { sequence = ''; return; }
    sequence = (sequence + key).slice(-5);
    if (sequence === 'admin') {
      sequence = ''; event.preventDefault();
      if (!toggle.hidden) { setOpen(false); toggle.hidden = true; }
      else toggle.hidden = false;
    }
  });
  toggle.onclick = () => setOpen(!open);
  $('developerClose').onclick = () => setOpen(false);
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !showroom()?.active) { event.stopPropagation(); setOpen(false); }
  });
  for (const input of inputs) input.addEventListener('input', () => {
    if (showroom()?.active || !cycle()) return;
    const key = input.dataset.devScene, kind = typeof ENVIRONMENT_DEFAULTS[key];
    cycle().cancel();
    apply({ [key]: kind === 'boolean' ? input.checked : kind === 'number' ? Number(input.value) : input.value });
    syncScene();
  });
  $('developerLoadPhase').onclick = () => { if (!showroom()?.active) { cycle()?.select($('developerPhase').value); syncScene(); } };
  function commit(next, message) {
    // Persist first: a storage failure must not claim the settings were saved.
    const saved = saveDeveloperSettings(localStorage, next);
    setSettings(saved); cycle()?.setPresets(saved.presets);
    $('developerSaveStatus').textContent = message; notify(message);
  }
  $('developerSavePhase').onclick = () => {
    if (!cycle() || cycle().transitioning || showroom()?.active) return;
    try {
      const next = structuredClone(getSettings()), id = $('developerPhase').value;
      next.presets[id] = { name: labels[PHASE_IDS.indexOf(id)] + '场景', scene: readEnvironment(read()) };
      commit(next, '已保存' + labels[PHASE_IDS.indexOf(id)] + '灯光到此浏览器'); syncScene();
    } catch (error) { notify('保存失败：' + error.message); }
  };
  $('developerTimingForm').onsubmit = event => {
    event.preventDefault();
    try {
      const timing = readTiming({ transition: $('developerTransition').valueAsNumber * 1000, hold: $('developerHold').valueAsNumber * 1000 });
      commit({ ...getSettings(), timing }, '已保存展厅时间；后续过渡与停留按新设置执行');
    } catch (error) { notify('保存失败：' + error.message); }
  };
  for (const id of ['developerAzimuth', 'developerElevation', 'developerFraming', 'developerShowroomScale']) $(id).addEventListener('input', () => {
    const key = id === 'developerAzimuth' ? 'azimuth' : id === 'developerElevation' ? 'elevation' : id === 'developerFraming' ? 'framing' : 'showroomScale';
    const output = panel.querySelector(`[data-dev-view-output="${key}"]`), value = Number($(id).value);
    if (output) output.value = key === 'azimuth' || key === 'elevation' ? Math.round(value) + '°' : value.toFixed(2) + '×';
  });
  $('developerViewForm').onsubmit = event => {
    event.preventDefault();
    try {
      const base = pendingView || getSettings().defaultView;
      const defaultView = readDefaultView({ ...base, azimuth: $('developerAzimuth').valueAsNumber, elevation: $('developerElevation').valueAsNumber, framing: $('developerFraming').valueAsNumber });
      commit({ ...getSettings(), defaultView }, '已保存默认视角'); pendingView = null; syncView();
    } catch (error) { notify('保存失败：' + error.message); }
  };
  $('developerSaveShowroomScale').onclick = () => {
    try {
      const showroomScale = readShowroomScale($('developerShowroomScale').valueAsNumber);
      commit({ ...getSettings(), showroomScale }, '已单独保存展台比例');
      syncView();
    } catch (error) { notify('保存展台比例失败：' + error.message); }
  };
  $('developerUseCurrentView').onclick = () => {
    try {
      const current = readCamera?.();
      if (!current) return notify('模型载入完成后才能读取当前视角');
      pendingView = readDefaultView(current);
      syncView(pendingView);
      notify('已读取当前视角；点击“保存默认视角”后写入配置');
    } catch (error) { notify('读取视角失败：' + error.message); }
  };
  $('developerExport').onclick = () => {
    const value = { ...getSettings(), presets: cycle()?.getPresets() || getSettings().presets };
    download(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), 'Spenic-开发者配置.json');
  };
  function operationLabel(target) {
    const control = target.closest?.('button,select,input,textarea,[role="button"],a,canvas');
    if (!control) return '';
    if (control.id === 'developerLogToggle' || control.id === 'developerLogExport') return '';
    if (control.tagName === 'CANVAS') return '操作三维画布';
    const text = control.getAttribute('aria-label') || control.title || control.textContent || control.id || control.name || control.type;
    return String(text).replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  document.addEventListener('click', event => {
    if (!logger.isRecording()) return;
    const operation = operationLabel(event.target);
    if (operation) logger.record(operation, latestMetrics);
  }, true);
  document.addEventListener('change', event => {
    if (!logger.isRecording()) return;
    const operation = operationLabel(event.target);
    if (operation) logger.record('修改：' + operation, latestMetrics);
  }, true);
  $('developerLogToggle').onclick = () => {
    if (logger.isRecording()) {
      logger.stop(latestMetrics);
      $('developerLogToggle').textContent = '开始记录';
      $('developerLogToggle').classList.add('dev-primary');
      $('developerLogExport').disabled = !logger.count();
      $('developerLogStatus').textContent = '已停止 · ' + logger.count() + ' 条';
      metrics.setEnabled(open);
      return;
    }
    metrics.setEnabled(true);
    logger.start(latestMetrics);
    $('developerLogToggle').textContent = '停止记录';
    $('developerLogToggle').classList.remove('dev-primary');
    $('developerLogExport').disabled = false;
    $('developerLogStatus').textContent = '记录中 · 1 条';
  };
  $('developerLogExport').onclick = () => {
    if (!logger.export()) return;
    logger.record('导出日志', latestMetrics);
    $('developerLogStatus').textContent = (logger.isRecording() ? '记录中 · ' : '已停止 · ') + logger.count() + ' 条';
  };
  $('developerImport').onclick = () => $('developerFile').click();
  $('developerFile').onchange = async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('配置文件不能超过 1 MB');
      const next = readDeveloperSettings(JSON.parse((await file.text()).replace(/^\uFEFF/, '')));
      commit(next, '已导入并保存开发者配置；载入时段后应用灯光'); syncTiming(); syncView(); syncScene();
    } catch (error) { notify('导入失败：' + error.message); }
  };
  renderer.domElement.addEventListener('webglcontextlost', () => { metrics.contextLost(); refresh(); });
  renderer.domElement.addEventListener('webglcontextrestored', () => metrics.contextRestored());
  document.addEventListener('visibilitychange', () => { if (open) { metrics.sample(); refresh(); } });
  setInterval(refresh, 750);
  return { beginFrame: () => metrics.begin(), endFrame: () => metrics.end() };
}
