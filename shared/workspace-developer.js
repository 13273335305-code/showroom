import { createWorkspaceRecorder } from './workspace-recorder.js';
import { downloadFile } from './navigation.js';

const recorder = createWorkspaceRecorder();
const dialog = document.createElement('dialog');
dialog.id = 'workspaceDeveloperDialog'; dialog.className = 'workspace-developer-dialog';
dialog.dataset.workspaceDiagnostics = ''; dialog.setAttribute('aria-labelledby', 'workspaceDevTitle');
dialog.innerHTML = `<header><div><span class="workspace-dev-eyebrow">DEVELOPER</span><h2 id="workspaceDevTitle">开发者</h2></div><button type="button" class="workspace-dev-close" aria-label="关闭开发者">×</button></header>
  <div class="workspace-dev-body"><div class="workspace-dev-heading"><h3>运行日志</h3><span id="workspaceLogStatus" class="workspace-dev-status" role="status">未开始记录</span></div>
  <p class="workspace-dev-description">记录当前页面、鼠标动作、下载速度、下载内容和时间。切换工作空间页面后继续记录。</p>
  <dl class="workspace-dev-values"><div><dt>当前页面</dt><dd id="workspaceLogPage"></dd></div><div><dt>鼠标动作</dt><dd id="workspaceLogMouse">暂无鼠标动作</dd></div><div><dt>下载速度</dt><dd id="workspaceLogSpeed">0 KB/s</dd></div><div><dt>下载内容</dt><dd id="workspaceLogContent">暂无下载</dd></div><div><dt>当前时间</dt><dd id="workspaceLogTime"></dd></div></dl>
  <div class="workspace-dev-actions"><button id="workspaceLogToggle" class="workspace-dev-primary" type="button">开始记录</button><button id="workspaceLogExport" type="button" disabled>导出日志</button></div>
  <p class="workspace-dev-note">结束后可导出 CSV，用 Excel 打开。日志仅保存在本机浏览器；再次开始会替换上次日志。鼠标移动每 0.5 秒采样，状态每秒记录。</p><p class="workspace-dev-note">速度为本页面已接收数据的采样值；缓存资源可能显示为 0，跨域资源大小以浏览器提供的信息为准。</p><p id="workspaceLogError" class="workspace-dev-error" role="alert" hidden></p></div>`;
document.body.append(dialog);
const $ = id => dialog.querySelector('#' + id), entry = document.getElementById('workspaceDeveloper');
const indicator = document.createElement('button');
indicator.type = 'button'; indicator.className = 'workspace-log-indicator'; indicator.dataset.workspaceDiagnostics = '';
indicator.setAttribute('aria-haspopup', 'dialog'); indicator.setAttribute('aria-controls', dialog.id); indicator.hidden = true;
document.body.append(indicator);
let busy = false, returnFocus;
function open(trigger) { returnFocus = trigger; if (!dialog.open) dialog.showModal(); render(); }
entry?.addEventListener('click', () => open(entry)); indicator.addEventListener('click', () => open(indicator));
dialog.querySelector('.workspace-dev-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => returnFocus?.focus({ preventScroll: true }));
dialog.addEventListener('click', event => {
  const bounds = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
});
function error(message) { $('workspaceLogError').hidden = !message; $('workspaceLogError').textContent = message || ''; }
function render() {
  const current = recorder.snapshot(), recording = !!current.session?.recording;
  entry?.setAttribute('data-recording', String(recording));
  indicator.hidden = !!entry || !current.session; indicator.dataset.recording = String(recording);
  indicator.textContent = recording ? '日志记录中 · 开发者' : '开发者日志 · 已结束';
  $('workspaceLogStatus').dataset.recording = String(recording);
  $('workspaceLogStatus').textContent = recording ? '记录中' : current.session ? '已结束记录' : '未开始记录';
  $('workspaceLogPage').textContent = current.page;
  $('workspaceLogMouse').textContent = current.mouse;
  $('workspaceLogSpeed').textContent = (current.speed / 1024).toFixed(2) + ' KB/s';
  $('workspaceLogContent').textContent = current.content;
  $('workspaceLogTime').textContent = current.time;
  $('workspaceLogToggle').textContent = recording ? '结束记录' : '开始记录';
  $('workspaceLogToggle').classList.toggle('workspace-dev-stop', recording);
  $('workspaceLogToggle').disabled = busy;
  $('workspaceLogExport').disabled = busy || recording || !current.session;
  if (current.failure) error(current.failure);
}
async function perform(action) {
  busy = true; error(''); render();
  try { await action(); } catch (cause) { error(cause.message || '操作失败，请重试。'); }
  finally { busy = false; render(); }
}
$('workspaceLogToggle').addEventListener('click', () => perform(() => recorder.snapshot().session?.recording ? recorder.stop() : recorder.start()));
$('workspaceLogExport').addEventListener('click', () => perform(async () => { const result = await recorder.export(); downloadFile(result.blob, result.name); }));
recorder.subscribe(render); await recorder.ready; render();
setInterval(() => { if (dialog.open) render(); }, 1000);
