import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AppState, Batch, Food } from '../types';
import { databaseItemToFood, type FoodDatabaseItem } from '../foodDatabase';
import { estimateSourceLabel } from '../aiEstimate';
import { batchServe, batchServesLeft } from '../mealPrep';
import { searchSections } from '../searchResults';
import { energyLabel, energyValue, entryUnitModeValue, fmt, fmtPortion } from '../utils';
import { type IconName, Icon } from '../ui/icons';
import { databaseSourceChip, databaseServingText } from '../ui/format';
import { FoodDatabasePreviewModal } from './EntryModal';
import { useFoodSearch } from './useFoodSearch';

type FoodSearchKind = 'favourite' | 'recent' | 'database';
const SEARCH_GLYPH: Record<FoodSearchKind, IconName> = { favourite: 'heart', recent: 'recent', database: 'database' };
const SEARCH_KIND_TEXT: Record<FoodSearchKind, string> = { favourite: 'Favourite', recent: 'Recent', database: 'From the food database' };

/** What the numbers are per, unless it's a plain serving: "per 100g", "1 bowl", "1 medium (120g)". */
function servingNote(food: Food) {
  return entryUnitModeValue(food.unitMode) === '100g' || food.servingLabel || food.servingGrams ? databaseServingText(food) : '';
}

/** The brand, unless the name already says it. */
function brandNote(name: string, brand?: string) {
  return brand && !name.toLowerCase().includes(brand.toLowerCase()) ? brand : '';
}

/** One result, marked by where it comes from: a heart for a favourite, a clock for a recent food, a database tile for the food database. */
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
 * What Log food's text box finds as you type: the fridge, favourites, recent foods and the food
 * database, each row marked by where it comes from, then a row to log what was typed yourself.
 * A fridge serve logs at once; a saved food opens Log food filled in; a database food shows its
 * estimate first. Estimate stays on the box above, for anything not found.
 */
export function FoodSearchResults({ state, query, batches, onChoose, onLogBatch, onLogNew, onSaveDatabaseFood, onDrag }: {
  state: AppState;
  query: string;
  /** The fridge, serves left. */
  batches: Batch[];
  onChoose: (food: Food) => void;
  onLogBatch: (batch: Batch) => void;
  /** Log food to type in, named after the search. */
  onLogNew: (name: string) => void;
  onSaveDatabaseFood: (item: FoodDatabaseItem) => Promise<void> | void;
  /** Dragging the results, so the keyboard can go away and the whole list show. */
  onDrag?: () => void;
}) {
  const [moreDatabase, setMoreDatabase] = useState(false);
  const [preview, setPreview] = useState<FoodDatabaseItem | null>(null);
  const { trimmedQuery, userResults, databaseMatches, databaseMessage, databaseQuery } = useFoodSearch(state, state.foods, query);
  const { prepRows, favouriteRows, recentRows, databaseRows, moreCount, nothing, summary } = searchSections({
    query: trimmedQuery, batches, userResults, databaseMatches, databaseQuery, moreDatabase
  });

  // Each new search starts with the short database list.
  useEffect(() => setMoreDatabase(false), [trimmedQuery]);

  const savedMeta = (food: Food) => [brandNote(food.name, food.brand), servingNote(food), estimateSourceLabel(food.estimateSource)].filter(Boolean).join(' · ');
  const databaseMeta = (item: FoodDatabaseItem) => [databaseSourceChip(item.tags, item.sourceKind), brandNote(item.name, item.brand) || item.customDatabaseName, databaseServingText(item)].filter(Boolean).join(' · ');
  const logDatabaseFood = (item: FoodDatabaseItem) => {
    setPreview(null);
    onChoose(databaseItemToFood(item));
  };
  const saveDatabaseFood = async (item: FoodDatabaseItem) => {
    await onSaveDatabaseFood(item);
    setPreview(null);
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
    <div className="log-results" onTouchMove={onDrag}>
      {prepRows.length > 0 && (
        <section className="food-search-group">
          <h2 className="food-search-label">In your fridge · tap to log a serve</h2>
          <div className="food-search-list">
            {prepRows.map(batch => {
              const left = batchServesLeft(batch, state.entries);
              const each = batchServe(batch);
              return (
                <button key={batch.id} type="button" className="food-search-row" onClick={() => onLogBatch(batch)}>
                  <span className="food-search-glyph prep" aria-hidden="true"><Icon name={batch.kind === 'bought' ? 'bag' : 'prep'} size={18} /></span>
                  <span className="food-search-main">
                    <span className="sr-only">In your fridge, logs a serve: </span>
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
            {databaseRows.map(item => <FoodSearchRow key={item.id} state={state} kind="database" food={databaseItemToFood(item)} meta={databaseMeta(item)} onChoose={() => setPreview(item)} />)}
            {moreCount > 0 && <button type="button" className="food-search-more" onClick={() => setMoreDatabase(true)}>Show {moreCount} more</button>}
          </div>
        </section>
      )}
      {nothing && <p className="log-results-empty">Nothing saved matches. Tap Estimate to work it out, or log it yourself.</p>}
      <div className="food-search-list food-search-new">
        <button type="button" className="food-search-row" onClick={() => onLogNew(trimmedQuery.charAt(0).toUpperCase() + trimmedQuery.slice(1))}>
          <span className="food-search-glyph new" aria-hidden="true"><Icon name="plus" size={18} /></span>
          <span className="food-search-main">
            <span className="food-search-name">Log “{trimmedQuery}” yourself</span>
            <span className="food-search-sub">Type in the calories</span>
          </span>
        </button>
      </div>
      {databaseMessage && <p className="food-search-note">{databaseMessage}</p>}
      <p className="sr-only" aria-live="polite">{summary}</p>
      {/* Out of the sheet, which slides on a transform and so would hold a fixed sheet inside it. */}
      {createPortal(<FoodDatabasePreviewModal state={state} item={preview} onUse={logDatabaseFood} onSave={saveDatabaseFood} onClose={() => setPreview(null)} />, document.body)}
    </div>
  );
}
