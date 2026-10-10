import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppState, Meal } from '../types';
import { compressImage } from '../image';
import { macrosDisagree } from '../aiEstimate';
import { requestMenuPick } from '../geminiEstimate';
import {
  budgetReason,
  buildMenuPickContext,
  buildMenuPickRequest,
  isMenuPickFresh,
  loadLastMenuPick,
  MAX_MENU_PHOTOS,
  mealBudget,
  MENU_PHOTO_OPTIONS,
  MENU_PICK_MEALS,
  parseMenuPick,
  saveLastMenuPick,
  type MenuPickItem,
  type MenuPickSession
} from '../menuPick';
import { energyText, energyUnitValue, energyValueForUnit, fmt } from '../utils';
import { Modal } from '../ui/Modal';
import { MacroChips, Field } from '../ui/controls';
import { defaultMealForCurrentTime } from '../ui/format';

export function MenuPickModal({ open, state, date, apiKey, onClose, onLog, onBackgroundNotice }: {
  open: boolean;
  state: AppState;
  date: string;
  apiKey: string;
  onClose: () => void;
  onLog: (item: MenuPickItem, meal: Meal) => void;
  onBackgroundNotice: (message: string) => void;
}) {
  // Unlike the estimate sheet, nothing resets on close: the sheet can be closed
  // while Gemini reads the menu, and the suggestion should still be here after.
  const [meal, setMeal] = useState<Meal>(() => defaultMealForCurrentTime());
  const [mealPicked, setMealPicked] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [addingPhotos, setAddingPhotos] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [session, setSession] = useState<MenuPickSession | null>(null);
  const [showResult, setShowResult] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const photoInputRef = useRef<HTMLInputElement>(null);

  const context = useMemo(() => buildMenuPickContext(state, date), [state, date]);
  const budget = mealBudget(context, meal);
  const activeSession = isMenuPickFresh(session, date) ? session : null;
  const unit = energyUnitValue(state.settings.energyUnit);
  const proteinLeft = Math.max(0, context.proteinTarget - context.eaten.protein);
  const rangeText = budget.low === budget.high
    ? energyText(state, budget.high)
    : `${fmt(energyValueForUnit(budget.low, unit))}–${energyText(state, budget.high)}`;

  // Bring back a recent suggestion if the app was closed while ordering.
  useEffect(() => {
    let cancelled = false;
    loadLastMenuPick(date)
      .then(saved => {
        if (cancelled || !saved) return;
        setSession(current => current || saved);
        setShowResult(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [date]);

  useEffect(() => {
    if (!open) return;
    setError('');
    // A fresh visit with nothing in progress follows the clock.
    if (!loading && !photos.length && !activeSession) {
      setMeal(defaultMealForCurrentTime());
      setMealPicked(false);
    }
  }, [open]);

  const addPhotos = async (files: FileList | null) => {
    const list = Array.from(files || []);
    if (photoInputRef.current) photoInputRef.current.value = '';
    const room = MAX_MENU_PHOTOS - photos.length;
    if (!list.length || room <= 0) return;
    const accepted = list.slice(0, room);
    setError('');
    setNotice(list.length > accepted.length ? `Dawni sends up to ${MAX_MENU_PHOTOS} photos, so only the first ${accepted.length} ${accepted.length === 1 ? 'was' : 'were'} added.` : '');
    setAddingPhotos(true);
    const added: string[] = [];
    let failed = 0;
    // One at a time: decoding several full-size phone photos at once can run a phone out of memory.
    for (const file of accepted) {
      try {
        const photo = await compressImage(file, MENU_PHOTO_OPTIONS);
        if (photo) added.push(photo);
      } catch {
        failed += 1;
      }
    }
    setPhotos(current => [...current, ...added].slice(0, MAX_MENU_PHOTOS));
    if (failed) setError(failed === 1 ? 'One photo couldn’t be read. Try taking it again.' : `${failed} photos couldn’t be read. Try taking them again.`);
    setAddingPhotos(false);
  };

  const submit = async () => {
    if (!photos.length) {
      setError('Add at least one photo of the menu.');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const requestMeal = meal;
    const requestContext = context;
    const requestBudget = budget;
    setLoading(true);
    setError('');
    setNotice('');
    const finishedClosed = (message: string) => {
      if (!openRef.current) onBackgroundNotice(message);
    };
    try {
      const raw = await requestMenuPick({
        apiKey,
        userText: buildMenuPickRequest({ context: requestContext, meal: requestMeal, budget: requestBudget, note, preferences: state.settings.aiPreferences, photoCount: photos.length }),
        imageDataUrls: photos,
        accept: text => !!parseMenuPick(text),
        signal: controller.signal
      });
      const result = parseMenuPick(raw);
      if (!result) {
        setError('Gemini replied in a format Dawni couldn’t read. Try again.');
        finishedClosed('Your menu pick couldn’t finish. Open Help me pick from a menu to see why.');
        return;
      }
      if (!result.menuReadable || !result.pick) {
        setNotice(result.note || 'Gemini couldn’t read a menu in these photos. Try a closer, well-lit photo of the menu text.');
        finishedClosed('Gemini couldn’t read that menu. Open Help me pick from a menu for tips.');
        return;
      }
      const next: MenuPickSession = {
        version: 1,
        date: requestContext.date,
        createdAt: Date.now(),
        meal: requestMeal,
        remainingAtRequest: requestBudget.remaining,
        proteinLeftAtRequest: Math.max(0, requestContext.proteinTarget - requestContext.eaten.protein),
        result
      };
      setSession(next);
      setShowResult(true);
      void saveLastMenuPick(next);
      finishedClosed('Your menu pick is ready. Tap Help me pick from a menu to see it.');
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Gemini could not suggest anything from this menu.');
      finishedClosed('Your menu pick couldn’t finish. Open Help me pick from a menu to see why.');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  };

  const startOver = () => {
    abortRef.current?.abort();
    setPhotos([]);
    setNote('');
    setError('');
    setNotice('');
    setSession(null);
    setShowResult(false);
    setMeal(defaultMealForCurrentTime());
    setMealPicked(false);
    void saveLastMenuPick(null);
  };

  if (showResult && activeSession && !loading) {
    const { result } = activeSession;
    const pick = result.pick as MenuPickItem;
    const leftAfter = activeSession.remainingAtRequest - pick.calories;
    const proteinAfter = Math.max(0, activeSession.proteinLeftAtRequest - pick.protein);
    const fitText = activeSession.remainingAtRequest <= 0
      ? 'You’d already reached today’s target before this meal. The week can still balance.'
      : leftAfter >= 0
        ? `Leaves about ${energyText(state, leftAfter)} and ${fmt(proteinAfter)}g of protein to go for the rest of today.`
        : `About ${energyText(state, -leftAfter)} over today’s target. The week can still balance.`;
    const madeAt = new Date(activeSession.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return (
      <Modal open={open} title="Pick from a menu" onClose={onClose} bottomSheet>
        <div className="menu-pick-result">
          <div className="menu-pick-result-head">
            <div className="section">Best pick for {activeSession.meal.toLowerCase()}</div>
            <span className="hint">Suggested at {madeAt}</span>
          </div>
          <article className="menu-pick-card">
            <h3>{pick.name}</h3>
            <div className="meta-chips">
              <span className="meta-chip source-chip">{pick.fromMenu ? 'From menu' : 'Estimated'}</span>
              <span className={`meta-chip confidence-chip confidence-${pick.confidence}`}>{pick.confidence[0].toUpperCase() + pick.confidence.slice(1)} confidence</span>
            </div>
            <div className="database-preview-nutrition menu-pick-nutrition">
              <div><span>Calories</span><strong>{energyText(state, pick.calories)}</strong></div>
              <div><span>Protein</span><strong>{fmt(pick.protein)}g</strong></div>
              <div><span>Carbs</span><strong>{fmt(pick.carbs)}g</strong></div>
              <div><span>Fat</span><strong>{fmt(pick.fat)}g</strong></div>
            </div>
            <p className="menu-pick-fit">{fitText}</p>
            {pick.reason && <p className="menu-pick-reason">{pick.reason}</p>}
            {pick.tip && <p className="menu-pick-tip"><strong>Tip:</strong> {pick.tip}</p>}
            {pick.assumptions.length > 0 && (
              <ul className="estimate-assumptions" aria-label="What Gemini assumed">
                {pick.assumptions.map(item => <li key={item}>{item}</li>)}
              </ul>
            )}
            {macrosDisagree(pick) && <p className="estimate-warning">Calories and macros don’t quite add up, so treat these numbers loosely.</p>}
            <button className="primary menu-pick-log" type="button" onClick={() => onLog(pick, activeSession.meal)}>Log this</button>
          </article>
          {result.alternatives.length > 0 && (
            <div className="menu-pick-section">
              <div className="section">Also good</div>
              <div className="menu-pick-alt-list">
                {result.alternatives.map(item => (
                  <div key={item.name} className="menu-pick-alt">
                    <div className="menu-pick-alt-main">
                      <strong>{item.name}</strong>
                      <div className="meta-chips">
                        <span className="meta-chip accent">{energyText(state, item.calories)}</span>
                        {item.fromMenu && <span className="meta-chip source-chip">From menu</span>}
                        <MacroChips fat={item.fat} carbs={item.carbs} protein={item.protein} />
                      </div>
                      {item.reason && <small>{item.reason}</small>}
                    </div>
                    <button className="secondary menu-pick-alt-log" type="button" onClick={() => onLog(item, activeSession.meal)}>Log</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {result.summary && (
            <div className="help-callout menu-pick-summary">
              <strong>Why this pick</strong>
              <p>{result.summary}</p>
            </div>
          )}
          {result.note && <p className="hint menu-pick-caveat">{result.note}</p>}
          <p className="hint menu-pick-disclaimer">Estimated from a menu photo. Restaurant portions vary, so check the numbers when you log.</p>
        </div>
        <div className="actions vertical">
          {photos.length > 0 && <button className="secondary" type="button" onClick={() => setShowResult(false)}>Change meal, note or photos</button>}
          <button className="secondary" type="button" onClick={startOver}>Start a new menu</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} title="Pick from a menu" onClose={onClose} bottomSheet>
      <div className="menu-pick-modal">
        <p className="hint menu-pick-intro">Take a photo of the menu you’re ordering from, either the whole page or just the part you’re choosing from. Gemini suggests a dish that fits the rest of your day.</p>

        <div className="menu-pick-section">
          <div className="section">Choosing for</div>
          <div className="meal-chip-row" role="group" aria-label="Meal">
            {MENU_PICK_MEALS.map(item => (
              <button key={item} type="button" className={`meal-chip ${meal === item ? 'active' : ''}`} disabled={loading} aria-pressed={meal === item} onClick={() => { setMeal(item); setMealPicked(true); }}>{item}</button>
            ))}
          </div>
          {!mealPicked && <p className="hint menu-pick-meal-hint">Picked from the time ({new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}). Tap to change.</p>}
        </div>

        <div className="menu-pick-today" aria-label="Today so far">
          <div className="menu-pick-stat">
            <span>{budget.remaining >= 0 ? 'Calories left today' : 'Over today’s target'}</span>
            <strong>{energyText(state, Math.abs(budget.remaining))}</strong>
            <small>{energyText(state, context.eaten.calories)} of {energyText(state, context.calorieTarget)} eaten</small>
          </div>
          <div className="menu-pick-stat">
            <span>Protein to go</span>
            <strong>{fmt(proteinLeft)}g</strong>
            <small>{fmt(context.eaten.protein)}g of {fmt(context.proteinTarget)}g eaten</small>
          </div>
          <p className="menu-pick-budget">
            {budget.remaining > 0
              ? <>Aim for about <strong>{rangeText}</strong> for {meal.toLowerCase()}. That {budgetReason(meal)}.</>
              : <>You’ve reached today’s target, so Gemini will look for the lightest option that still satisfies. The week can still balance.</>}
          </p>
        </div>

        <div className="menu-pick-section">
          <div className="section">Menu photos</div>
          <input ref={photoInputRef} hidden type="file" accept="image/*" multiple onChange={event => addPhotos(event.target.files)} />
          <div className="menu-photo-grid">
            {photos.map((src, index) => (
              <div key={`${index}-${src.length}`} className="menu-photo">
                <img src={src} alt={`Menu photo ${index + 1}`} />
                {!loading && (
                  <button type="button" className="menu-photo-remove" aria-label={`Remove menu photo ${index + 1}`} onClick={() => setPhotos(current => current.filter((_, i) => i !== index))}>
                    <span aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
            {photos.length < MAX_MENU_PHOTOS && (
              <button type="button" className="menu-photo-add" disabled={loading || addingPhotos} onClick={() => photoInputRef.current?.click()}>
                <span className="empty-photo-icon" aria-hidden="true" />
                <span>{addingPhotos ? 'Adding…' : photos.length ? 'Add page' : 'Add menu photo'}</span>
              </button>
            )}
          </div>
          <p className="hint menu-photo-tip">Up to {MAX_MENU_PHOTOS} photos. Hold your phone flat over the menu in good light so the small print is readable, and include dish descriptions and sides if you can.</p>
        </div>

        <Field label="Anything Gemini should know? (optional)" full>
          <textarea className="menu-pick-note" disabled={loading} value={note} onChange={event => setNote(event.target.value)} placeholder="e.g. high protein, no seafood, I’m sharing the chips" />
        </Field>

        <details className="extra-info menu-pick-how">
          <summary>What gets sent to Gemini</summary>
          <div className="extra-info-body">
            <ul className="menu-pick-how-list">
              <li>Your menu photos and note.</li>
              <li>Today’s calories and macros so far, your targets and goal mode, and what you’ve logged today.</li>
              <li>The meal you’re choosing for and the time.</li>
            </ul>
            <p className="hint">It goes to Google using your own Gemini key. Menu photos aren’t saved to your journal, and nothing is logged until you tap Log this.</p>
          </div>
        </details>

        {notice && <div className="help-callout menu-pick-notice">{notice}</div>}
        {error && <p className="ai-quick-log-error">{error}</p>}
      </div>
      <div className="actions vertical">
        {/* In the sticky bar so it's on screen however far the sheet is scrolled. */}
        {loading && (
          <div className="menu-pick-loading" role="status" aria-live="polite">
            <span className="menu-pick-spinner" aria-hidden="true" />
            <div>
              <strong>Reading the menu…</strong>
              <p className="hint">Usually 10–30 seconds. You can close this sheet and Dawni will let you know when it’s ready.</p>
            </div>
          </div>
        )}
        {loading
          ? <button className="secondary" type="button" onClick={() => abortRef.current?.abort()}>Cancel</button>
          : <button className="primary" type="button" disabled={!photos.length || addingPhotos} onClick={submit}>{activeSession ? 'Suggest again' : 'Suggest what to order'}</button>}
        {!loading && (activeSession
          ? <button className="secondary" type="button" onClick={() => setShowResult(true)}>Back to suggestion</button>
          : <button className="secondary" type="button" onClick={onClose}>Close</button>)}
      </div>
    </Modal>
  );
}
