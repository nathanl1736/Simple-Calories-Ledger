import type { AppState, Meal, Totals, TrackingMode } from './types';
import { numberValue, parseJsonObject, stringValue } from './aiQuickLog';
import { aboutUserLine, confidenceValue, stringList, type EstimateConfidence } from './aiEstimate';
import { SHARP_PHOTO_OPTIONS } from './image';
import { readValue, saveValue } from './storage';
import { dayEntries, entryTotals, goalForDate, resolveDayCalorieTarget, sum } from './utils';

export const MENU_PICK_MEALS: Meal[] = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
export const MAX_MENU_PHOTOS = 4;
/** Menus need legible small print, so they keep more resolution than food photos. */
export const MENU_PHOTO_OPTIONS = SHARP_PHOTO_OPTIONS;

export type MenuPickItem = {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  reason: string;
  tip: string;
  /** True when the energy was printed on the menu rather than estimated. */
  fromMenu: boolean;
  assumptions: string[];
  confidence: EstimateConfidence;
};

export type MenuPickResult = {
  menuReadable: boolean;
  pick: MenuPickItem | null;
  alternatives: MenuPickItem[];
  summary: string;
  note: string;
};

/** The day's numbers the suggestion is based on. Energy is always kcal. */
export type MenuPickContext = {
  date: string;
  trackingMode: TrackingMode;
  calorieTarget: number;
  eaten: Totals;
  proteinTarget: number;
  carbsTarget: number;
  fatTarget: number;
  items: { name: string; meal: Meal; calories: number }[];
};

export type MealBudget = {
  /** kcal still available today before this meal; negative when over. */
  remaining: number;
  low: number;
  high: number;
};

export type MenuPickSession = {
  version: 1;
  date: string;
  createdAt: number;
  meal: Meal;
  remainingAtRequest: number;
  proteinLeftAtRequest: number;
  result: MenuPickResult;
};

export const MENU_PICK_PROMPT = `You are the menu helper in Dawni, a calm calorie tracking app. The user is at a cafe or restaurant and has photographed a menu (the whole menu or just the part they are choosing from). Recommend what they should order for the meal named in the request, using the day's numbers in the request.

How to choose:
- Only recommend dishes that appear in the photos. Use the dish name as printed on the menu. You may add a short modification in brackets, for example "(dressing on the side)".
- Aim for the suggested calorie range so the rest of the day still works. If nothing fits, choose the closest sensible option and say so plainly.
- Follow the goal mode. Cutting: stay within the range and favour protein and fullness. Maintaining: stay close to the range. Bulking: make sure the meal helps reach the calorie and protein targets.
- When a lot of protein is still to go, favour higher-protein dishes.
- Consider what they have already eaten today, for balance and variety.
- Respect the user's note and the "About the user" line (dietary needs, cravings, sharing, budget).
- If the user has already reached today's calorie target, suggest the lightest option that will still satisfy them. Do not lecture.

How to estimate:
- If the menu prints energy for a dish (Australian chain menus show kJ by law), use it and set "fromMenu" to true. Convert kJ to kcal by dividing by 4.184. Never put a kJ number in a calorie field.
- Otherwise estimate one standard Australian restaurant serving of the dish as described, including listed sides and sauces and typical restaurant oil and butter, and set "fromMenu" to false.
- Calories in kcal, rounded to the nearest 10. Protein, carbs and fat in whole grams. Check that protein x 4 + carbs x 4 + fat x 9 is close to the calories.
- "assumptions": short phrases for anything you guessed (portion size, dressing, cooking method). "confidence": "high" (energy printed on the menu), "medium" (clear description) or "low" (vague description or hard to read).

Tone:
- Calm, practical and kind. Australian English. No guilt or shame language (never "cheat", "bad", "burn it off" or "failed").
- Keep "reason" to one or two short sentences and "summary" to two or three short sentences.

Reply with only one JSON object, with no markdown or code fences, in exactly this shape:
{
  "menuReadable": true,
  "pick": {
    "name": "dish name as on the menu",
    "calories": 0,
    "protein": 0,
    "carbs": 0,
    "fat": 0,
    "reason": "why this dish fits the rest of the day",
    "tip": "one optional ordering tweak, or an empty string",
    "fromMenu": false,
    "assumptions": [],
    "confidence": "medium"
  },
  "alternatives": [
    { "name": "another dish", "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "reason": "one short sentence", "tip": "", "fromMenu": false, "assumptions": [], "confidence": "medium" }
  ],
  "summary": "the overall reasoning, mentioning the calories and protein left today",
  "note": "an optional caveat about the photo or the estimate, or an empty string"
}

Rules:
- Give up to 2 alternatives, different from the pick and from each other (for example one lighter, one more filling).
- Use numbers only for calories, protein, carbs and fat.
- If you cannot read a menu in the photos, reply with {"menuReadable": false, "note": "what went wrong and how to retake the photo"} instead.`;

