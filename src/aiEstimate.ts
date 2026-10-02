import type { EntryEstimateSource, Meal, Totals } from './types';
import { amountPortionValue, numberValue, parseAiQuickLog, parseJsonObject, stringValue } from './aiQuickLog';
import { MEALS } from './utils';

export const MAX_ESTIMATE_PHOTOS = 3;

export type EstimateConfidence = 'high' | 'medium' | 'low';

/** Gemini's estimate, already converted into the shape a log entry uses. */
export type GeminiEstimate = {
  source: 'label' | 'estimate';
  name: string;
  meal: Meal;
  unitMode: 'serving' | '100g';
  /** Servings eaten, or grams eaten in 100g mode. */
  portion: number;
  /** Per serving, or per 100 g in 100g mode. kcal and grams. */
  base: Totals;
  servingLabel: string;
  assumptions: string[];
  confidence: EstimateConfidence;
  notes: string;
};

const NUTRITION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    calories: { type: 'NUMBER' },
    protein: { type: 'NUMBER' },
    carbs: { type: 'NUMBER' },
    fat: { type: 'NUMBER' }
  },
  required: ['calories', 'protein', 'carbs', 'fat']
};

/** Gemini structured output (OpenAPI subset). Values are checked again when parsed. */
export const ESTIMATE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    source: { type: 'STRING', description: '"label" or "estimate"' },
    name: { type: 'STRING' },
    meal: { type: 'STRING', description: 'Breakfast, Lunch, Dinner, Snack or Drink' },
    servingsEaten: { type: 'NUMBER' },
    servingDescription: { type: 'STRING' },
    gramsEaten: { type: 'NUMBER' },
    total: NUTRITION_SCHEMA,
    per100g: NUTRITION_SCHEMA,
    assumptions: { type: 'ARRAY', items: { type: 'STRING' } },
    confidence: { type: 'STRING', description: '"high", "medium" or "low"' },
    notes: { type: 'STRING' }
  },
  required: ['source', 'name', 'meal', 'servingsEaten', 'total', 'assumptions', 'confidence']
};

export const GEMINI_ESTIMATE_PROMPT = `You estimate food for Dawni, a calm calorie tracker used in Australia. The user describes what they ate, attaches photos (a meal, a product, or a nutrition information panel), or both. Return one combined log entry for everything they ate.

Choose the source:
- "label" when a nutrition information panel or printed nutrition values are readable in a photo. Read the numbers off the panel; do not estimate them.
- "estimate" otherwise.

Reading Australian labels:
- Australian panels list energy in kJ, often with Cal or kcal alongside. If only kJ is shown, convert: kcal = kJ / 4.184. Never put a kJ number in a calorie field.
- Panels have a "per serving" column and a "per 100 g" (or per 100 mL) column. Fill per100g from the per-100 column, and read the serving size.
- If the user says how much they ate in grams or mL, set gramsEaten. If they say serves or packs, set servingsEaten to match. If they say nothing, assume one label serving (or the whole item when it is clearly single-serve, like a yoghurt tub) and say so in assumptions.
- Use the product and brand name from the pack.

Estimating meals:
- Use typical Australian portion sizes and recipes. Count cooking oil, butter, sauces, dressings and sides that are shown or mentioned; if unsure, include a typical amount and say so.
- Ingredients and amounts the user gives beat visual guesses.
- If a printed energy figure for the item is visible (for example on a menu board), use it.

Numbers:
- total = calories and macros for everything eaten in this entry, all servings combined. Calories in kcal, macros in grams.
- servingsEaten = how many identical servings the total covers (2 for two drinks, 1 for a single plate).
- gramsEaten = grams or mL eaten when known, otherwise 0.
- per100g = per-100 g values when you have them (always for labels), otherwise all zeros.
- Check that protein x 4 + carbs x 4 + fat x 9 is close to calories (alcohol and fibre aside), and fix inconsistent numbers before replying.

Explain:
- assumptions: short phrases for anything you guessed (portion size, oil, brand, cooking method). Empty when nothing was guessed.
- confidence: "high" (read from a label, or exact amounts given), "medium" (clear photo or description with a typical portion), "low" (unclear photo, unknown portion or recipe).
- meal: Breakfast, Lunch, Dinner, Snack or Drink. Use the meal in the request unless the food clearly says otherwise.
- name: short and useful for a food log. notes: one short line on what is included.

Reply with only one JSON object, no markdown, in exactly this shape:
{
  "source": "estimate",
  "name": "",
  "meal": "Lunch",
  "servingsEaten": 1,
  "servingDescription": "1 bowl",
  "gramsEaten": 0,
  "total": { "calories": 0, "protein": 0, "carbs": 0, "fat": 0 },
  "per100g": { "calories": 0, "protein": 0, "carbs": 0, "fat": 0 },
  "assumptions": [],
  "confidence": "medium",
  "notes": ""
}`;

/** Appended when a reply could not be read, before giving up. */
export const JSON_RETRY_NOTE = 'Your previous reply could not be read. Reply again with only the JSON object in the exact shape described, with no other text.';

export function aboutUserLine(preferences: string) {
  const trimmed = preferences.trim();
  return `About the user: ${trimmed || 'nothing saved'}`;
}

