/**
 * Aceternity-style 3D card interaction for the workspace landing page.
 *
 * This is the small, dependency-free equivalent of CardContainer/CardBody/
 * CardItem for the project's native HTML architecture: the anchor stays still
 * for hit testing while its inner card and icon/copy depth layers tilt.
 */

const cards = [...document.querySelectorAll('.workspace-card')];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const hoverPointer = window.matchMedia('(hover: hover) and (pointer: fine)');

function setCardState(card, { rotateX = 0, rotateY = 0, glowX = 50, glowY = 50, scale = 1, active = false } = {}) {
  card.style.setProperty('--card-rotate-x', `${rotateX}deg`);
  card.style.setProperty('--card-rotate-y', `${rotateY}deg`);
  card.style.setProperty('--card-glow-x', `${glowX}%`);
  card.style.setProperty('--card-glow-y', `${glowY}%`);
  card.style.setProperty('--card-glow-start', active ? '#ffffffb8' : 'transparent');
  card.style.setProperty('--card-glow-mid', active ? '#ffffff36' : 'transparent');
  card.style.setProperty('--card-scale', scale);
  card.style.setProperty('--card-lift', active ? '-6px' : '0px');
  card.classList.toggle('is-tilting', active);
}

function resetCard(card) {
  setCardState(card);
}

cards.forEach((card) => {
  const hitArea = card.closest('.workspace-card-link');
  if (!hitArea) return;

  const updateFromPointer = (event) => {
    if (reducedMotion.matches || !hoverPointer.matches || event.pointerType === 'touch') return;

    // Read the stationary link, including after scrolling or a quick re-entry.
    // The visual card never participates in hit testing or pointer coordinates.
    const bounds = hitArea.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));

    // A closer perspective and wider angles make the glass layers read in 3D.
    setCardState(card, {
      rotateX: (0.5 - y) * 18,
      rotateY: (x - 0.5) * 24,
      glowX: x * 100,
      glowY: y * 100,
      scale: 1.045,
      active: true,
    });
  };

  hitArea.addEventListener('pointerenter', updateFromPointer);
  hitArea.addEventListener('pointermove', updateFromPointer);
  hitArea.addEventListener('pointerleave', () => resetCard(card));
  hitArea.addEventListener('pointercancel', () => resetCard(card));
  hitArea.addEventListener('blur', () => resetCard(card));
});

window.addEventListener('resize', () => cards.forEach(resetCard));
window.addEventListener('blur', () => cards.forEach(resetCard));

const updateMotionPreference = () => {
  if (reducedMotion.matches || !hoverPointer.matches) cards.forEach(resetCard);
};

[reducedMotion, hoverPointer].forEach((preference) => {
  if (typeof preference.addEventListener === 'function') {
    preference.addEventListener('change', updateMotionPreference);
  } else {
    preference.addListener(updateMotionPreference);
  }
});
