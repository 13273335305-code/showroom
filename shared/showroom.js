import { createShowroomLoop } from './showroom-cycle.js';

export const SHOWROOM_UI_DELAY = 800;
export const SHOWROOM_UI_DURATION = 1500;

export function createShowroom({ button, ready, capture, enter, restore, cycle, notify, timing, schedule = setTimeout, unschedule = clearTimeout }) {
  let active = false, snapshot = null, fullscreenOwned = false, inertStates = [], uiTimer = null, session = 0;
  const loop = createShowroomLoop({ transition: options => cycle().next(options), cancelTransition: () => cycle()?.cancel(), timing });
  const hiddenUI = [...document.querySelectorAll('.topbar,.material-dock,.showroom-tools,.viewer-heading,.model-chip,.view-bottom,.axis-widget,.day-cycle,.annotation-layer')];
  function clearTimer() { if (uiTimer !== null) unschedule(uiTimer); uiTimer = null; }
  function reveal(sessionId) {
    if (!active || sessionId !== session) return;
    uiTimer = null;
    inertStates = hiddenUI.map(element => [element, element.inert]);
    hiddenUI.forEach(element => { element.inert = true; });
    document.body.classList.add('showroom-mode');
    loop.start();
  }
  function finishExit(sessionId) {
    if (sessionId !== session) return;
    clearTimer(); document.body.classList.remove('showroom-mode');
    for (const [element, inert] of inertStates) element.inert = inert;
    button.setAttribute('aria-pressed', 'false'); button.setAttribute('aria-label', '进入展厅模式');
    button.title = '展厅模式：自动旋转、全屏与日光流转';
    restore(snapshot); button.focus({ preventScroll: true });
    fullscreenOwned = false;
  }
  function exit() {
    if (!active) return;
    active = false; session++; loop.stop(); clearTimer();
    const exitFullscreen = fullscreenOwned && document.fullscreenElement ? document.exitFullscreen() : null;
    if (exitFullscreen) exitFullscreen.catch(() => {}).finally(() => finishExit(session)); else finishExit(session);
  }
  function start() {
    if (active || !ready() || !cycle()) return;
    snapshot = capture(); active = true; session++;
    const alreadyFullscreen = !!document.fullscreenElement;
    fullscreenOwned = !alreadyFullscreen;
    enter();
    button.setAttribute('aria-pressed', 'true'); button.setAttribute('aria-label', '退出展厅模式'); button.title = '退出展厅模式（Esc）';
    button.focus({ preventScroll: true });
    // Request synchronously within the click's user activation. A late result
    // must not trap the user in fullscreen after they have already exited.
    if (!alreadyFullscreen) {
      try {
        document.documentElement.requestFullscreen().then(() => {
          if (!active) { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); return; }
          uiTimer = schedule(() => reveal(session), SHOWROOM_UI_DELAY);
        }).catch(() => {
          if (active) { notify('浏览器未允许自动全屏，可按 F11；展厅模式仍可使用。'); uiTimer = schedule(() => reveal(session), SHOWROOM_UI_DELAY); }
        });
      } catch { if (active) uiTimer = schedule(() => reveal(session), SHOWROOM_UI_DELAY); }
    } else {
      uiTimer = schedule(() => reveal(session), SHOWROOM_UI_DELAY);
    }
  }
  button.onclick = () => active ? exit() : start();
  document.addEventListener('fullscreenchange', () => { if (active && fullscreenOwned && !document.fullscreenElement) exit(); });
  document.addEventListener('keydown', event => {
    if (!active) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); exit(); }
    else if (!event.ctrlKey && !event.metaKey && ['2', '4', '5', '6', '8', 'f'].includes(event.key.toLowerCase())) event.stopImmediatePropagation();
  }, true);
  return { exit, get active() { return active; } };
}
