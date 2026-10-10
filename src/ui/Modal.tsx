import { ReactNode, type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';

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

export function Modal({ open, title, children, onClose, wide = false, className = '', bottomSheet = false, closeDisabled = false }: { open: boolean; title: string; children: ReactNode; onClose: () => void; wide?: boolean; className?: string; bottomSheet?: boolean; closeDisabled?: boolean }) {
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
  const closeDisabledRef = useRef(closeDisabled);
  closeDisabledRef.current = closeDisabled;
  const panelRef = useRef<HTMLElement>(null);
  const CLOSE_MS = bottomSheet ? 320 : 180;

  // Body scroll lock is shared across modal instances so handoffs cannot unlock the page early.
  useEffect(() => {
    if (!rendered) return;
    return acquireModalScrollLock();
  }, [rendered]);

  // Single close gate — all dismiss paths funnel here.
  const requestClose = useCallback((force = false) => {
    if (closeDisabled && !force) return;
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
    }, CLOSE_MS);
  }, [CLOSE_MS, closeDisabled]);

  // Swipe down to close, like an iOS sheet: from the handle/title bar, or from the
  // content once it is scrolled to the top. Native listeners, because React's
  // touch handlers are passive and could not stop the page scrolling.
  useEffect(() => {
    const panel = panelRef.current;
    if (!rendered || !panel) return;
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let eligible = false;
    let decided = false;
    let dragging = false;
    let offset = 0;
    const scrim = () => panel.parentElement?.querySelector<HTMLElement>(':scope > .modal-scrim') || null;
    const isTopmost = () => {
      const backdrops = document.querySelectorAll('.modal-backdrop');
      return backdrops[backdrops.length - 1] === panel.parentElement;
    };
    const reset = () => {
      dragging = false;
      decided = false;
      offset = 0;
    };
    const onStart = (event: TouchEvent) => {
      reset();
      const target = event.target instanceof Element ? event.target : null;
      eligible = !!target
        && event.touches.length === 1
        && !closeDisabledRef.current
        && !closingRef.current
        && isTopmost()
        // Typing, sliders and swipe-to-confirm keep their own gestures.
        && !target.closest('input, textarea, select, [contenteditable="true"], .swipe-confirm')
        && (!!target.closest('.modal-head') || !modalCanScroll(target, 'up'));
      startX = event.touches[0]?.clientX ?? 0;
      startY = event.touches[0]?.clientY ?? 0;
      startTime = performance.now();
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
        panel.style.transition = 'none';
      }
      if (!dragging) return;
      event.preventDefault();
      offset = Math.max(0, dy);
      panel.style.transform = `translate3d(0, ${offset}px, 0)`;
      const fade = scrim();
      if (fade) fade.style.opacity = String(Math.max(0.25, 1 - offset / Math.max(panel.offsetHeight, 1)));
    };
    const onEnd = () => {
      if (!dragging) return reset();
      const elapsed = Math.max(1, performance.now() - startTime);
      const fast = offset / elapsed > 0.6 && offset > 40;
      const far = offset > Math.min(140, panel.offsetHeight * 0.25);
      const fade = scrim();
      if (fast || far) {
        panel.style.transition = `transform ${Math.min(CLOSE_MS, 220)}ms cubic-bezier(.2, .8, .2, 1)`;
        panel.style.transform = 'translate3d(0, 110%, 0)';
        if (fade) {
          fade.style.transition = `opacity ${Math.min(CLOSE_MS, 220)}ms ease`;
          fade.style.opacity = '0';
        }
        requestClose();
      } else {
        panel.style.transition = 'transform 220ms cubic-bezier(.2, .8, .2, 1)';
        panel.style.transform = '';
        if (fade) {
          fade.style.transition = 'opacity 220ms ease';
          fade.style.opacity = '';
        }
        window.setTimeout(() => {
          if (closingRef.current) return;
          panel.style.transition = '';
          if (fade) fade.style.transition = '';
        }, 240);
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
  }, [rendered, requestClose, CLOSE_MS]);

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
    requestClose(true);
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
          <button className="close" type="button" onClick={() => requestClose()} aria-label="Close" disabled={closeDisabled}><span aria-hidden="true" /></button>
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
