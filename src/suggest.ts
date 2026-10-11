import type { AppState, Meal, Totals, TrackingMode } from './types';
import { numberValue, parseJsonObject, stringValue } from './aiQuickLog';
import { aboutUserLine, confidenceValue, stringList, type EstimateConfidence } from './aiEstimate';
import { SHARP_PHOTO_OPTIONS } from './image';
import { readValue, saveValue } from './storage';
import { usualsForMeal } from './tidelight';
import { weekMode, weekView } from './weekView';
import { dayEntries, entryTotals, goalForDate, resolveDayCalorieTarget, sum, todayKey, weekBank, weekStartMonday } from './utils';

export const SUGGEST_MEALS: Meal[] = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
export const MAX_SUGGEST_PHOTOS = 4;
/** Menus need legible small print, so they keep more resolution than food photos. */
export const SUGGEST_PHOTO_OPTIONS = SHARP_PHOTO_OPTIONS;
/** The usual foods sent along: this meal's usuals first, then favourites, up to this many. */
export const MAX_USUAL_FOODS = 10;

/**
 * What kind of answer it is, chosen by Gemini from what was asked:
 * - menu: dishes from a menu photo
 * - venue: items a named restaurant or chain is known for
 * - home: a dish to cook, with a short method
 * - general: anything else
 */
export type SuggestSource = 'menu' | 'venue' | 'home' | 'general';

export type SuggestItem = {
  name: string;
  /** What the numbers are for, in a few words, e.g. "1 regular bowl, no sour cream". */
  portion: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  reason: string;
  /** An ordering tweak, or for a home suggestion the short method. */
  tip: string;
  source: SuggestSource;
  /** True when the energy was printed on the menu, or published by the venue, rather than estimated. */
  printedEnergy: boolean;
  assumptions: string[];
  confidence: EstimateConfidence;
};

export type SuggestResult = {
  /** False only when menu photos were sent and no menu could be read in them. */
  menuReadable: boolean;
  /** The restaurant or chain named, as people say it ("Macca's"); empty unless it is a venue suggestion. */
  venue: string;
  pick: SuggestItem | null;
  alternatives: SuggestItem[];
  summary: string;
  note: string;
};

/** The day's numbers the suggestion is based on. Energy is always kcal. */
export type SuggestContext = {
  date: string;
  trackingMode: TrackingMode;
  calorieTarget: number;
  eaten: Totals;
  proteinTarget: number;
  carbsTarget: number;
  fatTarget: number;
  items: { name: string; meal: Meal; calories: number }[];
  /** How the week is going, e.g. "Week so far: net −163 Cal, 1 day left after today, plan about 1,287 Cal a day". */
  weekLine: string;
  /** What they often eat, for portions and tastes. `per100g` when the calories are for 100 g. */
  usuals: { name: string; calories: number; per100g?: boolean }[];
};

export type MealBudget = {
  /** kcal still available today before this meal; negative when over. */
  remaining: number;
  low: number;
  high: number;
};

export type SuggestSession = {
  version: 1;
  date: string;
  createdAt: number;
  meal: Meal;
  remainingAtRequest: number;
  proteinLeftAtRequest: number;
  result: SuggestResult;
};

