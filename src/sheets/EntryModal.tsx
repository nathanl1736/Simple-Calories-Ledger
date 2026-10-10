import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import type { AppState, EnergyUnit, Food } from '../types';
import { databaseItemToFood, type FoodDatabaseItem } from '../foodDatabase';
import { linkedFood } from '../favourites';
import { DAY_PART_LABEL, DAY_PARTS, mealDayPart } from '../tidelight';
import { energyFromMacros, estimateSourceLabel, estimateSourceValue, macrosDisagree } from '../aiEstimate';
import {
  energyInputFromKcal,
  energyInputToKcal,
  energyTextForUnit,
  energyText,
  energyUnitLabel,
  entryUnitModeValue,
  fmt,
  fmtGram,
  foodUnitText,
  MEALS,
  n,
  readable
} from '../utils';
import { type EntryOpenMode, type EntryDraft } from '../appTypes';
import { KEYBOARD_STAND_IN, takeKeyboardFromStandIn, Modal } from '../ui/Modal';
import { Icon } from '../ui/icons';
import { FavouriteToggle, MacroChips, Field } from '../ui/controls';
import { roundedText, databaseSourceChip, databaseServingText } from '../ui/format';
import { useFoodSearch } from './useFoodSearch';

export const draftNumberText = (value: unknown) => String(Number.isFinite(Number(value)) ? Number(value) : 0);
export const draftEnergyText = (kcal: number, unit: EnergyUnit) => energyInputFromKcal(kcal, unit) || '0';

/** Scales a typed number, leaving a blank field blank. */
const scaledDraftText = (value: string, factor: number, decimals: number) => value.trim() === '' ? value : roundedText(n(value) * factor, decimals);
const positiveOr = (value: unknown, fallback: number) => n(value) > 0 ? n(value) : fallback;
/**
 * Servings eaten, or grams in 100g mode. A blank or invalid amount counts as one
 * serving or 100 g, the same for the total shown, the swipe and what gets saved.
 */
export const draftPortion = (draft: Pick<EntryDraft, 'portion' | 'unitMode'>) => positiveOr(draft.portion, draft.unitMode === '100g' ? 100 : 1);

/**
 * Changes what the numbers are per (one serving or 100 g) without changing what
 * gets logged: 140 g at 66 Cal per 100 g becomes 1 serving of 92 Cal, and back.
 */
function switchDraftBasis(draft: EntryDraft, next: EntryDraft['unitMode']): Partial<EntryDraft> {
  if (draft.unitMode === next) return {};
  const scale = (factor: number) => ({
    calories: scaledDraftText(draft.calories, factor, draft.entryEnergyUnit === 'kj' ? 1 : 0),
    fat: scaledDraftText(draft.fat, factor, 1),
    carbs: scaledDraftText(draft.carbs, factor, 1),
    protein: scaledDraftText(draft.protein, factor, 1)
  });
  if (next === 'serving') {
    const grams = draftPortion(draft);
    // Keep a known serving size (1 slice = 30 g); otherwise what was eaten becomes the serving.
    const servingGrams = positiveOr(draft.servingGrams, grams);
    return { unitMode: next, portion: roundedText(grams / servingGrams, 2), servingGrams: roundedText(servingGrams, 1), ...scale(servingGrams / 100) };
  }
  const servings = draftPortion(draft);
  const servingGrams = positiveOr(draft.servingGrams, 0);
  // With no serving weight there is nothing to convert with, so the numbers stay and
  // the grams are set to log the same total until the real amount is typed.
  if (!servingGrams) return { unitMode: next, portion: roundedText(servings * 100, 1) };
  return { unitMode: next, portion: roundedText(servings * servingGrams, 1), ...scale(100 / servingGrams) };
}

