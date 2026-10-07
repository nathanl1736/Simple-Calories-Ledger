import type { EntryEstimateSource, Meal, Totals } from './types';
import { amountPortionValue, numberValue, parseAiQuickLog, parseJsonObject, stringValue, unitModeValue } from './aiQuickLog';
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
  /** Grams in one serving, so Per serving / Per 100g can convert exactly. 0 when unknown. */
  servingGrams: number;
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

/**
 * Gemini structured output (OpenAPI subset). Values are checked again when parsed.
 * Gemini writes fields alphabetically unless told otherwise, so `propertyOrdering`
 * keeps the prompt's order: what the food is and how it's measured before the numbers.
 */
export const ESTIMATE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    source: { type: 'STRING', description: '"label" or "estimate"' },
    name: { type: 'STRING' },
    meal: { type: 'STRING', description: 'Breakfast, Lunch, Dinner, Snack or Drink' },
    basis: { type: 'STRING', description: '"serving" or "100g"' },
    servingsEaten: { type: 'NUMBER' },
    servingDescription: { type: 'STRING' },
    servingGrams: { type: 'NUMBER' },
    gramsEaten: { type: 'NUMBER' },
    total: NUTRITION_SCHEMA,
    per100g: NUTRITION_SCHEMA,
    assumptions: { type: 'ARRAY', items: { type: 'STRING' } },
    confidence: { type: 'STRING', description: '"high", "medium" or "low"' },
    notes: { type: 'STRING' }
  },
  required: ['source', 'name', 'meal', 'basis', 'servingsEaten', 'total', 'assumptions', 'confidence'],
  propertyOrdering: ['source', 'name', 'meal', 'basis', 'servingsEaten', 'servingDescription', 'servingGrams', 'gramsEaten', 'total', 'per100g', 'assumptions', 'confidence', 'notes']
};