export const SUGGEST_PROMPT = `You are the "What should I eat?" helper in Dawni, a calm calorie tracking app used in Australia. The user wants a recommendation for the meal named in the request. Use the day's numbers, how the week is going, what they often eat, and what they tell you.

First decide the mode from what they gave you, and set "source" on every item to match:
- "menu": a readable menu photo is attached. Recommend only dishes that appear in the photos, using the dish name as printed. You may add a short modification in brackets, for example "(dressing on the side)".
- "venue": their words name a restaurant, cafe, chain or cuisine and there is no readable menu photo, for example "going to Macca's", "Subway for lunch" or "a Thai place". Recommend real items that place is known for in Australia, by the names it uses. Put the place's name in "venue". Don't invent items. If you are not sure the place sells something, choose something you are sure of.
- "home": their words describe cooking or what is in the fridge, for example "cooking at home, what should I make?" or "have chicken thighs and rice". Suggest one dish to cook, using what they have plus pantry basics. Put the short method in "tip" (two or three quick steps, at most about 35 words) and the portion that fits the range in "portion".
- "general": anything else, for example "what should I eat?", "something quick" or "I'm hungry". Suggest simple, realistic everyday Australian food that fits: a meal, a snack or a takeaway choice.
If photos are attached but no menu can be read in them: when their words name a place, carry on in "venue" mode and say so in "note"; otherwise reply with menuReadable false.

How to choose:
- Aim for the suggested calorie range so the rest of the day still works. If nothing fits, choose the closest sensible option and say so plainly.
- Follow the goal mode. Cutting: stay within the range and favour protein and fullness. Maintaining: stay close to the range. Bulking: make sure the meal helps reach the calorie and protein targets.
- When a lot of protein is still to go, favour higher-protein options.
- Keep the week in mind, using the "Week so far" line. A negative net means the week is over so far and a positive net means it is ahead (the other way round when bulking, where a positive net means under the target). If the week is behind, prefer the lighter end of the range. If it is ahead, say so plainly and allow the fuller end. Never lecture about it.
- "Usual foods" are what they often eat, with their Cal. Use them as a guide to portions and tastes. Don't just repeat them, though a small tweak to a usual is fine.
- Consider what they have already eaten today, for balance and variety.
- Respect what they said and the "About the user" line (dietary needs, cravings, sharing, budget).
- If they have already reached today's calorie target, suggest the lightest option that will still satisfy them. Do not lecture.
- These are suggestions, not orders. Offer, don't instruct.

How to estimate:
- Australian chain menus and menu boards show energy in kJ by law, and chains publish their figures. When a menu shows energy for a dish, or you know the venue's published figure for an item, use it and set "printedEnergy" to true. Convert kJ to kcal by dividing by 4.184. Never put a kJ number in a calorie field. In venue mode, add "published energy" to "assumptions" when you used a published figure, and say when you are unsure of a figure.
- Otherwise estimate one standard Australian serving as described, including listed sides and sauces and typical restaurant (or home) oil and butter, and set "printedEnergy" to false.
- Calories in kcal, rounded to the nearest 10. Protein, carbs and fat in whole grams. Check that protein x 4 + carbs x 4 + fat x 9 is close to the calories.
- "portion": a few words for the serving the numbers cover, for example "1 regular bowl, no sour cream" or "1 burger, no mayo".
- "assumptions": up to 3 short phrases of a few words each for anything you guessed (portion size, dressing, cooking method), for example "large serve of chips". "confidence": "high" (energy printed on the menu or published by the venue), "medium" (clear description or a familiar item) or "low" (vague or hard to read).

Tone:
- Calm, practical and kind. Australian English. No guilt or shame language (never "cheat", "bad", "burn it off" or "failed").
- Keep every text field short. People read this on a phone, so write plain sentences, not paragraphs, lists or headings.
- "reason": one sentence, at most about 15 words.
- "tip": at most about 10 words, or an empty string if there is no useful tweak. For a home suggestion, the method instead.
- "summary": at most two sentences, about 40 words in total. Give the calories and protein left today and the main trade-off, and mention the week if it changed your choice. Do not repeat the pick's reason.
- "note": one short sentence, or an empty string.

Reply with only one JSON object, with no markdown or code fences, in exactly this shape:
{
  "menuReadable": true,
  "venue": "",
  "pick": {
    "name": "dish name",
    "portion": "1 regular serve",
    "calories": 0,
    "protein": 0,
    "carbs": 0,
    "fat": 0,
    "reason": "one short sentence on why it fits",
    "tip": "a short tweak, or the method for a home dish, or an empty string",
    "source": "general",
    "printedEnergy": false,
    "assumptions": [],
    "confidence": "medium"
  },
  "alternatives": [
    { "name": "another option", "portion": "", "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "reason": "one short sentence", "tip": "", "source": "general", "printedEnergy": false, "assumptions": [], "confidence": "medium" }
  ],
  "summary": "at most two short sentences, mentioning the calories and protein left today",
  "note": "one short caveat about the photo or the estimate, or an empty string"
}

Rules:
- Give up to 2 alternatives, different from the pick and from each other (for example one lighter, one more filling).
- "venue" is the place's name as people say it, only in venue mode; otherwise an empty string.
- Set menuReadable to true whenever no photos are attached.
- Use numbers only for calories, protein, carbs and fat.
- If you cannot read a menu in the photos and their words don't name a place, reply with {"menuReadable": false, "note": "what went wrong and how to retake the photo"} instead.`;

const SUGGEST_ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    portion: { type: 'STRING', description: 'A few words: what the numbers are for' },
    calories: { type: 'NUMBER' },
    protein: { type: 'NUMBER' },
    carbs: { type: 'NUMBER' },
    fat: { type: 'NUMBER' },
    reason: { type: 'STRING', description: 'One sentence, at most about 15 words' },
    tip: { type: 'STRING', description: 'At most about 10 words, or the short method for a home dish, or empty' },
    source: { type: 'STRING', description: '"menu", "venue", "home" or "general"' },
    printedEnergy: { type: 'BOOLEAN', description: 'True when the energy is printed on the menu or published by the venue' },
    assumptions: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Up to 3 short phrases' },
    confidence: { type: 'STRING', description: '"high", "medium" or "low"' }
  },
  required: ['name', 'calories', 'protein', 'carbs', 'fat', 'reason'],
  propertyOrdering: ['name', 'portion', 'calories', 'protein', 'carbs', 'fat', 'reason', 'tip', 'source', 'printedEnergy', 'assumptions', 'confidence']
};

