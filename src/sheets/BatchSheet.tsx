import { FormEvent, useEffect, useRef, useState } from 'react';
import type { AppState, Batch, BatchIngredient, BatchKind, EnergyUnit, EntryEstimateSource, Food, Totals } from '../types';
import { energyFromMacros, estimateSourceLabel, macrosDisagree, MAX_ESTIMATE_PHOTOS } from '../aiEstimate';
import { isGeminiAbort } from '../geminiEstimate';
import { compressImages, SHARP_PHOTO_OPTIONS } from '../image';
import { BATCH_SHELF_DAYS, BOUGHT_SHELF_DAYS, batchServe, batchServesLeft, DEFAULT_BATCH_SERVINGS, defaultServesChange, foodBatch, MAX_BATCH_SERVINGS, MAX_PACKS, packBatch, packsValue, resizeLot, servingsValue, serveGrams, sumTotals, type BatchEstimate, type PackEstimate, type ServesChange } from '../mealPrep';
import { energyInputFromKcal, energyInputToKcal, energyTextForUnit, energyUnitLabel, energyUnitValue, energyValueForUnit, fmt, fmtPortion, n } from '../utils';
import { type BatchInput, type BatchSheetRequest } from '../appTypes';
import { Modal } from '../ui/Modal';
import { Field, MacroChips, ServePips } from '../ui/controls';
import { Icon } from '../ui/icons';
import { roundedText, cookedText } from '../ui/format';
import { ConnectGeminiCard } from './ConnectGemini';
import { SavedFoodRow } from './FoodSearch';
import { useFoodSearch } from './useFoodSearch';
import { favouritesByUse } from '../logUsuals';

/** Foods listed before anything is typed: every favourite, then this many recent ones. */
const PICK_RECENT_SHOWN = 20;

function ServesStepper({ value, min = 1, max = MAX_BATCH_SERVINGS, noun = 'serve', label = 'Serves', onChange, disabled = false }: { value: number; min?: number; max?: number; noun?: string; label?: string; onChange: (next: number) => void; disabled?: boolean }) {
  return (
    <div className="serves-stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`One ${noun} fewer`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label={`One ${noun} more`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </div>
  );
}

const ZERO_TOTALS: Totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
type ServeInputs = Record<keyof Totals, string>;
type Step = 'choose' | 'pick' | 'describe' | 'review';
/** What a request to Gemini hands back: its reply, for Refine, and what was read from it. */
type Reading<T> = { raw: string; estimate: T };
/** The lot as it was opened, read or typed. Changing the serves works from this, so stepping up and back lands where it began. */
type Lot = { total: Totals; servings: number; grams: number };

/** One serve's numbers as typed text; blank while the batch has none yet. */
function serveInputs(total: Totals, servings: number, unit: EnergyUnit): ServeInputs {
  if (!(total.calories > 0)) return { calories: '', protein: '', carbs: '', fat: '' };
  const each = (value: number) => roundedText(value / servings, 1);
  return { calories: energyInputFromKcal(total.calories / servings, unit), protein: each(total.protein), carbs: each(total.carbs), fat: each(total.fat) };
}

/**
 * The fridge: food on hand, logged a serve at a time. Something new starts by saying where it came
 * from. Cooked (meal prep): list what went in and how many serves, Gemini estimates the whole batch
 * ingredient by ingredient. Bought: photograph the nutrition label and say how many packs, Gemini
 * reads one pack and Dawni multiplies it out into the label's serves. Either way the review shows one
 * serve. Changing the serves means more of the same for bought food (each serve keeps its numbers,
 * the whole lot grows) and the same pot split again for cooking; once the count moves, a choice under
 * the stepper swaps the two. A split leaves serves already logged alone and splits only what's left.
 * Editing one serve's numbers changes the whole lot to match. From your foods: pick a saved food and say how many
 * serves you have. Its own serve is the fixed thing then, each one logs as that food, and nothing is
 * asked of Gemini.
 * The sheet can be closed while Gemini works: the request carries on and `onBackground` says how it went.
 */
