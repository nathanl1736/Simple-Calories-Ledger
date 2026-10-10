import { useEffect, useRef, useState } from 'react';
import type { Meal } from '../types';
import { AI_ESTIMATE_DISCLAIMER, parseAiQuickLog, type AiQuickLogEntry } from '../aiQuickLog';
import { Modal } from '../ui/Modal';
import { Field } from '../ui/controls';

export function AiQuickLogModal({ open, fallbackMeal, seedText, onClose, onParsed }: { open: boolean; fallbackMeal: Meal; seedText: string; onClose: () => void; onParsed: (entry: AiQuickLogEntry) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const parsedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setText('');
      setError('');
      parsedRef.current = false;
      return;
    }
    if (seedText) {
      setText(seedText);
      setError('');
      parsedRef.current = false;
    }
  }, [open, seedText]);

  const tryParse = (value: string, showError: boolean) => {
    if (parsedRef.current) return true;
    const trimmed = value.trim();
    if (!trimmed) {
      setError('');
      return false;
    }
    const parsed = parseAiQuickLog(trimmed, fallbackMeal);
    if (parsed) {
      parsedRef.current = true;
      setError('');
      onParsed(parsed);
      return true;
    }
    if (showError && trimmed.length > 12) {
      setError('Couldn\u2019t read that format. Check the prompt output and try again.');
    }
    return false;
  };

  useEffect(() => {
    if (!open) return;
    const trimmed = text.trim();
    if (!trimmed) {
      setError('');
      return;
    }
    const timer = window.setTimeout(() => {
      tryParse(trimmed, true);
    }, 550);
    return () => window.clearTimeout(timer);
  }, [open, text]);

  const updateText = (next: string) => {
    setText(next);
    setError('');
    tryParse(next, false);
  };

  const pasteFromClipboard = async () => {
    if (!navigator.clipboard?.readText) {
      setError('Clipboard paste is not available here. Paste manually instead.');
      return;
    }
    try {
      const next = await navigator.clipboard.readText();
      setText(next);
      setError('');
      tryParse(next, true);
    } catch {
      setError('Could not read from clipboard. Paste manually instead.');
    }
  };

  return (
    <Modal open={open} title="AI estimate helper" onClose={onClose}>
      <div className="ai-quick-log-modal">
        <p className="hint">Paste an AI-generated estimate. If the format is correct, it will fill the Log Food form for review.</p>
        <div className="help-callout">{AI_ESTIMATE_DISCLAIMER}</div>
        <div className="actions">
          <button className="secondary" type="button" onClick={pasteFromClipboard}>Paste from clipboard</button>
          <button className="secondary" type="button" onClick={() => { setText(''); setError(''); }}>Clear</button>
        </div>
        <Field label="Quick log JSON" full>
          <textarea className="ai-quick-log-textarea" value={text} onChange={event => updateText(event.target.value)} placeholder='{"name":"Beef mince bowl","unitMode":"serving","amount":"1","meal":"Dinner","calories":520,"protein":45,"carbs":18,"fat":28,"notes":"Ingredients and estimate notes"}' />
        </Field>
        {error && <p className="ai-quick-log-error">{error}</p>}
      </div>
    </Modal>
  );
}
