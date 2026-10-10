import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AppState, Batch, Food } from '../types';
import { databaseItemToFood, loadFoodDatabaseWithStatus, type FoodDatabaseItem } from '../foodDatabase';
import { normaliseSearchText } from '../foodSearch';
import { estimateSourceLabel } from '../aiEstimate';
import { batchServe, batchServesLeft } from '../mealPrep';
import { energyLabel, energyValue, entryUnitModeValue, fmt, fmtPortion } from '../utils';
import { acquireModalScrollLock, takeKeyboardFromStandIn } from '../ui/Modal';
import { type IconName, Icon } from '../ui/icons';
import { databaseSourceChip, databaseServingText } from '../ui/format';
import { FoodDatabasePreviewModal } from './EntryModal';
import { useFoodSearch } from './useFoodSearch';

type FoodSearchKind = 'favourite' | 'recent' | 'database';
const SEARCH_GLYPH: Record<FoodSearchKind, IconName> = { favourite: 'heart', recent: 'recent', database: 'database' };
const SEARCH_KIND_TEXT: Record<FoodSearchKind, string> = { favourite: 'Favourite', recent: 'Recent', database: 'From the food database' };
const SEARCH_EASE = 'cubic-bezier(.2, .8, .2, 1)';
const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** What the numbers are per, unless it's a plain serving: "per 100g", "1 bowl", "1 medium (120g)". */
function servingNote(food: Food) {
  return entryUnitModeValue(food.unitMode) === '100g' || food.servingLabel || food.servingGrams ? databaseServingText(food) : '';
}

/** The brand, unless the name already says it. */
function brandNote(name: string, brand?: string) {
  return brand && !name.toLowerCase().includes(brand.toLowerCase()) ? brand : '';
}

/** One result in Today's search, marked by where it comes from: a heart for a favourite, a clock for a recent food, a database tile for the food database. */
function FoodSearchRow({ state, kind, food, meta, onChoose }: { state: AppState; kind: FoodSearchKind; food: Food; meta: string; onChoose: () => void }) {
  return (
    <button type="button" className="food-search-row" onClick={onChoose}>
      <span className={`food-search-glyph ${kind}`} aria-hidden="true"><Icon name={SEARCH_GLYPH[kind]} size={18} filled={kind === 'favourite'} /></span>
      <span className="food-search-main">
        <span className="sr-only">{SEARCH_KIND_TEXT[kind]}: </span>
        <span className="food-search-name">{food.name}</span>
        <span className="food-search-sub">
          {meta}
          {/* Your own foods end on protein, like the day line; database rows keep the room for what their numbers are. */}
          {kind !== 'database' && <>{meta && ' · '}<b>{fmt(food.protein)}g</b> protein</>}
        </span>
      </span>
      <span className="food-search-cal"><span>{fmt(energyValue(state, food.calories))}</span><small>{energyLabel(state)}</small></span>
    </button>
  );
}

/**
 * Search foods: everything logged before, favourites first, and the food database, each
 * result marked by where it comes from. Opened from Log food it fades in; given an `anchorRef`
 * field, the bar rises out of it and sinks back into it on Cancel. A saved food opens Log food
 * filled in; a database food shows its estimate first, as in Log food's own search.
 */