const MENU_ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    calories: { type: 'NUMBER' },
    protein: { type: 'NUMBER' },
    carbs: { type: 'NUMBER' },
    fat: { type: 'NUMBER' },
    reason: { type: 'STRING' },
    tip: { type: 'STRING' },
    fromMenu: { type: 'BOOLEAN' },
    assumptions: { type: 'ARRAY', items: { type: 'STRING' } },
    confidence: { type: 'STRING', description: '"high", "medium" or "low"' }
  },
  required: ['name', 'calories', 'protein', 'carbs', 'fat', 'reason']
};

/** Gemini structured output (OpenAPI subset). Values are checked again when parsed. */
export const MENU_PICK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    menuReadable: { type: 'BOOLEAN' },
    pick: MENU_ITEM_SCHEMA,
    alternatives: { type: 'ARRAY', items: MENU_ITEM_SCHEMA },
    summary: { type: 'STRING' },
    note: { type: 'STRING' }
  },
  required: ['menuReadable']
};

export function buildMenuPickContext(state: AppState, date: string): MenuPickContext {
  const entries = dayEntries(state, date);
  const goal = goalForDate(state, date);
  return {
    date,
    trackingMode: goal.trackingMode,
    calorieTarget: resolveDayCalorieTarget(state, date).effective,
    eaten: sum(entries),
    proteinTarget: goal.protein,
    carbsTarget: goal.carbs,
    fatTarget: goal.fat,
    items: entries.map(entry => ({ name: entry.name, meal: entry.meal || 'Snack', calories: entryTotals(entry).calories }))
  };
}

/** Share of what's left today that this meal can use, as [low, high]. Later meals get more. */
const MEAL_SHARE: Record<Meal, [number, number]> = {
  Breakfast: [0.25, 0.35],
  Lunch: [0.4, 0.5],
  Dinner: [0.8, 1],
  Snack: [0.15, 0.3],
  Drink: [0.05, 0.15]
};

const roundTo10 = (value: number) => Math.round(value / 10) * 10;

/**
 * A plain, explainable calorie range for the meal being chosen: a share of
 * what's left today, so earlier meals leave room for later ones.
 */
export function mealBudget(context: MenuPickContext, meal: Meal): MealBudget {
  const remaining = Math.round(context.calorieTarget - context.eaten.calories);
  if (remaining <= 0) return { remaining, low: 0, high: 0 };
  const [lowShare, highShare] = MEAL_SHARE[meal];
  // A real meal is rarely under ~150, but never suggest more than is left.
  const floor = Math.min(remaining, meal === 'Drink' ? 50 : 150);
  const low = Math.min(remaining, Math.max(floor, roundTo10(remaining * lowShare)));
  const high = Math.min(remaining, Math.max(low, roundTo10(remaining * highShare)));
  return { remaining, low, high };
}

const BUDGET_REASON: Record<Meal, string> = {
  Breakfast: 'leaves room for lunch and dinner',
  Lunch: 'leaves room for dinner',
  Dinner: 'uses most of what is left today',
  Snack: 'keeps it snack-sized',
  Drink: 'keeps it light'
};

/** Why the range is what it is, e.g. "leaves room for dinner". Shown to the user and sent to Gemini. */
export function budgetReason(meal: Meal) {
  return BUDGET_REASON[meal];
}

const MODE_RULE: Record<TrackingMode, string> = {
  Cutting: 'Cutting (stay at or under the calorie target; favour protein and fullness)',
  Maintaining: 'Maintaining (stay close to the calorie target)',
  Bulking: 'Bulking (reach at least the calorie and protein targets)'
};

const whole = (value: number) => Math.round(value);

