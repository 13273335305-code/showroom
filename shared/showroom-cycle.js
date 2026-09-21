export const SHOWROOM_TRANSITION = 5000;
export const SHOWROOM_HOLD = 3000;

export function createShowroomLoop({ transition, cancelTransition, timing = () => ({ transition: SHOWROOM_TRANSITION, hold: SHOWROOM_HOLD }), schedule = setTimeout, unschedule = clearTimeout }) {
  let active = false, timer = null, generation = 0;
  function stop() {
    active = false; generation++;
    if (timer !== null) unschedule(timer);
    timer = null; cancelTransition();
  }
  return {
    start() {
      stop(); active = true;
      const session = generation;
      const next = () => {
        timer = null;
        if (!active || generation !== session) return;
        transition({ duration: timing().transition, onComplete() {
          if (active && generation === session) timer = schedule(next, timing().hold);
        } });
      };
      next();
    },
    stop,
    get active() { return active; }
  };
}
