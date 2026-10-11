import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AppState, Meal } from '../types';
import { macrosDisagree } from '../aiEstimate';
import { compressImages } from '../image';
import {
  budgetReason,
  buildSuggestContext,
  mealBudget,
  MAX_SUGGEST_PHOTOS,
  SUGGEST_MEALS,
  SUGGEST_PHOTO_OPTIONS,
  suggestFooter,
  type SuggestItem,
  type SuggestSession
} from '../suggest';
import { type LogDraft } from '../appTypes';
import { energyText, energyUnitValue, energyValueForUnit, fmt } from '../utils';
import { defaultMealForCurrentTime } from '../ui/format';
import { Icon } from '../ui/icons';
import { MacroChips, scrollChipIntoView } from '../ui/controls';

/** The suggest box starts taller than the Log box: its placeholder gives two examples. */
const COMPOSER_MIN_PX = 96;
const COMPOSER_MAX_PX = 160;

/** What the Log sheet's Suggest mode needs from the app. */
export type SuggestProps = {
  /** The day the suggestion is for: the one shown on Today. */
  date: string;
  meal: Meal;
  onMeal: (meal: Meal) => void;
  draft: LogDraft;
  setDraft: (update: (draft: LogDraft) => LogDraft) => void;
  /** The last suggestion if it is for this day and recent. */
  session: SuggestSession | null;
  /** Whether that suggestion or the form to ask again is showing. */
  view: 'result' | 'compose';
  /** Back to the form with what was asked still in it. */
  onChange: () => void;
  /** Forget the suggestion and what was asked. */
  onStartOver: () => void;
  onLog: (item: SuggestItem) => void;
  /** Ask Gemini. With no key the Log sheet connects one first. */
  onRun: () => void;
};

/**
 * Ask what to eat: where you're going or what's at home, optional menu photos, the meal, and what
 * the rest of the day has room for. Words alone are enough; so are photos.
 */
