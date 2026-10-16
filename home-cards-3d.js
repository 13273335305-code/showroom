/**
 * Aceternity-style 3D card interaction for the workspace landing page.
 *
 * This is the small, dependency-free equivalent of CardContainer/CardBody/
 * CardItem for the project's native HTML architecture: the anchor is the
 * card body, and its existing icon/copy elements become depth layers.
 */

const cards = [...document.querySelectorAll('.workspace-card')];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function setCardState(card, { rotateX = 0, rotateY = 0, glowX = 50, glowY = 50, scale = 1, active = false } = {}) {
  card.style.setProperty('--card-rotate-x', `${rotateX}deg`);
  card.style.setProperty('--card-rotate-y', `${rotateY}deg`);
  card.style.setProperty('--card-glow-x', `${glowX}%`);
  card.style.setProperty('--card-glow-y', `${glowY}%`);
  card.style.setProperty('--card-scale', scale);
  card.classList.toggle('is-tilting', active);
}

function resetCard(card) {
  setCardState(card);
}

cards.forEach((card) => {
  card.addEventListener('pointerenter', () => {
    if (reducedMotion.matches) return;
    setCardState(card, { scale: 1.04, active: true });
  });

  card.addEventListener('pointermove', (event) => {
    if (reducedMotion.matches || event.pointerType === 'touch') return;

    const bounds = card.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));

    // The pointer is mapped to a restrained tilt so the cards still feel calm
    // inside the existing glass workspace visual language.
    setCardState(card, {
      rotateX: (0.5 - y) * 9,
      rotateY: (x - 0.5) * 12,
      glowX: x * 100,
      glowY: y * 100,
      scale: 1.04,
      active: true,
    });
  });

  card.addEventListener('pointerleave', () => resetCard(card));
  card.addEventListener('pointercancel', () => resetCard(card));
  card.addEventListener('focus', () => {
    if (!reducedMotion.matches) setCardState(card, { scale: 1.04, active: true });
  });
  card.addEventListener('blur', () => resetCard(card));
});

const updateMotionPreference = () => {
  if (reducedMotion.matches) cards.forEach(resetCard);
};

if (typeof reducedMotion.addEventListener === 'function') {
  reducedMotion.addEventListener('change', updateMotionPreference);
} else {
  reducedMotion.addListener(updateMotionPreference);
}
