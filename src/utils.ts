import type { AppState, DailyGoalSnapshot, EnergyUnit, Entry, Food, Meal, Settings, Totals } from './types';

export const MEALS: Meal[] = ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Drink'];

export const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);

export const n = (value: unknown) => Number(value) || 0;
export const fmt = (value: unknown) => Number.isFinite(Number(value)) ? Math.round(Number(value)).toLocaleString() : String(value);
export const signed = (value: number) => `${value > 0 ? '+' : ''}${fmt(value)}`;

export function toKey(date: Date | string | number) {
  const z = new Date(date);
  z.setMinutes(z.getMinutes() - z.getTimezoneOffset());
  return z.toISOString().slice(0, 10);
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
  const completedDates = state.completedDates.map(normalizeDateKey).filter(Boolean);
  return {
    ...state,
    completedDates: on ? [...new Set([...completedDates, date])] : completedDates.filter(item => item !== date)
  };
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
  if (!date || date >= today) return goalSnapshotFromSettings(state.settings);
  return state.dailyGoals?.[date] || goalSnapshotFromSettings(state.settings);
}

export function datesWithRecords(state: AppState) {
  return [...new Set([
    ...state.entries.map(entry => normalizeDateKey(entry.date)).filter(Boolean),
    ...state.completedDates.map(normalizeDateKey).filter(Boolean)
  ])].sort();
}

export function lockPastGoals(state: AppState, today = todayKey(), goal = goalSnapshotFromSettings(state.settings)): AppState {
  const dailyGoals = { ...(state.dailyGoals || {}) };
  datesWithRecords(state).forEach(date => {
    if (date < today && !dailyGoals[date]) dailyGoals[date] = goal;
  });
  return { ...state, dailyGoals };
}

export function energyUnitValue(value: unknown): EnergyUnit {
  return value === 'kj' ? 'kj' : 'kcal';
}

export function energyUnitLabel(unit: unknown) {
  return energyUnitValue(unit) === 'kj' ? 'kJ' : 'kCal';
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
