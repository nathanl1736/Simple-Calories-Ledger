import { useState } from 'react';
import type { AppState, Meal } from '../types';
import { energyInputToKcal, energyText, energyUnitLabel, energyUnitValue, MEALS } from '../utils';

const ROUGH_MEAL_SIZES: { size: string; kcal: number; hint: string }[] = [
  { size: 'Light', kcal: 500, hint: 'Salad, sushi, a poke bowl' },
  { size: 'Regular', kcal: 800, hint: 'A restaurant main or a burrito' },
  { size: 'Big', kcal: 1200, hint: 'Burger and chips, pizza, creamy pasta' },
  { size: 'Feast', kcal: 1800, hint: 'Shared plates, dessert or a few drinks' }
];

/** One tap for a meal that was hard to track: a size, not a breakdown. */
export function RoughMealPanel({ state, defaultMeal, onLog }: { state: AppState; defaultMeal: Meal; onLog: (meal: Meal, kcal: number, size: string | null) => void }) {
  const [meal, setMeal] = useState<Meal>(defaultMeal);
  const [typed, setTyped] = useState('');
  const unit = energyUnitValue(state.settings.energyUnit);
  const typedKcal = energyInputToKcal(typed, unit);
  return (
    <div className="rough-meal">
      <p className="hint">Ate out, or forgot to log it? Pick the closest size. It logs calories only, marked as a rough guess, and you can edit it later.</p>
      <div className="chips rough-meal-meals" role="group" aria-label="Meal">
        {MEALS.map(item => (
          <button key={item} type="button" className={`chip ${item === meal ? 'active' : ''}`} aria-pressed={item === meal} onClick={() => setMeal(item)}>{item}</button>
        ))}
      </div>
      <div className="add-list">
        {ROUGH_MEAL_SIZES.map(item => (
          <button key={item.size} className="add-row rough-size" type="button" onClick={() => onLog(meal, item.kcal, item.size)}>
            <span className="add-text"><strong>{item.size}</strong><small>{item.hint}</small></span>
            <span className="rough-size-energy">~{energyText(state, item.kcal)}</span>
          </button>
        ))}
      </div>
      <form className="rough-meal-custom" onSubmit={event => { event.preventDefault(); if (typedKcal > 0) onLog(meal, typedKcal, null); }}>
        <label className="field">
          <span>Or type a number ({energyUnitLabel(unit)})</span>
          <input inputMode="numeric" type="number" min="1" value={typed} onChange={event => setTyped(event.target.value)} placeholder={unit === 'kj' ? 'e.g. 4000' : 'e.g. 950'} />
        </label>
        <button className="secondary" type="submit" disabled={!(typedKcal > 0)}>Log</button>
      </form>
    </div>
  );
}
