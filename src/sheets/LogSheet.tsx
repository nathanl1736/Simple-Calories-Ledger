import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AppState, Meal } from '../types';
import { MAX_ESTIMATE_PHOTOS } from '../aiEstimate';
import { compressImage, SHARP_PHOTO_OPTIONS } from '../image';
import { geminiModelLabel, readGeminiKeyStatus } from '../geminiEstimate';
import { elapsedText } from '../estimateJob';
import { type UsualChip } from '../logUsuals';
import { energyLabel, energyValue, fmt, fmtPortion } from '../utils';
import { type EstimateJob, type LogDraft } from '../appTypes';
import { Modal } from '../ui/Modal';
import { Icon, type IconName } from '../ui/icons';
import { ConnectGeminiCard } from './ConnectGemini';

/** The composer's textarea grows from two lines to five, then scrolls. */
const COMPOSER_MIN_PX = 72;
const COMPOSER_MAX_PX = 140;
const LONG_PRESS_MS = 450;

/**
 * Log food: one sheet, a composer rather than a menu. Describe or photograph what was eaten and
 * Estimate; or tap a usual to log it at once; or pick another way below. Opened by the sparkle on
 * any tab, the Now line, the first-run card and Journal. What it logs goes to the day shown on Today.
 */
export function LogSheet(props: {
  open: boolean;
  title: string;
  state: AppState;
  /** The meal a usual logs to, and the usuals shown. */
  meal: Meal;
  draft: LogDraft;
  setDraft: (update: (draft: LogDraft) => LogDraft) => void;
  job: EstimateJob | null;
  chips: UsualChip[];
  onClose: () => void;
  onEstimate: () => void;
  onCancelEstimate: () => void;
  /** A finished estimate waiting while the sheet was closed. */
  onReview: () => void;
  /** Forget a finished or failed estimate. */
  onDismissJob: () => void;
  onLogChip: (chip: UsualChip) => void;
  onReviewChip: (chip: UsualChip) => void;
  onTypeIn: () => void;
  onSearch: () => void;
  onRoughMeal: () => void;
  onBatch: () => void;
  onSuggest: () => void;
  onPasteEstimate: () => void;
  onSaveKey: (key: string) => Promise<void>;
}) {
  const { open, state, draft, job } = props;
  const hasKey = !!state.settings.geminiApiKey.trim();
  const [connectFor, setConnectFor] = useState<'estimate' | 'suggest' | null>(null);
  const [addingPhotos, setAddingPhotos] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [checking, setChecking] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [model, setModel] = useState('');
  const [now, setNow] = useState(() => performance.now());
  const textRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const running = job?.status === 'running';
  const ready = job?.status === 'ready';
  const failed = job?.status === 'failed';
  const unit = energyLabel(state);

  // Each opening starts in Log mode with the chips logging on tap.
  useEffect(() => {
    if (!open) return;
    setConnectFor(null);
    setChecking(false);
    setPhotoError('');
  }, [open]);

  // On a desktop the text box takes the cursor straight away. Not on a phone: the keyboard would
  // cover the usuals, which are one tap from logged.
  useEffect(() => {
    if (!open || running || ready || typeof matchMedia !== 'function' || !matchMedia('(pointer: fine)').matches) return;
    const timer = window.setTimeout(() => textRef.current?.focus({ preventScroll: true }), 340);
    return () => window.clearTimeout(timer);
  }, [open]);

  // The model line in the footer, from what Dawni last learned about the key. Never waits on Google.
  useEffect(() => {
    if (!open || !hasKey) return;
    let cancelled = false;
    readGeminiKeyStatus(state.settings.geminiApiKey)
      .then(status => { if (!cancelled) setModel(status ? geminiModelLabel(status.modelId) : ''); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [open, hasKey, state.settings.geminiApiKey]);

  // The estimating card counts the seconds once a reply is slower than usual.
  useEffect(() => {
    if (!open || !running) return;
    setNow(performance.now());
    const timer = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open, running]);

  // Two lines to five, then it scrolls.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(COMPOSER_MIN_PX, Math.min(COMPOSER_MAX_PX, el.scrollHeight + 2))}px`;
  }, [draft.text, open, connectFor, job?.status]);

  const editDraft = (update: (current: LogDraft) => LogDraft) => {
    // Changing what's asked starts afresh, so the button goes back to Estimate.
    if (failed) props.onDismissJob();
    props.setDraft(update);
  };

  const addPhotos = async (files: FileList | null) => {
    const list = Array.from(files || []).slice(0, MAX_ESTIMATE_PHOTOS - draft.photos.length);
    if (photoInputRef.current) photoInputRef.current.value = '';
    if (!list.length) return;
    setPhotoError('');
    setAddingPhotos(true);
    const added: string[] = [];
    // One at a time: full-size phone photos decoded together can exhaust memory.
    for (const file of list) {
      try {
        const photo = await compressImage(file, SHARP_PHOTO_OPTIONS);
        if (photo) added.push(photo);
      } catch {
        setPhotoError('One photo couldn’t be read. Try taking it again.');
      }
    }
    editDraft(current => ({ ...current, photos: [...current.photos, ...added].slice(0, MAX_ESTIMATE_PHOTOS) }));
    setAddingPhotos(false);
  };

  // Typing it in instead settles a failed estimate; what was typed stays in the composer.
  // Called in the tap, so the decimal keyboard still comes up with the sheet.
  const typeIn = () => {
    if (failed) props.onDismissJob();
    props.onTypeIn();
  };

  const canEstimate = !!(draft.text.trim() || draft.photos.length) && !addingPhotos;
  const estimate = () => {
    if (!canEstimate) return;
    if (!hasKey) return setConnectFor('estimate');
    props.onEstimate();
  };
  const suggest = () => {
    if (!hasKey) return setConnectFor('suggest');
    props.onSuggest();
  };

  // Chips: a tap logs; touch and hold (or right-click, or More) opens the review sheet first.
  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
  };
  const chipHandlers = (chip: UsualChip) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      cancelPress();
      const at = { x: event.clientX, y: event.clientY };
      press.current = { ...at, fired: false, timer: window.setTimeout(() => {
        if (!press.current) return;
        press.current.fired = true;
        props.onReviewChip(chip);
      }, LONG_PRESS_MS) };
    },
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
      // Scrolling the row sideways isn't a hold.
      if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10) cancelPress();
    },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
    onPointerLeave: cancelPress,
    onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      cancelPress();
      if (press.current?.fired) return;
      if (press.current) press.current.fired = true;
      props.onReviewChip(chip);
    },
    onClick: () => {
      if (press.current?.fired) {
        press.current = null;
        return;
      }
      press.current = null;
      if (checking) props.onReviewChip(chip);
      else props.onLogChip(chip);
    }
  });

  const way = (icon: IconName, label: string, onClick: () => void) => (
    <button type="button" className="log-way" onClick={onClick}>
      <span className="log-way-icon" aria-hidden="true"><Icon name={icon} size={20} /></span>
      <span className="log-way-label">{label}</span>
      <Icon name="chevron" size={16} />
    </button>
  );

  const thumb = (photos: string[]) => photos[0]
    ? <img className="log-status-thumb" src={photos[0]} alt="" />
    : <span className="log-status-glyph" aria-hidden="true"><Icon name="sparkle" size={22} filled /></span>;

  const elapsed = running && job ? elapsedText(now - job.startedAt) : '';

  let top: ReactNode;
  if (connectFor) {
    top = (
      <ConnectGeminiCard
        title={connectFor === 'suggest' ? 'Connect Gemini to suggest' : 'Connect Gemini to estimate'}
        onSaveKey={props.onSaveKey}
        onTypeIn={typeIn}
        onConnected={() => {
          const next = connectFor;
          setConnectFor(null);
          if (next === 'suggest') props.onSuggest();
          else props.onEstimate();
        }}
      />
    );
  } else if (running && job) {
    top = (
      <section className="log-status" aria-label="Estimating">
        <div className="log-status-main">
          {thumb(job.photos)}
          <div className="log-status-text" aria-live="polite">
            <strong><span className="log-spinner" aria-hidden="true" />Estimating…</strong>
            {job.description && <span className="log-status-desc">{job.description}</span>}
            {elapsed && <span className="log-status-elapsed">{elapsed}</span>}
          </div>
          <button type="button" className="text-btn log-status-cancel" onClick={props.onCancelEstimate}>Cancel</button>
        </div>
        <p className="hint log-status-note">You can close this. Dawni will let you know when it’s ready.</p>
      </section>
    );
  } else if (ready && job) {
    top = (
      <section className="log-status is-ready" aria-label="Your estimate is ready">
        <div className="log-status-main">
          {thumb(job.photos)}
          <div className="log-status-text">
            <strong>Your estimate is ready</strong>
            {job.description && <span className="log-status-desc">{job.description}</span>}
          </div>
        </div>
        <div className="log-status-actions">
          <button type="button" className="primary" onClick={props.onReview}>Review</button>
          <button type="button" className="text-btn" onClick={props.onDismissJob}>Start again</button>
        </div>
      </section>
    );
  } else {
    top = (
      <div className="log-composer">
        <textarea
          ref={textRef}
          className="log-text"
          value={draft.text}
          rows={2}
          aria-label="What did you eat?"
          placeholder="What did you eat? e.g. 2 eggs on toast with butter, flat white"
          enterKeyHint="enter"
          onChange={event => {
            const text = event.target.value;
            editDraft(current => ({ ...current, text }));
          }}
        />
        {draft.photos.length > 0 && (
          <div className="log-thumbs">
            {draft.photos.map((src, index) => (
              <span key={`${index}-${src.length}`} className="log-thumb">
                <img src={src} alt={`Photo ${index + 1}`} />
                <button type="button" className="log-thumb-remove" aria-label={`Remove photo ${index + 1}`} onClick={() => editDraft(current => ({ ...current, photos: current.photos.filter((_, i) => i !== index) }))}>
                  <span aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        {(failed || photoError) && (
          <div className="log-error" role="alert">
            <p>{failed ? job?.error : photoError}</p>
            {failed && job?.timedOut && <button type="button" className="secondary" onClick={typeIn}>Type it in</button>}
          </div>
        )}
        <div className="log-toolbar">
          <input ref={photoInputRef} hidden type="file" accept="image/*" multiple onChange={event => addPhotos(event.target.files)} />
          <button
            type="button"
            className="log-photo-chip"
            disabled={addingPhotos || draft.photos.length >= MAX_ESTIMATE_PHOTOS}
            onClick={() => photoInputRef.current?.click()}
            aria-label={draft.photos.length ? `Add another photo, ${draft.photos.length} of ${MAX_ESTIMATE_PHOTOS}` : 'Add a photo'}
          >
            <Icon name="camera" size={20} />
            <span>{addingPhotos ? 'Adding…' : 'Photo'}</span>
          </button>
          <button type="button" className="primary log-estimate" disabled={!canEstimate} onClick={estimate}>
            {failed ? 'Try again' : 'Estimate'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <Modal open={open} title={props.title} onClose={props.onClose} bottomSheet className="log-sheet">
      <div className="log-body">
        <div className="seg log-mode" role="group" aria-label="Log or suggest">
          <button type="button" className="active" aria-pressed="true">Log</button>
          <button type="button" aria-pressed="false" onClick={suggest}>Suggest</button>
        </div>

        {top}

        {!running && !ready && !connectFor && props.chips.length > 0 && (
          <section className="log-usuals" aria-label={`Usuals for ${props.meal.toLowerCase()}`}>
            <div className="log-section-head">
              <span>{checking ? 'Tap one to check it before logging' : `Usuals for ${props.meal.toLowerCase()}`}</span>
              {!checking && <small>Tap to log · hold to check</small>}
            </div>
            <div className="log-chips">
              {props.chips.map(chip => (
                <button
                  key={chip.key}
                  type="button"
                  className={`log-chip ${chip.kind}`}
                  aria-label={`${checking ? 'Check' : 'Log'} ${chip.name}${chip.kind === 'prep' ? `, a serve, ${fmtPortion(chip.left)} left` : ''}, ${fmt(energyValue(state, chip.calories))} ${unit}`}
                  {...chipHandlers(chip)}
                >
                  {chip.kind === 'prep' && <Icon name="prep" size={16} />}
                  <b>{chip.name}</b>
                  {chip.kind === 'prep' && <span className="log-chip-left">· {fmtPortion(chip.left)} left</span>}
                  <span className="log-chip-cal">{fmt(energyValue(state, chip.calories))}</span>
                </button>
              ))}
              <button
                type="button"
                className={`log-chip log-chip-more ${checking ? 'active' : ''}`}
                aria-pressed={checking}
                aria-label={checking ? 'Done: tap logs again' : 'More: check one before logging'}
                onClick={() => setChecking(current => !current)}
              >
                {checking ? 'Done' : <><Icon name="more" size={18} /><span>More</span></>}
              </button>
            </div>
          </section>
        )}

        <section className="log-ways-section" aria-label="Other ways to log">
          <div className="log-section-head"><span>Other ways</span></div>
          <div className="log-ways">
            {way('edit', 'Type it in', typeIn)}
            {way('search', 'Search foods', props.onSearch)}
            {way('approx', 'Rough meal', props.onRoughMeal)}
            {way('prep', 'Meal prep a batch', props.onBatch)}
          </div>
        </section>

        <footer className="log-foot">
          <div className="log-foot-row">
            <p>Estimates can be wrong. You check the numbers before anything is saved.</p>
            {hasKey && <p className="log-model">{model || 'Gemini'} · your key</p>}
          </div>
          <div className="log-foot-links">
            <button type="button" className="link-btn" onClick={props.onPasteEstimate}>Paste an estimate from another chatbot</button>
            <button type="button" className="link-btn" aria-expanded={tipsOpen} onClick={() => setTipsOpen(current => !current)}>Tips</button>
          </div>
          {tipsOpen && (
            <ul className="log-tips">
              <li>Packaged food: photograph the nutrition panel flat and close, plus the front. Say how much you ate (e.g. 150 g, half the tub).</li>
              <li>Home cooking: list ingredients and amounts, including oil, butter and sauces, and how many serves it made.</li>
              <li>Meals out: a photo from above plus a short description works best.</li>
            </ul>
          )}
        </footer>
      </div>
    </Modal>
  );
}
