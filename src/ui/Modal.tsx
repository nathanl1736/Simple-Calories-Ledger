import { ReactNode, type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../motion';

export const MODAL_SCROLL_LOCK_RELEASED_EVENT = 'modal-scroll-lock-released';
export let modalScrollLockCount = 0;
let modalScrollLockY = 0;
let lockTouchStartY = 0;
let lockTouchStartX = 0;

/**
 * True when `target` sits inside a modal element that can still scroll in
 * `direction` ('down' = content moves up, scrollTop grows).
 */
function modalCanScroll(target: EventTarget | null, direction: 'up' | 'down') {
  let el = target instanceof Element ? target : null;
  while (el && !el.classList.contains('modal-backdrop')) {
    if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 1) {
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') {
        if (direction === 'down' ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true;
      }
    }
    el = el.parentElement;
  }
  return false;
}

function onLockTouchStart(event: TouchEvent) {
  lockTouchStartY = event.touches[0]?.clientY ?? 0;
  lockTouchStartX = event.touches[0]?.clientX ?? 0;
}

function onLockTouchMove(event: TouchEvent) {
  const touch = event.touches[0];
  if (!touch || event.touches.length > 1) return;
  const dy = touch.clientY - lockTouchStartY;
  const dx = touch.clientX - lockTouchStartX;
  // Sideways drags (sliders, chip rows) can't scroll the page vertically.
  if (Math.abs(dx) > Math.abs(dy)) return;
  if (!modalCanScroll(event.target, dy < 0 ? 'down' : 'up')) event.preventDefault();
}

function onLockWheel(event: WheelEvent) {
  if (!event.deltaY) return;
  if (!modalCanScroll(event.target, event.deltaY > 0 ? 'down' : 'up')) event.preventDefault();
}

/**
 * Stops the page behind modals from scrolling. This deliberately leaves html and
 * body styles alone: the previous lock made body position:fixed, and in an iOS
 * home-screen app (viewport-fit=cover, translucent status bar) WebKit then
 * measured the viewport about a status bar shorter, so the tab bar and scrim
 * sat too high, the sticky header vanished, and everything snapped back when
 * the lock was released at the end of the close animation. Shared across
 * modals so handoffs never unlock early.
 */
export function acquireModalScrollLock() {
  if (modalScrollLockCount === 0) {
    modalScrollLockY = window.scrollY;
    document.addEventListener('touchstart', onLockTouchStart, { passive: true });
    document.addEventListener('touchmove', onLockTouchMove, { passive: false });
    document.addEventListener('wheel', onLockWheel, { passive: false });
  }

  modalScrollLockCount += 1;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    modalScrollLockCount = Math.max(0, modalScrollLockCount - 1);
    if (modalScrollLockCount > 0) return;

    document.removeEventListener('touchstart', onLockTouchStart);
    document.removeEventListener('touchmove', onLockTouchMove);
    document.removeEventListener('wheel', onLockWheel);
    // Only if something moved the page anyway (e.g. iOS scrolling for the keyboard).
    if (Math.abs(window.scrollY - modalScrollLockY) > 1) window.scrollTo(0, modalScrollLockY);
    window.dispatchEvent(new Event(MODAL_SCROLL_LOCK_RELEASED_EVENT));
  };
}

export const KEYBOARD_STAND_IN = 'keyboard-stand-in';

/**
 * iOS only opens the keyboard for a field focused during the tap itself, but a sheet's
 * fields render a moment after the tap and it then slides in. This invisible field takes
 * focus during the tap so the keyboard comes up at once, and the real field takes it over
 * once the sheet is in place (takeKeyboardFromStandIn). `kind` is the keyboard it brings
 * up: numbers for Log food's calories, letters for search.
 */