export function buildEstimateRequest({
  description,
  photoCount,
  meal,
  preferences,
  previous,
  correction,
  now = new Date()
}: {
  description: string;
  photoCount: number;
  meal: Meal;
  preferences: string;
  previous?: string;
  correction?: string;
  now?: Date;
}) {
  const lines = [
    'ESTIMATE REQUEST',
    `Local time: ${now.toLocaleString('en-AU', { weekday: 'long', hour: 'numeric', minute: '2-digit' })}`,
    `Meal: ${meal}`,
    aboutUserLine(preferences),
    `Photos attached: ${photoCount}`,
    `What they ate: ${description.trim() || 'not described, use the photos'}`
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

function nutrition(input: unknown): Totals | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const calories = numberValue(raw.calories);
  if (!Number.isFinite(calories) || calories < 0) return null;
  const grams = (value: unknown) => {
    const parsed = numberValue(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 10) / 10 : 0;
  };
  return { calories: Math.round(calories), protein: grams(raw.protein), carbs: grams(raw.carbs), fat: grams(raw.fat) };
}

const divide = (totals: Totals, by: number): Totals => ({
  calories: totals.calories / by,
  protein: totals.protein / by,
  carbs: totals.carbs / by,
  fat: totals.fat / by
});

function mealValue(value: unknown, fallback: Meal): Meal {
  const raw = stringValue(value).toLowerCase();
  return MEALS.find(meal => meal.toLowerCase() === raw) || fallback;
}

export function confidenceValue(value: unknown): EstimateConfidence {
  const raw = stringValue(value).toLowerCase();
  return raw === 'high' || raw === 'low' ? raw : 'medium';
}

export function stringList(value: unknown, max = 6) {
  return (Array.isArray(value) ? value : []).map(stringValue).filter(Boolean).slice(0, max);
}

/**
 * Reads Gemini's estimate. The model reports totals for what was eaten and the
 * app works out per-serving values, so a multi-serving order can't be counted
 * twice. Falls back to the older per-unit shape. Null when unreadable.
 */
export function parseGeminiEstimate(text: string, fallbackMeal: Meal): GeminiEstimate | null {
  let parsed: unknown;
  try {
    parsed = parseJsonObject(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  if (!('total' in raw) && 'calories' in raw) {
    const legacy = parseAiQuickLog(text, fallbackMeal);
    if (!legacy) return null;
    return {
      source: 'estimate',
      name: legacy.name,
      meal: legacy.meal,
      unitMode: legacy.unitMode,
      portion: Number(amountPortionValue(legacy.amount)) || 1,
      base: { calories: legacy.calories, protein: legacy.protein, carbs: legacy.carbs, fat: legacy.fat },
      servingLabel: legacy.amount,
      assumptions: [],
      confidence: 'medium',
      notes: legacy.notes
    };
  }
  const name = stringValue(raw.name);
  if (!name) return null;
  const source = stringValue(raw.source).toLowerCase() === 'label' ? 'label' : 'estimate';
  const total = nutrition(raw.total);
  const per100g = nutrition(raw.per100g);
  const servings = numberValue(raw.servingsEaten);
  const grams = numberValue(raw.gramsEaten);
  const shared = {
    source,
    name,
    meal: mealValue(raw.meal, fallbackMeal),
    servingLabel: stringValue(raw.servingDescription),
    assumptions: stringList(raw.assumptions),
    confidence: confidenceValue(raw.confidence),
    notes: stringValue(raw.notes)
  } as const;
  // A label with a known amount is logged per 100 g, so changing the grams later stays exact.
  if (per100g && per100g.calories > 0 && Number.isFinite(grams) && grams > 0) {
    return { ...shared, unitMode: '100g', portion: Math.round(grams * 10) / 10, base: per100g };
  }
  if (!total) return null;
  const portion = Number.isFinite(servings) && servings > 0 ? Math.round(servings * 100) / 100 : 1;
  return { ...shared, unitMode: 'serving', portion, base: divide(total, portion) };
}

/** Energy implied by the macros (4/4/9 kcal per gram). */
export function energyFromMacros(totals: Pick<Totals, 'protein' | 'carbs' | 'fat'>) {
  return totals.protein * 4 + totals.carbs * 4 + totals.fat * 9;
}

/**
 * True when calories and macros disagree by more than 15%. Alcohol and fibre
 * explain some gaps, so this asks for a check rather than calling it wrong.
 */
export function macrosDisagree(totals: Totals) {
  const fromMacros = energyFromMacros(totals);
  if (totals.calories < 50 || fromMacros <= 0) return false;
  return Math.abs(fromMacros - totals.calories) / totals.calories > 0.15;
}

const SOURCE_LABEL: Record<EntryEstimateSource, string> = {
  ai: 'Estimated',
  label: 'From label',
  menu: 'From menu'
};

export function estimateSourceLabel(source: EntryEstimateSource | null | undefined) {
  return source ? SOURCE_LABEL[source] : '';
}

export function estimateSourceValue(value: unknown): EntryEstimateSource | null {
  return value === 'ai' || value === 'label' || value === 'menu' ? value : null;
}

/** Notes saved with the entry, so the guesses stay visible after logging. */
export function estimateNotes(lead: string, assumptions: string[], confidence: EstimateConfidence | null) {
  return [
    lead,
    assumptions.length ? `Assumed: ${assumptions.join('; ')}.` : '',
    confidence ? `Confidence: ${confidence}.` : ''
  ].filter(Boolean).join(' ');
}