/** Gemini structured output (OpenAPI subset). Values are checked again when parsed. */
export const SUGGEST_SCHEMA = {
  type: 'OBJECT',
  properties: {
    menuReadable: { type: 'BOOLEAN' },
    venue: { type: 'STRING', description: 'The restaurant or chain named, or empty' },
    pick: SUGGEST_ITEM_SCHEMA,
    alternatives: { type: 'ARRAY', items: SUGGEST_ITEM_SCHEMA },
    summary: { type: 'STRING', description: 'At most two short sentences' },
    note: { type: 'STRING', description: 'One short sentence, or empty' }
  },
  required: ['menuReadable'],
  propertyOrdering: ['menuReadable', 'venue', 'pick', 'alternatives', 'summary', 'note']
};

/**
 * The week line sent to Gemini: the Week screen's own prompt line, always in Cal so every number in the
 * request is in the same unit.
 */
export function weekPromptLine(state: AppState, date: string, today = todayKey()) {
  const week = weekBank(state, weekStartMonday(date));
  return weekView({ week, today, mode: weekMode(week), unit: 'kcal' }).promptLine;
}

/** What they often eat for `meal` (most-logged first), then favourites, no food twice. */
export function usualFoods(state: AppState, meal: Meal, today = todayKey(), limit = MAX_USUAL_FOODS): SuggestContext['usuals'] {
  const saved = new Set(state.foods.map(food => food.id));
  const foods: SuggestContext['usuals'] = [];
  const names = new Set<string>();
  const take = (name: string, calories: number, per100g = false) => {
    const key = name.trim().toLowerCase();
    if (!key || names.has(key) || foods.length >= limit || !Number.isFinite(calories)) return;
    names.add(key);
    foods.push({ name: name.trim(), calories: Math.round(calories), ...(per100g ? { per100g } : {}) });
  };
  usualsForMeal(state.entries, meal, today, saved, 28, limit).forEach(usual => take(usual.name, entryTotals(usual.latest).calories));
  state.foods
    .filter(food => food.favourite)
    .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0) || (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
    .forEach(food => take(food.name, food.calories, food.unitMode === '100g'));
  return foods;
}

