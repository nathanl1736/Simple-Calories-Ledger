// Press feedback (3.0): buttons, rows and chips settle to 98% the instant a finger or mouse goes down on them,
// not when `:active` gets round to it (on iOS that can be after a scroll has already begun), and ease back
// on up, cancel, leaving, or the press turning into a scroll or a drag. One delegated listener; nothing to
// wire up per component. Uses the individual `scale` property through the Web Animations API, so it
// composes with whatever `transform` or `transition` an element already has.
import { prefersReducedMotion } from '../motion';

/** What gives under a finger. */
const PRESSABLE = 'button, [role="button"], summary';
/** What doesn't: disabled things, the tab bar (it has its own), and anything that opts out. */
const NOT_PRESSABLE = ':disabled, [aria-disabled="true"], [data-no-press], .tabbar-wrap *';

export const PRESS_SCALE = 0.98;
export const PRESS_MS = 100;
/** A press that moves further than this is a scroll or a drag, not a press. */
export const PRESS_SLOP = 10;

type Press = { el: HTMLElement; pointerId: number; x: number; y: number; animation: Animation };

export function installPressFeedback(): () => void {
  if (typeof document === 'undefined' || typeof Element === 'undefined' || !('animate' in Element.prototype)) return () => undefined;
  let active: Press | null = null;

  const release = () => {
    const press = active;
    if (!press) return;
    active = null;
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', release, true);
    document.removeEventListener('pointercancel', release, true);
    document.removeEventListener('scroll', release, true);
    document.removeEventListener('contextmenu', release, true);
    window.removeEventListener('blur', release);
    press.el.removeEventListener('pointerleave', release);
    press.el.classList.remove('is-pressed');
    // Back from wherever the press had got to, so a tap that was quicker than the press doesn't jump.
    const scale = parseFloat(getComputedStyle(press.el).scale);
    press.animation.cancel();
    if (scale < 1) press.el.animate([{ scale: String(scale) }, { scale: '1' }], { duration: PRESS_MS, easing: 'ease-out' });
  };

  function onMove(event: PointerEvent) {
    if (active && event.pointerId === active.pointerId && Math.hypot(event.clientX - active.x, event.clientY - active.y) > PRESS_SLOP) release();
  }

  const onDown = (event: PointerEvent) => {
    release();
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    // Under reduced motion the button's own tint and fade (`:active`) is the feedback.
    if (prefersReducedMotion()) return;
    const el = event.target instanceof Element ? event.target.closest<HTMLElement>(PRESSABLE) : null;
    if (!el || el.matches(NOT_PRESSABLE)) return;
    el.classList.add('is-pressed');
    const animation = el.animate([{ scale: '1' }, { scale: String(PRESS_SCALE) }], { duration: PRESS_MS, easing: 'ease-out', fill: 'forwards' });
    active = { el, pointerId: event.pointerId, x: event.clientX, y: event.clientY, animation };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    document.addEventListener('scroll', release, true);
    document.addEventListener('contextmenu', release, true);
    window.addEventListener('blur', release);
    el.addEventListener('pointerleave', release);
  };

  document.addEventListener('pointerdown', onDown, true);
  return () => {
    release();
    document.removeEventListener('pointerdown', onDown, true);
  };
}
