import type { Batch, BatchIngredient, Entry, Totals } from './types';
import { aboutUserLine, confidenceValue, estimateSourceValue, stringList, type EstimateConfidence } from './aiEstimate';
import { numberValue, parseJsonObject, stringValue } from './aiQuickLog';
import { addDays, n, normalizeDateKey, toKey } from './utils';

/** A batch drops off this many days after the day it was cooked, even with serves left. */
export const BATCH_SHELF_DAYS = 7;
/** Finished batches kept for Cook again. */
export const KEEP_FINISHED_BATCHES = 5;
export const MAX_BATCH_SERVINGS = 30;
export const DEFAULT_BATCH_SERVINGS = 4;

/** Gemini's estimate of a whole batch, ingredient by ingredient. */
export type BatchEstimate = {
  name: string;
  ingredients: BatchIngredient[];
  /** The whole batch: always the sum of the ingredients when there are any. */
  total: Totals;
  assumptions: string[];
  confidence: EstimateConfidence;
  notes: string;
};

export type BatchState = 'active' | 'eaten' | 'finished' | 'expired';

const NUTRITION = {
  calories: { type: 'NUMBER' },
  protein: { type: 'NUMBER' },
  carbs: { type: 'NUMBER' },
  fat: { type: 'NUMBER' }
};

/** Gemini structured output (OpenAPI subset). Values are checked again when parsed. */
export const BATCH_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    ingredients: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, amount: { type: 'STRING' }, ...NUTRITION },
        required: ['name', 'amount', 'calories', 'protein', 'carbs', 'fat'],
        propertyOrdering: ['name', 'amount', 'calories', 'protein', 'carbs', 'fat']
      }
    },
    total: { type: 'OBJECT', properties: NUTRITION, required: ['calories', 'protein', 'carbs', 'fat'] },
    assumptions: { type: 'ARRAY', items: { type: 'STRING' } },
    confidence: { type: 'STRING', description: '"high", "medium" or "low"' },
    notes: { type: 'STRING' }
  },
  required: ['name', 'ingredients', 'total', 'assumptions', 'confidence'],
  propertyOrdering: ['name', 'ingredients', 'total', 'assumptions', 'confidence', 'notes']
};

export const BATCH_ESTIMATE_PROMPT = `You estimate meal prep for Dawni, a calm calorie tracker used in Australia. The user cooked one batch of food to split into several serves and lists what went into it. Estimate the whole batch, ingredient by ingredient. Do not divide by the number of serves: the app does that.

Ingredients:
- One line per ingredient the user lists, in their order, with the amount used in the whole batch. Count cooking oil, butter, sauces, stock, cheese and toppings when they are listed.
- Count only what the user lists. If the dish is normally cooked with oil and none is listed, don't add it; say "no cooking oil listed" in assumptions.
- If an ingredient has no amount, assume a typical amount for a batch this size and say so in assumptions.
- Weights are as bought unless the user says cooked: "500 g rice" is uncooked rice and "1 kg beef mince" is raw mince. Use cooked values only when they say cooked.
- Don't take off fat drained from mince unless the user says they drained it.
- Australian products: beef mince with no grade is regular mince (about 15 to 20% fat); lean, 3 star, 4 star, 5 star or extra lean mince has less. Use the Australian version of any product or brand the user names.
- Leave out anything cooked with but not eaten, like water for boiling or a marinade that was thrown away.

Numbers:
- Each ingredient: calories in kcal, and protein, carbs and fat in grams, for the amount in the whole batch.
- Check each ingredient's protein x 4 + carbs x 4 + fat x 9 is close to its calories (fibre and alcohol aside), and fix inconsistent numbers before replying.
- total = the sum of the ingredients.

Explain:
- name: a short name for one serve in a food log, like "Beef mince rice bowl" or "Chicken curry with rice".
- assumptions: short phrases for anything you guessed (a missing amount, the mince grade, raw or cooked). Empty when nothing was guessed.
- confidence: "high" (exact amounts and clear products), "medium" (typical products or one or two guessed amounts), "low" (several missing amounts or unclear ingredients).
- notes: one short line on what the batch is.

Reply with only one JSON object, no markdown, in exactly this shape:
{
  "name": "",
  "ingredients": [
    { "name": "White rice, uncooked", "amount": "500 g", "calories": 0, "protein": 0, "carbs": 0, "fat": 0 }
  ],
  "total": { "calories": 0, "protein": 0, "carbs": 0, "fat": 0 },
  "assumptions": [],
  "confidence": "medium",
  "notes": ""
}`;