export function FoodSearch({ open, state, anchorRef, onClose, onChoose, onSaveDatabaseFood, onLogNew, batches, onLogBatch }: {
  open: boolean;
  state: AppState;
  /** A search field the bar rises from and sinks back to, if it was opened from one. */
  anchorRef?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onChoose: (food: Food) => void;
  onSaveDatabaseFood: (item: FoodDatabaseItem) => Promise<void> | void;
  /** Log food to type in, named after the search. */
  onLogNew: (name: string) => void;
  /** Meal prep with serves left: listed first, and one tap logs a serve. */
  batches: Batch[];
  onLogBatch: (batch: Batch) => void;
}) {
  const [rendered, setRendered] = useState(open);
  const [query, setQuery] = useState('');
  const [moreDatabase, setMoreDatabase] = useState(false);
  const [preview, setPreview] = useState<FoodDatabaseItem | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  /** Set by Cancel, so the bar sinks back into Today's field. A picked food just fades the search as Log food comes up. */
  const settleBack = useRef(false);
  /** How far opening had got when Cancel cut it short, so closing carries on from there rather than jumping. */
  const midway = useRef<{ bar: string; cancel: Keyframe; results: string; backdrop: string } | null>(null);
  const { trimmedQuery, recentFoods, userResults, databaseMatches, databaseMessage, databaseQuery } = useFoodSearch(state, state.foods, query);

  useEffect(() => {
    if (open) setRendered(true);
  }, [open]);

  // While it's up, the page behind stays put.
  useEffect(() => (rendered ? acquireModalScrollLock() : undefined), [rendered]);

  // Loaded now, so the first search doesn't wait for the food database.
  useEffect(() => {
    if (open) loadFoodDatabaseWithStatus().catch(() => undefined);
  }, [open]);

  // Each new search starts at the top, with the short database list.
  useEffect(() => {
    setMoreDatabase(false);
    resultsRef.current?.scrollTo({ top: 0 });
  }, [trimmedQuery]);

  /**
   * Where the bar moves to sit exactly on Today's field: the offset for the bar, and the margin
   * that tucks Cancel past the edge so the box is the field's full width.
   */
  const overField = (bar: HTMLElement, anchor: HTMLElement) => {
    const field = anchor.getBoundingClientRect();
    const box = bar.querySelector('.food-search-field')!.getBoundingClientRect();
    const cancelButton = bar.querySelector<HTMLElement>('.food-search-cancel');
    return {
      offset: `translate(${field.left - box.left}px, ${field.top - box.top}px)`,
      cancelButton,
      tucked: `${-((cancelButton?.offsetWidth || 0) + 12)}px`
    };
  };

  // Before paint, so the first frame already has the bar over Today's field.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const bar = barRef.current;
    const input = inputRef.current;
    if (!open || !rendered || !root || !bar || !input) return;
    const anchor = anchorRef?.current;
    // Today's field becomes the bar, so it isn't left showing underneath.
    if (anchor) anchor.style.visibility = 'hidden';
    // The keyboard came up on a stand-in during the tap; the box takes it over once it's in place.
    const handOver = () => {
      const typed = takeKeyboardFromStandIn(input);
      if (typed) setQuery(current => current || typed);
    };
    if (!anchor || prefersReducedMotion()) {
      const fade = root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
      handOver();
      return () => fade.cancel();
    }
    const { offset, cancelButton, tucked } = overField(bar, anchor);
    const backdrop = root.querySelector<HTMLElement>('.food-search-backdrop');
    const results = resultsRef.current;
    midway.current = null;
    const lift = bar.animate([{ transform: offset }, { transform: 'none' }], { duration: 320, easing: SEARCH_EASE });
    const parts = [
      lift,
      // Cancel slides in from the edge as the box narrows to make room for it.
      cancelButton?.animate([{ marginRight: tucked, opacity: 0 }, { marginRight: '0px', opacity: 1 }], { duration: 320, easing: SEARCH_EASE }),
      backdrop?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' }),
      results?.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 260, delay: 140, easing: SEARCH_EASE, fill: 'backwards' })
    ];
    let stopped = false;
    lift.finished.then(() => { if (!stopped) handOver(); }, () => undefined);
    return () => {
      stopped = true;
      if (parts.some(part => part?.playState === 'running')) {
        const cancelStyle = cancelButton ? getComputedStyle(cancelButton) : null;
        midway.current = {
          bar: getComputedStyle(bar).transform,
          cancel: { marginRight: cancelStyle?.marginRight || '0px', opacity: cancelStyle?.opacity || '1' },
          results: results ? getComputedStyle(results).opacity : '1',
          backdrop: backdrop ? getComputedStyle(backdrop).opacity : '1'
        };
      }
      parts.forEach(part => part?.cancel());
    };
  }, [open, rendered]);

  // Also before paint: closing takes over from a cut-short open in the same frame.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const bar = barRef.current;
    if (open || !rendered || !root || !bar) return;
    inputRef.current?.blur();
    const anchor = anchorRef?.current;
    const back = settleBack.current && !!anchor && !prefersReducedMotion();
    settleBack.current = false;
    const from = midway.current;
    midway.current = null;
    let parts: (Animation | undefined)[];
    if (back && anchor) {
      const { offset, cancelButton, tucked } = overField(bar, anchor);
      parts = [
        bar.animate([{ transform: from?.bar || 'none' }, { transform: offset }], { duration: 300, easing: SEARCH_EASE, fill: 'forwards' }),
        cancelButton?.animate([from?.cancel || { marginRight: '0px', opacity: 1 }, { marginRight: tucked, opacity: 0 }], { duration: 300, easing: SEARCH_EASE, fill: 'forwards' }),
        // The results go first, so they never sit over Today as it shows through.
        resultsRef.current?.animate([{ opacity: from?.results || 1 }, { opacity: 0 }], { duration: 90, easing: 'ease-out', fill: 'forwards' }),
        root.querySelector('.food-search-backdrop')?.animate([{ opacity: from?.backdrop || 1 }, { opacity: 0 }], { duration: 220, delay: 80, easing: 'ease-in-out', fill: 'forwards' })
      ];
    } else {
      parts = [root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'ease-out', fill: 'forwards' })];
    }
    let stopped = false;
    Promise.all(parts.map(part => part?.finished)).then(() => {
      if (stopped) return;
      if (anchor) {
        anchor.style.visibility = '';
        // Back where search was opened, for anyone moving around with a keyboard.
        if (back) anchor.focus({ preventScroll: true });
      }
      setRendered(false);
      setQuery('');
      setPreview(null);
    }, () => undefined);
    return () => {
      stopped = true;
      parts.forEach(part => part?.cancel());
    };
  }, [open, rendered]);

  const cancel = () => {
    settleBack.current = true;
    onClose();
  };

  // Esc on a keyboard, unless a food's estimate is open over the search: that closes first.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('.modal-backdrop')) return;
      event.preventDefault();
      cancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!rendered) return null;

  const browsing = !trimmedQuery;
  const prepRows = browsing ? batches : batches.filter(batch => normaliseSearchText(batch.name).includes(normaliseSearchText(trimmedQuery)));
  const pool = browsing ? recentFoods : userResults;
  const favouriteRows = pool.filter(food => food.favourite).slice(0, browsing ? 12 : 8);
  const recentRows = pool.filter(food => !food.favourite).slice(0, browsing ? 12 : 8);
  const databaseRows = browsing ? [] : databaseMatches.slice(0, moreDatabase ? 20 : 3);
  const moreCount = Math.min(databaseMatches.length, 20) - databaseRows.length;
  // Database matches land a moment after the typing, so "no matches" waits for them.
  const waiting = !browsing && databaseQuery !== trimmedQuery;
  const nothing = !browsing && !waiting && !prepRows.length && !favouriteRows.length && !recentRows.length && !databaseRows.length;
  const summary = browsing || waiting ? '' : nothing ? `No matches for ${trimmedQuery}` : [
    prepRows.length ? `${prepRows.length} meal prep` : '',
    favouriteRows.length ? `${favouriteRows.length} favourite${favouriteRows.length === 1 ? '' : 's'}` : '',
    recentRows.length ? `${recentRows.length} recent` : '',
    databaseMatches.length ? `${Math.min(databaseMatches.length, 20)} from the food database` : ''
  ].filter(Boolean).join(', ');

  const savedMeta = (food: Food) => [brandNote(food.name, food.brand), servingNote(food), estimateSourceLabel(food.estimateSource)].filter(Boolean).join(' · ');
  const databaseMeta = (item: FoodDatabaseItem) => [databaseSourceChip(item.tags, item.sourceKind), brandNote(item.name, item.brand) || item.customDatabaseName, databaseServingText(item)].filter(Boolean).join(' · ');
  const pickDatabase = (item: FoodDatabaseItem) => {
    inputRef.current?.blur();
    setPreview(item);
  };
  const logDatabaseFood = (item: FoodDatabaseItem) => {
    setPreview(null);
    onChoose(databaseItemToFood(item));
  };
  const saveDatabaseFood = async (item: FoodDatabaseItem) => {
    await onSaveDatabaseFood(item);
    setPreview(null);
  };
  // Dragging the results puts the keyboard away, as in iOS, so the whole list can be seen.
  const dismissKeyboard = () => {
    if (document.activeElement === inputRef.current) inputRef.current?.blur();
  };
  const savedSection = (title: string, kind: FoodSearchKind, foods: Food[]) => foods.length > 0 && (
    <section className="food-search-group">
      <h2 className="food-search-label">{title}</h2>
      <div className="food-search-list">
        {foods.map(food => <FoodSearchRow key={food.id} state={state} kind={kind} food={food} meta={savedMeta(food)} onChoose={() => onChoose(food)} />)}
      </div>
    </section>
  );

  return (
    <>
      {createPortal(
        <div ref={rootRef} className="food-search" role="dialog" aria-modal="true" aria-label="Search foods">
          <div className="food-search-backdrop" aria-hidden="true" />
          <div className="food-search-head">
            <div ref={barRef} className="food-search-bar">
              <div className="food-search-field">
                <Icon name="search" size={20} />
                <input
                  ref={inputRef}
                  type="search"
                  value={query}
                  placeholder="Search foods"
                  aria-label="Search foods"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="search"
                  onChange={event => setQuery(event.target.value)}
                  onKeyDown={event => {
                    // Search on the keyboard puts it away, so every result shows.
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    event.currentTarget.blur();
                  }}
                />
                {query && (
                  <button type="button" className="food-search-clear" aria-label="Clear search" onClick={() => { setQuery(''); inputRef.current?.focus(); }}>
                    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="9" /><path d="M6.2 6.2l5.6 5.6M11.8 6.2l-5.6 5.6" /></svg>
                  </button>
                )}
              </div>
              <button type="button" className="food-search-cancel" onClick={cancel}>Cancel</button>
            </div>
          </div>
          <div ref={resultsRef} className="food-search-results" onTouchMove={dismissKeyboard}>
            {prepRows.length > 0 && (
              <section className="food-search-group">
                <h2 className="food-search-label">Meal prep · tap to log a serve</h2>
                <div className="food-search-list">
                  {prepRows.map(batch => {
                    const left = batchServesLeft(batch, state.entries);
                    const each = batchServe(batch);
                    return (
                      <button key={batch.id} type="button" className="food-search-row" onClick={() => onLogBatch(batch)}>
                        <span className="food-search-glyph prep" aria-hidden="true"><Icon name="prep" size={18} /></span>
                        <span className="food-search-main">
                          <span className="sr-only">Meal prep, logs a serve: </span>
                          <span className="food-search-name">{batch.name}</span>
                          <span className="food-search-sub">{fmtPortion(left)} of {fmt(batch.servings)} left · <b>{fmt(each.protein)}g</b> protein</span>
                        </span>
                        <span className="food-search-cal"><span>{fmt(energyValue(state, each.calories))}</span><small>{energyLabel(state)}</small></span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
            {savedSection('Favourites', 'favourite', favouriteRows)}
            {savedSection('Recent', 'recent', recentRows)}
            {databaseRows.length > 0 && (
              <section className="food-search-group">
                <h2 className="food-search-label">Food database</h2>
                <div className="food-search-list">
                  {databaseRows.map(item => <FoodSearchRow key={item.id} state={state} kind="database" food={databaseItemToFood(item)} meta={databaseMeta(item)} onChoose={() => pickDatabase(item)} />)}
                  {moreCount > 0 && <button type="button" className="food-search-more" onClick={() => setMoreDatabase(true)}>Show {moreCount} more</button>}
                </div>
              </section>
            )}
            {browsing && !recentFoods.length && !prepRows.length && (
              <div className="food-search-empty">
                <strong>Nothing saved yet</strong>
                <span>Foods you log are kept here, favourites first. Type a food to search the food database too.</span>
              </div>
            )}
            {nothing && (
              <div className="food-search-empty">
                <strong>No matches for “{trimmedQuery}”</strong>
                <span>Try another word, or log it yourself.</span>
              </div>
            )}
            {!browsing && (
              <div className="food-search-list food-search-new">
                <button type="button" className="food-search-row" onClick={() => onLogNew(trimmedQuery.charAt(0).toUpperCase() + trimmedQuery.slice(1))}>
                  <span className="food-search-glyph new" aria-hidden="true"><Icon name="plus" size={18} /></span>
                  <span className="food-search-main">
                    <span className="food-search-name">Log “{trimmedQuery}” yourself</span>
                    <span className="food-search-sub">Type in the calories</span>
                  </span>
                </button>
              </div>
            )}
            {!browsing && databaseMessage && <p className="food-search-note">{databaseMessage}</p>}
            <p className="sr-only" aria-live="polite">{summary}</p>
          </div>
        </div>,
        document.body
      )}
      <FoodDatabasePreviewModal state={state} item={preview} onUse={logDatabaseFood} onSave={saveDatabaseFood} onClose={() => setPreview(null)} />
    </>
  );
}