export function BatchSheet({ open, request, batch, state, onEstimate, onEstimatePack, onSaveKey, onBusyChange, onBackground, onSave, onFinish, onClose }: {
  open: boolean;
  request: BatchSheetRequest;
  /** The batch being edited, or the finished one being cooked or bought again. */
  batch: Batch | null;
  state: AppState;
  onEstimate: (recipe: string, servings: number, previous?: string, correction?: string, signal?: AbortSignal) => Promise<Reading<BatchEstimate>>;
  /** Reads one pack of bought food from label photos and/or what's typed. */
  onEstimatePack: (description: string, photos: string[], packs: number, previous?: string, correction?: string, signal?: AbortSignal) => Promise<Reading<PackEstimate>>;
  /** Saves a key connected from the sheet's own Connect card. */
  onSaveKey: (key: string) => Promise<void>;
  /** Gemini started working on this sheet's request (for what kind), or stopped (null). */
  onBusyChange: (busy: BatchKind | null) => void;
  /** A request finished while the sheet was closed. Reopening the sheet (same request) shows the result. */
  onBackground: (outcome: { ok: true; kind: BatchKind } | { ok: false; kind: BatchKind; message: string }) => void;
  onSave: (input: BatchInput, logNow: boolean) => void;
  onFinish: (batch: Batch) => void;
  onClose: () => void;
}) {
  const unit = energyUnitValue(state.settings.energyUnit);
  const hasKey = !!state.settings.geminiApiKey.trim();
  const editing = request.mode === 'edit';
  const [step, setStep] = useState<Step>('choose');
  const [kind, setKind] = useState<BatchKind>('cooked');
  const [recipe, setRecipe] = useState('');
  const [servings, setServings] = useState(DEFAULT_BATCH_SERVINGS);
  const [name, setName] = useState('');
  const [total, setTotal] = useState<Totals>(ZERO_TOTALS);
  const [grams, setGrams] = useState(0);
  const [base, setBase] = useState<Lot>({ total: ZERO_TOTALS, servings: DEFAULT_BATCH_SERVINGS, grams: 0 });
  /** What a new number of serves means, once picked under the stepper; until then it goes by the food. */
  const [servesChange, setServesChange] = useState<ServesChange | null>(null);
  /** The numbers were typed in a serve at a time, so there's no whole batch to split: more serves are more of it. */
  const [typedServe, setTypedServe] = useState(false);
  const [inputs, setInputs] = useState<ServeInputs>(() => serveInputs(ZERO_TOTALS, 1, unit));
  const [ingredients, setIngredients] = useState<BatchIngredient[]>([]);
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<Batch['confidence']>(null);
  const [estimateSource, setEstimateSource] = useState<EntryEstimateSource | null>(null);
  /** Bought: label photos, how many packs, and what one label serve is. */
  const [photos, setPhotos] = useState<string[]>([]);
  const [addingPhotos, setAddingPhotos] = useState(false);
  const [packs, setPacks] = useState(1);
  const [labelServe, setLabelServe] = useState('');
  /** Gemini's last reply, so Refine can send a correction against it. */
  const [reply, setReply] = useState('');
  const [refineText, setRefineText] = useState('');
  const [busy, setBusy] = useState<'estimate' | 'refine' | null>(null);
  const [error, setError] = useState('');
  /** The error came from Gemini, so the button offers Try again. */
  const [failed, setFailed] = useState(false);
  /** No key yet: the describe step shows the Connect card in place of Estimate. */
  const [connecting, setConnecting] = useState(false);
  /** From your foods: the saved food it's a stock of, what the list is searched for, and one serve's grams (per 100 g foods). */
  const [foodId, setFoodId] = useState<string | null>(null);
  const [pickQuery, setPickQuery] = useState('');
  const [serveGramsText, setServeGramsText] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const abortRef = useRef<AbortController | null>(null);
  /** Bumped by each request and by Cancel, so a reply to an older one is ignored. */
  const requestSeq = useRef(0);
  /** The opening the sheet last started afresh for; reopening for a result keeps what's there. */
  const startedFor = useRef(0);

  // Each new opening starts afresh: asking cooked or bought for something new, or from the batch being edited or had again.
  // Reopening the same one (the pill, or Review in a toast) keeps it, so a result that came in while closed is there.
  useEffect(() => {
    if (!open || request.opened === startedFor.current) return;
    startedFor.current = request.opened;
    stopRequest();
    const source = request.mode === 'new' ? null : batch;
    const count = source?.servings || DEFAULT_BATCH_SERVINGS;
    const nextTotal = source?.total || ZERO_TOTALS;
    setStep(source ? 'review' : 'choose');
    setKind(source?.kind || 'cooked');
    setRecipe(source?.recipe || '');
    setServings(count);
    setName(source?.name || '');
    setTotal(nextTotal);
    setGrams(source?.grams || 0);
    setBase({ total: nextTotal, servings: count, grams: source?.grams || 0 });
    setServesChange(null);
    setTypedServe(false);
    setInputs(serveInputs(nextTotal, count, unit));
    setIngredients(source?.ingredients || []);
    setAssumptions(source?.assumptions || []);
    setConfidence(source?.confidence || null);
    setEstimateSource(source?.estimateSource || null);
    setPhotos([]);
    setAddingPhotos(false);
    setPacks(1);
    setLabelServe('');
    setReply('');
    setRefineText('');
    setError('');
    setFailed(false);
    setConnecting(false);
    setFoodId(source?.foodId || null);
    setPickQuery('');
    setServeGramsText(source ? String(serveGrams(source) || '') : '');
  }, [open, request.opened]);

  const bought = kind === 'bought';
  // A saved food it's a stock of, while that food is still saved. Its serve sets the numbers.
  const linkedFood = foodId ? state.foods.find(food => food.id === foodId) : undefined;
  const lot = linkedFood ? foodBatch(linkedFood, servings, n(serveGramsText)) : null;
  const { userResults } = useFoodSearch(state, state.foods, step === 'pick' ? pickQuery : '');
  const used = editing && batch ? batch.servings - batchServesLeft(batch, state.entries) : 0;
  const left = Math.max(0, Math.round((servings - used) * 100) / 100);
  // Editing can't split it into fewer serves than are already logged; Finish is for that.
  const minServings = Math.max(1, Math.ceil(used));

  const change = servesChange || (typedServe ? 'keep' : defaultServesChange(kind));

  /** Sets the serves and the numbers that go with them, worked out from the lot as it started. */
  const resize = (count: number, how: ServesChange) => {
    const next = resizeLot(base, base.servings, count, how, used);
    setServings(count);
    setTotal(next.total);
    setGrams(next.grams);
    setInputs(serveInputs(next.total, count, unit));
  };

  const changeServings = (next: number) => resize(Math.max(minServings, servingsValue(next)), change);

  const pickServesChange = (how: ServesChange) => {
    setServesChange(how);
    resize(servings, how);
  };

  const setServeInput = (key: keyof Totals, value: string) => {
    setInputs(current => ({ ...current, [key]: value }));
    const each = key === 'calories' ? energyInputToKcal(value, unit) : n(value);
    const next = { ...total, [key]: key === 'calories' ? Math.round(each * servings) : Math.round(each * servings * 10) / 10 };
    setTotal(next);
    // Typed numbers are the new starting point for changing the serves.
    setBase({ total: next, servings, grams });
    setError('');
  };

  const applyEstimate = (raw: string, estimate: BatchEstimate) => {
    setReply(raw);
    setName(estimate.name);
    setTotal(estimate.total);
    setBase({ total: estimate.total, servings, grams });
    setServesChange(null);
    setTypedServe(false);
    setInputs(serveInputs(estimate.total, servings, unit));
    setIngredients(estimate.ingredients);
    setAssumptions(estimate.assumptions);
    setConfidence(estimate.confidence);
    setEstimateSource('ai');
    setStep('review');
  };

  /** One pack times the packs bought, split into the label's serves. */
  const applyPack = (raw: string, estimate: PackEstimate) => {
    const lot = packBatch(estimate, packs);
    setReply(raw);
    setName(estimate.name);
    setTotal(lot.total);
    setServings(lot.servings);
    setInputs(serveInputs(lot.total, lot.servings, unit));
    setGrams(lot.grams);
    setBase(lot);
    setServesChange(null);
    setTypedServe(false);
    setLabelServe(estimate.servingDescription);
    setIngredients([]);
    setAssumptions(estimate.assumptions);
    setConfidence(estimate.confidence);
    setEstimateSource(estimate.source === 'label' ? 'label' : 'ai');
    setStep('review');
  };

  /** Stops whatever is running, quietly (a new opening, or Cancel). */
  function stopRequest() {
    requestSeq.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(null);
    onBusyChange(null);
  }

  /**
   * One Gemini request: cancellable, timed out by the transport, and still landing if the sheet
   * was closed meanwhile. `apply` runs on success; a failure shows here, and both are announced
   * when the sheet is closed.
   */
  async function ask<T>(job: 'estimate' | 'refine', run: (signal: AbortSignal) => Promise<Reading<T>>, apply: (raw: string, result: T) => void, fallback: string) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const id = ++requestSeq.current;
    const forKind = kind;
    setBusy(job);
    setError('');
    setFailed(false);
    onBusyChange(forKind);
    let outcome: { ok: true; kind: BatchKind } | { ok: false; kind: BatchKind; message: string };
    try {
      const result = await run(controller.signal);
      if (requestSeq.current !== id) return;
      apply(result.raw, result.estimate);
      outcome = { ok: true, kind: forKind };
    } catch (err) {
      if (requestSeq.current !== id || isGeminiAbort(err)) return;
      const message = err instanceof Error && err.message ? err.message : fallback;
      setError(message);
      setFailed(true);
      outcome = { ok: false, kind: forKind, message };
    }
    abortRef.current = null;
    setBusy(null);
    onBusyChange(null);
    if (!openRef.current) onBackground(outcome);
  }

  const runEstimate = () => bought
    ? ask('estimate', signal => onEstimatePack(recipe, photos, packs, undefined, undefined, signal), applyPack, 'Gemini could not read this label.')
    : ask('estimate', signal => onEstimate(recipe, servings, undefined, undefined, signal), applyEstimate, 'Gemini could not estimate this batch.');

  const estimate = () => {
    if (bought && !photos.length && !recipe.trim()) return setError('Add a photo of the label, or say what it is.');
    if (!bought && !recipe.trim()) return setError('List what went in, with amounts.');
    if (!hasKey) return setConnecting(true);
    void runEstimate();
  };

  const refine = () => {
    const correction = refineText.trim();
    if (!correction || busy) return;
    const done = () => {
      // Kept with the recipe, so cooking it again starts from the corrected version.
      setRecipe(current => `${current.trim()}\n(Correction: ${correction})`.trim());
      setRefineText('');
    };
    if (bought) {
      void ask('refine', signal => onEstimatePack(recipe, photos, packs, reply, correction, signal), (raw, result) => {
        applyPack(raw, result);
        done();
      }, 'Gemini could not refine this.');
      return;
    }
    void ask('refine', signal => onEstimate(recipe, servings, reply, correction, signal), (raw, result) => {
      applyEstimate(raw, result);
      done();
    }, 'Gemini could not refine this estimate.');
  };

  const typeIn = () => {
    setConnecting(false);
    setFailed(false);
    setReply('');
    setIngredients([]);
    setAssumptions([]);
    setConfidence(null);
    setEstimateSource(null);
    setTotal(ZERO_TOTALS);
    setGrams(0);
    setLabelServe('');
    // Bought: one serve a pack to start with, as a ready meal is. A tub's serves go up on the stepper.
    const count = bought ? servingsValue(packs) : servings;
    setServings(count);
    setBase({ total: ZERO_TOTALS, servings: count, grams: 0 });
    setServesChange(null);
    setTypedServe(true);
    // What it is, typed on the way here, is its name.
    if (bought && recipe.trim()) setName(current => current || recipe.trim());
    setInputs(serveInputs(ZERO_TOTALS, count, unit));
    setError('');
    setStep('review');
  };

  const addPhotos = async (files: FileList | null) => {
    const list = Array.from(files || []).slice(0, MAX_ESTIMATE_PHOTOS - photos.length);
    if (photoInputRef.current) photoInputRef.current.value = '';
    if (!list.length) return;
    setError('');
    setAddingPhotos(true);
    const { photos: added, failed: unreadable } = await compressImages(list, SHARP_PHOTO_OPTIONS);
    if (unreadable) setError('One photo couldn’t be read. Try taking it again.');
    setPhotos(current => [...current, ...added].slice(0, MAX_ESTIMATE_PHOTOS));
    setAddingPhotos(false);
  };

  /** A saved food into the fridge: as many serves as last time it was there, or one. */
  const pickFood = (food: Food) => {
    const last = state.batches.filter(item => item.foodId === food.id).sort((a, b) => b.createdAt - a.createdAt)[0];
    setFoodId(food.id);
    setKind('bought');
    setName(food.name);
    setServings(servingsValue(last?.servings || 1));
    setServeGramsText(food.unitMode === '100g' ? String((last && serveGrams(last)) || food.servingGrams || 100) : '');
    setRecipe('');
    setPhotos([]);
    setIngredients([]);
    setAssumptions([]);
    setConfidence(null);
    setEstimateSource(null);
    setReply('');
    setError('');
    setStep('review');
  };

  /** Picks where it came from. Bought goes straight to the camera when Gemini is there to read the label. */
  const choose = (next: BatchKind) => {
    setKind(next);
    setError('');
    setStep('describe');
    if (next === 'bought' && hasKey) photoInputRef.current?.click();
  };

  const save = (logNow: boolean) => {
    if (lot) {
      if (!(lot.total.calories > 0)) return setError(`${linkedFood?.name || 'This food'} has no ${energyUnitLabel(unit)} saved. Add them in Foods first.`);
      return onSave(lot, logNow);
    }
    if (!name.trim()) {
      setError('Give it a name so you can find it again.');
      nameRef.current?.focus();
      return;
    }
    if (!(total.calories > 0)) return setError(`Add the ${energyUnitLabel(unit)} in one serve.`);
    onSave({ name: name.trim(), kind, recipe: recipe.trim(), servings, total, grams, ingredients, estimateSource, assumptions, confidence }, logNow);
  };

  const serve = batchServe({ total: lot?.total || total, servings });
  const gramsEach = serveGrams({ servings, grams: lot ? lot.grams : grams });
  const macroCheckFails = !!estimateSource && macrosDisagree(serve);
  const counted = sumTotals(ingredients);
  // Typed-over numbers, or more of the same, no longer match Gemini's breakdown, so it says so rather
  // than look wrong. A split is the same food, so it's checked against the lot it was split from.
  const breakdownEdited = ingredients.length > 0 && Math.abs(counted.calories - (change === 'split' ? base.total : total).calories) > Math.max(2, servings);
  // The serves moved off where they started, so it asks which way they meant it. A batch Gemini has
  // just estimated is all of what was listed, so it can only be split.
  const resized = !lot && servings !== base.servings && base.total.calories > 0 && (bought || !reply);
  const whole = lot?.total || total;
  const unitLabel = energyUnitLabel(unit);
  const title = step === 'choose'
    ? 'Add to fridge'
    : step === 'pick'
      ? 'From your foods'
      : editing
      ? (bought ? 'Edit' : 'Edit batch')
      : request.mode === 'again'
        ? (bought ? 'Bought again' : 'Cook again')
        : step === 'describe'
          ? (bought ? 'Something you bought' : 'Meal prep a batch')
          : (bought ? 'Review' : 'Review batch');

  const servesRow = (
    <>
      <div className="batch-serves-row">
        <span className="batch-serves-label">
          <strong>Serves</strong>
          <small>
            {whole.calories > 0
              ? `${editing && used > 0 ? `What’s left ${energyTextForUnit(serve.calories * left, unit)}` : `${bought ? 'All of it' : 'Whole batch'} ${energyTextForUnit(whole.calories, unit)}`}${gramsEach ? ` · about ${fmt(gramsEach)} g a serve` : ''}`
              : bought ? 'How many serves in all' : 'The batch is split evenly'}
          </small>
        </span>
        <ServesStepper value={servings} min={minServings} onChange={changeServings} disabled={!!busy} />
      </div>
      {resized && (
        <span className="unit-toggle-chip serves-change" role="group" aria-label={`What ${fmt(servings)} serves means`}>
          <button type="button" className={change === 'keep' ? 'active' : ''} aria-pressed={change === 'keep'} disabled={!!busy} onClick={() => pickServesChange('keep')}>Each serve the same</button>
          <button type="button" className={change === 'split' ? 'active' : ''} aria-pressed={change === 'split'} disabled={!!busy} onClick={() => pickServesChange('split')}>{used > 0 ? 'Split what’s left' : 'Split the same amount'}</button>
        </span>
      )}
    </>
  );

  let body;
  if (step === 'choose') {
    body = (
      <div className="form batch-sheet">
        <div className="fridge-choices full">
          <button type="button" className="fridge-choice" onClick={() => choose('cooked')}>
            <span className="fridge-choice-icon" aria-hidden="true"><Icon name="prep" size={22} /></span>
            <span className="fridge-choice-text"><strong>I cooked it</strong><small>Meal prep. List what went in and split it into serves.</small></span>
            <Icon name="chevron" size={16} />
          </button>
          <button type="button" className="fridge-choice" onClick={() => choose('bought')}>
            <span className="fridge-choice-icon" aria-hidden="true"><Icon name="camera" size={22} /></span>
            <span className="fridge-choice-text"><strong>I bought it</strong><small>Ready meals, a tub of ice cream, a box of bars. Snap the nutrition label.</small></span>
            <Icon name="chevron" size={16} />
          </button>
          {state.foods.length > 0 && (
            <button type="button" className="fridge-choice" onClick={() => { setError(''); setStep('pick'); }}>
              <span className="fridge-choice-icon" aria-hidden="true"><Icon name="heart" size={22} /></span>
              <span className="fridge-choice-text"><strong>From my foods</strong><small>Logged it before? Pick it, no scan. Each serve logs as that food.</small></span>
              <Icon name="chevron" size={16} />
            </button>
          )}
        </div>
        <p className="hint full fridge-choose-note">Each serve then sits on Today, one tap to log, until it’s all eaten.</p>
      </div>
    );
  } else if (step === 'pick') {
    const query = pickQuery.trim();
    const favourites = favouritesByUse(state.foods);
    const recent = [...state.foods].filter(food => !food.favourite).sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0)).slice(0, PICK_RECENT_SHOWN);
    const list = (title: string, foods: Food[]) => foods.length > 0 && (
      <section className="food-search-group full">
        <h2 className="food-search-label">{title}</h2>
        <div className="food-search-list">
          {foods.map(food => <SavedFoodRow key={food.id} state={state} food={food} onChoose={() => pickFood(food)} />)}
        </div>
      </section>
    );
    body = (
      <div className="form batch-sheet">
        <input
          className="full fridge-pick-search"
          type="search"
          aria-label="Search your foods"
          placeholder="Search your foods"
          value={pickQuery}
          onChange={event => setPickQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            event.currentTarget.blur();
          }}
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint="search"
        />
        {query ? (
          userResults.length ? list('Your foods', userResults.slice(0, PICK_RECENT_SHOWN)) : <p className="hint full">Nothing saved matches “{query}”. If it’s new, go back and scan it once with I bought it.</p>
        ) : (
          <>
            {list('Favourites', favourites)}
            {list('Recent', recent)}
          </>
        )}
        <div className="entry-alt-links full">
          <button type="button" className="text-btn" onClick={() => { setFoodId(null); setName(''); setStep('choose'); }}>Something new instead</button>
        </div>
      </div>
    );
  } else if (step === 'describe') {
    const canEstimate = (bought ? !!(photos.length || recipe.trim()) : !!recipe.trim()) && !addingPhotos;
    const estimateLabel = busy ? (bought && photos.length ? 'Reading…' : 'Estimating…') : failed ? 'Try again' : bought ? (photos.length ? 'Read label' : 'Estimate') : 'Estimate batch';
    body = (
      <form className="form batch-sheet" onSubmit={(event: FormEvent) => { event.preventDefault(); estimate(); }}>
        {bought ? (
          <>
            <p className="hint full">Photograph the nutrition panel, flat and close. Add the front too if you like. Gemini reads one pack and splits it into the label’s serves.</p>
            <div className="fridge-photos full">
              {photos.map((src, index) => (
                <span key={`${index}-${src.length}`} className="log-thumb">
                  <img src={src} alt={`Photo ${index + 1}`} />
                  <button type="button" className="log-thumb-remove" disabled={!!busy} aria-label={`Remove photo ${index + 1}`} onClick={() => setPhotos(current => current.filter((_, i) => i !== index))}>
                    <span aria-hidden="true" />
                  </button>
                </span>
              ))}
              {photos.length < MAX_ESTIMATE_PHOTOS && (
                <button
                  type="button"
                  className="log-photo-chip"
                  disabled={addingPhotos || !!busy}
                  onClick={() => photoInputRef.current?.click()}
                  aria-label={photos.length ? `Add another photo, ${photos.length} of ${MAX_ESTIMATE_PHOTOS}` : 'Add a photo of the label'}
                >
                  <Icon name="camera" size={20} />
                  <span>{addingPhotos ? 'Adding…' : photos.length ? 'Add' : 'Photo of label'}</span>
                </button>
              )}
            </div>
            <Field label="What is it? (optional)" full>
              <input value={recipe} disabled={!!busy} placeholder="e.g. Muscle Chef chicken pesto pasta" onChange={event => { setRecipe(event.target.value); setError(''); }} />
            </Field>
            <div className="batch-serves-row full">
              <span className="batch-serves-label"><strong>How many did you buy?</strong><small>Packs, tubs or meals</small></span>
              <ServesStepper value={packs} max={MAX_PACKS} noun="pack" label="Packs bought" onChange={next => setPacks(packsValue(next))} disabled={!!busy} />
            </div>
          </>
        ) : (
          <>
            <p className="hint full">List everything that went in, with amounts. Gemini estimates the whole batch, then Dawni splits it into serves you log one at a time.</p>
            <Field label="What went in?" full>
              <textarea
                className="batch-recipe"
                disabled={!!busy}
                value={recipe}
                rows={6}
                onChange={event => { setRecipe(event.target.value); setError(''); }}
                placeholder={'500 g rice (uncooked)\n1 kg beef mince, 4 star\n1 tbsp olive oil\n1 iceberg lettuce\n1/2 cup teriyaki sauce'}
              />
            </Field>
            <div className="batch-serves-row full">
              <span className="batch-serves-label"><strong>Serves</strong><small>How many portions you split it into</small></span>
              <ServesStepper value={servings} onChange={changeServings} disabled={!!busy} />
            </div>
          </>
        )}
        {error && <p className="ai-quick-log-error full" role="alert">{error}</p>}
        {/* Stays up through "Ready" after the key saves, then the estimate runs. */}
        {connecting ? (
          <div className="full">
            <ConnectGeminiCard
              title={bought ? 'Connect Gemini to read labels' : 'Connect Gemini to estimate'}
              onSaveKey={onSaveKey}
              onTypeIn={typeIn}
              typeInLabel="Enter the numbers yourself"
              onConnected={() => {
                setConnecting(false);
                void runEstimate();
              }}
            />
          </div>
        ) : (
          <div className="actions vertical full">
            <button className="primary" type="submit" disabled={!!busy || !canEstimate}>{estimateLabel}</button>
            {busy ? (
              <>
                <button className="secondary" type="button" onClick={stopRequest}>Cancel</button>
                <p className="hint batch-actions-note">You can close this. Dawni will let you know when it’s ready.</p>
              </>
            ) : (
              <>
                <button className="text-btn" type="button" onClick={typeIn}>Enter the numbers yourself</button>
                {request.mode === 'new' && (
                  <button className="text-btn" type="button" onClick={() => { setError(''); setFailed(false); setKind(bought ? 'cooked' : 'bought'); }}>
                    {bought ? 'I cooked it instead' : 'I bought it instead'}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </form>
    );
  } else {
    body = (
      <form className="form batch-sheet" onSubmit={(event: FormEvent) => { event.preventDefault(); save(false); }}>
        {lot && linkedFood ? (
          <div className="fridge-food full">
            <strong>{linkedFood.name}</strong>
            <small>Each serve logs as this saved food, so nothing new lands in Recent.</small>
          </div>
        ) : (
          <div className="field full">
            <label className="field-caption" htmlFor="batchName">Name</label>
            <input ref={nameRef} id="batchName" value={name} placeholder={bought ? 'e.g. Chicken pesto pasta' : 'e.g. Beef mince rice bowl'} onChange={event => { setName(event.target.value); setError(''); }} />
          </div>
        )}
        {editing && batch && (
          <p className="batch-status full"><ServePips left={left} servings={servings} />{fmtPortion(left)} of {fmt(servings)} serves left · {cookedText(batch.cookedOn, kind)}</p>
        )}
        {lot && linkedFood ? (
          <div className="calories-priority full" role="group" aria-label="One serve">
            <div className="fridge-serves-first">{servesRow}</div>
            {linkedFood.unitMode === '100g' && (
              <div className="amount-row">
                <label className="amount-label" htmlFor="fridgeServeGrams"><span>Grams a serve</span><small>It’s saved per 100 g</small></label>
                <div className="calorie-input-row amount-input-row">
                  <input id="fridgeServeGrams" inputMode="decimal" value={serveGramsText} onChange={event => { setServeGramsText(event.target.value); setError(''); }} />
                  <span aria-hidden="true">g</span>
                </div>
              </div>
            )}
            <div className="meta-chips fridge-food-serve">
              <span className="portion-preview-label">One serve</span>
              <span className="meta-chip accent">{energyTextForUnit(serve.calories, unit)}</span>
              <MacroChips fat={serve.fat} carbs={serve.carbs} protein={serve.protein} />
            </div>
            <p className="hint fridge-food-note">The numbers are your saved food’s. To change them, edit it in Foods.</p>
          </div>
        ) : (
        <div className="calories-priority full" role="group" aria-label="One serve">
          {/* Bought: how many serves comes first, as it does on a label, then what's in one. */}
          {bought && <div className="fridge-serves-first">{servesRow}</div>}
          <div className="calorie-input-row entry-energy-row">
            <input id="batchCalories" aria-label={`${unitLabel} in one serve`} inputMode="decimal" value={inputs.calories} placeholder="0" onChange={event => setServeInput('calories', event.target.value)} />
            <span className="energy-suffix" aria-hidden="true"><strong>{unitLabel}</strong><small>per serve</small></span>
          </div>
          <div className="nutrition-grid">
            <Field label="Fat (g)"><input inputMode="decimal" value={inputs.fat} onChange={event => setServeInput('fat', event.target.value)} /></Field>
            <Field label="Carbs (g)"><input inputMode="decimal" value={inputs.carbs} onChange={event => setServeInput('carbs', event.target.value)} /></Field>
            <Field label="Protein (g)"><input inputMode="decimal" value={inputs.protein} onChange={event => setServeInput('protein', event.target.value)} /></Field>
          </div>
          {!bought && servesRow}
          {bought && labelServe && servings > 1 && (
            <p className="hint fridge-label-serve">The label’s serve is {labelServe}. If yours are bigger, take serves off and pick Split the same amount.</p>
          )}
          {estimateSource && (
            <div className="estimate-review">
              <div className="meta-chips estimate-source-row">
                <span className="meta-chip source-chip">{estimateSourceLabel(estimateSource)}</span>
                {confidence && <span className={`meta-chip confidence-chip confidence-${confidence}`}>{confidence[0].toUpperCase() + confidence.slice(1)} confidence</span>}
              </div>
              {assumptions.length > 0 && (
                <ul className="estimate-assumptions" aria-label="What Gemini assumed">
                  {assumptions.map(item => <li key={item}>{item}</li>)}
                </ul>
              )}
              {macroCheckFails && (
                <p className="estimate-warning">Calories and macros don’t quite add up: the macros come to about {energyTextForUnit(energyFromMacros(serve), unit)} a serve. Worth a check.</p>
              )}
              {reply && (
                <div className="estimate-refine">
                  <input
                    aria-label="Correction for Gemini"
                    value={refineText}
                    disabled={!!busy}
                    placeholder={bought ? 'e.g. it’s the 1 L tub' : 'e.g. mince was 5 star'}
                    onChange={event => { setRefineText(event.target.value); setError(''); }}
                    onKeyDown={event => {
                      if (event.key !== 'Enter') return;
                      // Enter would otherwise save the batch.
                      event.preventDefault();
                      refine();
                    }}
                  />
                  <button type="button" className="secondary" disabled={!refineText.trim() || !!busy} onClick={refine}>{busy === 'refine' ? 'Refining…' : 'Refine'}</button>
                </div>
              )}
              {busy === 'refine' && <button type="button" className="text-btn" onClick={stopRequest}>Cancel</button>}
            </div>
          )}
        </div>
        )}
        {ingredients.length > 0 && (
          <details className="extra-info batch-ingredients full" open={request.mode === 'new'}>
            <summary>What went in ({ingredients.length})</summary>
            <div className="extra-info-body">
              <ul className="batch-ingredient-list">
                {ingredients.map((item, index) => (
                  <li key={`${index}-${item.name}`}>
                    <span className="batch-ingredient-name">
                      <b>{item.name}</b>
                      <small>{[item.amount, `P ${fmt(item.protein)} · C ${fmt(item.carbs)} · F ${fmt(item.fat)}g`].filter(Boolean).join(' · ')}</small>
                    </span>
                    <span className="batch-ingredient-cal">{fmt(energyValueForUnit(item.calories, unit))}<small>{unitLabel}</small></span>
                  </li>
                ))}
                <li className="batch-ingredient-total">
                  <span className="batch-ingredient-name"><b>Whole batch</b><small>{`P ${fmt(counted.protein)} · C ${fmt(counted.carbs)} · F ${fmt(counted.fat)}g`}</small></span>
                  <span className="batch-ingredient-cal">{fmt(energyValueForUnit(counted.calories, unit))}<small>{unitLabel}</small></span>
                </li>
              </ul>
              {breakdownEdited && <p className="hint">You changed the numbers, so this breakdown no longer adds up to the batch.</p>}
            </div>
          </details>
        )}
        {!editing && lot && (
          <div className="entry-alt-links full">
            <button type="button" className="text-btn" onClick={() => { setError(''); setFoodId(null); setStep('pick'); }}>Pick another food</button>
          </div>
        )}
        {!editing && !lot && (
          <div className="entry-alt-links full">
            <button type="button" className="text-btn" disabled={!!busy} onClick={() => { setError(''); setStep('describe'); }}>
              {bought
                ? (photos.length || recipe.trim() ? 'Change the photo or packs' : 'Read a label instead')
                : (recipe.trim() ? 'Change what went in' : 'Estimate with Gemini instead')}
            </button>
          </div>
        )}
        {error && <p className="ai-quick-log-error full" role="alert">{error}</p>}
        <div className="actions vertical full">
          {editing ? (
            <>
              <button className="primary" type="submit" disabled={!!busy}>Save changes</button>
              {batch && <button className="text-btn" type="button" disabled={!!busy} onClick={() => onFinish(batch)}>{bought ? 'Finish it' : 'Finish batch'}</button>}
              <p className="hint batch-actions-note">Serves you’ve logged keep their numbers. Finish it when the rest is eaten or thrown out.</p>
            </>
          ) : (
            <>
              <button className="primary" type="submit" disabled={!!busy}>Save {fmt(servings)} serve{servings === 1 ? '' : 's'}</button>
              <button className="secondary" type="button" disabled={!!busy} onClick={() => save(true)}>Save and log one now</button>
              <p className="hint batch-actions-note">Stays on Today until it’s eaten, or {bought ? `${BOUGHT_SHELF_DAYS} days` : `a week (${BATCH_SHELF_DAYS} days)`}.</p>
            </>
          )}
        </div>
      </form>
    );
  }

  return (
    <Modal open={open} title={title} onClose={onClose} wide bottomSheet>
      {/* Outside the steps, so "I bought it" can open the camera in the same tap that shows the next step. */}
      <input ref={photoInputRef} hidden type="file" accept="image/*" multiple onChange={event => void addPhotos(event.target.files)} />
      {body}
    </Modal>
  );
}
