import type { Food, FoodDatabaseRecord } from './types';
import { readValue, saveValue } from './storage';

export type FoodDatabaseItem = FoodDatabaseRecord & {
  sourceKind?: 'builtin' | 'custom';
  customDatabaseId?: string;
  customDatabaseName?: string;
};

export type FoodDatabaseSource = {
  id: string;
  label: string;
  url: string;
};

export type FoodDatabaseLoadResult = {
  items: FoodDatabaseItem[];
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  sourceCount: number;
  fromCache: boolean;
  message?: string;
};

type CachedFoodEstimateDatabase = {
  version: 1;
  updatedAt: string;
  sources: string[];
  items: FoodDatabaseItem[];
};

export const FOOD_ESTIMATE_DATABASE_CACHE_KEY = 'foodEstimateDatabaseCache';

export const FOOD_DATABASE_SOURCES: FoodDatabaseSource[] = [
  {
    id: 'common-food-estimates',
    label: 'Common food estimates',
    url: './commonfooddb/baselinedb.json'
  }
];

let foodDatabasePromise: Promise<FoodDatabaseLoadResult> | null = null;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function generatedSearchText(item: Omit<FoodDatabaseItem, 'searchText'>) {
  return [
    item.name,
    item.brand,
    item.servingLabel,
    item.category,
    ...item.tags
  ].filter(Boolean).join(' ').toLowerCase();
}

function normalizeDatabaseItem(input: unknown): FoodDatabaseItem | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const id = text(raw.id);
  const name = text(raw.name);
  const unitMode: FoodDatabaseItem['unitMode'] | '' = raw.unitMode === '100g' ? '100g' : raw.unitMode === 'serving' ? 'serving' : '';
  const tags = Array.isArray(raw.tags) ? raw.tags.map(tag => text(tag)).filter(Boolean) : null;
  if (!id || !name || !unitMode || !tags) return null;
  if (!isFiniteNumber(raw.calories) || !isFiniteNumber(raw.protein) || !isFiniteNumber(raw.carbs) || !isFiniteNumber(raw.fat)) return null;

  const item = {
    id,
    name,
    brand: text(raw.brand) || undefined,
    unitMode,
    servingLabel: text(raw.servingLabel) || undefined,
    servingGrams: isFiniteNumber(raw.servingGrams) ? raw.servingGrams : undefined,
    calories: raw.calories,
    protein: raw.protein,
    carbs: raw.carbs,
    fat: raw.fat,
    category: text(raw.category) || undefined,
    tags
  };
  return {
    ...item,
    searchText: (text(raw.searchText) || generatedSearchText(item)).toLowerCase()
  };
}

function readRecordList(input: unknown) {
  if (Array.isArray(input)) return input;
  if (input && typeof input === 'object' && Array.isArray((input as { records?: unknown[] }).records)) {
    return (input as { records: unknown[] }).records;
  }
  return [];
}

function combineAndValidate(recordsBySource: unknown[][]): Omit<FoodDatabaseLoadResult, 'fromCache' | 'message'> {
  const seen = new Set<string>();
  const items: FoodDatabaseItem[] = [];
  let invalidCount = 0;
  let duplicateCount = 0;

  recordsBySource.flat().forEach(record => {
    const item = normalizeDatabaseItem(record);
    if (!item) {
      invalidCount += 1;
      return;
    }
    if (seen.has(item.id)) {
      duplicateCount += 1;
      return;
    }
    seen.add(item.id);
    items.push(item);
  });

  if (invalidCount) console.warn(`Food estimate database skipped ${invalidCount} invalid records.`);
  if (duplicateCount) console.warn(`Food estimate database skipped ${duplicateCount} duplicate IDs.`);

  return {
    items,
    validCount: items.length,
    invalidCount,
    duplicateCount,
    sourceCount: recordsBySource.length
  };
}

async function fetchSources(cache: RequestCache) {
  const recordsBySource = await Promise.all(FOOD_DATABASE_SOURCES.map(async source => {
    try {
      const response = await fetch(source.url, { cache });
      if (!response.ok) throw new Error(`${source.label} returned ${response.status}`);
      return readRecordList(await response.json());
    } catch (err) {
      console.warn(`Could not load food estimate source "${source.label}".`, err);
      return [];
    }
  }));
  const loaded = combineAndValidate(recordsBySource);
  if (!loaded.validCount) throw new Error('No valid food estimate records were loaded.');
  return loaded;
}

function validCachedDatabase(value: CachedFoodEstimateDatabase | null): CachedFoodEstimateDatabase | null {
  if (!value || value.version !== 1 || !Array.isArray(value.items)) return null;
  const checked = combineAndValidate([value.items]);
  return checked.validCount ? { ...value, items: checked.items } : null;
}

async function readCachedDatabase() {
  return validCachedDatabase(await readValue<CachedFoodEstimateDatabase>(FOOD_ESTIMATE_DATABASE_CACHE_KEY));
}

async function saveCachedDatabase(items: FoodDatabaseItem[]) {
  await saveValue<CachedFoodEstimateDatabase>(FOOD_ESTIMATE_DATABASE_CACHE_KEY, {
    version: 1,
    updatedAt: new Date().toISOString(),
    sources: FOOD_DATABASE_SOURCES.map(source => source.id),
    items
  });
}

async function loadFoodDatabaseResult() {
  const cached = await readCachedDatabase();
  if (cached) {
    return {
      items: cached.items,
      validCount: cached.items.length,
      invalidCount: 0,
      duplicateCount: 0,
      sourceCount: cached.sources.length,
      fromCache: true
    };
  }

  try {
    const loaded = await fetchSources('default');
    await saveCachedDatabase(loaded.items);
    return { ...loaded, fromCache: false };
  } catch (err) {
    console.warn('Could not load bundled food estimate database.', err);
    return {
      items: [],
      validCount: 0,
      invalidCount: 0,
      duplicateCount: 0,
      sourceCount: FOOD_DATABASE_SOURCES.length,
      fromCache: false,
      message: 'Food estimate database could not be loaded.'
    };
  }
}

export function loadFoodDatabaseWithStatus() {
  foodDatabasePromise ||= loadFoodDatabaseResult();
  return foodDatabasePromise;
}

export async function loadFoodDatabase() {
  return (await loadFoodDatabaseWithStatus()).items;
}

export async function refreshFoodEstimateDatabase() {
  const loaded = await fetchSources('no-store');
  await saveCachedDatabase(loaded.items);
  foodDatabasePromise = Promise.resolve({ ...loaded, fromCache: true });
  return { ...loaded, fromCache: true };
}

export function databaseItemToFood(item: FoodDatabaseItem): Food {
  return {
    id: item.id,
    name: item.name,
    brand: item.brand || undefined,
    unitMode: item.unitMode,
    servingLabel: item.servingLabel,
    servingGrams: item.servingGrams,
    source: item.sourceKind === 'custom' ? 'customFoodDatabase' : 'foodEstimateDatabase',
    sourceId: item.id,
    category: item.category,
    tags: item.tags,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
    favourite: false,
    usageCount: 0,
    lastUsedAt: 0,
    createdAt: 0,
    updatedAt: 0
  };
}
