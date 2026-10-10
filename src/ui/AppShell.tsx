import { ReactNode, useEffect, useRef, useState } from 'react';
import { type Tab } from '../appTypes';
import { MODAL_SCROLL_LOCK_RELEASED_EVENT } from './Modal';
import { Icon, TabGlyph } from './icons';

export const TABS: [Tab, string][] = [
  ['tracking', 'Today'],
  ['stats', 'Week'],
  ['journal', 'Journal'],
  ['library', 'Foods'],
  ['settings', 'Settings']
];
/** The tab bar: Settings opens from the gear on Today instead. */
const NAV_TABS = TABS.filter(([id]) => id !== 'settings');

/**
 * Replays the settle animation when `token` changes. Previously each screen used
 * `key={date}`, which remounted the whole subtree on every arrow tap: children
 * lost state and re-ran their effects (the food database load, menu positioning)
 * and the DOM was rebuilt. Restarting the animation on a stable node is cheaper.
 */
export function useSettleAnimation(token: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove('view-transition');
    void el.offsetWidth; // reflow, so re-adding the class restarts the animation
    el.classList.add('view-transition');
  }, [token]);
  return ref;
}

export function AppShell({ tab, setTab, onLogWithAi, children }: { tab: Tab; setTab: (tab: Tab) => void; onLogWithAi: () => void; children: ReactNode }) {
  const [navHidden, setNavHidden] = useState(false);

  useEffect(() => {
    const inputTypesWithoutKeyboard = new Set(['button', 'checkbox', 'color', 'date', 'datetime-local', 'file', 'hidden', 'image', 'month', 'radio', 'range', 'reset', 'submit', 'time', 'week']);
    const isInsideAppModal = (el: EventTarget | null) => el instanceof HTMLElement && !!el.closest('.modal-backdrop');
    /** True while any modal backdrop is mounted (including during close animation). */
    const isModalLayerPresent = () => !!document.querySelector('.modal-backdrop');
    const isTextEntryElement = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (isInsideAppModal(target)) return false;
      if (target.matches('textarea, select, [contenteditable="true"]')) return true;
      if (!(target instanceof HTMLInputElement)) return false;
      return !inputTypesWithoutKeyboard.has(target.type);
    };
    const refresh = () => {
      if (isModalLayerPresent()) return;
      setNavHidden(isTextEntryElement(document.activeElement));
    };
    const onModalScrollLockReleased = () => requestAnimationFrame(refresh);
    const onFocusIn = (event: FocusEvent) => {
      if (isModalLayerPresent()) return;
      setNavHidden(isTextEntryElement(event.target));
    };
    const onFocusOut = () => {
      const hadModal = !!document.querySelector('.modal-backdrop');
      window.setTimeout(refresh, 0);
      if (hadModal) window.setTimeout(refresh, 400);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    window.addEventListener(MODAL_SCROLL_LOCK_RELEASED_EVENT, onModalScrollLockReleased);
    refresh();
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      window.removeEventListener(MODAL_SCROLL_LOCK_RELEASED_EVENT, onModalScrollLockReleased);
    };
  }, []);

  return (
    <>
      <div className="status-bar-scrim" aria-hidden="true" />
      <main className="app">{children}</main>
      <div className={`tabbar-wrap ${navHidden ? 'hidden' : ''}`} aria-hidden={navHidden}>
        <nav className="tabbar" aria-label="Main tabs">
          {NAV_TABS.map(([id, label]) => (
            <button key={id} className={`tab tab-${id} ${tab === id ? 'active' : ''}`} type="button" onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}>
              <TabGlyph tab={id} />
              {label}
            </button>
          ))}
        </nav>
        {tab !== 'settings' && (
          <button className="log-button" type="button" aria-label="Log with AI" onClick={onLogWithAi}>
            <Icon name="sparkle" size={28} filled />
          </button>
        )}
      </div>
    </>
  );
}
