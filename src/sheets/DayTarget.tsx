import { useState } from 'react';
import type { AppState } from '../types';
import { dayCalorieSliderBounds, energyInputToKcal, energyText, energyUnitLabel, energyUnitValue, energyValue, fmt } from '../utils';

export function DayCalorieGoalPanel({
  state,
  date,
  suggested,
  effective,
  hasOverride,
  past,
  onPersist
}: {
  state: AppState;
  date: string;
  suggested: number;
  effective: number;
  hasOverride: boolean;
  past: boolean;
  onPersist: (kcal: number | null) => void;
}) {
  const [typedValue, setTypedValue] = useState('');
  const { min, max } = dayCalorieSliderBounds(suggested);
  const safe = Math.min(max, Math.max(min, effective));
  const unit = energyUnitValue(state.settings.energyUnit);
  const sliderStepKcal = 10;
  const sliderId = `day-cal-goal-${date}`;
  const inputId = `day-cal-goal-input-${date}`;
  const applyTyped = () => {
    const raw = typedValue.trim();
    if (!raw) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const kcal = energyInputToKcal(parsed, unit);
    onPersist(kcal);
    setTypedValue('');
  };
  if (past) return <p className="hint">This day has finished, so it keeps its usual target.</p>;
  return (
        <div className="day-calorie-goal-expand">
          <p className="hint day-calorie-goal-hint">Eating more or less on purpose today? Set this day&apos;s calories here. Protein, carbs and fat keep your usual targets.</p>
          <div className="day-calorie-slider-well">
            <div className="day-calorie-slider-row">
              <span className="day-calorie-endpoint" aria-hidden="true">{fmt(energyValue(state, min))}</span>
              <input
                id={sliderId}
                className="day-calorie-slider"
                type="range"
                aria-valuemin={min}
                aria-valuemax={max}
                aria-valuenow={safe}
                min={min}
                max={max}
                step={sliderStepKcal}
                value={safe}
                onChange={event => {
                  const kcal = Number(event.target.value);
                  if (!Number.isFinite(kcal)) return;
                  onPersist(kcal);
                }}
              />
              <span className="day-calorie-endpoint" aria-hidden="true">{fmt(energyValue(state, max))}</span>
            </div>
            <div className="day-calorie-input-row">
              <label className="day-calorie-input-label" htmlFor={inputId}>Type a target ({energyUnitLabel(unit)})</label>
              <div className="day-calorie-input-controls">
                <input
                  id={inputId}
                  className="day-calorie-input"
                  inputMode="numeric"
                  type="number"
                  step={unit === 'kj' ? 10 : 10}
                  placeholder={String(fmt(energyValue(state, safe))).replaceAll(',', '')}
                  value={typedValue}
                  onChange={event => setTypedValue(event.target.value)}
                  onKeyDown={event => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    applyTyped();
                  }}
                />
                <button type="button" className="secondary day-calorie-apply" onClick={applyTyped} disabled={!typedValue.trim()}>
                  Set
                </button>
              </div>
            </div>
          </div>
          <div className="day-calorie-goal-foot">
            <span className="hint">Your usual target is {energyText(state, suggested)}{state.settings.spreadWeeklyBank ? ' · includes week bank spread' : ''}</span>
            {hasOverride ? (
              <button type="button" className="secondary day-calorie-reset" onClick={() => onPersist(null)}>
                Use usual target
              </button>
            ) : null}
          </div>
        </div>
  );
}