export function holdKeyboard(kind: 'decimal' | 'search') {
  document.querySelector(`.${KEYBOARD_STAND_IN}`)?.remove();
  const standIn = document.createElement('input');
  standIn.className = KEYBOARD_STAND_IN;
  standIn.inputMode = kind;
  if (kind === 'search') {
    standIn.type = 'search';
    standIn.enterKeyHint = 'search';
    standIn.autocapitalize = 'none';
    standIn.setAttribute('autocorrect', 'off');
  }
  standIn.tabIndex = -1;
  standIn.setAttribute('aria-hidden', 'true');
  // On screen, as iOS scrolls to a focused field that is off it; 16px stops iOS zooming in.
  standIn.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;min-height:0;padding:0;border:0;opacity:0;font-size:16px;pointer-events:none;';
  document.body.appendChild(standIn);
  standIn.focus({ preventScroll: true });
  // Only if no sheet takes over; it normally does within half a second.
  window.setTimeout(() => standIn.remove(), 2000);
}

/** Moves the keyboard from the stand-in to `input`, returning anything typed into the stand-in meanwhile. */
export function takeKeyboardFromStandIn(input: HTMLInputElement) {
  const standIn = document.querySelector<HTMLInputElement>(`.${KEYBOARD_STAND_IN}`);
  const typed = standIn?.value.trim() || '';
  // Straight into the field as well as state, so a key pressed before React re-renders adds to it.
  if (typed) input.value = typed;
  input.focus({ preventScroll: true });
  standIn?.remove();
  return typed;
}

/**
 * Runs `fn` once no modal holds the scroll lock. Releasing the lock can restore
 * the old scroll offset, so scrolling to a section any earlier could be undone.
 */
export function afterModalScrollLock(fn: () => void) {
  const run = () => requestAnimationFrame(() => requestAnimationFrame(fn));
  if (!modalScrollLockCount) {
    run();
    return;
  }
  const onReleased = () => {
    window.removeEventListener(MODAL_SCROLL_LOCK_RELEASED_EVENT, onReleased);
    run();
  };
  window.addEventListener(MODAL_SCROLL_LOCK_RELEASED_EVENT, onReleased);
}

/**
 * A sheet. Every sheet can always be closed (X, scrim, swipe down, Esc): one waiting on Gemini
 * lets its request carry on and says when it's done, rather than holding the person there.
 */
