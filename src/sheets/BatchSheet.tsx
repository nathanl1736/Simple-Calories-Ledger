import { FormEvent, useEffect, useRef, useState } from 'react';
import type { AppState, Batch, BatchIngredient, EnergyUnit, EntryEstimateSource, Totals } from '../types';
import { energyFromMacros, estimateSourceLabel, macrosDisagree } from '../aiEstimate';
import { batchServe, batchServesLeft, DEFAULT_BATCH_SERVINGS, MAX_BATCH_SERVINGS, servingsValue, sumTotals, type BatchEstimate } from '../mealPrep';
import { energyInputFromKcal, energyInputToKcal, energyTextForUnit, energyUnitLabel, energyUnitValue, energyValueForUnit, fmt, fmtPortion, n } from '../utils';
import { type BatchInput, type BatchSheetRequest } from '../appTypes';
import { Modal } from '../ui/Modal';
import { Field, ServePips } from '../ui/controls';
import { roundedText, cookedText } from '../ui/format';

function ServesStepper({ value, min = 1, onChange, disabled = false }: { value: number; min?: number; onChange: (next: number) => void; disabled?: boolean }) {
  return (
    <div className="serves-stepper" role="group" aria-label="Serves">
      <button type="button" aria-label="One serve fewer" disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label="One serve more" disabled={disabled || value >= MAX_BATCH_SERVINGS} onClick={() => onChange(value + 1)}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </div>
  );
}

const ZERO_TOTALS: Totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
type ServeInputs = Record<keyof Totals, string>;

/** One serve's numbers as typed text; blank while the batch has none yet. */
function serveInputs(total: Totals, servings: number, unit: EnergyUnit): ServeInputs {
  if (!(total.calories > 0)) return { calories: '', protein: '', carbs: '', fat: '' };
  const each = (value: number) => roundedText(value / servings, 1);
  return { calories: energyInputFromKcal(total.calories / servings, unit), protein: each(total.protein), carbs: each(total.carbs), fat: each(total.fat) };
}

/**
 * Meal prep: list what went into a batch and how many serves, Gemini estimates the whole batch
 * ingredient by ingredient, and the review shows one serve. The batch is the fixed thing: changing
 * the serves re-splits it, and editing one serve's numbers changes the batch to match.
 */