export function buildBatchRequest({
  recipe,
  servings,
  preferences,
  previous,
  correction
}: {
  recipe: string;
  servings: number;
  preferences: string;
  previous?: string;
  correction?: string;
}) {
  const lines = [
    'BATCH ESTIMATE REQUEST',
    aboutUserLine(preferences),
    `Serves it will be split into: ${servings} (for context only; return the whole batch)`,
    `What went in:\n${recipe.trim()}`
  ];
  if (previous && correction) {
    lines.push(
      `Previous estimate: ${previous}`,
      `Correction from the user: ${correction.trim()}`,
      'Update the estimate using the correction. Keep anything the correction does not change.'
    );
  }
  return lines.join('\n');
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const grams = (value: unknown) => {
  const parsed = numberValue(value);
  return Number.isFinite(parsed) && parsed > 0 ? round1(parsed) : 0;
};
const kcal = (value: unknown) => {
  const parsed = numberValue(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
};

function nutritionOf(raw: Record<string, unknown>): Totals {
  return { calories: kcal(raw.calories), protein: grams(raw.protein), carbs: grams(raw.carbs), fat: grams(raw.fat) };
}

export function sumTotals(items: Totals[]): Totals {
  return items.reduce<Totals>((acc, item) => ({
    calories: acc.calories + item.calories,
    protein: round1(acc.protein + item.protein),
    carbs: round1(acc.carbs + item.carbs),
    fat: round1(acc.fat + item.fat)
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

function ingredientList(value: unknown): BatchIngredient[] {
  return (Array.isArray(value) ? value : [])
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    .map(item => ({ name: stringValue(item.name), amount: stringValue(item.amount), ...nutritionOf(item) }))
    .filter(item => item.name)
    .slice(0, 40);
}

/**
 * Reads Gemini's batch estimate. The total is worked out from the ingredients, so the
 * breakdown the user sees always adds up to what gets split into serves. Null when unreadable.
 */
export function parseBatchEstimate(text: string): BatchEstimate | null {
  let parsed: unknown;
  try {
    parsed = parseJsonObject(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  const name = stringValue(raw.name);
  if (!name) return null;
  const ingredients = ingredientList(raw.ingredients);
  const fromIngredients = sumTotals(ingredients);
  const stated = raw.total && typeof raw.total === 'object' && !Array.isArray(raw.total) ? nutritionOf(raw.total as Record<string, unknown>) : null;
  const total = fromIngredients.calories > 0 ? fromIngredients : stated;
  if (!total || total.calories <= 0) return null;
  return {
    name,
    ingredients,
    total,
    assumptions: stringList(raw.assumptions, 8),
    confidence: confidenceValue(raw.confidence),
    notes: stringValue(raw.notes)
  };
}

export function servingsValue(value: unknown) {
  const whole = Math.round(n(value));
  return Math.min(MAX_BATCH_SERVINGS, Math.max(1, whole || DEFAULT_BATCH_SERVINGS));
}

/** One serve of a batch. */
export function batchServe(batch: Pick<Batch, 'total' | 'servings'>): Totals {
  const servings = Math.max(1, batch.servings);
  return {
    calories: batch.total.calories / servings,
    protein: batch.total.protein / servings,
    carbs: batch.total.carbs / servings,
    fat: batch.total.fat / servings
  };
}

/** Serves logged from a batch, on any day. An entry switched to per 100 g counts as one serve. */
export function batchServesUsed(batch: Pick<Batch, 'id'>, entries: Entry[]) {
  return entries.reduce((acc, entry) => {
    if (entry.batchId !== batch.id) return acc;
    return acc + (entry.unitMode === '100g' ? 1 : n(entry.portion) || 1);
  }, 0);
}

export function batchServesLeft(batch: Pick<Batch, 'id' | 'servings'>, entries: Entry[]) {
  // Rounded so 1.5 + 2.5 of 4 reads as none left rather than a float's dust.
  return Math.max(0, Math.round((batch.servings - batchServesUsed(batch, entries)) * 100) / 100);
}

/** The last day a batch shows on Today. */
export function batchLastDay(batch: Pick<Batch, 'cookedOn'>) {
  return addDays(batch.cookedOn, BATCH_SHELF_DAYS);
}

export function batchState(batch: Batch, entries: Entry[], today: string): BatchState {
  if (batch.finishedAt) return 'finished';
  if (batchServesLeft(batch, entries) <= 0) return 'eaten';
  if (today > batchLastDay(batch)) return 'expired';
  return 'active';
}

/** Batches with serves left, oldest first so it gets eaten first. */
export function activeBatches(batches: Batch[], entries: Entry[], today: string) {
  return batches
    .filter(batch => batchState(batch, entries, today) === 'active')
    .sort((a, b) => a.cookedOn.localeCompare(b.cookedOn) || a.createdAt - b.createdAt);
}

/** Batches that are done, newest first, for Cook again. */
export function finishedBatches(batches: Batch[], entries: Entry[], today: string, limit = KEEP_FINISHED_BATCHES) {
  return batches
    .filter(batch => batchState(batch, entries, today) !== 'active')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

/** Keeps every batch on the go and the last few finished ones, so meal prep never piles up. */
export function pruneBatches(batches: Batch[], entries: Entry[], today: string, keep = KEEP_FINISHED_BATCHES) {
  const kept = new Set(finishedBatches(batches, entries, today, keep).map(batch => batch.id));
  return batches.filter(batch => kept.has(batch.id) || batchState(batch, entries, today) === 'active');
}

export function normalizeBatch(input: unknown): Batch | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const id = stringValue(raw.id);
  const name = stringValue(raw.name);
  if (!id || !name) return null;
  const total = raw.total && typeof raw.total === 'object' && !Array.isArray(raw.total) ? nutritionOf(raw.total as Record<string, unknown>) : null;
  if (!total) return null;
  const createdAt = n(raw.createdAt) || Date.now();
  const confidence = stringValue(raw.confidence) ? confidenceValue(raw.confidence) : null;
  return {
    id,
    name,
    recipe: typeof raw.recipe === 'string' ? raw.recipe : '',
    servings: servingsValue(raw.servings),
    total,
    ingredients: ingredientList(raw.ingredients),
    estimateSource: estimateSourceValue(raw.estimateSource),
    assumptions: stringList(raw.assumptions, 8),
    confidence,
    cookedOn: normalizeDateKey(raw.cookedOn) || toKey(createdAt),
    finishedAt: n(raw.finishedAt) || null,
    createdAt,
    updatedAt: n(raw.updatedAt) || createdAt
  };
}
