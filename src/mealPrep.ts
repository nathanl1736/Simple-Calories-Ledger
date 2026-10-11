import type { Batch, BatchIngredient, BatchKind, Entry, Totals } from './types';
import { aboutUserLine, confidenceValue, estimateSourceValue, stringList, type EstimateConfidence } from './aiEstimate';
import { numberValue, parseJsonObject, stringValue } from './aiQuickLog';
import { addDays, fmt, n, normalizeDateKey, toKey } from './utils';

/** A cooked batch drops off this many days after the day it was cooked, even with serves left. */
export const BATCH_SHELF_DAYS = 7;
/** Bought food keeps longer (a tub of ice cream, a box of bars), so it stays this many days. */
export const BOUGHT_SHELF_DAYS = 60;
/** Packs, tubs or meals bought at once. */
export const MAX_PACKS = 12;
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

/** Gemini's reading of one pack of bought food: what's in it and how many serves the label says. */
export type PackEstimate = {
  source: 'label' | 'estimate';
  name: string;
  /** One pack, tub or meal as bought. kcal and grams. */
  perPack: Totals;
  /** The label's servings per package; 1 for a single ready meal. */
  servingsPerPack: number;
  /** What one label serve is, like "1 scoop (70 g)". */
  servingDescription: string;
  /** Grams or mL in one pack. 0 when unknown. */
  packGrams: number;
  assumptions: string[];
  confidence: EstimateConfidence;
  notes: string;
};

/** Gemini structured output (OpenAPI subset). Values are checked again when parsed. */
export const PACK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    source: { type: 'STRING', description: '"label" or "estimate"' },
    name: { type: 'STRING' },
    servingsPerPack: { type: 'NUMBER' },
    servingDescription: { type: 'STRING' },
    servingGrams: { type: 'NUMBER' },
    packGrams: { type: 'NUMBER' },
    perServing: { type: 'OBJECT', properties: NUTRITION, required: ['calories', 'protein', 'carbs', 'fat'] },
    per100g: { type: 'OBJECT', properties: NUTRITION, required: ['calories', 'protein', 'carbs', 'fat'] },
    assumptions: { type: 'ARRAY', items: { type: 'STRING' } },
    confidence: { type: 'STRING', description: '"high", "medium" or "low"' },
    notes: { type: 'STRING' }
  },
  required: ['source', 'name', 'servingsPerPack', 'perServing', 'assumptions', 'confidence'],
  propertyOrdering: ['source', 'name', 'servingsPerPack', 'servingDescription', 'servingGrams', 'packGrams', 'perServing', 'per100g', 'assumptions', 'confidence', 'notes']
};

export const PACK_ESTIMATE_PROMPT = `You read packaged food for Dawni, a calm calorie tracker used in Australia. The user bought food to keep in the fridge, freezer or pantry and eat over several days, a serve at a time: ready meals, a tub of ice cream, a box of protein bars, a big tub of yoghurt. They attach photos of the pack (usually its nutrition information panel, sometimes the front), describe it, or both. Describe ONE pack as bought. Do not multiply by the number of packs: the app does that.

Choose the source:
- "label" when a nutrition information panel is readable in a photo. Read the numbers off the panel; do not estimate them.
- "estimate" otherwise. Use what you know of the Australian product or brand named, or a typical product like it, and say so in assumptions.

Reading Australian labels:
- Panels list energy in kJ, often with Cal or kcal alongside. If only kJ is shown, convert: kcal = kJ / 4.184. Never put a kJ number in a calorie field.
- servingsPerPack: the panel's "Servings per package". A single ready meal is 1. If it says "approx", use its number.
- servingGrams: the panel's "Serving size" in g or mL.
- perServing: the panel's per serving column. If the panel only has a per 100 g column, work out perServing = per100g x servingGrams / 100.
- per100g: the per 100 g (or per 100 mL) column when shown, otherwise all zeros.
- packGrams: the net weight or volume of one pack in g or mL when printed or known, otherwise servingGrams x servingsPerPack, otherwise 0.
- Use the product and brand name from the pack.

Numbers:
- Calories in kcal; protein, carbs and fat in grams.
- Check that perServing protein x 4 + carbs x 4 + fat x 9 is close to its calories (fibre and alcohol aside). For a label, trust the label unless you misread it.

Explain:
- name: short and useful in a food log, with the brand when known, like "Chicken pesto pasta (Muscle Chef)" or "Vanilla ice cream (Connoisseur)".
- servingDescription: what one label serve is, like "1 meal (350 g)" or "1 scoop (70 g)".
- assumptions: short phrases for anything you guessed (the product, the serving size). Empty when everything was read off the label.
- confidence: "high" (read from a label), "medium" (a known product without a readable label), "low" (unclear photo or product).
- notes: one short line on what the pack is.

Reply with only one JSON object, no markdown, in exactly this shape:
{
  "source": "label",
  "name": "",
  "servingsPerPack": 1,
  "servingDescription": "1 meal (350 g)",
  "servingGrams": 0,
  "packGrams": 0,
  "perServing": { "calories": 0, "protein": 0, "carbs": 0, "fat": 0 },
  "per100g": { "calories": 0, "protein": 0, "carbs": 0, "fat": 0 },
  "assumptions": [],
  "confidence": "high",
  "notes": ""
}`;