function SwipeConfirm({ label, confirmLabel, className = '', onConfirm }: { label: string; confirmLabel?: string; className?: string; onConfirm: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);

  const updateProgress = (clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const usable = Math.max(1, rect.width - 62);
    const next = Math.max(0, Math.min(1, (clientX - startX.current) / usable));
    setProgress(next);
  };
  const reset = () => {
    setDragging(false);
    setProgress(0);
  };
  const finish = () => {
    if (progress >= 0.82) {
      setProgress(1);
      window.setTimeout(() => {
        onConfirm();
        reset();
      }, 120);
    } else {
      reset();
    }
  };

  return (
    <div
      ref={wrapRef}
      className={`swipe-confirm ${dragging ? 'dragging' : ''} ${className}`}
      data-swipe-lock
      role="button"
      tabIndex={0}
      aria-label={label}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onConfirm();
        }
      }}
      onPointerDown={event => {
        startX.current = event.clientX;
        setProgress(0);
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => dragging && updateProgress(event.clientX)}
      onPointerUp={finish}
      onPointerCancel={reset}
      style={{ '--swipe': `${progress * 100}%` } as React.CSSProperties}
    >
      <span className="swipe-confirm-fill" />
      <span className="swipe-confirm-handle" aria-hidden="true" />
      <span className="swipe-confirm-label">{progress >= 0.82 ? (confirmLabel || 'Release to confirm') : label}</span>
    </div>
  );
}

