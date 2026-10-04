import type { AppState, DailyGoalSnapshot, EnergyUnit, Entry, Food, Meal, Settings, Totals } from './types';

export const MEALS: Meal[] = ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Drink'];

export const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);

export const n = (value: unknown) => Number(value) || 0;
export const fmt = (value: unknown) => Number.isFinite(Number(value)) ? Math.round(Number(value)).toLocaleString() : String(value);
export const signed = (value: number) => `${value > 0 ? '+' : ''}${fmt(value)}`;

// Built from local date parts. Shifting by the UTC offset and reading the ISO
// string broke on daylight-saving start (e.g. Melbourne's first Sunday in
// October), where local midnight plus the offset lands after the clock change
// and the Sunday came out as Saturday.
export function toKey(date: Date | string | number) {
  const z = new Date(date);
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`;
}

export const todayKey = () => toKey(new Date());

export function addDays(key: string, days: number) {
  const d = new Date(`${key}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toKey(d);
}

export function readable(key: string) {
  const today = todayKey();
  if (key === today) return 'Today';
  if (key === addDays(today, -1)) return 'Yesterday';
  if (key === addDays(today, 1)) return 'Tomorrow';
  return new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function shortDate(key: string) {
  return new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function normalizeDateKey(value: unknown) {
  if (!value) return '';
  if (typeof value === 'string') {
    const match = value.match(/\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  try {
    return toKey(value as string);
  } catch {
    return String(value);
  }
}

export const weekStartMonday = (key: string) => {
  const d = new Date(`${key}T00:00:00`);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return toKey(d);
};

export const portionValue = (value: unknown) => {
  const x = Number(value);
  return Number.isFinite(x) && x > 0 ? x : 1;
};

export const fmtPortion = (value: unknown) => portionValue(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
export const fmtGram = (value: unknown) => portionValue(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
export const entryUnitModeValue = (value: unknown): 'serving' | '100g' => value === '100g' ? '100g' : 'serving';

export function macroBase(entry: Partial<Entry> | undefined, key: keyof Totals) {
  if (!entry) return 0;
  const prop = `base${key[0].toUpperCase()}${key.slice(1)}` as keyof Entry;
  return entry[prop] != null ? n(entry[prop]) : n(entry[key]);
}

export function entryMultiplier(entry: Partial<Entry>) {
  const portion = portionValue(entry.portion);
  return entryUnitModeValue(entry.unitMode) === '100g' ? portion / 100 : portion;
}

export function entryTotals(entry: Partial<Entry>): Totals {
  const multiplier = entryMultiplier(entry);
  return {
    calories: macroBase(entry, 'calories') * multiplier,
    protein: macroBase(entry, 'protein') * multiplier,
    carbs: macroBase(entry, 'carbs') * multiplier,
    fat: macroBase(entry, 'fat') * multiplier
  };
}

export function sum(entries: Entry[]): Totals {
  return entries.reduce<Totals>((acc, entry) => {
    const totals = entryTotals(entry);
    acc.calories += totals.calories;
    acc.protein += totals.protein;
    acc.carbs += totals.carbs;
    acc.fat += totals.fat;
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

export function dayEntries(state: AppState, key: string) {
  return state.entries
    .filter(entry => normalizeDateKey(entry.date) === key)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export function isDayComplete(state: AppState, key: string) {
  const date = normalizeDateKey(key);
  return state.completedDates.some(item => normalizeDateKey(item) === date);
}

export function setDayComplete(state: AppState, key: string, on: boolean): AppState {
  const date = normalizeDateKey(key);
  // A day can't be finished before it starts.
  if (on && date > todayKey()) return state;
  const completedDates = state.completedDates.map(normalizeDateKey).filter(Boolean);
  const dailyGoals = { ...(state.dailyGoals || {}) };
  if (on && date && !dailyGoals[date]) dailyGoals[date] = goalSnapshotFromSettings(state.settings);
  return {
    ...state,
    completedDates: on ? [...new Set([...completedDates, date])] : completedDates.filter(item => item !== date),
    dailyGoals
  };
}

export function dayEstimate(state: AppState, key: string): number | null {
  const value = state.dayEstimates?.[normalizeDateKey(key)];
  return value == null || !Number.isFinite(value) ? null : value;
}

/** Sets a rough guess for a day (kcal above its target), or clears it with null. */
export function setDayEstimate(state: AppState, key: string, kcal: number | null): AppState {
  const date = normalizeDateKey(key);
  if (!date || (kcal != null && date > todayKey())) return state;
  const dayEstimates = { ...(state.dayEstimates || {}) };
  const dailyGoals = { ...(state.dailyGoals || {}) };
  if (kcal == null) {
    delete dayEstimates[date];
  } else {
    dayEstimates[date] = Math.round(kcal);
    if (!dailyGoals[date]) dailyGoals[date] = goalSnapshotFromSettings(state.settings);
  }
  return { ...state, dayEstimates, dailyGoals };
}

export function goalSnapshotFromSettings(settings: Settings): DailyGoalSnapshot {
  return {
    calories: n(settings.calories),
    protein: n(settings.protein),
    carbs: n(settings.carbs),
    fat: n(settings.fat),
    trackingMode: settings.trackingMode
  };
}

export function normalizeGoalSnapshot(input: Partial<DailyGoalSnapshot> | undefined, fallback: Settings): DailyGoalSnapshot {
  const base = goalSnapshotFromSettings(fallback);
  return {
    calories: n(input?.calories) || base.calories,
    protein: n(input?.protein) || base.protein,
    carbs: n(input?.carbs) || base.carbs,
    fat: n(input?.fat) || base.fat,
    trackingMode: input?.trackingMode === 'Bulking' || input?.trackingMode === 'Maintaining' || input?.trackingMode === 'Cutting'
      ? input.trackingMode
      : base.trackingMode
  };
}

export function goalForDate(state: AppState, key: string): DailyGoalSnapshot {
  const date = normalizeDateKey(key);
  const today = todayKey();
  const savedGoal = state.dailyGoals?.[date];
  if (savedGoal && (date < today || isDayComplete(state, date))) return savedGoal;
  return goalSnapshotFromSettings(state.settings);
}

/** Under this share of its target, a finished day's log probably has a meal missing, so it waits for a check before it banks. */
export const LIGHT_DAY_SHARE = 0.6;
/** Sharing out an overrun never takes a day below this share of its target; the rest stays in that week's result. */
export const SPREAD_FLOOR_SHARE = 0.8;

/**
 * How a day takes part in the week bank:
 * - counted: finished, and the bank uses what was logged
 * - estimated: the bank uses a rough guess instead of the log
 * - light: logged under LIGHT_DAY_SHARE of target, held out until checked
 * - untracked: nothing logged, so it counts as on target
 * - today: still in progress
 * - upcoming: hasn't started
 */
export type DayBankStatus = 'counted' | 'estimated' | 'light' | 'untracked' | 'today' | 'upcoming';

export type BankDay = {
  date: string;
  status: DayBankStatus;
  goal: DailyGoalSnapshot;
  /** What was logged. */
  totals: Totals;
  /** What the bank counts as eaten, or null while the day doesn't count. */
  intake: number | null;
  /** Target minus intake for a day that counts, else 0. Positive is under target. */
  delta: number;
};

export function bankDay(state: AppState, key: string): BankDay {
  const date = normalizeDateKey(key);
  const today = todayKey();
  const goal = goalForDate(state, date);
  const totals = sum(dayEntries(state, date));
  const estimate = dayEstimate(state, date);
  let status: DayBankStatus;
  if (date > today) status = 'upcoming';
  else if (estimate != null) status = 'estimated';
  // An empty day can't be a saving, even one swiped complete before 2.6.
  else if (totals.calories <= 0) status = date === today ? 'today' : 'untracked';
  else if (isDayComplete(state, date)) status = 'counted';
  else if (date === today) status = 'today';
  else status = totals.calories < goal.calories * LIGHT_DAY_SHARE ? 'light' : 'counted';
  const intake = status === 'counted' ? totals.calories : status === 'estimated' ? goal.calories + (estimate || 0) : null;
  return { date, status, goal, totals, intake, delta: intake == null ? 0 : goal.calories - intake };
}

export type WeekBank = {
  days: BankDay[];
  /** Days the bank uses: counted logs and rough guesses. */
  counted: BankDay[];
  /** Light days waiting for a check. */
  toCheck: BankDay[];
  /** Days still to eat: today while it's in progress, then the days ahead. */
  remaining: BankDay[];
  banked: number;
  budget: number;
  /** Food already logged on today while it's in progress. */
  eatenToday: number;
  /** What the remaining days can still eat in total: their targets plus the bank, less what today has had. */
  left: number;
  /** What each remaining day can average, never below SPREAD_FLOOR_SHARE of target. */
  perDay: number;
  /** How far over the week finishes if the remaining days eat perDay; only above 0 when the floor applies. */
  overAtFloor: number;
};

export function weekBank(state: AppState, start: string): WeekBank {
  const days = Array.from({ length: 7 }, (_, i) => bankDay(state, addDays(start, i)));
  const counted = days.filter(day => day.intake != null);
  const remaining = days.filter(day => day.status === 'today' || day.status === 'upcoming');
  const banked = counted.reduce((acc, day) => acc + day.delta, 0);
  const remainingTarget = remaining.reduce((acc, day) => acc + day.goal.calories, 0);
  const eatenToday = remaining.reduce((acc, day) => acc + (day.status === 'today' ? day.totals.calories : 0), 0);
  const even = remaining.length ? (remainingTarget + banked) / remaining.length : 0;
  const floor = remaining.length ? remainingTarget * SPREAD_FLOOR_SHARE / remaining.length : 0;
  const perDay = Math.max(even, floor);
  return {
    days,
    counted,
    toCheck: days.filter(day => day.status === 'light'),
    remaining,
    banked,
    budget: days.reduce((acc, day) => acc + day.goal.calories, 0),
    eatenToday,
    left: remainingTarget + banked - eatenToday,
    perDay,
    overAtFloor: (perDay - even) * remaining.length
  };
}

export function weeklyBankAdjustmentForDate(state: AppState, key: string): number {
  if (!state.settings.spreadWeeklyBank) return 0;
  const date = normalizeDateKey(key);
  if (!date) return 0;
  const week = weekBank(state, weekStartMonday(date));
  if (!week.banked || !week.remaining.some(day => day.date === date)) return 0;
  const goal = goalForDate(state, date).calories;
  return Math.max(week.banked / week.remaining.length, -goal * (1 - SPREAD_FLOOR_SHARE));
}

export function dayCalorieSliderBounds(suggested: number): { min: number; max: number } {
  const min = Math.max(400, Math.floor(suggested * 0.45));
  const max = Math.min(8000, Math.ceil(Math.max(suggested * 1.65, suggested + 400)));
  return min < max ? { min, max } : { min: Math.max(1, suggested - 1), max: suggested + 1 };
}

export function suggestedTrackDayCalories(state: AppState, date: string): number {
  const key = normalizeDateKey(date);
  const base = goalForDate(state, key);
  const bank = weeklyBankAdjustmentForDate(state, key);
  return Math.max(1, base.calories + bank);
}

function overrideNearSuggestedTolerance(suggested: number) {
  return Math.max(25, Math.round(suggested * 0.015));
}

export function resolveDayCalorieTarget(state: AppState, date: string): { suggested: number; effective: number; hasOverride: boolean } {
  const key = normalizeDateKey(date);
  const suggested = suggestedTrackDayCalories(state, key);
  const raw = state.dayCalorieOverrides?.[key];
  // A day target plans today or a day ahead; a finished day shows its usual target.
  if (key < todayKey() || raw == null || !Number.isFinite(raw)) {
    return { suggested, effective: suggested, hasOverride: false };
  }
  const { min, max } = dayCalorieSliderBounds(suggested);
  const clamped = Math.min(max, Math.max(min, Math.round(n(raw))));
  const tol = overrideNearSuggestedTolerance(suggested);
  if (Math.abs(clamped - suggested) <= tol) {
    return { suggested, effective: suggested, hasOverride: false };
  }
  return { suggested, effective: clamped, hasOverride: true };
}

export function applyDayCalorieOverride(state: AppState, date: string, kcal: number | null): AppState {
  const key = normalizeDateKey(date);
  if (!key) return state;
  const next = { ...(state.dayCalorieOverrides || {}) };
  if (kcal == null) {
    delete next[key];
    return { ...state, dayCalorieOverrides: next };
  }
  const suggested = suggestedTrackDayCalories(state, key);
  const { min, max } = dayCalorieSliderBounds(suggested);
  const clamped = Math.min(max, Math.max(min, Math.round(n(kcal))));
  const tol = overrideNearSuggestedTolerance(suggested);
  if (Math.abs(clamped - suggested) <= tol) delete next[key];
  else next[key] = clamped;
  return { ...state, dayCalorieOverrides: next };
}

export function datesWithRecords(state: AppState) {
  return [...new Set([
    ...state.entries.map(entry => normalizeDateKey(entry.date)).filter(Boolean),
    ...state.completedDates.map(normalizeDateKey).filter(Boolean),
    ...Object.keys(state.dayEstimates || {}).map(normalizeDateKey).filter(Boolean)
  ])].sort();
}

export function lockPastGoals(state: AppState, today = todayKey(), goal = goalSnapshotFromSettings(state.settings)): AppState {
  const dailyGoals = { ...(state.dailyGoals || {}) };
  datesWithRecords(state).forEach(date => {
    if ((date < today || isDayComplete(state, date)) && !dailyGoals[date]) dailyGoals[date] = goal;
  });
  return { ...state, dailyGoals };
}

export function energyUnitValue(value: unknown): EnergyUnit {
  return value === 'kj' ? 'kj' : 'kcal';
}

export function energyUnitLabel(unit: unknown) {
  return energyUnitValue(unit) === 'kj' ? 'kJ' : 'Cal';
}

export function energyLabel(state: AppState) {
  return energyUnitLabel(state.settings.energyUnit);
}

export function energyValueForUnit(kcal: number, unit: unknown) {
  return energyUnitValue(unit) === 'kj' ? n(kcal) * 4.184 : n(kcal);
}

export function energyValue(state: AppState, kcal: number) {
  return energyValueForUnit(kcal, state.settings.energyUnit);
}

export function energyText(state: AppState, kcal: number, suffix = '') {
  return `${fmt(energyValue(state, kcal))} ${energyLabel(state)}${suffix}`;
}

export function energyTextForUnit(kcal: number, unit: unknown, suffix = '') {
  return `${fmt(energyValueForUnit(kcal, unit))} ${energyUnitLabel(unit)}${suffix}`;
}

export function energyInputFromKcal(kcal: number, unit: unknown) {
  const value = energyValueForUnit(kcal, unit);
  if (!value) return '';
  return String(Number(value.toFixed(energyUnitValue(unit) === 'kj' ? 1 : 0)));
}

export function energyInputToKcal(value: unknown, unit: unknown) {
  const raw = n(value);
  return energyUnitValue(unit) === 'kj' ? raw / 4.184 : raw;
}

export function foodUnitText(food: Partial<Food>) {
  return entryUnitModeValue(food.unitMode) === '100g' ? 'per 100g' : 'per serving';
}

export function mealGroupId(date: string, meal: Meal) {
  return `${date}__${meal}`;
}

export function validBackupReminderDays(value: unknown) {
  return [3, 7, 14].includes(Number(value)) ? Number(value) : 7;
}
