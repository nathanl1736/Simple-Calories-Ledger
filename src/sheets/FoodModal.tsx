import { useEffect, useState } from 'react';
import type { EnergyUnit, Food } from '../types';
import { estimateSourceLabel } from '../aiEstimate';
import { energyInputFromKcal, energyInputToKcal, energyUnitLabel, energyUnitValue, entryUnitModeValue, n } from '../utils';
import { Modal } from '../ui/Modal';
import { FavouriteToggle, Field } from '../ui/controls';

export function FoodModal({ food, open, energyUnit, onClose, onSave, onDelete }: { food: Food | null; open: boolean; energyUnit: EnergyUnit; onClose: () => void; onSave: (food: Food) => void; onDelete: (food: Food) => void }) {
  const [draft, setDraft] = useState<Food | null>(food);
  const foodEnergyUnit = energyUnitValue(energyUnit);
  const [calorieInput, setCalorieInput] = useState('');
  useEffect(() => {
    setDraft(food ? structuredClone(food) : null);
    setCalorieInput(food ? energyInputFromKcal(food.calories, foodEnergyUnit) : '');
  }, [food, foodEnergyUnit]);
  if (!draft) return <Modal open={open} title="Manage food" onClose={onClose} bottomSheet><div className="empty">Food not found.</div></Modal>;
  const patch = (next: Partial<Food>) => setDraft(current => current ? { ...current, ...next } : current);
  const setCalories = (value: string) => {
    setCalorieInput(value);
    patch({ calories: energyInputToKcal(value, foodEnergyUnit) });
  };
  const toggleFoodUnitMode = () => patch({ unitMode: entryUnitModeValue(draft.unitMode) === 'serving' ? '100g' : 'serving' });
  return (
    <Modal open={open} title="Manage food" onClose={onClose} bottomSheet>
      <form className="form" onSubmit={event => { event.preventDefault(); onSave({ ...draft, calories: energyInputToKcal(calorieInput, foodEnergyUnit) }); }}>
        <div className="field full name-field">
          <label className="field-caption" htmlFor="foodName">Name</label>
          <div className="name-row">
            <input id="foodName" value={draft.name} onChange={event => patch({ name: event.target.value })} />
            <FavouriteToggle on={draft.favourite} onToggle={() => patch({ favourite: !draft.favourite })} />
          </div>
        </div>
        <Field label="Calories">
          <div className="calorie-input-row food-calorie-input">
            <input inputMode="decimal" value={calorieInput} onChange={event => setCalories(event.target.value)} />
            <span>{energyUnitLabel(foodEnergyUnit)}</span>
          </div>
        </Field>
        <Field label="Fat">
          <div className="calorie-input-row macro-input-row">
            <input inputMode="decimal" value={draft.fat} onChange={event => patch({ fat: n(event.target.value) })} />
            <span>g</span>
          </div>
        </Field>
        <Field label="Carbs">
          <div className="calorie-input-row macro-input-row">
            <input inputMode="decimal" value={draft.carbs} onChange={event => patch({ carbs: n(event.target.value) })} />
            <span>g</span>
          </div>
        </Field>
        <Field label="Protein">
          <div className="calorie-input-row macro-input-row">
            <input inputMode="decimal" value={draft.protein} onChange={event => patch({ protein: n(event.target.value) })} />
            <span>g</span>
          </div>
        </Field>
        <Field label="Nutrition values" full>
          <span className="unit-toggle-chip food-basis-toggle" role="group" aria-label="Saved food nutrition basis">
            <button type="button" className={entryUnitModeValue(draft.unitMode) === 'serving' ? 'active' : ''} onClick={toggleFoodUnitMode}>Per serving</button>
            <button type="button" className={entryUnitModeValue(draft.unitMode) === '100g' ? 'active' : ''} onClick={toggleFoodUnitMode}>Per 100g</button>
          </span>
        </Field>
        {draft.estimateSource && (
          <div className="meta-chips estimate-source-row full">
            <span className="meta-chip source-chip">{estimateSourceLabel(draft.estimateSource)}</span>
            <button type="button" className="link-btn" onClick={() => patch({ estimateSource: null })}>Not an estimate</button>
          </div>
        )}
        <div className="actions full"><button className="primary" type="submit">Save food</button><button className="secondary danger" type="button" onClick={() => onDelete(draft)}>Delete</button></div>
      </form>
    </Modal>
  );
}
