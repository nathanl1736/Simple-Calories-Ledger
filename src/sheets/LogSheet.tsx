import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AppState, Batch, Food, Meal } from '../types';
import { MAX_ESTIMATE_PHOTOS } from '../aiEstimate';
import { loadFoodDatabaseWithStatus, type FoodDatabaseItem } from '../foodDatabase';
import { composerSearchQuery } from '../searchResults';
import { compressImages, SHARP_PHOTO_OPTIONS } from '../image';
import { geminiModelLabel, readGeminiKeyStatus } from '../geminiEstimate';
import { elapsedText, estimatingLabel } from '../estimateJob';
import { type UsualChip } from '../logUsuals';
import { energyLabel, energyValue, fmt, fmtPortion } from '../utils';
import { type EstimateJob, type LogDraft, type LogMode } from '../appTypes';
import { Modal } from '../ui/Modal';
import { Icon, type IconName } from '../ui/icons';
import { ConnectGeminiCard } from './ConnectGemini';
import { FoodSearchResults } from './FoodSearch';
import { MAX_SUGGEST_PHOTOS } from '../suggest';
import { SuggestComposer, SuggestResult, type SuggestProps } from './SuggestSheet';

/** The composer's textarea grows from two lines to five, then scrolls. */
const COMPOSER_MIN_PX = 72;
const COMPOSER_MAX_PX = 140;
const LONG_PRESS_MS = 450;

/**
 * Whether a row that scrolls sideways has more in it than shows. Checked after each render, as chips come and
 * go, and when the row changes width. `paused` keeps the last answer, for while the row is unfolded.
 */
