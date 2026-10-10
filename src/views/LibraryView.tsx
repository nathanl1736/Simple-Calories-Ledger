import { useEffect, useState } from 'react';
import type { AppState, Batch, Food } from '../types';
import { ONE_OFF_ESTIMATE_DAYS } from '../favourites';
import { activeBatches, batchServe, batchServesLeft, finishedBatches } from '../mealPrep';
import { energyLabel, energyValue, fmt, fmtPortion, foodUnitText, todayKey } from '../utils';
import { Icon } from '../ui/icons';
import { FavouriteToggle, ServePips } from '../ui/controls';
import { cookedText } from '../ui/format';

/** What Foods' Meal prep list can do with a batch. */
type MealPrepActions = {
  onNew: () => void;
  onLog: (batch: Batch) => void;
  onManage: (batch: Batch) => void;
  onCookAgain: (batch: Batch) => void;
  onRemove: (batch: Batch) => void;
};

export function LibraryView({ state, sub, setSub, query, setQuery, onPrefill, onToggleFavourite, onManage, mealPrep }: { state: AppState; sub: string; setSub: (sub: string) => void; query: string; setQuery: (q: string) => void; onPrefill: (food: Food) => void; onToggleFavourite: (food: Food) => void; onManage: (food: Food) => void; mealPrep: MealPrepActions }) {
  // Un-hearting on Favourites leaves the row in place until you switch lists, so a slip is one tap to undo.
  const [unhearted, setUnhearted] = useState<string[]>([]);
  useEffect(() => setUnhearted([]), [sub]);
  const foods = state.foods.filter(food => !query || food.name.toLowerCase().includes(query.toLowerCase())).sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
  const shown = sub === 'favourites' ? foods.filter(food => food.favourite || unhearted.includes(food.id)) : foods;
  const toggleFavourite = (food: Food) => {
    if (sub === 'favourites' && food.favourite) setUnhearted(ids => [...ids, food.id]);
    onToggleFavourite(food);
  };
  const emptyCopy =
    sub === 'favourites'
      ? { title: 'No favourites yet.', body: 'Tap the heart on a food you eat often. Favourites show here and first when you search on Today.' }
      : query.trim()
        ? { title: 'No matches yet.', body: 'Try a different food name.' }
        : { title: 'Nothing here yet.', body: 'Your usual foods will appear here as you reuse them.' };
  const prep = sub === 'prep';
  return (
    <>
      <header className="page-header has-helper">
        <h1 className="page-title">Foods</h1>
        <p className="hint page-subtitle library-hint">{prep ? 'Cook once, log a serve at a time. A batch clears once it’s eaten, or a week after you cook it.' : sub === 'favourites' ? 'Tap + to log a food again. Heart the ones you eat often.' : `Tap + to log a food again. AI estimates you only log once clear after ${ONE_OFF_ESTIMATE_DAYS} days, unless you heart them.`}</p>
      </header>
      <div className="page-controls">
        <div className="seg" role="tablist" aria-label="Saved foods">
          <button className={sub === 'history' ? 'active' : ''} onClick={() => setSub('history')} type="button" role="tab" aria-selected={sub === 'history'}>
            Recent
          </button>
          <button className={sub === 'favourites' ? 'active' : ''} onClick={() => setSub('favourites')} type="button" role="tab" aria-selected={sub === 'favourites'}>
            Favourites
          </button>
          <button className={prep ? 'active' : ''} onClick={() => setSub('prep')} type="button" role="tab" aria-selected={prep}>
            Meal prep
          </button>
        </div>
        {!prep && <input className="search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search your usual foods" />}
      </div>
      {prep ? <MealPrepList state={state} actions={mealPrep} /> : (
      <section className={shown.length ? 'list-card' : 'card'}>
        {shown.length ? (
          shown.map(food => <FoodRow key={food.id} state={state} food={food} showUsage={sub !== 'favourites'} onPrefill={onPrefill} onToggleFavourite={toggleFavourite} onManage={onManage} />)
        ) : (
          <div className="empty">
            <strong>{emptyCopy.title}</strong>
            <div>{emptyCopy.body}</div>
          </div>
        )}
      </section>
      )}
    </>
  );
}