export function buildPackRequest({
  description,
  photoCount,
  packs,
  preferences,
  previous,
  correction
}: {
  description: string;
  photoCount: number;
  packs: number;
  preferences: string;
  previous?: string;
  correction?: string;
}) {
  const lines = [
    'FRIDGE ITEM REQUEST',
    aboutUserLine(preferences),
    `Packs bought: ${packs} (for context only; describe one pack)`,
    photoCount ? `Photos attached: ${photoCount}` : 'No photos attached',
    `What it is: ${description.trim() || 'see the photos'}`
  ];
  if (previous && correction) {
    lines.push(
      `Previous reading: ${previous}`,
      `Correction from the user: ${correction.trim()}`,
      'Update the reading using the correction. Keep anything the correction does not change.'
    );
  }
  return lines.join('\n');
}

const positive = (value: unknown) => {
  const parsed = numberValue(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/** Scales kcal and grams, rounded the way a batch keeps them. */
function scaleTotals(item: Totals, by: number): Totals {
  return { calories: Math.round(item.calories * by), protein: round1(item.protein * by), carbs: round1(item.carbs * by), fat: round1(item.fat * by) };
}

function rawNutrition(value: unknown): Totals | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  return { calories: positive(raw.calories), protein: positive(raw.protein), carbs: positive(raw.carbs), fat: positive(raw.fat) };
}

/**
 * Reads Gemini's reading of one pack. One pack is a label serve times the servings per package,
 * or the per 100 g column times the pack's weight when there's no serve column. Null when unreadable.
 */
export function parsePackEstimate(text: string): PackEstimate | null {
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
  const servingsPerPack = positive(raw.servingsPerPack) || 1;
  const servingGrams = positive(raw.servingGrams);
  // The serve size beats the net amount: a tub's net is often in mL (1 L) while its serve is in grams.
  const packGrams = servingGrams > 0 ? servingGrams * servingsPerPack : positive(raw.packGrams);
  const perServing = rawNutrition(raw.perServing);
  const per100g = rawNutrition(raw.per100g);
  const net = positive(raw.packGrams) || packGrams;
  const perPack = perServing && perServing.calories > 0
    ? scaleTotals(perServing, servingsPerPack)
    : per100g && per100g.calories > 0 && net > 0
      ? scaleTotals(per100g, net / 100)
      : null;
  if (!perPack || perPack.calories <= 0) return null;
  return {
    source: stringValue(raw.source).toLowerCase() === 'label' ? 'label' : 'estimate',
    name,
    perPack,
    servingsPerPack,
    servingDescription: stringValue(raw.servingDescription),
    packGrams: Math.round(packGrams),
    assumptions: stringList(raw.assumptions, 8),
    confidence: confidenceValue(raw.confidence),
    notes: stringValue(raw.notes)
  };
}

export function packsValue(value: unknown) {
  return Math.min(MAX_PACKS, Math.max(1, Math.round(n(value)) || 1));
}

/** Everything bought, split into the label's serves: two single meals are 2 serves, a tub of 8 serves is 8. */
export function packBatch(estimate: Pick<PackEstimate, 'perPack' | 'servingsPerPack' | 'packGrams'>, packs: number) {
  const count = packsValue(packs);
  return {
    total: scaleTotals(estimate.perPack, count),
    servings: servingsValue(Math.max(1, Math.round(estimate.servingsPerPack * count))),
    grams: Math.round(estimate.packGrams * count)
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

export function batchKindValue(value: unknown): BatchKind {
  return value === 'bought' ? 'bought' : 'cooked';
}

/** How long it stays on Today: a week for home cooking, longer for bought food. */
export function batchShelfDays(batch: { kind?: BatchKind }) {
  return batchKindValue(batch.kind) === 'bought' ? BOUGHT_SHELF_DAYS : BATCH_SHELF_DAYS;
}

/** The last day a batch shows on Today. */
export function batchLastDay(batch: Pick<Batch, 'cookedOn'> & { kind?: BatchKind }) {
  return addDays(batch.cookedOn, batchShelfDays(batch));
}

/** Grams (or mL) in one serve, when the label gave the weight. 0 when unknown. */
export function serveGrams(batch: Pick<Batch, 'servings'> & { grams?: number }) {
  const grams = n(batch.grams);
  return grams > 0 ? Math.round(grams / Math.max(1, batch.servings)) : 0;
}

/** The note a logged serve carries, so the entry says where it came from. */
export function serveNote(batch: Pick<Batch, 'servings'> & { kind?: BatchKind }) {
  return batchKindValue(batch.kind) === 'bought'
    ? `From the fridge: a serve of ${fmt(batch.servings)}.`
    : `Meal prep: a serve of a batch of ${fmt(batch.servings)}.`;
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

/** Keeps every batch on the go and the last few finished ones, so the fridge never piles up. */
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
    // Batches from before 3.1 were all home cooking.
    kind: batchKindValue(raw.kind),
    recipe: typeof raw.recipe === 'string' ? raw.recipe : '',
    servings: servingsValue(raw.servings),
    total,
    grams: Math.round(positive(raw.grams)),
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