export function Modal({ open, title, children, onClose, wide = false, className = '', bottomSheet = false }: { open: boolean; title: string; children: ReactNode; onClose: () => void; wide?: boolean; className?: string; bottomSheet?: boolean }) {
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);
  // `entered` drives the CSS transition for bottom-sheet open/close.
  // Default (not entered) = panel offscreen; entered = panel in view.
  const [entered, setEntered] = useState(false);
  const closingRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof window.setTimeout> | undefined>(undefined);
  const rafRef = useRef<ReturnType<typeof requestAnimationFrame> | undefined>(undefined);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const renderedRef = useRef(rendered);
  renderedRef.current = rendered;
  const panelRef = useRef<HTMLElement>(null);
  // Sheets slide out in 260 ms (they came in over 420); under reduced motion they cross-fade for 200 instead.
  const closeMs = useCallback(() => bottomSheet ? (prefersReducedMotion() ? 200 : 260) : 180, [bottomSheet]);

  // Body scroll lock is shared across modal instances so handoffs cannot unlock the page early.
  useEffect(() => {
    if (!rendered) return;
    return acquireModalScrollLock();
  }, [rendered]);

  // Single close gate — all dismiss paths funnel here. A swipe passes the time its own flick-out takes.
  const requestClose = useCallback((ms?: number) => {
    if (closingRef.current) return;
    closingRef.current = true;
    cancelAnimationFrame(rafRef.current!);
    // Removing `entered` triggers the CSS transition back to translate3d(0,110%,0).
    setEntered(false);
    setClosing(true);
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setRendered(false);
      setClosing(false);
      closingRef.current = false;
      onCloseRef.current();
    }, ms ?? closeMs());
  }, [closeMs]);

  // Swipe down to close, like an iOS sheet: from the handle/title bar, or from the
  // content once it is scrolled to the top. Native listeners, because React's
  // touch handlers are passive and could not stop the page scrolling.
  // The panel follows the finger 1:1 (from wherever it is: it may still be sliding in), gives way
  // slowly if pulled up past its resting place, and on release carries the finger's own speed on:
  // out if it was flicked down or pulled far, back if it was lifted, taking as long as the rest of
  // the way takes at that speed (never under 120 ms or over 260).
  useEffect(() => {
    const panel = panelRef.current;
    if (!rendered || !panel) return;
    let startX = 0;
    let startY = 0;
    let eligible = false;
    let decided = false;
    let dragging = false;
    /** Where the panel sat when the finger took hold, and where it is now (past the top, this is the eased distance). */
    let base = 0;
    let offset = 0;
    let samples: { y: number; t: number }[] = [];
    const scrim = () => panel.parentElement?.querySelector<HTMLElement>(':scope > .modal-scrim') || null;
    const isTopmost = () => {
      const backdrops = document.querySelectorAll('.modal-backdrop');
      return backdrops[backdrops.length - 1] === panel.parentElement;
    };
    const panelY = () => {
      const transform = getComputedStyle(panel).transform;
      if (!transform || transform === 'none') return 0;
      try { return new DOMMatrixReadOnly(transform).m42; } catch { return 0; }
    };
    const reset = () => {
      dragging = false;
      decided = false;
      offset = 0;
      samples = [];
    };
    const onStart = (event: TouchEvent) => {
      reset();
      const target = event.target instanceof Element ? event.target : null;
      eligible = !!target
        && event.touches.length === 1
        && !closingRef.current
        && isTopmost()
        // Typing and sliders keep their own gestures.
        && !target.closest('input, textarea, select, [contenteditable="true"]')
        && (!!target.closest('.modal-head') || !modalCanScroll(target, 'up'));
      startX = event.touches[0]?.clientX ?? 0;
      startY = event.touches[0]?.clientY ?? 0;
      samples = [{ y: startY, t: event.timeStamp }];
    };
    const onMove = (event: TouchEvent) => {
      if (!eligible) return;
      const touch = event.touches[0];
      if (!touch) return;
      const dy = touch.clientY - startY;
      const dx = touch.clientX - startX;
      if (!decided) {
        if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
        decided = true;
        dragging = dy > 0 && Math.abs(dy) > Math.abs(dx);
        if (!dragging) return;
        // Take hold from the live position, so grabbing a sheet that is still arriving doesn't make it jump.
        base = panelY();
        panel.style.transition = 'none';
        // An entrance animation still running would otherwise hold the transform (and the scrim's opacity) and ignore the finger.
        panel.style.animation = 'none';
        const fade = scrim();
        if (fade) fade.style.animation = 'none';
      }
      if (!dragging) return;
      event.preventDefault();
      const raw = base + dy;
      // Past the top it resists: a third of the way, then no more. (Down, it is 1:1.)
      offset = raw < 0 ? raw * 0.35 : raw;
      panel.style.transform = `translate3d(0, ${offset}px, 0)`;
      panel.classList.toggle('is-pulled', offset < 0);
      samples.push({ y: touch.clientY, t: event.timeStamp });
      while (samples.length > 2 && event.timeStamp - samples[0].t > 100) samples.shift();
      const fade = scrim();
      if (fade) fade.style.opacity = String(Math.min(1, Math.max(0.25, 1 - Math.max(0, offset) / Math.max(panel.offsetHeight, 1))));
    };
    const onEnd = (event: TouchEvent) => {
      if (!dragging) return reset();
      const height = Math.max(panel.offsetHeight, 1);
      // The finger's speed as it left, px per ms, down the screen positive. Resting before lifting counts as none.
      const last = samples[samples.length - 1];
      const first = samples.find(sample => event.timeStamp - sample.t <= 100) || last;
      const velocity = last && first && last.t > first.t && event.timeStamp - last.t <= 80 ? (last.y - first.y) / (last.t - first.t) : 0;
      const flicked = velocity > 0.6 && offset > 40;
      const far = offset > Math.min(140, height * 0.25);
      const lifted = velocity < -0.25;
      const dismiss = !lifted && (flicked || far);
      const fade = scrim();
      const reduceMotion = prefersReducedMotion();
      const remaining = Math.max(1, dismiss ? height * 1.1 - offset : Math.abs(offset));
      const ms = reduceMotion ? 200 : Math.round(Math.min(260, Math.max(120, remaining / Math.max(Math.abs(velocity), 0.001))));
      // Carrying speed on wants a curve that starts at about the finger's pace; from rest, the sheet's own.
      const ease = Math.abs(velocity) >= 0.3 ? 'cubic-bezier(.4, .4, .6, 1)' : 'cubic-bezier(.32, .72, 0, 1)';
      if (dismiss) {
        if (reduceMotion) {
          // No sliding: it fades where it was let go.
          panel.style.transition = `opacity ${ms}ms ease`;
          panel.style.opacity = '0';
        } else {
          panel.style.transition = `transform ${ms}ms ${ease}`;
          panel.style.transform = 'translate3d(0, 110%, 0)';
        }
        if (fade) {
          fade.style.transition = `opacity ${ms}ms ease`;
          fade.style.opacity = '0';
        }
        requestClose(ms);
      } else {
        panel.style.transition = reduceMotion ? 'none' : `transform ${ms}ms ${ease}`;
        panel.style.transform = '';
        if (fade) {
          fade.style.transition = reduceMotion ? 'none' : `opacity ${ms}ms ease`;
          fade.style.opacity = '';
        }
        window.setTimeout(() => {
          if (closingRef.current) return;
          panel.style.transition = '';
          panel.classList.remove('is-pulled');
          if (fade) fade.style.transition = '';
        }, reduceMotion ? 0 : ms + 20);
      }
      reset();
    };
    panel.addEventListener('touchstart', onStart, { passive: true });
    panel.addEventListener('touchmove', onMove, { passive: false });
    panel.addEventListener('touchend', onEnd, { passive: true });
    panel.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      panel.removeEventListener('touchstart', onStart);
      panel.removeEventListener('touchmove', onMove);
      panel.removeEventListener('touchend', onEnd);
      panel.removeEventListener('touchcancel', onEnd);
    };
  }, [rendered, requestClose]);

  // Esc closes the topmost modal on desktop.
  useEffect(() => {
    if (!rendered || !open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const backdrops = document.querySelectorAll('.modal-backdrop');
      if (backdrops[backdrops.length - 1] !== panelRef.current?.parentElement) return;
      event.preventDefault();
      requestClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [rendered, open, requestClose]);

  useEffect(() => {
    if (open) {
      window.clearTimeout(closeTimerRef.current);
      cancelAnimationFrame(rafRef.current!);
      closingRef.current = false;
      setRendered(true);
      setClosing(false);
      setEntered(false); // start off-screen
      if (!bottomSheet) {
        // Non-bottom-sheet: no entrance transition needed, always entered.
        setEntered(true);
        return;
      }
      // Bottom sheet: one RAF so the browser paints the offscreen starting
      // position before the enter transition fires.
      rafRef.current = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(rafRef.current!);
    }
    // Nothing on screen (e.g. first mount while closed): closing anyway would
    // call onClose a moment later and shut whichever modal opened meanwhile,
    // which is how the launch-time backup reminder vanished before it was seen.
    if (!renderedRef.current || closingRef.current) return;
    requestClose();
  }, [open, requestClose, bottomSheet]);

  if (!rendered) return null;
  const panelClass = ['modal-panel', wide ? 'wide' : '', bottomSheet ? 'modal-panel--bottom-sheet' : '', className].filter(Boolean).join(' ');
  const backdropMouse = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    requestClose();
  };
  return (
    <div
      className={`modal-backdrop ${entered ? 'entered' : ''} ${closing ? 'closing' : ''} ${bottomSheet ? 'modal-backdrop--scrim' : ''}`}
      data-swipe-lock
      onMouseDown={bottomSheet ? undefined : backdropMouse}
    >
      {bottomSheet && <div className="modal-scrim" data-swipe-lock onMouseDown={backdropMouse} />}
      <section ref={panelRef} className={panelClass} data-swipe-lock role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="close" type="button" onClick={() => requestClose()} aria-label="Close"><span aria-hidden="true" /></button>
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
