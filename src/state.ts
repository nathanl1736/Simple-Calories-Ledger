import type { AppState, Entry, Food, Settings } from './types';
import { normalizeCustomFoodDatabases } from './customFoodDatabases';
import { estimateSourceValue } from './aiEstimate';
import { normalizeBatch } from './mealPrep';
import { dayPartValue } from './tidelight';
import { energyUnitValue, entryTotals, entryUnitModeValue, goalSnapshotFromSettings, lockPastGoals, n, normalizeDateKey, normalizeGoalSnapshot, portionValue, validBackupReminderDays } from './utils';

export const DEFAULT: AppState = {
  settings: {
    calories: 1800,
    protein: 150,
    carbs: 90,
    fat: 50,
    accent: '#0E7C76',
    theme: 'light',
    trackingMode: 'Cutting',
    energyUnit: 'kcal',
    lastBackupAt: null,
    lastBackupMeta: null,
    lastBackupReminderShownAt: null,
    backupReminderDays: 7,
    geminiApiKey: '',
    aiPreferences: '',
    spreadWeeklyBank: false
  },
  entries: [],
  foods: [],
  completedDates: [],
  dayEstimates: {},
  dailyGoals: {},
  dayCalorieOverrides: {},
  customFoodDatabases: [],
  batches: []
};

export function normalizeEntry(input: Partial<Entry>): Entry {
  const entry = { ...input } as Entry;
  const mode = entryUnitModeValue(entry.unitMode);
  const portion = portionValue(entry.portion);
  const multiplier = mode === '100g' ? portion / 100 : portion;
  (['calories', 'protein', 'carbs', 'fat'] as const).forEach(key => {
    const prop = `base${key[0].toUpperCase()}${key.slice(1)}` as keyof Entry;
    if (entry[prop] == null) {
      (entry as Record<string, unknown>)[prop] = multiplier !== 1 && entry[key] != null ? n(entry[key]) / multiplier : n(entry[key]);
    }
  });
  entry.unitMode = mode;
  entry.portion = portion;
  Object.assign(entry, entryTotals(entry));
  entry.sourceFoodId = entry.sourceFoodId || null;
  entry.estimateSource = estimateSourceValue(entry.estimateSource);
  entry.photo = entry.photo || null;
  entry.meal = entry.meal || 'Snack';
  const part = dayPartValue(entry.part);
  if (part) entry.part = part;
  else delete entry.part;
  if (typeof entry.batchId !== 'string' || !entry.batchId) delete entry.batchId;
  entry.createdAt = entry.createdAt || Date.now();
  entry.updatedAt = entry.updatedAt || entry.createdAt;
  return entry;
}

export function normalizeFood(input: Partial<Food>): Food {
  return {
    id: String(input.id || crypto.randomUUID()),
    name: String(input.name || 'Food'),
    unitMode: entryUnitModeValue(input.unitMode),
    brand: input.brand ? String(input.brand) : undefined,
    servingLabel: input.servingLabel ? String(input.servingLabel) : undefined,
    servingGrams: n(input.servingGrams) || undefined,
    source: input.source ? String(input.source) : undefined,
    sourceId: input.sourceId ? String(input.sourceId) : undefined,
    category: input.category ? String(input.category) : undefined,
    tags: Array.isArray(input.tags) ? input.tags.map(String) : undefined,
    calories: n(input.calories),
    protein: n(input.protein),
    carbs: n(input.carbs),
    fat: n(input.fat),
    estimateSource: estimateSourceValue(input.estimateSource) || undefined,
    favourite: !!input.favourite,
    usageCount: n(input.usageCount),
    lastUsedAt: n(input.lastUsedAt),
    createdAt: n(input.createdAt) || Date.now(),
    updatedAt: n(input.updatedAt) || Date.now()
  };
}

export function normalizeStateShape(input: unknown): AppState {
  const raw = (input && typeof input === 'object') ? input as Partial<AppState> : {};
  const settings = { ...DEFAULT.settings, ...(raw.settings || {}) } as Settings;
  settings.energyUnit = energyUnitValue(settings.energyUnit);
  settings.backupReminderDays = validBackupReminderDays(settings.backupReminderDays);
  settings.geminiApiKey = typeof settings.geminiApiKey === 'string' ? settings.geminiApiKey : '';
  settings.aiPreferences = typeof settings.aiPreferences === 'string' ? settings.aiPreferences.slice(0, 500) : '';
  settings.spreadWeeklyBank = !!settings.spreadWeeklyBank;
  if (!['system', 'dark', 'light'].includes(settings.theme)) settings.theme = DEFAULT.settings.theme;
  // Earlier preset accents move to their Tidelight counterparts (2.7); a colour picked by hand stays.
  const RETIRED_ACCENTS: Record<string, string> = { '#efad7c': '#A04E1E', '#ccb7f6': '#7A5AA6', '#c9dc86': '#0E7C76', '#a8c9d8': '#2B58B1', '#dec77f': '#A04E1E', '#dc9b8e': '#A04E1E', '#c6b3df': '#7A5AA6' };
  const retired = RETIRED_ACCENTS[String(settings.accent).toLowerCase()];
  if (retired) settings.accent = retired;
  if (settings.calories === 2000 && settings.protein === 150 && settings.carbs === 200 && settings.fat === 65) {
    settings.calories = 1800;
    settings.carbs = 90;
    settings.fat = 50;
  }
  const next: AppState = {
    settings,
    entries: Array.isArray(raw.entries) ? raw.entries.map(entry => normalizeEntry(entry)) : [],
    foods: Array.isArray(raw.foods) ? raw.foods.map(food => normalizeFood(food)) : [],
    completedDates: Array.isArray(raw.completedDates) ? raw.completedDates.map(String) : [],
    dayEstimates: {},
    dailyGoals: {},
    dayCalorieOverrides: {},
    customFoodDatabases: normalizeCustomFoodDatabases((raw as { customFoodDatabases?: unknown }).customFoodDatabases),
    batches: (Array.isArray(raw.batches) ? raw.batches : []).map(normalizeBatch).filter((batch): batch is NonNullable<typeof batch> => !!batch)
  };
  const rawDailyGoals = raw.dailyGoals && typeof raw.dailyGoals === 'object' ? raw.dailyGoals : {};
  Object.entries(rawDailyGoals).forEach(([key, value]) => {
    const date = normalizeDateKey(key);
    if (date) next.dailyGoals[date] = normalizeGoalSnapshot(value as Partial<Settings>, settings);
  });
  const rawEstimates = (raw as { dayEstimates?: unknown }).dayEstimates;
  if (rawEstimates && typeof rawEstimates === 'object') {
    Object.entries(rawEstimates as Record<string, unknown>).forEach(([key, value]) => {
      const date = normalizeDateKey(key);
      const kcal = Number(value);
      if (date && Number.isFinite(kcal)) next.dayEstimates[date] = Math.round(Math.min(10000, Math.max(-5000, kcal)));
    });
  }
  const rawOverrides = (raw as { dayCalorieOverrides?: unknown }).dayCalorieOverrides;
  if (rawOverrides && typeof rawOverrides === 'object') {
    Object.entries(rawOverrides as Record<string, unknown>).forEach(([key, value]) => {
      const date = normalizeDateKey(key);
      const kcal = n(value);
      if (date && kcal > 0) next.dayCalorieOverrides[date] = Math.round(kcal);
    });
  }
  return lockPastGoals(next, undefined, goalSnapshotFromSettings(settings));
}
