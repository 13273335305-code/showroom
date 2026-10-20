import { parseFabricIdentity } from './fabric-identity.js';
import { createQrDecoder } from './qr-decoder.js';

export function mountFabricScanner({ button, apply }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'fabric-scan-dialog'; dialog.id = 'fabricScanDialog';
  dialog.setAttribute('aria-labelledby', 'fabricScanTitle');
  dialog.innerHTML = `
    <header class="fabric-scan-heading">
      <button type="button" class="fabric-scan-back fabric-scan-icon" aria-label="返回扫码" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg></button>
      <h2 id="fabricScanTitle">扫码换面料</h2>
      <button type="button" class="fabric-scan-settings fabric-scan-icon" aria-label="扫码设置" title="扫码设置" aria-controls="fabricScanSettings" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 3h5l.6 2.4 1.3.8 2.4-.7 2.5 4.3-1.8 1.5v1.4l1.8 1.5-2.5 4.3-2.4-.7-1.3.8-.6 2.4h-5l-.6-2.4-1.3-.8-2.4.7-2.5-4.3 1.8-1.5v-1.4L2.2 9.8l2.5-4.3 2.4.7 1.3-.8z"/><circle cx="12" cy="12" r="3"/></svg></button>
    </header>
    <div class="fabric-scan-camera-view">
      <video class="fabric-scan-video" muted playsinline autoplay aria-label="二维码扫描画面"></video>
      <div class="fabric-scan-guide" aria-hidden="true"></div>
    </div>
    <section id="fabricScanSettings" class="fabric-scan-settings-page" aria-label="扫码设置" hidden>
      <label for="fabricScanCamera">摄像头</label>
      <select id="fabricScanCamera" aria-label="选择摄像头"><option value="">默认摄像头</option></select>
      <button class="fabric-scan-camera" type="button">开启摄像头</button>
      <form>
        <label for="fabricScanInput">扫码枪 / 手动输入身份码</label>
        <div class="fabric-scan-input-row"><input id="fabricScanInput" name="identity" autocomplete="off" spellcheck="false" placeholder="扫描或输入身份码" aria-describedby="fabricScanStatus"><button class="fabric-scan-submit" type="submit">应用</button></div>
      </form>
    </section>
    <p id="fabricScanStatus" class="fabric-scan-status" role="status" aria-live="polite">正在开启摄像头…</p>`;
  document.body.append(dialog);
  const input = dialog.querySelector('input'), form = dialog.querySelector('form'), submit = dialog.querySelector('[type=submit]');
  const cameraButton = dialog.querySelector('.fabric-scan-camera'), cameraView = dialog.querySelector('.fabric-scan-camera-view');
  const cameraSelect = dialog.querySelector('select'), video = dialog.querySelector('video'), status = dialog.querySelector('[role=status]');
  const settingsButton = dialog.querySelector('.fabric-scan-settings'), settingsPage = dialog.querySelector('.fabric-scan-settings-page');
  const backButton = dialog.querySelector('.fabric-scan-back'), title = dialog.querySelector('h2');
  const dock = button.closest('.material-dock');
  const scanCanvas = document.createElement('canvas'), scanContext = scanCanvas.getContext('2d', { willReadFrequently: true });
  video.muted = true;
  let session = 0, cameraSession = 0, busy = false, starting = false, stream = null, decoder = null, timer = null, active = false;
  let lastCode = null, lastSeen = 0, preferredCamera = '', inSettings = false, frameFailures = 0;
  const message = (text, state = '') => { status.textContent = text; status.dataset.state = state; };
  const controls = () => {
    input.readOnly = busy; submit.disabled = busy; cameraSelect.disabled = busy || starting; cameraButton.disabled = busy || starting;
    cameraButton.textContent = starting ? '正在开启摄像头…' : stream ? '关闭摄像头' : '开启摄像头';
    form.setAttribute('aria-busy', String(busy));
    dialog.classList.toggle('has-camera', !!stream);
  };
  function position() {
    if (!dock) return;
    const bounds = dock.getBoundingClientRect();
    const bottom = Math.max(12, innerHeight - bounds.top + 12);
    dialog.style.setProperty('--fabric-scan-bottom', `${bottom}px`);
    dialog.style.setProperty('--fabric-scan-right', `${Math.max(12, innerWidth - bounds.right)}px`);
    dialog.style.setProperty('--fabric-scan-space', `${Math.max(120, innerHeight - bottom - 76)}px`);
  }
  function showSettings(show, focus = true) {
    inSettings = show; settingsPage.hidden = !show; cameraView.hidden = show; backButton.hidden = !show; settingsButton.hidden = show;
    settingsButton.setAttribute('aria-expanded', String(show));
    dialog.classList.toggle('is-settings', show); title.textContent = show ? '扫码设置' : '扫码换面料';
    if (!show && stream) {
      if (video.paused) void video.play().catch(() => {});
      message('对准面料二维码，识别后自动应用');
    } else if (!show && starting) {
      message('正在开启摄像头…');
    }
    if (focus) (show ? (cameraSelect.disabled ? backButton : cameraSelect) : settingsButton).focus({ preventScroll: true });
  }
  function stopCamera() {
    cameraSession++; clearTimeout(timer); timer = null;
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    video.pause(); video.srcObject = null; decoder?.reset(); decoder = null;
    starting = false; lastCode = null; frameFailures = 0; controls();
  }
  async function accept(value, fromCamera = false) {
    if (busy || !dialog.open) return;
    busy = true; controls();
    const token = session;
    try {
      const id = parseFabricIdentity(value); message('正在读取面料并替换对应部位…');
      const result = await apply(id, { isCurrent: () => dialog.open && token === session });
      if (!dialog.open || token !== session) return;
      input.value = ''; message(result || '面料已应用，可以继续扫描；支持撤销', 'success');
    } catch (error) { if (dialog.open && token === session) message(error.message || '面料应用失败，请重试', 'error'); }
    finally { busy = false; controls(); if (dialog.open && token === session && !fromCamera && inSettings) input.focus({ preventScroll: true }); }
  }
  async function scan(token) {
    if (token !== cameraSession || !stream || !dialog.open) return;
    if (!busy && !inSettings && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0 && decoder) {
      try {
        // Decode the same centered square shown in the camera window.
        const side = Math.min(video.videoWidth, video.videoHeight), size = Math.min(side, 960);
        if (scanCanvas.width !== size) { scanCanvas.width = size; scanCanvas.height = size; }
        scanContext.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, size, size);
        const value = await decoder.decode(scanCanvas);
        if (token !== cameraSession || !dialog.open) return;
        frameFailures = 0;
        if (!inSettings && value) {
          const previous = lastCode; lastCode = value; lastSeen = Date.now();
          if (value !== previous) await accept(value, true);
        } else if (!inSettings && Date.now() - lastSeen > 1000) lastCode = null;
      } catch {
        if (token !== cameraSession || !dialog.open) return;
        frameFailures++;
        try {
          decoder?.reset();
          decoder = await createQrDecoder();
          if (token !== cameraSession || !dialog.open) { decoder.reset(); decoder = null; return; }
          message(frameFailures === 1 ? '正在恢复二维码识别…' : '请保持二维码在画面内，正在重试识别…');
        } catch {
          if (token !== cameraSession || !dialog.open) return;
          decoder = null;
          message('相机画面可用，二维码识别暂时不可用；请在设置中重试或使用扫码枪', 'error');
        }
      }
    }
    if (token === cameraSession && dialog.open) timer = setTimeout(() => { void scan(token); }, 250);
  }
  async function startCamera(deviceId = preferredCamera) {
    stopCamera();
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) { message('摄像头需要 HTTPS 或本机环境，可在设置中使用扫码枪或输入身份码', 'error'); return; }
    starting = true; controls();
    const token = cameraSession; message('请允许使用摄像头，将二维码放入画面');
    let acquired = null;
    try {
      acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' }, width: { ideal: 720 }, height: { ideal: 720 } } });
      if (token !== cameraSession || !dialog.open) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream = acquired; video.srcObject = stream; await video.play();
      const created = await createQrDecoder();
      if (token !== cameraSession || !dialog.open) { created.reset(); return; }
      decoder = created;
      frameFailures = 0;
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
      if (token !== cameraSession || !dialog.open) return;
      cameraSelect.replaceChildren(...devices.map((device, index) => new Option(device.label || `摄像头 ${index + 1}`, device.deviceId)));
      preferredCamera = stream.getVideoTracks()[0]?.getSettings().deviceId || deviceId;
      if (!cameraSelect.options.length) cameraSelect.add(new Option('默认摄像头', preferredCamera));
      cameraSelect.value = preferredCamera || cameraSelect.options[0].value;
      starting = false; controls(); message('对准面料二维码，识别后自动应用');
      stream.getVideoTracks().forEach(track => {
        track.addEventListener('ended', () => {
          if (token !== cameraSession || !dialog.open) return;
          stopCamera(); message('摄像头连接已中断，请进入设置重新开启', 'error');
        }, { once: true });
      });
      void scan(token);
    } catch (error) {
      acquired?.getTracks().forEach(track => track.stop());
      if (token !== cameraSession || !dialog.open) return;
      stopCamera();
      const hints = { NotAllowedError: '摄像头权限被拒绝，请在浏览器中允许，或在设置中使用扫码枪', NotFoundError: '未找到摄像头，请连接设备，或在设置中使用扫码枪', NotReadableError: '摄像头无法使用，可能被其他程序占用', OverconstrainedError: '所选摄像头不可用，请在设置中切换摄像头' };
      message(hints[error.name] || '摄像头开启失败，请在设置中重试或输入身份码', 'error');
    }
  }
  function close() {
    if (!active) return;
    active = false;
    session++; stopCamera(); input.value = '';
    button.setAttribute('aria-expanded', 'false');
  }
  function dismiss() { if (dialog.open) { dialog.close(); close(); } }
  form.addEventListener('submit', event => { event.preventDefault(); void accept(input.value); });
  input.addEventListener('keydown', event => { if (event.key !== 'Escape') event.stopPropagation(); });
  cameraButton.onclick = () => { if (stream) { stopCamera(); message('摄像头已关闭，可输入身份码或重新开启'); } else void startCamera(); };
  cameraSelect.onchange = () => { preferredCamera = cameraSelect.value; void startCamera(); };
  settingsButton.onclick = () => showSettings(true);
  backButton.onclick = () => {
    const retry = !stream && status.dataset.state === 'error' && !starting;
    showSettings(false);
    if (retry) void startCamera();
  };
  button.onclick = () => {
    if (dialog.open) { dismiss(); return; }
    active = true; session++; position(); showSettings(false, false); dialog.show(); button.setAttribute('aria-expanded', 'true');
    settingsButton.focus({ preventScroll: true }); controls(); void startCamera();
  };
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  dialog.addEventListener('close', () => { if (!dialog.open) close(); });
  document.addEventListener('keydown', event => {
    if (dialog.open && event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); dismiss(); button.focus({ preventScroll: true }); }
  }, true);
  window.addEventListener('pagehide', dismiss);
  document.addEventListener('visibilitychange', () => { if (document.hidden && dialog.open) { stopCamera(); message('摄像头已暂停，可在设置中重新开启'); } });
  window.addEventListener('resize', position);
  if (dock) new ResizeObserver(position).observe(dock);
  new MutationObserver(() => { if (document.body.classList.contains('capture-mode') || document.body.classList.contains('showroom-mode')) dismiss(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return { close: dismiss };
}