/** Foods → Meal prep: batches on the go, then the last few finished ones to cook again. */
function MealPrepList({ state, actions }: { state: AppState; actions: MealPrepActions }) {
  const today = todayKey();
  const active = activeBatches(state.batches, state.entries, today);
  const finished = finishedBatches(state.batches, state.entries, today);
  return (
    <>
      <button type="button" className="prep-new" onClick={actions.onNew}>
        <span className="add-icon" aria-hidden="true"><Icon name="plus" /></span>
        <span className="add-text"><strong>New batch</strong><small>Split a cook-up into serves</small></span>
        <Icon name="chevron" size={18} />
      </button>
      {active.length ? (
        <section className="list-card">
          {active.map(batch => <BatchRow key={batch.id} state={state} batch={batch} onLog={actions.onLog} onManage={actions.onManage} />)}
        </section>
      ) : (
        <div className="empty prep-empty">
          <strong>No meal prep on the go.</strong>
          <div>Cooked a batch? List what went in and how many serves. Each serve is then one tap from Today, and the batch clears once it’s eaten.</div>
        </div>
      )}
      {finished.length > 0 && (
        <details className="extra-info prep-again">
          <summary>Cook again ({finished.length})</summary>
          <div className="extra-info-body">
            {finished.map(batch => (
              <div key={batch.id} className="prep-again-row">
                <span className="prep-again-text">
                  <strong>{batch.name}</strong>
                  <small>{fmt(batch.servings)} serves · {fmt(energyValue(state, batchServe(batch).calories))} {energyLabel(state)} each · {cookedText(batch.cookedOn)}</small>
                </span>
                <button type="button" className="secondary prep-again-btn" onClick={() => actions.onCookAgain(batch)}>Cook again</button>
                <button type="button" className="prep-again-remove" aria-label={`Remove ${batch.name}`} onClick={() => actions.onRemove(batch)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

function BatchRow({ state, batch, onLog, onManage }: { state: AppState; batch: Batch; onLog: (batch: Batch) => void; onManage: (batch: Batch) => void }) {
  const left = batchServesLeft(batch, state.entries);
  const each = batchServe(batch);
  return (
    <div className="food-row prep-row" data-swipe-lock>
      <span className="prep-row-icon" aria-hidden="true"><Icon name="prep" size={20} /></span>
      <strong className="prep-row-name">{batch.name}</strong>
      <button className="food-log-btn" type="button" onClick={() => onLog(batch)} aria-label={`Log a serve of ${batch.name}`}><Icon name="plus" size={20} /></button>
      <button className="food-manage-btn" type="button" onClick={() => onManage(batch)} aria-label={`Edit ${batch.name}`}><span aria-hidden="true" /></button>
      {/* The detail lines run under the buttons, so they have the row's full width. */}
      <div className="food-sub prep-row-left"><ServePips left={left} servings={batch.servings} />{fmtPortion(left)} of {fmt(batch.servings)} left · {cookedText(batch.cookedOn)}</div>
      <div className="food-sub prep-row-macros">
        <b>{batch.estimateSource && <><span aria-hidden="true">≈</span><span className="sr-only">About </span></>}{fmt(energyValue(state, each.calories))} {energyLabel(state)}</b> a serve · P {fmt(each.protein)} · C {fmt(each.carbs)} · F {fmt(each.fat)}g
      </div>
    </div>
  );
}

function FoodRow({ state, food, showUsage, onPrefill, onToggleFavourite, onManage }: { state: AppState; food: Food; showUsage: boolean; onPrefill: (food: Food) => void; onToggleFavourite: (food: Food) => void; onManage: (food: Food) => void }) {
  const sub = [foodUnitText(food), showUsage && food.usageCount ? `logged ${fmt(food.usageCount)}×` : '', `P ${fmt(food.protein)} · C ${fmt(food.carbs)} · F ${fmt(food.fat)}g`].filter(Boolean).join(' · ');
  return (
    <div className="food-row" data-swipe-lock>
      <FavouriteToggle on={food.favourite} onToggle={() => onToggleFavourite(food)} label={`Favourite ${food.name}`} size={20} />
      <div className="body">
        <strong>{food.name}</strong>
        <div className="food-sub">{sub}</div>
      </div>
      <div className="food-cal">{food.estimateSource && <><span aria-hidden="true">≈</span><span className="sr-only">About </span></>}{fmt(energyValue(state, food.calories))}<small>{energyLabel(state)}</small></div>
      <button className="food-log-btn" type="button" onClick={() => onPrefill(food)} aria-label={`Log ${food.name}`}><Icon name="plus" size={20} /></button>
      <button className="food-manage-btn" type="button" onClick={() => onManage(food)} aria-label={`Manage ${food.name}`}><span aria-hidden="true" /></button>
    </div>
  );
}
