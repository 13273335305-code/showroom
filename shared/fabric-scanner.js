import { parseFabricIdentity } from './fabric-identity.js';
import { createQrDecoder } from './qr-decoder.js';
import { createScanFeedback } from './fabric-scan-feedback.js';
import { openRearCamera } from './scan-camera.js';

export function mountFabricScanner({ button, apply }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'fabric-scan-dialog'; dialog.id = 'fabricScanDialog';
  dialog.setAttribute('aria-labelledby', 'fabricScanTitle');
  dialog.innerHTML = `
    <header class="fabric-scan-heading">
      <h2 id="fabricScanTitle">扫码换面料</h2>
      <div id="fabricScanMode" class="fabric-scan-modes" role="group" aria-label="扫码方式">
        <button type="button" data-scan-mode="camera" aria-pressed="true">摄像头</button>
        <button type="button" data-scan-mode="scanner" aria-pressed="false">扫码枪</button>
      </div>
    </header>
    <div class="fabric-scan-camera-view">
      <video class="fabric-scan-video" muted playsinline autoplay aria-label="二维码扫描画面"></video>
      <div class="fabric-scan-guide" aria-hidden="true">
        <div class="fabric-scan-camera-blur"><video muted playsinline aria-hidden="true"></video></div>
        <div class="fabric-scan-demo">
          <img src="${new URL('../assets/fabric-scan-placeholder.svg', import.meta.url).href}" alt="" draggable="false">
          <span class="fabric-scan-beam fabric-scan-beam-top"></span>
          <span class="fabric-scan-beam fabric-scan-beam-bottom"></span>
        </div>
        <div class="fabric-scan-outline"></div>
        <div class="fabric-scan-feedback"><div class="fabric-scan-loading"></div><div class="fabric-scan-material"></div></div>
      </div>
    </div>
    <p id="fabricScanStatus" class="fabric-scan-status" role="status" aria-live="polite"></p>`;
  document.body.append(dialog);
  const video = dialog.querySelector('video'), status = dialog.querySelector('[role=status]');
  const modeButtons = [...dialog.querySelectorAll('[data-scan-mode]')];
  const dock = button.closest('.material-dock');
  const feedback = createScanFeedback(dialog.querySelector('.fabric-scan-guide'));
  const scanCanvas = document.createElement('canvas'), scanContext = scanCanvas.getContext('2d', { willReadFrequently: true });
  video.muted = true;
  let session = 0, cameraSession = 0, busy = false, starting = false, stream = null, decoder = null, timer = null, active = false;
  let lastCode = null, lastSeen = 0, frameFailures = 0;
  let mode = 'camera', keyboardCode = '', keyboardLastKey = 0;
  try { if (localStorage.getItem('spenic-fabric-scan-mode') === 'scanner') mode = 'scanner'; } catch {}
  const message = (text, state = '') => { status.textContent = text; status.dataset.state = state; };
  const controls = () => {
    dialog.setAttribute('aria-busy', String(busy));
    dialog.classList.toggle('has-camera', !!stream);
    dialog.classList.toggle('is-keyboard', mode === 'scanner');
    modeButtons.forEach(control => control.setAttribute('aria-pressed', String(control.dataset.scanMode === mode)));
  };
  function position() {
    if (!dock) return;
    const bounds = dock.getBoundingClientRect();
    const bottom = Math.max(12, innerHeight - bounds.top + 12);
    dialog.style.setProperty('--fabric-scan-bottom', `${bottom}px`);
    dialog.style.setProperty('--fabric-scan-right', `${Math.max(12, innerWidth - bounds.right)}px`);
    dialog.style.setProperty('--fabric-scan-space', `${Math.max(120, innerHeight - bottom - 76)}px`);
  }
  function stopCamera() {
    feedback.reset();
    cameraSession++; clearTimeout(timer); timer = null;
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    video.pause(); video.srcObject = null; decoder?.reset(); decoder = null;
    starting = false; lastCode = null; frameFailures = 0; controls();
  }
  function useScannerFallback(text) {
    const cameraHadFocus = document.activeElement === modeButtons[0];
    session++; busy = false; mode = 'scanner'; keyboardCode = ''; stopCamera();
    message(text);
    if (cameraHadFocus) modeButtons[1].focus({ preventScroll: true });
  }
  async function accept(value) {
    if (busy || !dialog.open) return;
    busy = true; controls();
    const token = session; let recognition = null;
    try {
      const id = parseFabricIdentity(value);
      message('正在读取面料并替换对应部位…');
      recognition = feedback.start();
      const result = await apply(id, {
        isCurrent: () => dialog.open && token === session,
        onPreview: preview => { if (recognition) void feedback.preview(recognition, preview); }
      });
      if (!dialog.open || token !== session) return;
      if (recognition) feedback.succeed(recognition);
      message(result || '面料已应用，可以继续扫描；支持撤销', 'success');
    } catch (error) { if (dialog.open && token === session) { feedback.reset(); message(error.message || '面料应用失败，请重试', 'error'); } }
    finally { if (token === session) { busy = false; controls(); } }
  }
  async function scan(token) {
    if (token !== cameraSession || !stream || !dialog.open) return;
    if (!busy && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0 && decoder) {
      try {
        // Decode the same centered square shown in the camera window.
        const side = Math.min(video.videoWidth, video.videoHeight), size = Math.min(side, 960);
        if (scanCanvas.width !== size) { scanCanvas.width = size; scanCanvas.height = size; }
        scanContext.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, size, size);
        const value = await decoder.decode(scanCanvas);
        if (token !== cameraSession || !dialog.open) return;
        frameFailures = 0;
        if (value) {
          const previous = lastCode; lastCode = value; lastSeen = Date.now();
          if (value !== previous) await accept(value);
        } else if (Date.now() - lastSeen > 1000) lastCode = null;
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
          message('相机画面可用，二维码识别暂时不可用；点“摄像头”重试或切换扫码枪', 'error');
        }
      }
    }
    if (token === cameraSession && dialog.open) timer = setTimeout(() => { void scan(token); }, 250);
  }
  async function startCamera() {
    if (mode !== 'camera') return;
    stopCamera();
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) { useScannerFallback('摄像头不可用，已切换到扫码枪，请扫描面料标签'); return; }
    starting = true; controls();
    const token = cameraSession; message('请允许使用摄像头，将二维码放入画面');
    let acquired = null;
    try {
      acquired = await openRearCamera(navigator.mediaDevices, () => token === cameraSession && dialog.open);
      if (!acquired) return;
      stream = acquired; video.srcObject = stream; await video.play();
      const created = await createQrDecoder();
      if (token !== cameraSession || !dialog.open) { created.reset(); return; }
      decoder = created; starting = false; controls(); message('对准面料二维码，识别后自动应用');
      stream.getVideoTracks().forEach(track => {
        track.addEventListener('ended', () => {
          if (token !== cameraSession || !dialog.open) return;
          stopCamera(); message('摄像头连接已中断，点“摄像头”重新开启', 'error');
        }, { once: true });
      });
      void scan(token);
    } catch (error) {
      acquired?.getTracks().forEach(track => track.stop());
      if (token !== cameraSession || !dialog.open) return;
      if (['NotFoundError', 'DevicesNotFoundError'].includes(error.name)) { useScannerFallback('未检测到摄像头，已切换到扫码枪，请扫描面料标签'); return; }
      stopCamera();
      const hints = { NotAllowedError: '摄像头权限被拒绝，请在浏览器中允许，或切换扫码枪', NotReadableError: '摄像头无法使用，可能被其他程序占用', OverconstrainedError: '摄像头不可用，点“摄像头”重试或切换扫码枪' };
      message(hints[error.name] || '摄像头开启失败，点“摄像头”重试或切换扫码枪', 'error');
    }
  }
  function close() {
    if (!active) return;
    active = false;
    session++; busy = false; keyboardCode = ''; stopCamera();
    button.setAttribute('aria-expanded', 'false');
  }
  function dismiss() { if (dialog.open) { dialog.close(); close(); } }
  modeButtons.forEach(control => control.onclick = () => {
    if (mode === control.dataset.scanMode && (mode === 'scanner' || starting || (stream && decoder))) return;
    session++; busy = false; mode = control.dataset.scanMode; keyboardCode = ''; stopCamera();
    try { localStorage.setItem('spenic-fabric-scan-mode', mode); } catch {}
    if (mode === 'camera') void startCamera();
    else message('请使用扫码枪扫描面料标签，识别后自动应用');
  });
  button.onclick = () => {
    if (dialog.open) { dismiss(); return; }
    active = true; session++; position(); dialog.show(); button.setAttribute('aria-expanded', 'true');
    modeButtons.find(control => control.dataset.scanMode === mode).focus({ preventScroll: true }); controls();
    if (mode === 'camera') void startCamera();
    else message('请使用扫码枪扫描面料标签，识别后自动应用');
  };
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  dialog.addEventListener('close', () => { if (!dialog.open) close(); });
  document.addEventListener('keydown', event => {
    if (dialog.open && event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); dismiss(); button.focus({ preventScroll: true }); }
    if (!dialog.open || mode !== 'scanner' || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    // A keyboard-wedge scanner can keep working while the user rotates the
    // model. Leave real text fields alone, and isolate scan keys from shortcuts.
    if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) { keyboardCode = ''; return; }
    if (event.key.length !== 1 && event.key !== 'Enter') return;
    if (Date.now() - keyboardLastKey > 250) keyboardCode = '';
    keyboardLastKey = Date.now();
    if (event.key === 'Enter' && !keyboardCode && !busy) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (busy || event.repeat) { keyboardCode = ''; return; }
    if (event.key === 'Enter') {
      const value = keyboardCode; keyboardCode = ''; void accept(value);
    } else {
      keyboardCode = (keyboardCode + event.key).slice(-128);
    }
  }, true);
  window.addEventListener('blur', () => { keyboardCode = ''; });
  window.addEventListener('pagehide', dismiss);
  document.addEventListener('visibilitychange', () => {
    if (!dialog.open) return;
    if (document.hidden) { keyboardCode = ''; stopCamera(); }
    else if (mode === 'camera') void startCamera();
  });
  window.addEventListener('resize', position);
  if (dock) new ResizeObserver(position).observe(dock);
  new MutationObserver(() => { if (document.body.classList.contains('capture-mode') || document.body.classList.contains('showroom-mode')) dismiss(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return { close: dismiss };
}
