import { useEffect, useRef, useState } from 'react';

/** A toast can offer one action, like Undo after a one-tap log. */
export type ToastAction = { label: string; run: () => void };
export type ToastItem = { id: number; text: string; action?: ToastAction };

/** How long a toast takes to fade once it's dismissed or its time is up. */
export const TOAST_FADE_MS = 140;

/**
 * The toast. When it goes it stays for TOAST_FADE_MS, fading and no longer tappable, rather than vanishing.
 * A new toast replaces it at once.
 */
export function ToastHost({ toast, abovePill, onAction }: { toast: ToastItem | null; abovePill: boolean; onAction: (action: ToastAction) => void }) {
  const lingering = useRef<ToastItem | null>(null);
  const [, redraw] = useState(0);
  if (toast) lingering.current = toast;

  useEffect(() => {
    if (toast) return;
    const timer = window.setTimeout(() => {
      lingering.current = null;
      redraw(count => count + 1);
    }, TOAST_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const shown = toast ?? lingering.current;
  if (!shown) return null;
  const leaving = !toast;
  return (
    <div key={shown.id} className={`toast ${shown.action ? 'has-action' : ''} ${abovePill ? 'above-pill' : ''} ${leaving ? 'leaving' : ''}`} role="status">
      <span>{shown.text}</span>
      {shown.action && (
        <button type="button" className="toast-action" tabIndex={leaving ? -1 : undefined} onClick={() => { const action = shown.action; if (action) onAction(action); }}>{shown.action.label}</button>
      )}
    </div>
  );
}