export function buildSuggestContext(state: AppState, date: string, meal: Meal, today = todayKey()): SuggestContext {
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
    items: entries.map(entry => ({ name: entry.name, meal: entry.meal || 'Snack', calories: entryTotals(entry).calories })),
    weekLine: weekPromptLine(state, date, today),
    usuals: usualFoods(state, meal, today)
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
export function mealBudget(context: Pick<SuggestContext, 'calorieTarget' | 'eaten'>, meal: Meal): MealBudget {
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

/** "Usual foods: Chicken and rice (520 Cal); Greek yoghurt (194 Cal per 100 g)". */
export function usualFoodsLine(usuals: SuggestContext['usuals']) {
  if (!usuals.length) return 'Usual foods: none yet';
  return `Usual foods: ${usuals.map(food => `${food.name} (${whole(food.calories)} Cal${food.per100g ? ' per 100 g' : ''})`).join('; ')}`;
}

export function buildSuggestRequest({
  context,
  meal,
  budget,
  text,
  preferences = '',
  photoCount,
  now = new Date()
}: {
  context: SuggestContext;
  meal: Meal;
  budget: MealBudget;
  /** What they typed: where they're eating, or what's in the fridge. */
  text: string;
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
    'SUGGEST REQUEST',
    `Local time: ${time}`,
    `Meal to choose: ${meal}`,
    `Goal mode: ${MODE_RULE[context.trackingMode]}`,
    `Today's calorie target: ${whole(context.calorieTarget)} kcal`,
    `Eaten so far today: ${whole(eaten.calories)} kcal, so ${whole(Math.abs(budget.remaining))} kcal ${budget.remaining >= 0 ? 'left' : 'over'}`,
    `Suggested range for this meal: ${range}`,
    `Protein: ${whole(eaten.protein)} g eaten of a ${whole(context.proteinTarget)} g target, so ${whole(proteinLeft)} g still to go`,
    `Carbs: ${whole(eaten.carbs)} g of ${whole(context.carbsTarget)} g. Fat: ${whole(eaten.fat)} g of ${whole(context.fatTarget)} g.`,
    `Already logged today: ${logged}`,
    context.weekLine,
    usualFoodsLine(context.usuals),
    aboutUserLine(preferences),
    `What the user said: ${text.trim() || 'nothing, use the menu photos'}`,
    `Menu photos attached: ${photoCount}`
  ].join('\n');
}

const SOURCES: SuggestSource[] = ['menu', 'venue', 'home', 'general'];

function suggestItem(input: unknown, fallbackSource: SuggestSource): SuggestItem | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const name = stringValue(raw.name);
  const calories = numberValue(raw.calories);
  if (!name || !Number.isFinite(calories) || calories < 0) return null;
  const grams = (value: unknown) => {
    const parsed = numberValue(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
  };
  const source = stringValue(raw.source).toLowerCase() as SuggestSource;
  // `fromMenu` is what replies called it before suggestions went beyond menu photos.
  const printedEnergy = raw.printedEnergy === true || raw.fromMenu === true;
  return {
    name,
    portion: stringValue(raw.portion),
    calories: Math.round(calories),
    protein: grams(raw.protein),
    carbs: grams(raw.carbs),
    fat: grams(raw.fat),
    reason: stringValue(raw.reason),
    tip: stringValue(raw.tip),
    source: SOURCES.includes(source) ? source : fallbackSource,
    printedEnergy,
    assumptions: stringList(raw.assumptions, 3),
    confidence: printedEnergy ? 'high' : confidenceValue(raw.confidence)
  };
}

/**
 * Reads Gemini's reply. Returns null when it isn't the JSON we asked for. `photos` is whether menu photos were
 * sent: an item that doesn't say what kind it is counts as from the menu then, and as general otherwise.
 */
export function parseSuggest(text: string, photos = false): SuggestResult | null {
  let parsed: unknown;
  try {
    parsed = parseJsonObject(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  const fallback: SuggestSource = photos ? 'menu' : 'general';
  const note = stringValue(raw.note);
  const pick = suggestItem(raw.pick, fallback);
  if (raw.menuReadable === false && !pick) return { menuReadable: false, venue: '', pick: null, alternatives: [], summary: '', note };
  if (!pick) return null;
  const seen = new Set([pick.name.toLowerCase()]);
  const alternatives = (Array.isArray(raw.alternatives) ? raw.alternatives : [])
    .map(item => suggestItem(item, pick.source))
    .filter((item): item is SuggestItem => {
      if (!item || seen.has(item.name.toLowerCase())) return false;
      seen.add(item.name.toLowerCase());
      return true;
    })
    .slice(0, 2);
  const venue = pick.source === 'venue' ? stringValue(raw.venue).slice(0, 40) : '';
  return { menuReadable: true, venue, pick, alternatives, summary: stringValue(raw.summary), note };
}

/** The small print under a suggestion, by what kind it is. */
export function suggestFooter(source: SuggestSource, venue = '') {
  if (source === 'menu') return 'Estimated from the menu. Portions vary, so check the numbers when you log.';
  if (source === 'venue') return `Based on what ${venue || 'this place'} usually serves. Check the numbers against the menu board.`;
  if (source === 'home') return 'A suggestion to cook. Log what you actually plate up.';
  return 'A suggestion based on your day. Check the numbers when you log.';
}

/** How a suggestion starts the notes of the entry it becomes: "Suggested for lunch at Macca's." */
export function suggestNotesLead(item: Pick<SuggestItem, 'source' | 'printedEnergy'>, meal: Meal, venue = '') {
  const forMeal = `Suggested for ${meal.toLowerCase()}`;
  if (item.source === 'menu') return `${forMeal} from the menu.${item.printedEnergy ? ' Energy printed on the menu.' : ''}`;
  if (item.source === 'venue') return `${forMeal} ${venue ? `at ${venue}` : 'when eating out'}.${item.printedEnergy ? ' Energy as published.' : ''}`;
  if (item.source === 'home') return 'Suggested to cook at home.';
  return `${forMeal}.`;
}

const SUGGEST_LAST_KEY = 'suggestLast';
/** A suggestion stays useful for about as long as a meal out lasts. */
const SUGGEST_KEEP_MS = 3 * 60 * 60 * 1000;

export function isSuggestFresh(session: SuggestSession | null, date: string, now = Date.now()): session is SuggestSession {
  if (!session || session.version !== 1 || session.date !== date || !session.result?.pick) return false;
  const age = now - session.createdAt;
  return Number.isFinite(age) && age >= 0 && age <= SUGGEST_KEEP_MS;
}

/** The last suggestion, if it is for `date` and recent: the app may be closed while ordering. */
export async function loadLastSuggest(date: string, now = Date.now()): Promise<SuggestSession | null> {
  const saved = await readValue<SuggestSession>(SUGGEST_LAST_KEY);
  return isSuggestFresh(saved, date, now) ? saved : null;
}

export async function saveLastSuggest(session: SuggestSession | null) {
  try {
    await saveValue(SUGGEST_LAST_KEY, session);
  } catch {
    // Only costs the "show it again after a restart" convenience.
  }
}