export function buildMenuPickRequest({
  context,
  meal,
  budget,
  note,
  preferences = '',
  photoCount,
  now = new Date()
}: {
  context: MenuPickContext;
  meal: Meal;
  budget: MealBudget;
  note: string;
  preferences?: string;
  photoCount: number;
  now?: Date;
}) {
  const { eaten } = context;
  const proteinLeft = Math.max(0, context.proteinTarget - eaten.protein);
  const time = now.toLocaleString('en-AU', { weekday: 'long', hour: 'numeric', minute: '2-digit' });
  const logged = context.items.length
    ? context.items.slice(0, 20).map(item => `${item.name} (${item.meal}, ${whole(item.calories)} kcal)`).join('; ')
    : 'nothing yet';
  const range = budget.remaining > 0
    ? `${budget.low}-${budget.high} kcal (${budgetReason(meal)})`
    : 'none: today\'s calorie target is already reached, so suggest the lightest option that will still satisfy';
  return [
    'MENU PICK REQUEST',
    `Local time: ${time}`,
    `Meal to choose: ${meal}`,
    `Goal mode: ${MODE_RULE[context.trackingMode]}`,
    `Today's calorie target: ${whole(context.calorieTarget)} kcal`,
    `Eaten so far today: ${whole(eaten.calories)} kcal, so ${whole(budget.remaining)} kcal ${budget.remaining >= 0 ? 'left' : 'over'}`,
    `Suggested range for this meal: ${range}`,
    `Protein: ${whole(eaten.protein)} g eaten of a ${whole(context.proteinTarget)} g target, so ${whole(proteinLeft)} g still to go`,
    `Carbs: ${whole(eaten.carbs)} g of ${whole(context.carbsTarget)} g. Fat: ${whole(eaten.fat)} g of ${whole(context.fatTarget)} g.`,
    `Already logged today: ${logged}`,
    aboutUserLine(preferences),
    `User note: ${note.trim() || 'none'}`,
    `Menu photos attached: ${photoCount}`
  ].join('\n');
}

function menuItem(input: unknown): MenuPickItem | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const name = stringValue(raw.name);
  const calories = numberValue(raw.calories);
  if (!name || !Number.isFinite(calories) || calories < 0) return null;
  const grams = (value: unknown) => {
    const parsed = numberValue(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
  };
  return {
    name,
    calories: Math.round(calories),
    protein: grams(raw.protein),
    carbs: grams(raw.carbs),
    fat: grams(raw.fat),
    reason: stringValue(raw.reason),
    tip: stringValue(raw.tip),
    fromMenu: raw.fromMenu === true,
    assumptions: stringList(raw.assumptions, 4),
    confidence: raw.fromMenu === true ? 'high' : confidenceValue(raw.confidence)
  };
}

/** Reads Gemini's reply. Returns null when it isn't the JSON we asked for. */
export function parseMenuPick(text: string): MenuPickResult | null {
  let parsed: unknown;
  try {
    parsed = parseJsonObject(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  const note = stringValue(raw.note);
  const pick = menuItem(raw.pick);
  if (raw.menuReadable === false) return { menuReadable: false, pick: null, alternatives: [], summary: '', note };
  if (!pick) return null;
  const seen = new Set([pick.name.toLowerCase()]);
  const alternatives = (Array.isArray(raw.alternatives) ? raw.alternatives : [])
    .map(menuItem)
    .filter((item): item is MenuPickItem => {
      if (!item || seen.has(item.name.toLowerCase())) return false;
      seen.add(item.name.toLowerCase());
      return true;
    })
    .slice(0, 2);
  return { menuReadable: true, pick, alternatives, summary: stringValue(raw.summary), note };
}

const MENU_PICK_LAST_KEY = 'menuPickLast';
/** A suggestion stays useful for about as long as a meal out lasts. */
const MENU_PICK_KEEP_MS = 3 * 60 * 60 * 1000;

export function isMenuPickFresh(session: MenuPickSession | null, date: string, now = Date.now()): session is MenuPickSession {
  if (!session || session.version !== 1 || session.date !== date || !session.result?.pick) return false;
  const age = now - session.createdAt;
  return Number.isFinite(age) && age >= 0 && age <= MENU_PICK_KEEP_MS;
}

/** The last suggestion, if it is for `date` and recent: the app may be closed while ordering. */
export async function loadLastMenuPick(date: string, now = Date.now()): Promise<MenuPickSession | null> {
  const saved = await readValue<MenuPickSession>(MENU_PICK_LAST_KEY);
  return isMenuPickFresh(saved, date, now) ? saved : null;
}

export async function saveLastMenuPick(session: MenuPickSession | null) {
  try {
    await saveValue(MENU_PICK_LAST_KEY, session);
  } catch {
    // Only costs the "show it again after a restart" convenience.
  }
}
