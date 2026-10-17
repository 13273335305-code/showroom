// Shared by every workspace entry so navigation and secondary tabs keep one log.
const STATE_KEY = 'spenic.workspace-recording.v1';
const PAGE_NAMES = { 'index.html': '工作空间', 'design.html': '设计台', 'material-editor.html': '材质编辑器', 'asset-library.html': '资产库', 'project-library.html': '项目库', 'model-parts.html': '部件配置', 'album.html': '图册' };
const COLUMNS = [['time', '时间（含时区）'], ['page', '当前页面'], ['pageUrl', '页面地址'], ['action', '事件'], ['mouse', '当前鼠标动作'], ['speed', '下载速度 (KB/s)'], ['content', '当前下载内容'], ['resource', '下载地址'], ['state', '下载状态'], ['bytes', '已接收字节'], ['detail', '说明']];

export function safeResource(value) {
  try { const url = new URL(value, globalThis.location?.href); return ['http:', 'https:'].includes(url.protocol) ? url.origin + url.pathname : url.protocol; }
  catch { return ''; }
}

function localTime(date = new Date()) {
  const offset = -date.getTimezoneOffset(), sign = offset >= 0 ? '+' : '-';
  const pad = (n, width = 2) => String(n).padStart(width, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)} ${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

export function recordingCsv(records) {
  const cell = value => {
    let text = value == null ? '' : String(value);
    // Labels and filenames are user content; keep spreadsheet formulas inert.
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  return '\uFEFF' + [COLUMNS.map(([, label]) => label), ...records.map(record => COLUMNS.map(([key]) => record[key]))].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function createWorkspaceRecorder() {
  let session = null, failure = '', mouse = '暂无鼠标动作', speed = 0, bytesThisSecond = 0, tickAt = performance.now();
  let database, timer, lastMove = 0, lastWheel = 0;
  const subscribers = new Set(), active = new Map(), tracked = [];
  const emit = () => subscribers.forEach(listener => listener());
  const readSession = () => {
    const value = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
    return value && typeof value.id === 'string' && Number.isFinite(value.startedAt) ? value : null;
  };
  const ready = new Promise((resolve, reject) => {
    const request = indexedDB.open('spenic-workspace-diagnostics', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records', { keyPath: 'key', autoIncrement: true }).createIndex('session', 'session');
    request.onsuccess = () => { database = request.result; resolve(); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('日志存储暂时不可用，请关闭旧页面后重试。'));
  });
  function transaction(mode, run) {
    return ready.then(() => new Promise((resolve, reject) => {
      const tx = database.transaction('records', mode), request = run(tx.objectStore('records'));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('无法保存日志'));
    }));
  }
  function fail(error) {
    failure = '日志保存失败：' + (error?.message || '浏览器存储不可用');
    if (session?.recording) {
      session = { ...session, recording: false, stoppedAt: Date.now() };
      try { localStorage.setItem(STATE_KEY, JSON.stringify(session)); } catch { /* Show the storage failure in the panel. */ }
    }
    clearInterval(timer); timer = null; emit();
  }
  function pageInfo() {
    const file = location.pathname.split('/').pop() || 'index.html';
    return { page: PAGE_NAMES[file] || document.title, pageUrl: safeResource(location.href) };
  }
  function snapshot() {
    const downloads = [...active.values()];
    return { session, failure, ...pageInfo(), mouse, speed, content: downloads.map(item => item.name).join('；') || '暂无下载', time: localTime() };
  }
  function record(action, extra = {}, id = session?.id) {
    if (!session?.recording || id !== session.id) return Promise.resolve();
    const data = snapshot();
    return transaction('readwrite', store => store.add({ session: id, time: data.time, page: data.page, pageUrl: data.pageUrl, action, mouse, speed: Number((speed / 1024).toFixed(2)), content: active.size ? data.content : '', resource: [...active.values()].map(item => item.url).join('；'), ...extra })).catch(fail);
  }
  function tick() {
    const now = performance.now(); speed = bytesThisSecond * 1000 / Math.max(1, now - tickAt);
    bytesThisSecond = 0; tickAt = now;
    void record('状态采样'); emit();
  }
  function updateSession(next, arrived = false) {
    const wasRecording = session?.recording, previousId = session?.id;
    session = next;
    if (session?.recording && (!wasRecording || previousId !== session.id)) {
      active.clear(); speed = 0; bytesThisSecond = 0; tickAt = performance.now(); mouse = '暂无鼠标动作';
      clearInterval(timer); timer = setInterval(tick, 1000);
      if (arrived) void record('进入页面');
    } else if (!session?.recording) { clearInterval(timer); timer = null; active.clear(); speed = 0; }
    emit();
  }
  const initialized = ready.then(() => updateSession(readSession(), true)).catch(fail);
  window.addEventListener('storage', event => {
    if (event.key !== STATE_KEY) return;
    try {
      const next = readSession();
      if (session?.recording && !next?.recording) void record('结束页面记录');
      updateSession(next, true);
    } catch (error) { fail(error); }
  });
  window.addEventListener('pagehide', () => { void record('离开页面'); });
  window.addEventListener('pageshow', event => { if (event.persisted) updateSession(readSession(), true); });
  document.addEventListener('visibilitychange', () => { void record(document.hidden ? '页面切到后台' : '页面回到前台'); });
  window.addEventListener('hashchange', () => { void record('页面位置变化'); });
  function targetLabel(target) {
    if (!(target instanceof Element)) return '页面';
    if (target.closest('[data-workspace-diagnostics]')) return '开发者日志面板';
    const control = target.closest('button,a,input,select,textarea,canvas,[role="button"]') || target;
    if (control.matches('input,textarea')) return control.type === 'password' ? '密码输入框' : '输入框' + (control.id ? ' #' + control.id : '');
    return (control.getAttribute('aria-label') || control.title || control.textContent || control.tagName).replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  function mouseEvent(event, label) {
    if (!session?.recording) return;
    mouse = `${label} · ${targetLabel(event.target)} · (${Math.round(event.clientX)}, ${Math.round(event.clientY)})`;
    void record('鼠标动作');
  }
  document.addEventListener('pointermove', event => {
    if (!session?.recording || performance.now() - lastMove < 500) return;
    lastMove = performance.now(); mouseEvent(event, event.buttons ? '拖动' : '移动');
  }, { passive: true, capture: true });
  for (const [type, label] of [['pointerdown', '按下'], ['pointerup', '松开'], ['click', '点击'], ['dblclick', '双击'], ['contextmenu', '右键菜单']]) {
    document.addEventListener(type, event => mouseEvent(event, `${label}（${['左键', '中键', '右键'][event.button] || '指针'}）`), { passive: true, capture: true });
  }
  document.addEventListener('wheel', event => {
    if (!session?.recording || performance.now() - lastWheel < 500) return;
    lastWheel = performance.now(); mouseEvent(event, `滚轮 ${event.deltaY >= 0 ? '向下' : '向上'}`);
  }, { passive: true, capture: true });

  function beginDownload(url, kind) {
    if (!session?.recording) return null;
    const clean = safeResource(url);
    if (!/^https?:/.test(clean)) return null;
    let name; try { name = decodeURIComponent(new URL(clean).pathname.split('/').pop()) || '页面资源'; } catch { name = '页面资源'; }
    const item = { id: session.id, url: clean, name, bytes: 0, kind };
    active.set(item, item);
    tracked.push({ url: clean, start: performance.now() });
    if (tracked.length > 1000) tracked.shift();
    void record('开始下载', { content: name, resource: clean, state: '下载中', bytes: 0 }); emit();
    return item;
  }
  function receive(item, size) {
    if (!item || !session?.recording || item.id !== session.id) return;
    item.bytes += size; bytesThisSecond += size;
  }
  function finishDownload(item, state = '已完成', detail = '') {
    if (!item) return;
    if (session?.recording && item.id === session.id) void record('下载' + state, { content: item.name, resource: item.url, state, bytes: item.bytes, detail });
    active.delete(item); emit();
  }
  // Count streamed fetch bytes as the application consumes them. No response clone,
  // duplicate request or full-file buffering is needed, even for large models.
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);
    const item = beginDownload(url, 'fetch');
    try {
      const response = await originalFetch.apply(this, args);
      if (!item) return response;
      if (!response.ok || !response.body) { finishDownload(item, response.ok ? '已完成' : '失败', 'HTTP ' + response.status); return response; }
      const reader = response.body.getReader();
      const stream = new ReadableStream({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) { finishDownload(item); controller.close(); }
            else { receive(item, value.byteLength); controller.enqueue(value); }
          } catch (error) { finishDownload(item, error.name === 'AbortError' ? '已取消' : '失败', error.name); controller.error(error); }
        },
        cancel(reason) { finishDownload(item, '已取消'); return reader.cancel(reason); }
      });
      const wrapped = new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
      for (const property of ['url', 'redirected', 'type']) Object.defineProperty(wrapped, property, { value: response[property] });
      return wrapped;
    } catch (error) { finishDownload(item, error.name === 'AbortError' ? '已取消' : '失败', error.name); throw error; }
  };
  const xhrOpen = XMLHttpRequest.prototype.open, xhrSend = XMLHttpRequest.prototype.send, xhrUrls = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url, ...rest) { xhrUrls.set(this, String(url)); return xhrOpen.call(this, method, url, ...rest); };
  XMLHttpRequest.prototype.send = function (...args) {
    const item = beginDownload(xhrUrls.get(this) || '', 'xhr');
    if (!item) return xhrSend.apply(this, args);
    let loaded = 0, state = '已完成';
    const progress = event => { receive(item, Math.max(0, event.loaded - loaded)); loaded = event.loaded; };
    const error = () => { state = '失败'; }, abort = () => { state = '已取消'; };
    const done = () => {
      this.removeEventListener('progress', progress); this.removeEventListener('error', error); this.removeEventListener('abort', abort); this.removeEventListener('loadend', done);
      finishDownload(item, this.status >= 400 ? '失败' : state, 'HTTP ' + this.status);
    };
    this.addEventListener('progress', progress); this.addEventListener('error', error); this.addEventListener('abort', abort); this.addEventListener('loadend', done);
    try { return xhrSend.apply(this, args); } catch (cause) { state = '失败'; done(); throw cause; }
  };
  if (typeof PerformanceObserver !== 'undefined') {
    const observer = new PerformanceObserver(list => {
      if (!session?.recording) return;
      for (const entry of list.getEntries()) {
        const url = safeResource(entry.name);
        if (!/^https?:/.test(url) || tracked.some(item => item.url === url && Math.abs(item.start - entry.startTime) < 250)) continue;
        const size = entry.transferSize || 0;
        bytesThisSecond += size;
        let name; try { name = decodeURIComponent(new URL(url).pathname.split('/').pop()); } catch { name = '页面资源'; }
        void record('资源下载完成', { content: name, resource: url, state: '已完成', bytes: size, detail: size ? '浏览器资源计时' : '缓存命中或浏览器未提供传输大小' });
      }
    });
    observer.observe({ type: 'resource', buffered: false });
  }
  return {
    ready: initialized,
    snapshot,
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
    async start() {
      await ready;
      const current = readSession();
      if (current?.recording) { updateSession(current, true); return; }
      await transaction('readwrite', store => store.clear());
      const next = { id: crypto.randomUUID(), startedAt: Date.now(), recording: true };
      localStorage.setItem(STATE_KEY, JSON.stringify(next)); failure = ''; updateSession(next);
      await record('开始记录');
    },
    async stop() {
      if (!session?.recording) return;
      tick(); await record('结束记录');
      const next = { ...session, recording: false, stoppedAt: Date.now() };
      localStorage.setItem(STATE_KEY, JSON.stringify(next)); updateSession(next);
    },
    async export() {
      if (!session) throw new Error('请先开始记录。');
      if (session.recording) throw new Error('请先结束记录再导出。');
      const rows = await transaction('readonly', store => store.index('session').getAll(session.id));
      return { blob: new Blob([recordingCsv(rows.sort((a, b) => a.time.localeCompare(b.time) || a.key - b.key))], { type: 'text/csv;charset=utf-8' }), name: 'Spenic-开发者日志-' + new Date(session.startedAt).toISOString().replace(/[:.]/g, '-') + '.csv', count: rows.length };
    }
  };
}