export function BatchSheet({ open, request, batch, state, onEstimate, onSetupGemini, onSave, onFinish, onClose }: {
  open: boolean;
  request: BatchSheetRequest;
  /** The batch being edited, or the finished one being cooked again. */
  batch: Batch | null;
  state: AppState;
  onEstimate: (recipe: string, servings: number, previous?: string, correction?: string) => Promise<{ raw: string; estimate: BatchEstimate }>;
  onSetupGemini: () => void;
  onSave: (input: BatchInput, logNow: boolean) => void;
  onFinish: (batch: Batch) => void;
  onClose: () => void;
}) {
  const unit = energyUnitValue(state.settings.energyUnit);
  const hasKey = !!state.settings.geminiApiKey.trim();
  const editing = request.mode === 'edit';
  const [step, setStep] = useState<'describe' | 'review'>('describe');
  const [recipe, setRecipe] = useState('');
  const [servings, setServings] = useState(DEFAULT_BATCH_SERVINGS);
  const [name, setName] = useState('');
  const [total, setTotal] = useState<Totals>(ZERO_TOTALS);
  const [inputs, setInputs] = useState<ServeInputs>(() => serveInputs(ZERO_TOTALS, 1, unit));
  const [ingredients, setIngredients] = useState<BatchIngredient[]>([]);
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<Batch['confidence']>(null);
  const [estimateSource, setEstimateSource] = useState<EntryEstimateSource | null>(null);
  /** Gemini's last reply, so Refine can send a correction against it. */
  const [reply, setReply] = useState('');
  const [refineText, setRefineText] = useState('');
  const [busy, setBusy] = useState<'estimate' | 'refine' | null>(null);
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  // Each opening starts afresh: empty for a new batch, or from the batch being edited or cooked again.
  useEffect(() => {
    if (!open) return;
    const source = request.mode === 'new' ? null : batch;
    const count = source?.servings || DEFAULT_BATCH_SERVINGS;
    const nextTotal = source?.total || ZERO_TOTALS;
    setStep(source ? 'review' : 'describe');
    setRecipe(source?.recipe || '');
    setServings(count);
    setName(source?.name || '');
    setTotal(nextTotal);
    setInputs(serveInputs(nextTotal, count, unit));
    setIngredients(source?.ingredients || []);
    setAssumptions(source?.assumptions || []);
    setConfidence(source?.confidence || null);
    setEstimateSource(source?.estimateSource || null);
    setReply('');
    setRefineText('');
    setBusy(null);
    setError('');
  }, [open, request.opened]);

  const used = editing && batch ? batch.servings - batchServesLeft(batch, state.entries) : 0;
  const left = Math.max(0, Math.round((servings - used) * 100) / 100);
  // Editing can't split it into fewer serves than are already logged; Finish batch is for that.
  const minServings = Math.max(1, Math.ceil(used));

  const changeServings = (next: number) => {
    const count = Math.max(minServings, servingsValue(next));
    setServings(count);
    setInputs(serveInputs(total, count, unit));
  };

  const setServeInput = (key: keyof Totals, value: string) => {
    setInputs(current => ({ ...current, [key]: value }));
    const each = key === 'calories' ? energyInputToKcal(value, unit) : n(value);
    setTotal(current => ({ ...current, [key]: key === 'calories' ? Math.round(each * servings) : Math.round(each * servings * 10) / 10 }));
    setError('');
  };

  const applyEstimate = (raw: string, estimate: BatchEstimate) => {
    setReply(raw);
    setName(estimate.name);
    setTotal(estimate.total);
    setInputs(serveInputs(estimate.total, servings, unit));
    setIngredients(estimate.ingredients);
    setAssumptions(estimate.assumptions);
    setConfidence(estimate.confidence);
    setEstimateSource('ai');
    setStep('review');
  };

  const estimate = async () => {
    if (!hasKey) return onSetupGemini();
    if (!recipe.trim()) return setError('List what went in, with amounts.');
    setBusy('estimate');
    setError('');
    try {
      const result = await onEstimate(recipe, servings);
      applyEstimate(result.raw, result.estimate);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gemini could not estimate this batch.');
    } finally {
      setBusy(null);
    }
  };

  const refine = async () => {
    const correction = refineText.trim();
    if (!correction || busy) return;
    setBusy('refine');
    setError('');
    try {
      const result = await onEstimate(recipe, servings, reply, correction);
      applyEstimate(result.raw, result.estimate);
      // Kept with the recipe, so cooking it again starts from the corrected version.
      setRecipe(current => `${current.trim()}\n(Correction: ${correction})`);
      setRefineText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gemini could not refine this estimate.');
    } finally {
      setBusy(null);
    }
  };

  const typeIn = () => {
    setReply('');
    setIngredients([]);
    setAssumptions([]);
    setConfidence(null);
    setEstimateSource(null);
    setTotal(ZERO_TOTALS);
    setInputs(serveInputs(ZERO_TOTALS, servings, unit));
    setError('');
    setStep('review');
  };

  const save = (logNow: boolean) => {
    if (!name.trim()) {
      setError('Name this batch so you can find it again.');
      nameRef.current?.focus();
      return;
    }
    if (!(total.calories > 0)) return setError(`Add the ${energyUnitLabel(unit)} in one serve.`);
    onSave({ name: name.trim(), recipe: recipe.trim(), servings, total, ingredients, estimateSource, assumptions, confidence }, logNow);
  };

  const serve = batchServe({ total, servings });
  const macroCheckFails = !!estimateSource && macrosDisagree(serve);
  const counted = sumTotals(ingredients);
  // Typed-over numbers no longer match Gemini's breakdown, so it says so rather than look wrong.
  const breakdownEdited = ingredients.length > 0 && Math.abs(counted.calories - total.calories) > Math.max(2, servings);
  const unitLabel = energyUnitLabel(unit);
  const title = editing ? 'Edit batch' : request.mode === 'again' ? 'Cook again' : step === 'describe' ? 'Meal prep a batch' : 'Review batch';

  return (
    <Modal open={open} title={title} onClose={onClose} wide bottomSheet closeDisabled={!!busy}>
      {step === 'describe' ? (
        <form className="form batch-sheet" onSubmit={(event: FormEvent) => { event.preventDefault(); estimate(); }}>
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
          {error && <p className="ai-quick-log-error full">{error}</p>}
          <div className="actions vertical full">
            <button className="primary" type="submit" disabled={!!busy || (hasKey && !recipe.trim())}>{busy ? 'Estimating…' : hasKey ? 'Estimate batch' : 'Set up Gemini to estimate'}</button>
            <button className="text-btn" type="button" disabled={!!busy} onClick={typeIn}>Enter the numbers yourself</button>
          </div>
        </form>
      ) : (
        <form className="form batch-sheet" onSubmit={(event: FormEvent) => { event.preventDefault(); save(false); }}>
          <div className="field full">
            <label className="field-caption" htmlFor="batchName">Name</label>
            <input ref={nameRef} id="batchName" value={name} placeholder="e.g. Beef mince rice bowl" onChange={event => { setName(event.target.value); setError(''); }} />
          </div>
          {editing && batch && (
            <p className="batch-status full"><ServePips left={left} servings={servings} />{fmtPortion(left)} of {fmt(servings)} serves left · {cookedText(batch.cookedOn)}</p>
          )}
          <div className="calories-priority full" role="group" aria-label="One serve">
            <div className="calorie-input-row entry-energy-row">
              <input id="batchCalories" aria-label={`${unitLabel} in one serve`} inputMode="decimal" value={inputs.calories} placeholder="0" onChange={event => setServeInput('calories', event.target.value)} />
              <span className="energy-suffix" aria-hidden="true"><strong>{unitLabel}</strong><small>per serve</small></span>
            </div>
            <div className="nutrition-grid">
              <Field label="Fat (g)"><input inputMode="decimal" value={inputs.fat} onChange={event => setServeInput('fat', event.target.value)} /></Field>
              <Field label="Carbs (g)"><input inputMode="decimal" value={inputs.carbs} onChange={event => setServeInput('carbs', event.target.value)} /></Field>
              <Field label="Protein (g)"><input inputMode="decimal" value={inputs.protein} onChange={event => setServeInput('protein', event.target.value)} /></Field>
            </div>
            <div className="batch-serves-row">
              <span className="batch-serves-label">
                <strong>Serves</strong>
                <small>{total.calories > 0 ? `Whole batch ${energyTextForUnit(total.calories, unit)}` : 'The batch is split evenly'}</small>
              </span>
              <ServesStepper value={servings} min={minServings} onChange={changeServings} disabled={!!busy} />
            </div>
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
                      placeholder="e.g. mince was 5 star"
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
              </div>
            )}
          </div>
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
          {!editing && (
            <div className="entry-alt-links full">
              <button type="button" className="text-btn" disabled={!!busy} onClick={() => { setError(''); setStep('describe'); }}>{recipe.trim() ? 'Change what went in' : 'Estimate with Gemini instead'}</button>
            </div>
          )}
          {error && <p className="ai-quick-log-error full">{error}</p>}
          <div className="actions vertical full">
            {editing ? (
              <>
                <button className="primary" type="submit" disabled={!!busy}>Save changes</button>
                {batch && <button className="text-btn" type="button" disabled={!!busy} onClick={() => onFinish(batch)}>Finish batch</button>}
                <p className="hint batch-actions-note">Serves you’ve logged keep their numbers. Finish it when the rest is eaten or thrown out.</p>
              </>
            ) : (
              <>
                <button className="primary" type="submit" disabled={!!busy}>Save {fmt(servings)} serve{servings === 1 ? '' : 's'}</button>
                <button className="secondary" type="button" disabled={!!busy} onClick={() => save(true)}>Save and log one now</button>
              </>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}