function readableTag(tag: string) {
  return tag.replace(/[-_]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function QuickFoodResultRow({ state, food, databaseSuggestion = false, sourceChip = '', sourceName = '', onChoose }: { state: AppState; food: Food; databaseSuggestion?: boolean; sourceChip?: string; sourceName?: string; onChoose: (food: Food) => void }) {
  const meta = databaseSuggestion
    ? [food.brand || 'Generic', databaseServingText(food), food.category, sourceName].filter(Boolean).join(' · ')
    : [food.brand, food.servingLabel, foodUnitText(food), food.category].filter(Boolean).join(' · ');
  const chip = sourceChip || (databaseSuggestion ? '' : estimateSourceLabel(food.estimateSource));
  return (
    <button className={`quick-food-result ${databaseSuggestion ? 'database' : 'user-food'}`} type="button" onClick={() => onChoose(food)}>
      <span className={`quick-food-icon ${food.favourite ? 'fav' : ''}`}>{food.favourite ? <><Icon name="heart" size={18} filled /><span className="sr-only">Favourite</span></> : databaseSuggestion ? 'DB' : ''}</span>
      <span className="quick-food-main">
        <strong>{food.name}</strong>
        <small>{meta || foodUnitText(food)}</small>
        <span className="quick-food-macros">
          {chip && <span className="meta-chip source-chip">{chip}</span>}
          <MacroChips fat={food.fat} carbs={food.carbs} protein={food.protein} />
        </span>
      </span>
      <span className="quick-food-cal">{energyText(state, food.calories)}</span>
    </button>
  );
}

function QuickResultSection({ title, children }: { title: string; children: ReactNode }) {
  return <div className="quick-result-section"><div className="quick-section-label">{title}</div><div className="quick-result-list">{children}</div></div>;
}

function SavedFoodPicker({ state, foods, onChoose, onSaveDatabaseFood, compact = false }: { state: AppState; foods: Food[]; onChoose: (food: Food) => void; onSaveDatabaseFood: (item: FoodDatabaseItem) => Promise<void> | void; compact?: boolean }) {
  const [query, setQuery] = useState('');
  const [favouritesOpen, setFavouritesOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [databaseOpen, setDatabaseOpen] = useState(false);
  const [databasePreview, setDatabasePreview] = useState<FoodDatabaseItem | null>(null);
  const { trimmedQuery, recentFoods, userResults: allUserResults, databaseMatches, databaseMessage } = useFoodSearch(state, foods, query);
  const favourites = recentFoods.filter(food => food.favourite).slice(0, 12);
  const recent = recentFoods.slice(0, 14);
  const userResults = allUserResults.slice(0, 5);
  const shownDatabase = databaseMatches.slice(0, 3);

  const choose = (food: Food) => {
    setDatabaseOpen(false);
    setQuery('');
    onChoose(food);
  };
  const previewDatabase = (item: FoodDatabaseItem) => {
    setDatabaseOpen(false);
    setDatabasePreview(item);
  };
  const useDatabaseFood = (item: FoodDatabaseItem) => {
    setDatabasePreview(null);
    setDatabaseOpen(false);
    setQuery('');
    onChoose(databaseItemToFood(item));
  };
  const saveDatabaseFood = async (item: FoodDatabaseItem) => {
    await onSaveDatabaseFood(item);
    setDatabasePreview(null);
  };
  const rows = (items: Food[], empty: string) => (
    <div className="quick-result-list">
      {items.length ? items.map(food => <QuickFoodResultRow key={food.id} state={state} food={food} onChoose={choose} />) : <span className="hint">{empty}</span>}
    </div>
  );
  const dbRows = (items: FoodDatabaseItem[]) => items.map(item => {
    const food = databaseItemToFood(item);
    return <QuickFoodResultRow key={item.id} state={state} food={food} sourceChip={databaseSourceChip(item.tags, item.sourceKind)} sourceName={item.customDatabaseName} databaseSuggestion onChoose={() => previewDatabase(item)} />;
  });
  return (
    <section className={`quick-picker ${compact ? 'compact' : ''}`}>
      <input type="search" placeholder="Search saved foods" value={query} onChange={event => setQuery(event.target.value)} autoCapitalize="none" autoCorrect="off" enterKeyHint="search" />
      {trimmedQuery ? (
        <>
          {userResults.length ? (
            <QuickResultSection title="Your foods">
              {userResults.map(food => <QuickFoodResultRow key={food.id} state={state} food={food} onChoose={choose} />)}
            </QuickResultSection>
          ) : <div className="quick-empty"><strong>{shownDatabase.length ? 'No saved matches yet' : 'No matching foods yet'}</strong><span>Try a different search or log manually.</span></div>}
          {shownDatabase.length > 0 && (
            <QuickResultSection title="From food database">
              {dbRows(shownDatabase)}
              {databaseMatches.length > shownDatabase.length && <button className="quick-more-btn" type="button" onClick={() => setDatabaseOpen(true)}>Show more database results</button>}
            </QuickResultSection>
          )}
          {databaseMessage && <p className="hint database-load-message">{databaseMessage}</p>}
        </>
      ) : (
        <>
          <details open={favouritesOpen} onToggle={event => setFavouritesOpen(event.currentTarget.open)}>
            <summary>Favourites</summary>
            {rows(favourites, 'No favourites yet.')}
          </details>
          <details open={recentOpen} onToggle={event => setRecentOpen(event.currentTarget.open)}>
            <summary>Recent foods</summary>
            {rows(recent, 'Recent foods appear after saving entries.')}
          </details>
        </>
      )}
      <Modal open={databaseOpen} title="Food database results" onClose={() => setDatabaseOpen(false)} wide>
        <p className="hint database-query">Results for “{trimmedQuery}”</p>
        <div className="quick-result-list modal-results">{dbRows(databaseMatches.slice(0, 20))}</div>
      </Modal>
      <FoodDatabasePreviewModal
        state={state}
        item={databasePreview}
        onUse={useDatabaseFood}
        onSave={saveDatabaseFood}
        onClose={() => setDatabasePreview(null)}
      />
    </section>
  );
}

export function FoodDatabasePreviewModal({ state, item, onUse, onSave, onClose }: { state: AppState; item: FoodDatabaseItem | null; onUse: (item: FoodDatabaseItem) => void; onSave: (item: FoodDatabaseItem) => Promise<void> | void; onClose: () => void }) {
  if (!item) return null;
  const chip = databaseSourceChip(item.tags, item.sourceKind);
  return (
    <Modal open title="Food estimate" onClose={onClose}>
      <div className="database-preview">
        <div>
          <h3>{item.name}</h3>
          <p className="hint">{[item.brand, item.category, item.customDatabaseName].filter(Boolean).join(' · ') || item.category || 'Generic food estimate'}</p>
        </div>
        <div className="meta-chips">
          {chip && <span className="meta-chip source-chip">{chip}</span>}
          <span className="meta-chip neutral">{databaseServingText(item)}</span>
          {item.servingGrams && entryUnitModeValue(item.unitMode) === 'serving' && !String(item.servingLabel || '').includes(`${item.servingGrams}`) && <span className="meta-chip neutral">{fmtGram(item.servingGrams)}g</span>}
        </div>
        <div className="database-preview-nutrition">
          <div><span>Calories</span><strong>{energyText(state, item.calories)}</strong></div>
          <div><span>Protein</span><strong>{fmt(item.protein)}g</strong></div>
          <div><span>Carbs</span><strong>{fmt(item.carbs)}g</strong></div>
          <div><span>Fat</span><strong>{fmt(item.fat)}g</strong></div>
        </div>
        {item.tags.length > 0 && <div className="tag-chip-row">{item.tags.map(tag => <span key={tag} className="tag-chip">{readableTag(tag)}</span>)}</div>}
        <div className="actions vertical">
          <button className="primary" type="button" onClick={() => onUse(item)}>Use this food</button>
          <button className="secondary" type="button" onClick={() => onSave(item)}>Add to My Foods</button>
          <button className="secondary" type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

export function EntryModal({
  open,
  openMode,
  state,
  foods,
  draft,
  setDraft,
  onClose,
  onSave,
  onPickPhoto,
  onSaveDatabaseFood,
  onRefine,
  onRoughMeal,
  onRepeat,
  onDelete,
  day
}: {
  open: boolean;
  openMode: EntryOpenMode;
  state: AppState;
  foods: Food[];
  draft: EntryDraft;
  setDraft: (fn: EntryDraft | ((draft: EntryDraft) => EntryDraft)) => void;
  onClose: () => void;
  onSave: (keepOpen?: boolean) => void;
  onPickPhoto: () => void;
  onSaveDatabaseFood: (item: FoodDatabaseItem) => Promise<void> | void;
  /** Present while the draft is the latest Gemini estimate. */
  onRefine?: (correction: string) => Promise<void>;
  /** Opens Add a rough meal, for a meal that was hard to track. */
  onRoughMeal: () => void;
  /** While editing: log the entry again today, or delete it. */
  onRepeat: (id: string) => void;
  onDelete: (id: string) => void;
  /** The day being logged to, without this entry. Energy in kcal. */
  day: { eaten: number; target: number; bulking: boolean; date: string };
}) {
  const [refineText, setRefineText] = useState('');
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState('');
  const caloriesPanelRef = useRef<HTMLDivElement>(null);
  const caloriesInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const update = (patch: Partial<EntryDraft>) => setDraft(current => ({ ...current, ...patch }));
  const baseCalories = energyInputToKcal(draft.calories, draft.entryEnergyUnit);
  const multiplier = draft.unitMode === '100g' ? draftPortion(draft) / 100 : draftPortion(draft);
  const total = { calories: baseCalories * multiplier, fat: n(draft.fat) * multiplier, carbs: n(draft.carbs) * multiplier, protein: n(draft.protein) * multiplier };
  // Reviewing a picked food, an AI estimate or a saved entry starts from what it is; typing one in starts from the numbers.
  const reviewing = openMode !== 'manual';
  const scrollCaloriesPanel = (behavior: ScrollBehavior = 'smooth') => {
    requestAnimationFrame(() => {
      // The numbers are at or near the top of the sheet, so showing them means back to the top.
      caloriesPanelRef.current?.closest('.modal-body')?.scrollTo({ top: 0, behavior });
    });
  };
  // In the tap itself, so iOS keeps the keyboard up (or brings it back) for the next entry.
  const focusCaloriesForNext = () => {
    caloriesPanelRef.current?.closest('.modal-body')?.scrollTo({ top: 0 });
    caloriesInputRef.current?.focus({ preventScroll: true });
  };
  // Each option sets its own value, so tapping the one already chosen changes nothing.
  const setEntryEnergyUnit = (nextUnit: EnergyUnit) => setDraft(current => current.entryEnergyUnit === nextUnit
    ? current
    : { ...current, entryEnergyUnit: nextUnit, calories: energyInputFromKcal(energyInputToKcal(current.calories, current.entryEnergyUnit), nextUnit) });
  const setUnitMode = (nextUnitMode: EntryDraft['unitMode']) => setDraft(current => ({ ...current, ...switchDraftBasis(current, nextUnitMode) }));
  const chooseFood = (food: Food) => {
    const unit = draft.entryEnergyUnit;
    setDraft(current => ({
      ...current,
      sourceFoodId: food.source ? '' : food.id,
      name: food.name,
      unitMode: entryUnitModeValue(food.unitMode),
      brand: food.brand || '',
      servingLabel: food.servingLabel || '',
      servingGrams: food.servingGrams ? String(food.servingGrams) : '',
      source: food.source || '',
      sourceId: food.sourceId || '',
      category: food.category || '',
      tags: food.tags || [],
      calories: draftEnergyText(food.calories, unit),
      protein: draftNumberText(food.protein),
      carbs: draftNumberText(food.carbs),
      fat: draftNumberText(food.fat),
      portion: entryUnitModeValue(food.unitMode) === '100g' ? '100' : '1',
      favourite: null,
      estimateSource: estimateSourceValue(food.estimateSource),
      estimateDetails: null
    }));
    scrollCaloriesPanel();
  };

  useEffect(() => {
    if (!open) return;
    scrollCaloriesPanel('auto');
    if (openMode !== 'manual') return;
    // The + tap left the keyboard on a stand-in; the calories box takes it once the sheet
    // stops sliding, as focusing a field that is still off screen can make iOS scroll to it.
    const startedAt = performance.now();
    let frame = requestAnimationFrame(function handOver() {
      const input = caloriesInputRef.current;
      const panel = input?.closest('.modal-panel');
      const waited = performance.now() - startedAt;
      // In place once the slide-in has no offset left (its first frames still sit at the start).
      const inPlace = !!panel?.closest('.modal-backdrop.entered') && Math.abs(new DOMMatrixReadOnly(getComputedStyle(panel).transform).m42) < 1;
      if (input && (inPlace || waited > 800)) {
        const typed = takeKeyboardFromStandIn(input);
        if (typed) update({ calories: typed });
        else input.select();
        return;
      }
      if (waited > 2000) return;
      frame = requestAnimationFrame(handOver);
    });
    return () => cancelAnimationFrame(frame);
  }, [open, openMode]);

  useEffect(() => {
    if (open) return;
    setRefineText('');
    setRefineError('');
    // Closed before the calories box took the keyboard over.
    document.querySelector(`.${KEYBOARD_STAND_IN}`)?.remove();
  }, [open]);

  const perUnit = { calories: baseCalories, protein: n(draft.protein), carbs: n(draft.carbs), fat: n(draft.fat) };
  const macroCheckFails = !!draft.estimateSource && macrosDisagree(perUnit);
  const refine = async () => {
    if (!onRefine || !refineText.trim() || refining) return;
    setRefining(true);
    setRefineError('');
    try {
      await onRefine(refineText);
      setRefineText('');
    } catch (err) {
      setRefineError(err instanceof Error ? err.message : 'Gemini could not refine this estimate.');
    } finally {
      setRefining(false);
    }
  };

  const per100g = draft.unitMode === '100g';
  const basisText = per100g ? 'per 100 g' : 'per serving';
  // What one serving is ("1 pouch (140g)", "1 tsp (5g)"), so the amount can be checked against it.
  // A bare weight or "1 serve" would only repeat the amount.
  const servingCaption = draft.servingLabel.trim();
  const showServingCaption = !!servingCaption && !/^[\d.,]+\s*g$/i.test(servingCaption) && !/^1\s*serv(e|ing)$/i.test(servingCaption);
  const displayUnit = state.settings.energyUnit;
  const hasCalories = draft.calories.trim() !== '';
  const loggedText = energyTextForUnit(total.calories, displayUnit);
  const dayName = readable(day.date);
  const dayWord = ['Today', 'Yesterday', 'Tomorrow'].includes(dayName) ? dayName.toLowerCase() : `on ${dayName}`;
  const remaining = Math.round(day.target - day.eaten - (hasCalories ? total.calories : 0));
  const dayLine = !(day.target > 0)
    ? ''
    : remaining < 0
      ? `${energyTextForUnit(-remaining, displayUnit)} over${day.bulking ? ' target' : ''} ${dayWord}`
      : `${energyTextForUnit(remaining, displayUnit)} ${day.bulking ? 'to go' : 'left'} ${dayWord}`;
  const swipeLabel = draft.editingId
    ? hasCalories ? `Swipe to save ${loggedText}` : 'Swipe to save entry'
    : hasCalories ? `Swipe to log ${loggedText}` : 'Swipe to log food';
  // The heart shows the saved food this entry belongs to, and only changes it once tapped.
  const savedFavourite = !!linkedFood(foods, draft.sourceFoodId, draft.name)?.favourite;
  const isFavourite = draft.favourite ?? savedFavourite;
  const favouriteNote = draft.favourite === null || draft.favourite === savedFavourite ? '' : draft.favourite ? 'Also saves it to favourites' : 'Also removes it from favourites';
  const toggleFavourite = () => {
    update({ favourite: !isFavourite });
    // A favourite needs a name to be found again.
    if (!isFavourite && !draft.name.trim()) nameInputRef.current?.focus();
  };
  const nameField = (
    <div className="field full name-field">
      <label className="field-caption" htmlFor="entryName">Food name</label>
      <div className="name-row">
        <input ref={nameInputRef} id="entryName" value={draft.name} placeholder={isFavourite && !draft.name.trim() ? 'Name your favourite' : `${draft.meal} entry`} onChange={event => update({ name: event.target.value })} />
        {/* Meal prep runs out, so a serve of it isn't something to favourite. */}
        {!draft.batchId && <FavouriteToggle on={isFavourite} onToggle={toggleFavourite} />}
      </div>
    </div>
  );

  return (
    <Modal open={open} title={draft.editingId ? 'Edit entry' : `Log ${draft.meal.toLowerCase()}`} onClose={onClose} wide bottomSheet>
      <form className="form entry-form" onSubmit={(event: FormEvent) => { event.preventDefault(); onSave(false); }}>
        {reviewing && nameField}
        <div ref={caloriesPanelRef} className="calories-priority full" role="group" aria-label="Calories and macros">
          <div className="entry-panel-head">
            <span className="unit-toggle-chip" role="group" aria-label="Nutrition values are">
              <button type="button" className={per100g ? '' : 'active'} aria-pressed={!per100g} onClick={() => setUnitMode('serving')}>Per serving</button>
              <button type="button" className={per100g ? 'active' : ''} aria-pressed={per100g} onClick={() => setUnitMode('100g')}>Per 100g</button>
            </span>
            <span className="unit-toggle-chip" role="group" aria-label="Energy input unit">
              <button type="button" className={draft.entryEnergyUnit === 'kcal' ? 'active' : ''} aria-pressed={draft.entryEnergyUnit === 'kcal'} onClick={() => setEntryEnergyUnit('kcal')}>Cal</button>
              <button type="button" className={draft.entryEnergyUnit === 'kj' ? 'active' : ''} aria-pressed={draft.entryEnergyUnit === 'kj'} onClick={() => setEntryEnergyUnit('kj')}>kJ</button>
            </span>
          </div>
          <div className="calorie-input-row entry-energy-row">
            <input ref={caloriesInputRef} id="entryCalories" aria-label={`${energyUnitLabel(draft.entryEnergyUnit)} ${basisText}`} inputMode="decimal" value={draft.calories} placeholder="0" onChange={event => update({ calories: event.target.value })} />
            <span className="energy-suffix" aria-hidden="true"><strong>{energyUnitLabel(draft.entryEnergyUnit)}</strong><small>{basisText}</small></span>
          </div>
          <div className="nutrition-grid">
            <Field label="Fat (g)"><input inputMode="decimal" value={draft.fat} onChange={event => update({ fat: event.target.value })} /></Field>
            <Field label="Carbs (g)"><input inputMode="decimal" value={draft.carbs} onChange={event => update({ carbs: event.target.value })} /></Field>
            <Field label="Protein (g)"><input inputMode="decimal" value={draft.protein} onChange={event => update({ protein: event.target.value })} /></Field>
          </div>
          <div className="amount-row">
            <label className="amount-label" htmlFor="entryPortion">
              <span>{per100g ? 'Amount eaten' : 'Servings eaten'}</span>
              {showServingCaption && <small>{servingCaption}</small>}
            </label>
            <div className="calorie-input-row amount-input-row">
              <input
                id="entryPortion"
                inputMode="decimal"
                value={draft.portion}
                onChange={event => update({ portion: event.target.value })}
                onFocus={event => {
                  const input = event.currentTarget;
                  // Selected so a new amount replaces the old one. After focus, or iOS clears it.
                  requestAnimationFrame(() => input.select());
                }}
              />
              <span aria-hidden="true">{per100g ? 'g' : draftPortion(draft) === 1 ? 'serving' : 'servings'}</span>
            </div>
          </div>
          {draft.batchId && <p className="hint batch-entry-hint"><Icon name="prep" size={15} />A serve of meal prep. Servings eaten here count toward what’s left of the batch.</p>}
          {multiplier !== 1 && (
            <div className="meta-chips portion-preview" aria-live="polite">
              <span className="portion-preview-label">Logged total</span>
              <span className="meta-chip accent">{loggedText}</span>
              <MacroChips fat={total.fat} carbs={total.carbs} protein={total.protein} />
            </div>
          )}
          {draft.estimateSource && (
            <div className="estimate-review">
              <div className="meta-chips estimate-source-row">
                <span className="meta-chip source-chip">{estimateSourceLabel(draft.estimateSource)}</span>
                {draft.estimateDetails && <span className={`meta-chip confidence-chip confidence-${draft.estimateDetails.confidence}`}>{draft.estimateDetails.confidence[0].toUpperCase() + draft.estimateDetails.confidence.slice(1)} confidence</span>}
                <button type="button" className="link-btn" onClick={() => update({ estimateSource: null, estimateDetails: null })}>Not an estimate</button>
              </div>
              {/* The Estimated chip already says it's a guess; labels and menus need the specific check. */}
              {draft.estimateSource !== 'ai' && (
                <p className="hint estimate-hint">{draft.estimateSource === 'label'
                  ? 'Read from the label photo. Check it matches the pack and the amount you ate.'
                  : draft.estimateSource === 'rough'
                    ? 'A rough size for a meal that was hard to track. Change the number if you find out more.'
                    : 'Energy printed on the menu; macros are estimated.'}</p>
              )}
              {!!draft.estimateDetails?.assumptions.length && (
                <ul className="estimate-assumptions" aria-label="What Gemini assumed">
                  {draft.estimateDetails.assumptions.map(item => <li key={item}>{item}</li>)}
                </ul>
              )}
              {macroCheckFails && (
                <p className="estimate-warning">Calories and macros don’t quite add up: the macros come to about {energyTextForUnit(energyFromMacros(perUnit), draft.entryEnergyUnit)}. Worth a check, unless it contains alcohol.</p>
              )}
              {onRefine && (
                <div className="estimate-refine">
                  <input
                    aria-label="Correction for Gemini"
                    value={refineText}
                    disabled={refining}
                    placeholder="Something off? e.g. small bowl, no cheese"
                    onChange={event => { setRefineText(event.target.value); setRefineError(''); }}
                    onKeyDown={event => {
                      if (event.key !== 'Enter') return;
                      // Enter would otherwise submit Log Food.
                      event.preventDefault();
                      refine();
                    }}
                  />
                  <button type="button" className="secondary" disabled={!refineText.trim() || refining} onClick={refine}>{refining ? 'Refining…' : 'Refine'}</button>
                </div>
              )}
              {refineError && <p className="ai-quick-log-error">{refineError}</p>}
            </div>
          )}
        </div>

        {/* Not a <label>: a tap between chips would pick the first one. */}
        <div className="field full">
          <span>Meal</span>
          <div className="meal-chip-row" role="group" aria-label="Meal">
            {MEALS.map(meal => <button key={meal} type="button" className={`meal-chip ${draft.meal === meal ? 'active' : ''}`} aria-pressed={draft.meal === meal} onClick={() => update({ meal, part: mealDayPart(meal) ?? draft.part })}>{meal}</button>)}
          </div>
          {/* Breakfast, lunch and dinner already say when; a snack or drink is asked, so logging it later doesn't move it. */}
          {!mealDayPart(draft.meal) && (
            <div className="seg entry-part" role="group" aria-label={`When was this ${draft.meal.toLowerCase()}?`}>
              {DAY_PARTS.map(part => <button key={part} type="button" className={draft.part === part ? 'active' : ''} aria-pressed={draft.part === part} onClick={() => update({ part })}>{DAY_PART_LABEL[part]}</button>)}
            </div>
          )}
        </div>
        {!reviewing && nameField}
        {!reviewing && !draft.editingId && <SavedFoodPicker state={state} foods={foods} onChoose={chooseFood} onSaveDatabaseFood={onSaveDatabaseFood} compact />}
        {!reviewing && !draft.editingId && (
          <div className="entry-alt-links full">
            <button type="button" className="text-btn" onClick={onRoughMeal}>Add a rough meal</button>
          </div>
        )}
        <div className="photo-picker full">
          <button type="button" className="photo-picker-label" onClick={onPickPhoto}>
            <span className="photo-picker-icon" aria-hidden="true"><span className="empty-photo-icon" /></span><span><strong>{draft.photo ? 'Meal photo attached' : 'Add meal photo'}</strong><small>{draft.photo ? 'Tap to replace the photo' : 'Optional journal photo, compressed before saving'}</small></span>
          </button>
          {draft.photo && <div className="photo-picker-preview show"><img src={draft.photo} alt="Selected meal preview" /></div>}
        </div>

        <div className="entry-form-extras">
          <Field label="Notes" full><textarea value={draft.notes} onChange={event => update({ notes: event.target.value })} /></Field>
        </div>

        {/* What saving does, at the point of saving. ✕ and swipe down still close the sheet. */}
        <div className="actions full">
          {dayLine && <p className={`entry-day-impact ${remaining < 0 ? 'over' : ''}`}>{hasCalories && 'After this: '}<strong>{dayLine}</strong></p>}
          {favouriteNote && <p className={`entry-fav-note ${draft.favourite ? 'on' : ''}`}><Icon name="heart" size={14} filled={!!draft.favourite} />{favouriteNote}</p>}
          <SwipeConfirm label={swipeLabel} confirmLabel={draft.editingId ? 'Release to save' : 'Release to log'} className="entry-swipe" onConfirm={() => onSave(false)} />
          {!reviewing && !draft.editingId && <button className="secondary" type="button" onClick={() => { focusCaloriesForNext(); onSave(true); }}>Save and add another</button>}
          {draft.editingId && (
            <div className="entry-alt-links">
              <button type="button" className="text-btn" onClick={() => onRepeat(draft.editingId)}>Log again today</button>
              <button type="button" className="text-btn danger-text" onClick={() => onDelete(draft.editingId)}>Delete entry</button>
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}
