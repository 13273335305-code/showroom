import { parseFabricIdentity } from './fabric-identity.js';
import { createQrDecoder } from './qr-decoder.js';

export function mountFabricScanner({ button, apply }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'fabric-scan-dialog'; dialog.id = 'fabricScanDialog';
  dialog.setAttribute('aria-labelledby', 'fabricScanTitle');
  dialog.innerHTML = '<header class="fabric-scan-heading"><h2 id="fabricScanTitle">扫码换面料</h2><button type="button" class="fabric-scan-close" aria-label="关闭扫码">×</button></header><p class="fabric-scan-hint">扫描面料二维码，自动替换模型中该面料分类对应的部位。支持二维码扫码枪，扫描后发送回车。</p><form><label for="fabricScanInput">扫码枪 / 手动输入身份码</label><div class="fabric-scan-input-row"><input id="fabricScanInput" name="identity" autocomplete="off" spellcheck="false" placeholder="扫描二维码或输入身份码" aria-describedby="fabricScanStatus"><button class="fabric-scan-submit" type="submit">应用</button></div></form><button class="fabric-scan-camera" type="button">开启摄像头</button><div class="fabric-scan-camera-view" hidden><label for="fabricScanCamera">选择摄像头</label><select id="fabricScanCamera" aria-label="选择摄像头"></select><video class="fabric-scan-video" muted playsinline autoplay aria-label="二维码扫描画面"></video></div><p id="fabricScanStatus" class="fabric-scan-status" role="status" aria-live="polite">等待扫描面料二维码</p>';
  document.body.append(dialog);
  const input = dialog.querySelector('input'), form = dialog.querySelector('form'), submit = dialog.querySelector('[type=submit]');
  const cameraButton = dialog.querySelector('.fabric-scan-camera'), cameraView = dialog.querySelector('.fabric-scan-camera-view');
  const cameraSelect = dialog.querySelector('select'), video = dialog.querySelector('video'), status = dialog.querySelector('[role=status]');
  video.muted = true;
  let session = 0, cameraSession = 0, busy = false, starting = false, stream = null, decoder = null, timer = null;
  let lastCode = null, lastSeen = 0;
  const message = (text, state = '') => { status.textContent = text; status.dataset.state = state; };
  const controls = () => { input.readOnly = busy; submit.disabled = busy; cameraSelect.disabled = busy || starting; cameraButton.disabled = starting; cameraButton.textContent = starting ? '正在开启摄像头…' : stream ? '关闭摄像头' : '开启摄像头'; form.setAttribute('aria-busy', String(busy)); };
  function stopCamera() {
    cameraSession++; clearTimeout(timer); timer = null;
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    video.pause(); video.srcObject = null; decoder?.reset(); decoder = null;
    starting = false; cameraView.hidden = true; lastCode = null; controls();
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
    finally { busy = false; controls(); if (dialog.open && token === session && !fromCamera) input.focus({ preventScroll: true }); }
  }
  async function scan(token) {
    if (token !== cameraSession || !stream || !dialog.open) return;
    try {
      if (!busy && video.readyState >= 2) {
        const value = await decoder.decode(video);
        if (token !== cameraSession || !dialog.open) return;
        if (value) {
          const previous = lastCode; lastCode = value; lastSeen = Date.now();
          if (value !== previous) await accept(value, true);
        } else if (Date.now() - lastSeen > 1000) lastCode = null;
      }
    } catch {
      if (token !== cameraSession) return;
      stopCamera(); message('摄像头识别暂时不可用，请重新开启或使用扫码枪 / 身份码', 'error'); return;
    }
    if (token === cameraSession && dialog.open) timer = setTimeout(() => { void scan(token); }, 250);
  }
  async function startCamera(deviceId = '') {
    stopCamera();
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) { message('摄像头需要 HTTPS 或本机 localhost 环境，请使用扫码枪或输入身份码', 'error'); return; }
    starting = true; controls();
    const token = cameraSession; message('请允许使用摄像头，并将面料二维码放入画面');
    let acquired = null;
    try {
      acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (token !== cameraSession || !dialog.open) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream = acquired; cameraView.hidden = false; video.srcObject = stream; await video.play();
      const created = await createQrDecoder();
      if (token !== cameraSession || !dialog.open) { created.reset(); return; }
      decoder = created;
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
      if (token !== cameraSession || !dialog.open) return;
      cameraSelect.replaceChildren(...devices.map((device, index) => new Option(device.label || `摄像头 ${index + 1}`, device.deviceId)));
      cameraSelect.value = stream.getVideoTracks()[0]?.getSettings().deviceId || deviceId;
      starting = false; controls(); message('将二维码对准摄像头；再次扫描同一码时请先移开标签'); void scan(token);
    } catch (error) {
      acquired?.getTracks().forEach(track => track.stop());
      if (token !== cameraSession || !dialog.open) return;
      stopCamera();
      const hints = { NotAllowedError: '摄像头权限被拒绝，请在浏览器中允许，或使用扫码枪 / 身份码', NotFoundError: '未找到摄像头，请连接设备或使用扫码枪 / 身份码', NotReadableError: '摄像头无法使用，可能被其他程序占用', OverconstrainedError: '所选摄像头不可用，请重新开启摄像头' };
      message(hints[error.name] || '摄像头开启失败，请重试或使用扫码枪 / 身份码', 'error');
    }
  }
  form.addEventListener('submit', event => { event.preventDefault(); void accept(input.value); });
  input.addEventListener('keydown', event => { if (event.key !== 'Escape') event.stopPropagation(); });
  cameraButton.onclick = () => stream ? stopCamera() : void startCamera();
  cameraSelect.onchange = () => { void startCamera(cameraSelect.value); };
  button.onclick = () => { session++; if (!dialog.open) dialog.showModal(); if (!busy) message('等待扫描面料二维码'); controls(); input.focus({ preventScroll: true }); };
  const close = () => { session++; stopCamera(); };
  dialog.querySelector('.fabric-scan-close').onclick = () => dialog.close();
  dialog.addEventListener('cancel', close); dialog.addEventListener('close', close);
  window.addEventListener('pagehide', close);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
  return { close: () => dialog.close() };
}
