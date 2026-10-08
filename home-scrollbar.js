(function () {
  const rail = document.querySelector('.home-scrollbar');
  const thumb = rail?.querySelector('.home-scrollbar-thumb');
  if (!rail || !thumb) return;

  function sync() {
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const trackHeight = rail.clientHeight;
    const minimum = window.innerWidth <= 800 ? 56 : 72;
    const thumbHeight = maxScroll <= 1
      ? trackHeight
      : Math.min(trackHeight, Math.max(minimum, Math.round(trackHeight * window.innerHeight / document.documentElement.scrollHeight)));
    const travel = Math.max(0, trackHeight - thumbHeight);
    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translateY(${maxScroll <= 1 ? 0 : Math.round(travel * window.scrollY / maxScroll)}px)`;
    rail.hidden = maxScroll <= 1;
  }

  function scrollFromRail(clientY) {
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const rect = rail.getBoundingClientRect();
    const travel = Math.max(1, rect.height - thumb.offsetHeight);
    const offset = Math.max(0, Math.min(travel, clientY - rect.top - thumb.offsetHeight / 2));
    window.scrollTo({ top: maxScroll * offset / travel, behavior: 'auto' });
  }

  let dragging = null;
  rail.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    if (event.target === thumb) {
      dragging = { pointerId: event.pointerId, startY: event.clientY, startScroll: window.scrollY };
      thumb.setPointerCapture?.(event.pointerId);
    } else scrollFromRail(event.clientY);
  });
  rail.addEventListener('pointermove', event => {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    const travel = Math.max(1, rail.clientHeight - thumb.offsetHeight);
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo({ top: dragging.startScroll + (event.clientY - dragging.startY) * maxScroll / travel, behavior: 'auto' });
  });
  rail.addEventListener('pointerup', () => { dragging = null; });
  rail.addEventListener('pointercancel', () => { dragging = null; });
  rail.addEventListener('lostpointercapture', () => { dragging = null; });
  rail.addEventListener('wheel', event => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
    window.scrollBy({ top: event.deltaY * unit, behavior: 'auto' });
  }, { passive: false });
  window.addEventListener('scroll', sync, { passive: true });
  window.addEventListener('resize', sync);
  new ResizeObserver(sync).observe(document.body);
  sync();
}());
