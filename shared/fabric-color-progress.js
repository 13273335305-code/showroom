// Both the asset cards and material inspector use the same progress overlay.
export function syncFabricColorProgress(button, { pending, progress = 0 } = {}) {
  const value = Number.isFinite(Number(progress)) ? Math.max(0, Math.min(100, Math.round(Number(progress)))) : 0;
  button.setAttribute('aria-busy', String(!!pending && value < 100));
  let indicator = button.querySelector('.fabric-color-progress');
  if (!pending) { indicator?.remove(); return; }
  if (!indicator) {
    indicator = button.ownerDocument.createElement('span');
    indicator.className = 'fabric-color-progress';
    indicator.setAttribute('role', 'progressbar');
    indicator.setAttribute('aria-label', button.getAttribute('aria-label') + '加载进度');
    indicator.setAttribute('aria-valuemin', '0');
    indicator.setAttribute('aria-valuemax', '100');
    indicator.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle class="color-progress-track" cx="16" cy="16" r="14"/><circle class="color-progress-value" cx="16" cy="16" r="14" pathLength="100"/></svg><span class="color-progress-label" aria-hidden="true"></span>';
    button.append(indicator);
  }
  indicator.setAttribute('aria-valuenow', String(value));
  indicator.querySelector('.color-progress-value').style.strokeDashoffset = String(100 - value);
  indicator.querySelector('.color-progress-label').textContent = value + '%';
}
