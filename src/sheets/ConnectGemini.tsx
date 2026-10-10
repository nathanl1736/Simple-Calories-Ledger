import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { geminiModelLabel, isGeminiAbort, isGeminiTimeout, isKeyLevelFailure, probeGeminiKey, type GeminiError, type GeminiKeyCheck } from '../geminiEstimate';
import { Modal } from '../ui/Modal';

/** How long "Ready" shows before the request that asked for a key carries on. */
const READY_BEAT_MS = 900;

/** The steps to a key, for the "?" in Settings and "How do I get a key?" on the Connect card. */
export function GeminiKeyHelp() {
  return (
    <>
      <ol className="update-list ai-help-list">
        <li>
          Open Google AI Studio at{' '}
          <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">aistudio.google.com/app/apikey</a>
          .
        </li>
        <li>Tap Create API key. A new key starts on Google&apos;s free tier, with no card needed.</li>
        <li>Copy the key, paste it into Dawni and tap Save and test (or Settings → Gemini → Save). Dawni checks which models the key can actually use and shows the one it picked.</li>
        <li>Free tier: Gemini Flash models with daily limits, which is plenty for logging meals. Pro models need a paid plan, where Google asks you to prepay credit (at least US$5).</li>
        <li>Once billing is linked to a key&apos;s Google project, every request on it is charged, even ones the free tier would have covered. To keep a free key, create it in a project without billing.</li>
        <li>The check is free on a free key. On a paid key it&apos;s one tiny request to the best model, a fraction of a cent.</li>
        <li>Dawni only uses the key when you tap Estimate or Help me pick from a menu. The key is stored locally in this browser and is included in exported backups.</li>
      </ol>
      <div className="help-callout">Dawni picks the best model your key&apos;s plan allows, so it keeps working as Google releases new models. If one model is busy or not in your plan, it moves to the next. Upgraded to a paid plan? Tap Test key in Settings and Dawni switches to the better model straight away.</div>
    </>
  );
}

type CheckState =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; modelId: string }
  | { state: 'error'; message: string };

/**
 * No key yet: connect one right where it's needed instead of a trip to Settings. Save and test
 * runs the same check as Settings' Test key, and once it passes the request that asked for the
 * key carries on with everything already typed or photographed.
 */
export function ConnectGeminiCard({ title = 'Connect Gemini to estimate', onSaveKey, onConnected, onTypeIn, typeInLabel = 'Type it in instead' }: {
  title?: string;
  /** Saves the key to settings. */
  onSaveKey: (key: string) => Promise<void> | void;
  /** The key works: carry on with what asked for it. */
  onConnected: (check: GeminiKeyCheck) => void;
  onTypeIn: () => void;
  typeInLabel?: string;
}) {
  const [key, setKey] = useState('');
  const [check, setCheck] = useState<CheckState>({ state: 'idle' });
  const [helpOpen, setHelpOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  // Closed mid-check: stop it, and don't carry on with a request nobody is waiting for.
  useEffect(() => () => {
    abortRef.current?.abort();
    window.clearTimeout(timerRef.current);
  }, []);

  const saveAndTest = async () => {
    const trimmed = key.trim();
    if (!trimmed) {
      setCheck({ state: 'error', message: 'Paste your key first. It starts with AIza.' });
      inputRef.current?.focus();
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setCheck({ state: 'testing' });
    try {
      const result = await probeGeminiKey(trimmed, controller.signal);
      await onSaveKey(trimmed);
      setCheck({ state: 'ok', modelId: result.modelId });
      timerRef.current = window.setTimeout(() => onConnectedRef.current(result), READY_BEAT_MS);
    } catch (err) {
      if (isGeminiAbort(err)) return;
      const error = err as GeminiError;
      // Busy or over a limit for now: the key itself works, so keep it for next time.
      const keyWorks = !isGeminiTimeout(err) && !isKeyLevelFailure(error.status ?? 0, error.detail || error.message || '');
      if (keyWorks) await onSaveKey(trimmed);
      setCheck({ state: 'error', message: `${error.message || 'Could not reach Gemini.'}${keyWorks ? ' Your key is saved.' : ''}` });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  return (
    <section className="connect-card" aria-label={title}>
      <h3>{title}</h3>
      <p className="hint">Dawni uses your own free Google key. It stays on this phone and is only sent to Google.</p>
      {/* Not a <form>: the card sits inside other sheets' forms (meal prep), and a nested form submits the page. */}
      <div className="connect-form" role="group" aria-label="Your Gemini API key">
        <input
          ref={inputRef}
          type="password"
          value={key}
          placeholder="Paste your API key"
          aria-label="Paste your API key"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          disabled={check.state === 'testing' || check.state === 'ok'}
          onChange={event => { setKey(event.target.value); if (check.state === 'error') setCheck({ state: 'idle' }); }}
          onKeyDown={event => {
            // Enter saves and tests, and never reaches a form around the card.
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void saveAndTest();
          }}
        />
        <button className="primary" type="button" disabled={check.state === 'testing' || check.state === 'ok'} onClick={() => void saveAndTest()}>
          {check.state === 'testing' ? 'Checking…' : check.state === 'error' ? 'Try again' : 'Save and test'}
        </button>
      </div>
      {check.state === 'testing' && <p className="hint connect-status" role="status">Checking which Gemini models this key can use…</p>}
      {check.state === 'ok' && <p className="hint connect-status is-ready" role="status">Ready · {geminiModelLabel(check.modelId)}</p>}
      {check.state === 'error' && <p className="ai-quick-log-error connect-status" role="alert">{check.message}</p>}
      <div className="connect-links">
        <button type="button" className="link-btn" onClick={() => setHelpOpen(true)}>How do I get a key?</button>
        <button type="button" className="link-btn" onClick={onTypeIn}>{typeInLabel}</button>
      </div>
      {/* On the page, not in this sheet: a sheet's slide transform would hold a fixed layer inside it. */}
      {createPortal(
        <Modal open={helpOpen} title="Gemini API key" onClose={() => setHelpOpen(false)}>
          <GeminiKeyHelp />
        </Modal>,
        document.body
      )}
    </section>
  );
}
