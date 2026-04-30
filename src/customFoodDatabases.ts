import type { CustomFoodDatabase, FoodDatabaseRecord } from './types';
import type { FoodDatabaseItem } from './foodDatabase';

type ImportedDatabaseResult = {
  database: CustomFoodDatabase;
  skippedCount: number;
  duplicateCount: number;
};

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

function slug(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'custom-food-database';
}

function fileBaseName(fileName: string) {
  return (fileName.split(/[\\/]/).pop() || 'custom-food-database').replace(/\.[^.]+$/, '');
}

function titleFromFileName(fileName: string) {
  return fileBaseName(fileName)
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, letter => letter.toUpperCase()) || 'Custom Food Database';
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : NaN;
  }
  return NaN;
}

function generatedSearchText(item: Omit<FoodDatabaseRecord, 'searchText'>) {
  return [
    item.name,
    item.brand,
    item.category,
    ...item.tags
  ].filter(Boolean).join(' ').toLowerCase();
}

export function normalizeCustomFoodDatabaseItem(input: unknown): FoodDatabaseRecord | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const id = text(raw.id);
  const name = text(raw.name);
  const unitMode: FoodDatabaseRecord['unitMode'] | '' = raw.unitMode === '100g' ? '100g' : raw.unitMode === 'serving' ? 'serving' : '';
  const calories = numberValue(raw.calories);
  const protein = numberValue(raw.protein);
  const carbs = numberValue(raw.carbs);
  const fat = numberValue(raw.fat);
  if (!id || !name || !unitMode || !Number.isFinite(calories) || !Number.isFinite(protein) || !Number.isFinite(carbs) || !Number.isFinite(fat)) return null;

  const tags = Array.isArray(raw.tags) ? raw.tags.map(tag => text(tag)).filter(Boolean) : [];
  const servingGrams = numberValue(raw.servingGrams);
  const item = {
    id,
    name,
    brand: text(raw.brand) || undefined,
    unitMode,
    servingLabel: text(raw.servingLabel) || undefined,
    servingGrams: Number.isFinite(servingGrams) && servingGrams > 0 ? servingGrams : undefined,
    calories,
    protein,
    carbs,
    fat,
    category: text(raw.category) || undefined,
    tags
  };
  return {
    ...item,
    searchText: text(raw.searchText) || generatedSearchText(item)
  };
}

function normalizeItemList(items: unknown[]) {
  const seen = new Set<string>();
  const valid: FoodDatabaseRecord[] = [];
  let skippedCount = 0;
  let duplicateCount = 0;
  items.forEach(record => {
    const item = normalizeCustomFoodDatabaseItem(record);
    if (!item) {
      skippedCount += 1;
      return;
    }
    if (seen.has(item.id)) {
      duplicateCount += 1;
      return;
    }
    seen.add(item.id);
    valid.push(item);
  });
  return { valid, skippedCount, duplicateCount };
}

export function parseCustomFoodDatabaseText(textContent: string, fileName: string, importedAt = new Date().toISOString()): ImportedDatabaseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(textContent);
  } catch {
    throw new Error('That file is not valid JSON.');
  }

  const baseName = fileBaseName(fileName);
  let id = slug(baseName);
  let name = titleFromFileName(fileName);
  let version = '1.0.0';
  let records: unknown[] | null = null;

  if (Array.isArray(parsed)) {
    records = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const raw = parsed as Record<string, unknown>;
    if (Array.isArray(raw.items)) {
      records = raw.items;
      id = slug(text(raw.id) || text(raw.name) || baseName);
      name = text(raw.name) || titleFromFileName(fileName);
      version = text(raw.version) || '1.0.0';
    }
  }

  if (!records) {
    throw new Error('Expected a database object with an items array, or an array of food items.');
  }

  const { valid, skippedCount, duplicateCount } = normalizeItemList(records);
  if (!valid.length) {
    throw new Error('No valid food items were found in that database.');
  }

  return {
    database: {
      id,
      name,
      version,
      importedAt,
      enabled: true,
      itemCount: valid.length,
      items: valid
    },
    skippedCount,
    duplicateCount
  };
}

export function normalizeCustomFoodDatabases(value: unknown): CustomFoodDatabase[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap(record => {
    if (!record || typeof record !== 'object') return [];
    const raw = record as Partial<CustomFoodDatabase>;
    const id = slug(text(raw.id));
    if (!id || seen.has(id)) return [];
    const items = normalizeItemList(Array.isArray(raw.items) ? raw.items : []).valid;
    if (!items.length) return [];
    seen.add(id);
    return [{
      id,
      name: text(raw.name) || titleFromFileName(id),
      version: text(raw.version) || '1.0.0',
      importedAt: text(raw.importedAt) || new Date().toISOString(),
      enabled: raw.enabled !== false,
      itemCount: items.length,
      items
    }];
  });
}

export function flattenEnabledCustomDatabaseItems(databases: CustomFoodDatabase[]): FoodDatabaseItem[] {
  return databases
    .filter(database => database.enabled)
    .flatMap(database => database.items.map(item => ({
      ...item,
      id: `custom:${database.id}:${item.id}`,
      sourceKind: 'custom' as const,
      customDatabaseId: database.id,
      customDatabaseName: database.name
    })));
}

export function customFoodItemCount(databases: CustomFoodDatabase[]) {
  return databases.reduce((total, database) => total + database.itemCount, 0);
}