export const GEMINI_ESTIMATE_PROMPT = `You estimate food for Dawni, a calm calorie tracker used in Australia. The user describes what they ate, attaches photos (a meal, a product, or a nutrition information panel), or both. Return one combined log entry for everything they ate.

Choose the source:
- "label" when a nutrition information panel or printed nutrition values are readable in a photo. Read the numbers off the panel; do not estimate them.
- "estimate" otherwise.

Choose the basis, which is how the app shows the numbers for the user to check and adjust:
- "serving" for a dish or meal: anything cooked or put together from several ingredients (including when the user lists the ingredients and amounts they cooked with), restaurant, cafe and takeaway food, sandwiches, bowls and plates, and countable things eaten without a weight (2 eggs, 1 banana, 1 large latte). The app shows one serving's numbers times servings eaten.
- "100g" for one single food or packaged product when the grams (or mL) eaten are known: a label reading, or a plain food the user weighed (200 g Greek yoghurt, 40 g oats). The app shows the per-100 g numbers times grams eaten, so the user can change the grams.
- If unsure, use "serving".

Reading Australian labels:
- Australian panels list energy in kJ, often with Cal or kcal alongside. If only kJ is shown, convert: kcal = kJ / 4.184. Never put a kJ number in a calorie field.
- Panels have a "per serving" column and a "per 100 g" (or per 100 mL) column. Fill per100g from the per-100 column, and read the serving size into servingGrams.
- If the user says how much they ate in grams or mL, set gramsEaten. If they say serves or packs, set servingsEaten to match and work out gramsEaten from the serving size. If they say nothing, assume one label serving (or the whole item when it is clearly single-serve, like a yoghurt tub) and say so in assumptions.
- Use the product and brand name from the pack.

Home cooking from a list of ingredients:
- Count every ingredient listed, including oil, butter, sauces and toppings.
- If the user says how many serves the recipe made, or how much of it they ate, total is only their share. For a recipe that made 4 serves when they ate one: total = whole recipe / 4, servingsEaten = 1, servingDescription "1 of 4 serves".
- If they don't say, treat the amounts as what they ate (one serving), unless the amounts are clearly a batch for several people (like 500 g dry pasta or a whole chicken). Then assume a typical number of serves, count one, and say so in assumptions.
- Ingredient weights are usually raw, so don't add them up into gramsEaten. Set gramsEaten only when the user weighed the finished portion.

Estimating meals:
- Use typical Australian portion sizes and recipes. Count cooking oil, butter, sauces, dressings and sides that are shown or mentioned; if unsure, include a typical amount and say so.
- Ingredients and amounts the user gives beat visual guesses.
- If a printed energy figure for the item is visible (for example on a menu board), use it.

Numbers:
- total = calories and macros for everything eaten in this entry, all servings combined. Calories in kcal, macros in grams.
- servingsEaten = how many identical servings the total covers (2 for two drinks, 1 for a single plate or one serve of a recipe).
- servingDescription = what one serving is, like "1 bowl", "1 of 4 serves" or "1 tub (170 g)".
- servingGrams = grams or mL in one serving when known (a label's serving size, or a weighed portion), otherwise 0.
- gramsEaten = grams or mL eaten when known, otherwise 0. Always set it for basis "100g".
- per100g = per-100 g values when you have them (always for labels and for basis "100g"), otherwise all zeros. For basis "100g", total = per100g x gramsEaten / 100.
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
  "basis": "serving",
  "servingsEaten": 1,
  "servingDescription": "1 bowl",
  "servingGrams": 0,
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

const positiveNumber = (value: unknown) => {
  const parsed = numberValue(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const roundTo = (value: number, decimals: number) => Number(value.toFixed(decimals));

/**
 * Reads Gemini's estimate. The model reports totals for what was eaten and the
 * app works out per-serving values, so a multi-serving order can't be counted
 * twice. Dishes are logged per serving; a single food or product with known
 * grams (a label, a weighed yoghurt) per 100 g. Falls back to the older
 * per-unit shape. Null when unreadable.
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
      servingGrams: 0,
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
  const servings = positiveNumber(raw.servingsEaten);
  const grams = positiveNumber(raw.gramsEaten);
  // A reply without a basis predates it; only a label reading was meant to go per 100 g.
  const basis = stringValue(raw.basis) ? unitModeValue(raw.basis) : source === 'label' ? '100g' : 'serving';
  const shared = {
    source,
    name,
    meal: mealValue(raw.meal, fallbackMeal),
    servingLabel: stringValue(raw.servingDescription),
    assumptions: stringList(raw.assumptions),
    confidence: confidenceValue(raw.confidence),
    notes: stringValue(raw.notes)
  } as const;
  // A single food with known grams is logged per 100 g, so changing the grams later stays exact.
  if (basis === '100g' && grams > 0) {
    const base = per100g && per100g.calories > 0 ? per100g : total && total.calories > 0 ? divide(total, grams / 100) : null;
    if (base) {
      return { ...shared, unitMode: '100g', portion: roundTo(grams, 1), base, servingGrams: roundTo(positiveNumber(raw.servingGrams), 1) };
    }
  }
  if (!total) return null;
  const portion = servings > 0 ? roundTo(servings, 2) : 1;
  // One serving's weight is what was eaten split across the servings, matching the total.
  const servingGrams = grams > 0 ? grams / portion : positiveNumber(raw.servingGrams);
  return { ...shared, unitMode: 'serving', portion, base: divide(total, portion), servingGrams: roundTo(servingGrams, 1) };
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
  menu: 'From menu',
  rough: 'Rough guess'
};

export function estimateSourceLabel(source: EntryEstimateSource | null | undefined) {
  return source ? SOURCE_LABEL[source] : '';
}

export function estimateSourceValue(value: unknown): EntryEstimateSource | null {
  return value === 'ai' || value === 'label' || value === 'menu' || value === 'rough' ? value : null;
}

/** Notes saved with the entry, so the guesses stay visible after logging. */
export function estimateNotes(lead: string, assumptions: string[], confidence: EstimateConfidence | null) {
  return [
    lead,
    assumptions.length ? `Assumed: ${assumptions.join('; ')}.` : '',
    confidence ? `Confidence: ${confidence}.` : ''
  ].filter(Boolean).join(' ');
}