function useRunsOffSide(row: HTMLElement | null, paused: boolean) {
  const [overflows, setOverflows] = useState(false);
  const measure = () => {
    if (!paused) setOverflows(!!row && row.scrollWidth > row.clientWidth + 1);
  };
  useLayoutEffect(measure);
  useEffect(() => {
    if (!row || paused || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [row, paused]);
  return overflows;
}

/**
 * Log food: one sheet, one text box rather than a menu. Type and it searches your foods, the fridge
 * and the food database, the results standing in for the usuals, favourites and other ways below; or
 * describe or photograph what was eaten and Estimate; or tap a usual or a favourite to log it at once. Its Suggest mode asks
 * what to eat instead: where you're going or what's at home, and Gemini fits it to the day and the
 * week. Opened by the sparkle on any tab, the Now line, the first-run card and Journal. What it logs
 * goes to the day shown on Today.
 */
export function LogSheet(props: {
  open: boolean;
  /** "Log food", or which day it is for when that isn't today. */
  title: string;
  /** The title in Suggest mode. */
  suggestTitle: string;
  state: AppState;
  mode: LogMode;
  onMode: (mode: LogMode) => void;
  /** The meal a usual logs to, and the usuals shown. */
  meal: Meal;
  draft: LogDraft;
  setDraft: (update: (draft: LogDraft) => LogDraft) => void;
  /** What Suggest mode asks and shows. */
  suggest: SuggestProps;
  job: EstimateJob | null;
  /** This meal's usuals and the fridge. */
  chips: UsualChip[];
  /** Every favourite, its own row under the usuals. */
  favourites: UsualChip[];
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
  /** The fridge, serves left: what the text box finds first. */
  batches: Batch[];
  /** A food the text box found: Log food, filled in. */
  onChooseFood: (food: Food) => void;
  /** A fridge serve the text box found: logged at once. */
  onLogBatch: (batch: Batch) => void;
  /** Log food to type in, named after what was typed. */
  onLogNew: (name: string) => void;
  onSaveDatabaseFood: (item: FoodDatabaseItem) => Promise<void> | void;
  onRoughMeal: () => void;
  onBatch: () => void;
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
  /** Favourites unfolded from one sideways row into all of them at once. */
  const [allFavourites, setAllFavourites] = useState(false);
  const [favouritesRow, setFavouritesRow] = useState<HTMLDivElement | null>(null);
  const [model, setModel] = useState('');
  const [now, setNow] = useState(() => performance.now());
  const textRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  /** The sheet's height before the text box started searching. */
  const restingHeight = useRef(0);
  const suggesting = props.mode === 'suggest';
  // A request belongs to the mode that asked it; the other mode sees the sheet as if nothing were running.
  const jobHere = job && (job.kind === 'suggest') === suggesting ? job : null;
  const running = jobHere?.status === 'running';
  const ready = jobHere?.status === 'ready';
  const failed = jobHere?.status === 'failed';
  // One request at a time: while one runs, the sheet stays in its mode.
  const lockedTo: LogMode | null = job?.status === 'running' ? (job.kind === 'suggest' ? 'suggest' : 'log') : null;
  const unit = energyLabel(state);
  // Typing searches, and the results take the place of the usuals and other ways. Not with a photo:
  // then the words are for Gemini.
  const searchQuery = !suggesting && !running && !ready && !connectFor ? composerSearchQuery(draft) : '';
  const searching = !!searchQuery;
  // The one-tap rows rest under the box: usuals and the fridge, then favourites.
  const quickRows = !suggesting && !searching && !running && !ready && !connectFor;
  const showUsuals = quickRows && props.chips.length > 0;

  // Each opening starts with the chips logging on tap.
  useEffect(() => {
    if (!open) return;
    setConnectFor(null);
    setChecking(false);
    setAllFavourites(false);
    setPhotoError('');
  }, [open]);

  // On a desktop the text box takes the cursor straight away. Not on a phone: the keyboard would
  // cover the usuals, which are one tap from logged.
  useEffect(() => {
    if (!open || suggesting || running || ready || typeof matchMedia !== 'function' || !matchMedia('(pointer: fine)').matches) return;
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
  }, [draft.text, open, connectFor, job?.status, suggesting]);

  // "See all" only when the favourites run off the side of the sheet.
  const favouritesOverflow = useRunsOffSide(favouritesRow, allFavourites);

  // The sheet sits on the bottom edge, so a list that grew and shrank with each letter would move the
  // box being typed in. While it searches, the sheet keeps the height it had before the first letter
  // (through its slide away too) and the results scroll inside it.
  const panel = () => bodyRef.current?.closest<HTMLElement>('.modal-panel') ?? null;
  const noteRestingHeight = () => {
    const sheet = panel();
    if (!searching && sheet) restingHeight.current = sheet.offsetHeight;
  };
  useLayoutEffect(() => {
    const sheet = panel();
    if (!sheet) return;
    if (searching && !sheet.style.height && restingHeight.current) sheet.style.height = `${restingHeight.current}px`;
    else if (!searching && sheet.style.height) sheet.style.height = '';
  });

  const editDraft = (update: (current: LogDraft) => LogDraft) => {
    // Changing what's asked starts afresh, so the button goes back to Estimate.
    if (failed) props.onDismissJob();
    props.setDraft(update);
  };

  const switchMode = (next: LogMode) => {
    if (next === props.mode || lockedTo) return;
    setConnectFor(null);
    props.onMode(next);
  };

  const addPhotos = async (files: FileList | null) => {
    const list = Array.from(files || []).slice(0, MAX_ESTIMATE_PHOTOS - draft.photos.length);
    if (photoInputRef.current) photoInputRef.current.value = '';
    if (!list.length) return;
    setPhotoError('');
    setAddingPhotos(true);
    const { photos, failed: unreadable } = await compressImages(list, SHARP_PHOTO_OPTIONS);
    if (unreadable) setPhotoError('One photo couldn’t be read. Try taking it again.');
    editDraft(current => ({ ...current, photos: [...current.photos, ...photos].slice(0, MAX_ESTIMATE_PHOTOS) }));
    setAddingPhotos(false);
  };

  // Typing it in instead settles a failed estimate; what was typed stays in the composer.
  // Called in the tap, so the decimal keyboard still comes up with the sheet.
  const typeIn = () => {
    if (failed) props.onDismissJob();
    props.onTypeIn();
  };
  // Picking something the text box found settles it too, still within the tap ("Log it yourself"
  // brings up the decimal keyboard the same way).
  const settle = <T,>(pick: (value: T) => void) => (value: T) => {
    if (failed) props.onDismissJob();
    pick(value);
  };
  // Dragging the results puts the keyboard away, as in iOS, so the whole list can be seen.
  const dismissKeyboard = () => {
    if (document.activeElement === textRef.current) textRef.current?.blur();
  };

  const canEstimate = !!(draft.text.trim() || draft.photos.length) && !addingPhotos;
  const estimate = () => {
    if (!canEstimate) return;
    if (!hasKey) return setConnectFor('estimate');
    props.onEstimate();
  };
  const suggest = () => {
    if (!hasKey) return setConnectFor('suggest');
    props.suggest.onRun();
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

  const chipButton = (chip: UsualChip) => (
    <button
      key={chip.key}
      type="button"
      className={`log-chip ${chip.kind}`}
      aria-label={`${checking ? 'Check' : 'Log'} ${chip.name}${chip.kind === 'prep' ? `, a serve, ${fmtPortion(chip.left)} left` : ''}, ${fmt(energyValue(state, chip.calories))} ${unit}`}
      {...chipHandlers(chip)}
    >
      {chip.kind === 'prep' && <Icon name={chip.batch.kind === 'bought' ? 'bag' : 'prep'} size={16} />}
      <b>{chip.name}</b>
      {chip.kind === 'prep' && <span className="log-chip-left">· {fmtPortion(chip.left)} left</span>}
      <span className="log-chip-cal">{fmt(energyValue(state, chip.calories))}</span>
    </button>
  );
  // More turns every chip in the sheet into a check first. It ends the first row of chips.
  const moreChip = (
    <button
      type="button"
      className={`log-chip log-chip-more ${checking ? 'active' : ''}`}
      aria-pressed={checking}
      aria-label={checking ? 'Done: tap logs again' : 'More: check one before logging'}
      onClick={() => setChecking(current => !current)}
    >
      {checking ? 'Done' : <><Icon name="more" size={18} /><span>More</span></>}
    </button>
  );
  const checkingHead = 'Tap one to check it before logging';
  const tapHint = 'Tap to log · hold to check';

  const way = (icon: IconName, label: string, onClick: () => void, detail = '') => (
    <button type="button" className={detail ? 'log-way has-detail' : 'log-way'} onClick={onClick}>
      <span className="log-way-icon" aria-hidden="true"><Icon name={icon} size={20} /></span>
      <span className="log-way-label">{label}{detail && <small>{detail}</small>}</span>
      <Icon name="chevron" size={16} />
    </button>
  );

  const thumb = (photos: string[]) => photos[0]
    ? <img className="log-status-thumb" src={photos[0]} alt="" />
    : <span className="log-status-glyph" aria-hidden="true"><Icon name="sparkle" size={22} filled /></span>;

  const elapsed = running && jobHere ? elapsedText(now - jobHere.startedAt) : '';
  const showResult = suggesting && !!props.suggest.session && props.suggest.view === 'result';

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
          if (next === 'suggest') props.suggest.onRun();
          else props.onEstimate();
        }}
      />
    );
  } else if (running && jobHere) {
    top = (
      <section className="log-status" aria-label={suggesting ? 'Finding ideas' : 'Estimating'}>
        <div className="log-status-main">
          {thumb(jobHere.photos)}
          <div className="log-status-text" aria-live="polite">
            <strong><span className="log-spinner" aria-hidden="true" />{estimatingLabel(null, jobHere.kind)}</strong>
            {jobHere.description && <span className="log-status-desc">{jobHere.description}</span>}
            {elapsed && <span className="log-status-elapsed">{elapsed}</span>}
          </div>
          <button type="button" className="text-btn log-status-cancel" onClick={props.onCancelEstimate}>Cancel</button>
        </div>
        <p className="hint log-status-note">You can close this. Dawni will let you know when it’s ready.</p>
      </section>
    );
  } else if (ready && jobHere) {
    top = (
      <section className="log-status is-ready" aria-label="Your estimate is ready">
        <div className="log-status-main">
          {thumb(jobHere.photos)}
          <div className="log-status-text">
            <strong>Your estimate is ready</strong>
            {jobHere.description && <span className="log-status-desc">{jobHere.description}</span>}
          </div>
        </div>
        <div className="log-status-actions">
          <button type="button" className="primary" onClick={props.onReview}>Review</button>
          <button type="button" className="text-btn" onClick={props.onDismissJob}>Start again</button>
        </div>
      </section>
    );
  } else if (showResult && props.suggest.session) {
    top = <SuggestResult state={state} session={props.suggest.session} props={props.suggest} />;
  } else if (suggesting) {
    top = (
      <SuggestComposer
        open={open}
        state={state}
        props={props.suggest}
        error={failed ? jobHere?.error || '' : ''}
        timedOut={!!(failed && jobHere?.timedOut)}
        onTypeIn={typeIn}
        onDismissError={() => { if (failed) props.onDismissJob(); }}
        onRun={suggest}
      />
    );
  } else {
    top = (
      <div className="log-composer">
        <textarea
          ref={textRef}
          className="log-text"
          value={draft.text}
          rows={2}
          aria-label="Search your foods, or describe what you ate"
          placeholder={'Search your foods, or describe a meal: 2\u00a0eggs on toast, flat white'}
          enterKeyHint="enter"
          // The food database, ready for the first letter.
          onFocus={() => { loadFoodDatabaseWithStatus().catch(() => undefined); }}
          onChange={event => {
            const text = event.target.value;
            // Before the results arrive, so it's the height without them.
            noteRestingHeight();
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
            <p>{failed ? jobHere?.error : photoError}</p>
            {failed && jobHere?.timedOut && <button type="button" className="secondary" onClick={typeIn}>Type it in</button>}
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
    <Modal open={open} title={suggesting ? props.suggestTitle : props.title} onClose={props.onClose} bottomSheet className="log-sheet">
      <div ref={bodyRef} className="log-body">
        <div className="seg log-mode" role="group" aria-label="Log or suggest">
          <button type="button" className={suggesting ? '' : 'active'} aria-pressed={!suggesting} disabled={lockedTo === 'suggest'} onClick={() => switchMode('log')}>Log</button>
          <button type="button" className={suggesting ? 'active' : ''} aria-pressed={suggesting} disabled={lockedTo === 'log'} onClick={() => switchMode('suggest')}>Suggest</button>
        </div>

        {top}

        {searching && (
          <FoodSearchResults
            state={state}
            query={searchQuery}
            batches={props.batches}
            onChoose={settle(props.onChooseFood)}
            onLogBatch={settle(props.onLogBatch)}
            onLogNew={settle(props.onLogNew)}
            onSaveDatabaseFood={props.onSaveDatabaseFood}
            onDrag={dismissKeyboard}
          />
        )}

        {showUsuals && (
          <section className="log-usuals" aria-label={`Usuals for ${props.meal.toLowerCase()}`}>
            <div className="log-section-head">
              <span>{checking ? checkingHead : `Usuals for ${props.meal.toLowerCase()}`}</span>
              {!checking && <small>{tapHint}</small>}
            </div>
            <div className="log-chips">
              {props.chips.map(chipButton)}
              {moreChip}
            </div>
          </section>
        )}

        {quickRows && (
          <section className="log-favourites" aria-label="Favourites">
            <div className="log-section-head">
              <span>{!showUsuals && checking && props.favourites.length > 0 ? checkingHead : 'Favourites'}</span>
              {props.favourites.length > 0 && (favouritesOverflow || allFavourites) ? (
                <button
                  type="button"
                  className="log-see-all"
                  aria-expanded={allFavourites}
                  aria-controls="log-favourite-chips"
                  aria-label={allFavourites ? undefined : `See all ${props.favourites.length} favourites`}
                  onClick={() => setAllFavourites(current => !current)}
                >
                  {allFavourites ? 'Show less' : `See all ${props.favourites.length}`}
                </button>
              ) : !showUsuals && !checking && props.favourites.length > 0 && <small>{tapHint}</small>}
            </div>
            {props.favourites.length > 0 ? (
              <div ref={setFavouritesRow} id="log-favourite-chips" className={allFavourites ? 'log-chips is-wrapped' : 'log-chips'}>
                {props.favourites.map(chipButton)}
                {!showUsuals && moreChip}
              </div>
            ) : (
              <p className="log-favourites-empty">
                <span className="log-favourites-empty-glyph" aria-hidden="true"><Icon name="heart" size={16} /></span>
                <span>Heart a food when you log it and it’ll wait here, one tap away.</span>
              </p>
            )}
          </section>
        )}

        {!suggesting && !searching && (
          <section className="log-ways-section" aria-label="Other ways to log">
            <div className="log-section-head"><span>Other ways</span></div>
            <div className="log-ways">
              {way('prep', 'Add to fridge', props.onBatch, 'Meal prep or something you bought')}
              {way('edit', 'Type it in', typeIn)}
              {way('approx', 'Rough meal', props.onRoughMeal)}
            </div>
          </section>
        )}

        <footer className="log-foot">
          <div className="log-foot-row">
            <p>{suggesting ? 'Suggestions are a starting point. You check the numbers before anything is saved.' : 'Estimates can be wrong. You check the numbers before anything is saved.'}</p>
            {hasKey && <p className="log-model">{model || 'Gemini'} · your key</p>}
          </div>
          <div className="log-foot-links">
            {!suggesting && <button type="button" className="link-btn" onClick={props.onPasteEstimate}>Paste an estimate from another chatbot</button>}
            <button type="button" className="link-btn" aria-expanded={tipsOpen} onClick={() => setTipsOpen(current => !current)}>Tips</button>
          </div>
          {tipsOpen && (suggesting ? (
            <ul className="log-tips">
              <li>Eating out: name the place (“Macca’s”, “a Thai place”) or photograph the menu. Hold your phone flat over it in good light so the small print is readable, and include dish descriptions and sides if you can. Up to {MAX_SUGGEST_PHOTOS} photos.</li>
              <li>At home: say what’s in the fridge and how much time you have.</li>
              <li>Not sure? Just ask. Dawni suggests something that fits what’s left today and how the week is going.</li>
            </ul>
          ) : (
            <ul className="log-tips">
              <li>Packaged food: photograph the nutrition panel flat and close, plus the front. Say how much you ate (e.g. 150 g, half the tub).</li>
              <li>Home cooking: list ingredients and amounts, including oil, butter and sauces, and how many serves it made.</li>
              <li>Meals out: a photo from above plus a short description works best.</li>
            </ul>
          ))}
        </footer>
      </div>
    </Modal>
  );
}
