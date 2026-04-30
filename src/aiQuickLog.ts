import type { Meal } from './types';
import { MEALS } from './utils';

export type AiQuickLogEntry = {
  name: string;
  amount: string;
  meal: Meal;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  notes: string;
};

export const AI_QUICK_LOG_PROMPT = `You are helping me estimate a meal for my calorie tracker.

I will tell you the ingredients, amounts, sauces, oils, cooking method, meal details, or show you a product photo or nutrition label.

Estimate the meal as one combined food log entry.

Return only one JSON object. Do not include explanations.

Use this exact JSON shape:

{
  "name": "short combined meal name",
  "amount": "serving amount, such as 1 bowl, 1 plate, 1 serving",
  "meal": "Breakfast, Lunch, Dinner, or Snack",
  "calories": 0,
  "protein": 0,
  "carbs": 0,
  "fat": 0,
  "notes": "brief ingredient and estimate notes"
}

Rules:
- Create only one combined entry.
- If I provide a product photo or nutrition label, identify the product and use the visible label details where possible.
- Use kcal for calories.
- Use grams for protein, carbs, and fat.
- Use numbers only for calories, protein, carbs, and fat.
- Estimate conservatively if unsure.
- Keep the name short and useful for a food log.
- Put ingredient details in notes.
- Do not split ingredients into separate items.
- Do not wrap the result in markdown or code fences.
- After I provide ingredients, reply only with the JSON object.`;

const mealValues = new Set<string>(MEALS);

function cleanInput(value: string) {
  return value
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\u2060]/g, '')
    .trim();
}

function stripCodeFence(value: string) {
  const trimmed = cleanInput(value);
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (match ? match[1] : trimmed).trim();
}

function extractJsonObject(value: string) {
  const source = stripCodeFence(value);
  const start = source.indexOf('{');
  if (start < 0) return source;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return source;
}

function repairJsonText(value: string) {
  return value
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');
}

function parseJsonObject(value: string) {
  const jsonText = extractJsonObject(value);
  try {
    return JSON.parse(jsonText) as unknown;
  } catch {
    return JSON.parse(repairJsonText(jsonText)) as unknown;
  }
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : NaN;
  }
  return NaN;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function mealValue(value: unknown, fallbackMeal: Meal): Meal {
  const raw = stringValue(value).toLowerCase();
  const meal = MEALS.find(item => item.toLowerCase() === raw);
  return meal && mealValues.has(meal) ? meal : fallbackMeal;
}

export function parseAiQuickLog(text: string, fallbackMeal: Meal = 'Snack'): AiQuickLogEntry | null {
  try {
    const parsed = parseJsonObject(text) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const name = stringValue(parsed.name);
    const calories = numberValue(parsed.calories);
    if (!name || !Number.isFinite(calories)) return null;
    const protein = numberValue(parsed.protein);
    const carbs = numberValue(parsed.carbs);
    const fat = numberValue(parsed.fat);
    return {
      name,
      amount: stringValue(parsed.amount) || '1 serve',
      meal: mealValue(parsed.meal, fallbackMeal),
      calories,
      protein: Number.isFinite(protein) ? protein : 0,
      carbs: Number.isFinite(carbs) ? carbs : 0,
      fat: Number.isFinite(fat) ? fat : 0,
      notes: stringValue(parsed.notes)
    };
  } catch {
    return null;
  }
}

export function amountPortionValue(amount: string) {
  const match = amount.trim().match(/^(\d+(?:\.\d+)?)/);
  return match ? match[1] : '1';
}
