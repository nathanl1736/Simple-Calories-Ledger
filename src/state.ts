import type { AppState, Entry, Food, Settings } from './types';
import { normalizeCustomFoodDatabases } from './customFoodDatabases';
import { energyUnitValue, entryTotals, entryUnitModeValue, goalSnapshotFromSettings, lockPastGoals, n, normalizeDateKey, normalizeGoalSnapshot, portionValue, validBackupReminderDays } from './utils';

export const DEFAULT: AppState = {
  settings: {
    calories: 1800,
    protein: 150,
    carbs: 90,
    fat: 50,
    accent: '#c9dc86',
    theme: 'light',
    trackingMode: 'Cutting',
    energyUnit: 'kcal',
    lastBackupAt: null,
    lastBackupMeta: null,
    lastBackupReminderShownAt: null,
    backupReminderDays: 7,
    geminiApiKey: ''
  },
  entries: [],
  foods: [],
  completedDates: [],
  dailyGoals: {},
  customFoodDatabases: []
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
  entry.photo = entry.photo || null;
  entry.meal = entry.meal || 'Snack';
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
  if (!['system', 'dark', 'light'].includes(settings.theme)) settings.theme = DEFAULT.settings.theme;
  if (settings.accent === '#efad7c' || settings.accent === '#ccb7f6') settings.accent = '#c9dc86';
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
    dailyGoals: {},
    customFoodDatabases: normalizeCustomFoodDatabases((raw as { customFoodDatabases?: unknown }).customFoodDatabases)
  };
  const rawDailyGoals = raw.dailyGoals && typeof raw.dailyGoals === 'object' ? raw.dailyGoals : {};
  Object.entries(rawDailyGoals).forEach(([key, value]) => {
    const date = normalizeDateKey(key);
    if (date) next.dailyGoals[date] = normalizeGoalSnapshot(value as Partial<Settings>, settings);
  });
  return lockPastGoals(next, undefined, goalSnapshotFromSettings(settings));
}