export function SuggestComposer({ open, state, props, error, timedOut, onTypeIn, onDismissError, onRun }: {
  open: boolean;
  state: AppState;
  props: SuggestProps;
  /** Why the last request failed, and whether it was the 45 s timeout. */
  error: string;
  timedOut: boolean;
  onTypeIn: () => void;
  /** Editing what was asked settles a failed request. */
  onDismissError: () => void;
  onRun: () => void;
}) {
  const { draft, meal, date } = props;
  const [mealPicked, setMealPicked] = useState(false);
  const [addingPhotos, setAddingPhotos] = useState(false);
  const [photoNote, setPhotoNote] = useState('');
  const [photoError, setPhotoError] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const mealRowRef = useRef<HTMLDivElement>(null);

  const context = useMemo(() => buildSuggestContext(state, date, meal), [state, date, meal]);
  const budget = mealBudget(context, meal);
  const unit = energyUnitValue(state.settings.energyUnit);
  const rangeText = budget.low === budget.high
    ? energyText(state, budget.high)
    : `${fmt(energyValueForUnit(budget.low, unit))}–${energyText(state, budget.high)}`;
  const canRun = !!(draft.text.trim() || draft.photos.length) && !addingPhotos;
  // The hint says where the meal came from, so only while it is still the clock's guess.
  const fromClock = !mealPicked && meal === defaultMealForCurrentTime();

  // Each visit says again where the meal came from.
  useEffect(() => {
    if (open) setMealPicked(false);
  }, [open]);

  // On a desktop the text box takes the cursor straight away. Not on a phone: the keyboard would cover the sheet.
  useEffect(() => {
    if (!open || typeof matchMedia !== 'function' || !matchMedia('(pointer: fine)').matches) return;
    const timer = window.setTimeout(() => textRef.current?.focus({ preventScroll: true }), 340);
    return () => window.clearTimeout(timer);
  }, [open]);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(COMPOSER_MIN_PX, Math.min(COMPOSER_MAX_PX, el.scrollHeight + 2))}px`;
  }, [draft.text, open]);

  // The chosen meal stays in view on the one-line row.
  useEffect(() => {
    scrollChipIntoView(mealRowRef.current, false);
  }, [meal, open]);

  const edit = (update: (current: LogDraft) => LogDraft) => {
    onDismissError();
    props.setDraft(update);
  };

  const addPhotos = async (files: FileList | null) => {
    const list = Array.from(files || []);
    if (photoInputRef.current) photoInputRef.current.value = '';
    const room = MAX_SUGGEST_PHOTOS - draft.photos.length;
    if (!list.length || room <= 0) return;
    const accepted = list.slice(0, room);
    setPhotoError('');
    setPhotoNote(list.length > accepted.length ? `Dawni sends up to ${MAX_SUGGEST_PHOTOS} photos, so only the first ${accepted.length} ${accepted.length === 1 ? 'was' : 'were'} added.` : '');
    setAddingPhotos(true);
    const { photos, failed } = await compressImages(accepted, SUGGEST_PHOTO_OPTIONS);
    edit(current => ({ ...current, photos: [...current.photos, ...photos].slice(0, MAX_SUGGEST_PHOTOS) }));
    if (failed) setPhotoError(failed === 1 ? 'One photo couldn’t be read. Try taking it again.' : `${failed} photos couldn’t be read. Try taking them again.`);
    setAddingPhotos(false);
  };

  const logged = context.items.length;
  const week = context.weekLine.replace(/^Week[^:]*: /, '');
  const preferences = state.settings.aiPreferences.trim();
  const shownError = error || photoError;

  return (
    <>
      <div className="log-composer suggest-composer">
        <textarea
          ref={textRef}
          className="log-text suggest-text"
          value={draft.text}
          rows={3}
          aria-label="Where are you eating, or what’s in the fridge?"
          placeholder="Where are you eating, or what’s in the fridge? e.g. Macca’s for lunch · cooking at home, have chicken thighs and rice"
          enterKeyHint="enter"
          onChange={event => {
            const text = event.target.value;
            edit(current => ({ ...current, text }));
          }}
        />
        {draft.photos.length > 0 && (
          <div className="log-thumbs">
            {draft.photos.map((src, index) => (
              <span key={`${index}-${src.length}`} className="log-thumb">
                <img src={src} alt={`Menu photo ${index + 1}`} />
                <button type="button" className="log-thumb-remove" aria-label={`Remove menu photo ${index + 1}`} onClick={() => edit(current => ({ ...current, photos: current.photos.filter((_, i) => i !== index) }))}>
                  <span aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        {(shownError || photoNote) && (
          <div className={shownError ? 'log-error' : 'log-note'} role={shownError ? 'alert' : 'status'}>
            <p>{shownError || photoNote}</p>
            {error && timedOut && <button type="button" className="secondary" onClick={onTypeIn}>Type it in</button>}
          </div>
        )}
        <div className="log-toolbar">
          <input ref={photoInputRef} hidden type="file" accept="image/*" multiple onChange={event => addPhotos(event.target.files)} />
          <button
            type="button"
            className="log-photo-chip"
            disabled={addingPhotos || draft.photos.length >= MAX_SUGGEST_PHOTOS}
            onClick={() => photoInputRef.current?.click()}
            aria-label={draft.photos.length ? `Add another menu photo, ${draft.photos.length} of ${MAX_SUGGEST_PHOTOS}` : 'Add a menu photo'}
          >
            <Icon name="camera" size={20} />
            <span>{addingPhotos ? 'Adding…' : 'Photo'}</span>
          </button>
          <button type="button" className="primary log-estimate" disabled={!canRun} onClick={onRun}>
            {error ? 'Try again' : 'Suggest'}
          </button>
        </div>
      </div>

      <section className="suggest-meal" aria-label="Meal">
        <div className="log-section-head"><span>Choosing for</span></div>
        <div ref={mealRowRef} className="meal-chip-row" role="group" aria-label="Meal">
          {SUGGEST_MEALS.map(item => (
            <button key={item} type="button" className={`meal-chip ${meal === item ? 'active' : ''}`} aria-pressed={meal === item} onClick={() => { props.onMeal(item); setMealPicked(true); }}>{item}</button>
          ))}
        </div>
        {fromClock && <p className="hint suggest-hint">Picked from the time ({new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}). Tap to change.</p>}
        <p className="suggest-budget">
          {budget.remaining > 0
            ? <>Aim for about <strong>{rangeText}</strong> for {meal.toLowerCase()}. That {budgetReason(meal)}.</>
            : <>You’ve reached today’s target, so Gemini will look for the lightest option that still satisfies. The week can still balance.</>}
        </p>
      </section>

      <details className="extra-info suggest-how">
        <summary>What gets sent to Gemini</summary>
        <div className="extra-info-body">
          <ul className="suggest-how-list">
            <li>What you type{draft.photos.length ? ` and your ${draft.photos.length === 1 ? 'menu photo' : `${draft.photos.length} menu photos`}` : ', and any menu photos you add'}.</li>
            <li>The meal you’re choosing for and the time.</li>
            <li>Today so far: calories and macros eaten, your targets and goal mode, and what you’ve logged ({logged === 0 ? 'nothing yet' : `${logged} ${logged === 1 ? 'item' : 'items'}`}).</li>
            <li>How your week is going: {week}.</li>
            <li>Your usual foods and their Cal{context.usuals.length ? ` (${context.usuals.length} ${context.usuals.length === 1 ? 'food' : 'foods'})` : ', once you have some'}.</li>
            <li>“About you, for AI” from Settings: {preferences ? <q>{preferences}</q> : 'nothing saved yet.'}</li>
          </ul>
          <p className="hint">It goes to Google using your own Gemini key. Menu photos aren’t saved to your journal, and nothing is logged until you tap Log this.</p>
        </div>
      </details>
    </>
  );
}

/** A suggestion: the pick with its numbers and why, two others, and Log this. */
export function SuggestResult({ state, session, props }: { state: AppState; session: SuggestSession; props: SuggestProps }) {
  const { result } = session;
  const pick = result.pick as SuggestItem;
  const home = pick.source === 'home';
  const leftAfter = session.remainingAtRequest - pick.calories;
  const proteinAfter = Math.max(0, session.proteinLeftAtRequest - pick.protein);
  const fitText = session.remainingAtRequest <= 0
    ? 'You’d already reached today’s target before this meal. The week can still balance.'
    : leftAfter >= 0
      ? `Leaves about ${energyText(state, leftAfter)} and ${fmt(proteinAfter)}g of protein to go for the rest of today.`
      : `About ${energyText(state, -leftAfter)} over today’s target. The week can still balance.`;
  const madeAt = new Date(session.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const meal = session.meal.toLowerCase();
  const where = pick.source === 'venue' ? (result.venue ? `At ${result.venue}` : 'Eating out') : home ? 'To cook' : '';
  return (
    <div className="suggest-result">
      <div className="suggest-result-head">
        <div className="section">{home ? `To cook for ${meal}` : `Best pick for ${meal}`}</div>
        <span className="hint">Suggested at {madeAt}</span>
      </div>
      <article className="suggest-card">
        <h3>{pick.name}</h3>
        {pick.portion && <p className="suggest-portion">{pick.portion}</p>}
        <div className="meta-chips">
          <span className="meta-chip source-chip">{pick.printedEnergy ? 'From menu' : 'Estimated'}</span>
          {where && <span className="meta-chip source-chip">{where}</span>}
          <span className={`meta-chip confidence-chip confidence-${pick.confidence}`}>{pick.confidence[0].toUpperCase() + pick.confidence.slice(1)} confidence</span>
        </div>
        <div className="database-preview-nutrition suggest-nutrition">
          <div><span>Calories</span><strong>{energyText(state, pick.calories)}</strong></div>
          <div><span>Protein</span><strong>{fmt(pick.protein)}g</strong></div>
          <div><span>Carbs</span><strong>{fmt(pick.carbs)}g</strong></div>
          <div><span>Fat</span><strong>{fmt(pick.fat)}g</strong></div>
        </div>
        <p className="suggest-fit">{fitText}</p>
        {pick.reason && <p className="suggest-reason">{pick.reason}</p>}
        {pick.tip && <p className="suggest-tip"><strong>{home ? 'Method:' : 'Tip:'}</strong> {pick.tip}</p>}
        {pick.assumptions.length > 0 && (
          <ul className="estimate-assumptions" aria-label="What Gemini assumed">
            {pick.assumptions.map(item => <li key={item}>{item}</li>)}
          </ul>
        )}
        {macrosDisagree(pick) && <p className="estimate-warning">Calories and macros don’t quite add up, so treat these numbers loosely.</p>}
        <button className="primary suggest-log" type="button" onClick={() => props.onLog(pick)}>Log this</button>
      </article>
      {result.alternatives.length > 0 && (
        <div className="suggest-section">
          <div className="section">Also good</div>
          <div className="suggest-alt-list">
            {result.alternatives.map(item => (
              <div key={item.name} className="suggest-alt">
                <div className="suggest-alt-main">
                  <strong>{item.name}</strong>
                  <div className="meta-chips">
                    <span className="meta-chip accent">{energyText(state, item.calories)}</span>
                    {item.printedEnergy && <span className="meta-chip source-chip">From menu</span>}
                    <MacroChips fat={item.fat} carbs={item.carbs} protein={item.protein} />
                  </div>
                  {item.reason && <small>{item.reason}</small>}
                </div>
                <button className="secondary suggest-alt-log" type="button" aria-label={`Log ${item.name}`} onClick={() => props.onLog(item)}>Log</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {result.summary && (
        <div className="help-callout suggest-summary">
          <strong>Why this pick</strong>
          <p>{result.summary}</p>
        </div>
      )}
      {result.note && <p className="hint suggest-caveat">{result.note}</p>}
      <p className="hint suggest-disclaimer">{suggestFooter(pick.source, result.venue)}</p>
      <div className="suggest-actions">
        <button className="secondary" type="button" onClick={props.onChange}>Change meal, text or photos</button>
        <button className="secondary" type="button" onClick={props.onStartOver}>Start a new suggestion</button>
      </div>
    </div>
  );
}
