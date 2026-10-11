// What should I eat? (3.0): the request Dawni builds, the reply it reads, and the copy that depends on the kind
// of answer. Run straight from src/suggest.ts: npm test (Node 22.6+).
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// utils.ts reads the clock through `new Date()`, so pin "now" before it loads.
const RealDate = Date;
let now = 0;
class FixedDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
globalThis.Date = FixedDate;
const setToday = key => { now = new RealDate(`${key}T12:00:00`).getTime(); };

register('./resolveTs.mjs', import.meta.url);
const sg = await import('../src/suggest.ts');
const { suggestSheetTitle, estimatingLabel } = await import('../src/estimateJob.ts');

// The owner's week: Monday 5 to Sunday 11 October 2026, and it is Saturday evening with 730 Cal over.
const WEEK = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
const SAT = WEEK[5];
const LIMIT = 1450;
const MINUS = '−';
const OWNER = [1145.8, 1487.8, 1211.8, 1559.8, 1276.8];

const entry = (id, date, name, calories, extra = {}) => ({
  id, date, name, calories, protein: 0, carbs: 0, fat: 0, portion: 1, unitMode: 'serving', meal: 'Lunch', sourceFoodId: null, createdAt: 1, updatedAt: 1, ...extra
});
const food = (id, name, calories, extra = {}) => ({
  id, name, calories, protein: 0, carbs: 0, fat: 0, favourite: true, usageCount: 1, lastUsedAt: 1, createdAt: 1, updatedAt: 1, ...extra
});

function state({ unit = 'kcal', mode = 'Cutting', preferences = '', foods = [], extra = [] } = {}) {
  const s = {
    settings: { calories: LIMIT, protein: 150, carbs: 160, fat: 60, trackingMode: mode, spreadWeeklyBank: false, energyUnit: unit, aiPreferences: preferences },
    entries: [],
    foods,
    completedDates: [],
    dayEstimates: {},
    dailyGoals: {},
    dayCalorieOverrides: {},
    customFoodDatabases: []
  };
  // One unnamed entry a day, so none of them is anyone's usual.
  [...OWNER, LIMIT + 730].forEach((kcal, i) => s.entries.push(entry(`w${i}`, WEEK[i], 'Lunch entry', kcal, { autoNamed: true, protein: i === 5 ? 169 : 120, createdAt: i + 2 })));
  s.entries.push(...extra);
  return s;
}

const NOW = new RealDate('2026-10-10T19:30:00');
const lines = text => text.split('\n');
const line = (text, start) => lines(text).find(item => item.startsWith(start));

/* ---------------------------------------------------------------- the request */

test('the request names the week and the usual foods, and keeps everything the menu helper sent', () => {
  setToday(SAT);
  const s = state({
    preferences: 'Melbourne. Vegetarian on weekdays.',
    extra: [
      // Before this week, so the week's balance stays the owner's.
      entry('u1', '2026-09-21', 'Chicken and rice', 520),
      entry('u2', '2026-09-28', 'Chicken and rice', 520),
      entry('u3', '2026-09-30', 'Tuna salad sandwich', 380)
    ],
    foods: [food('f1', 'Greek yoghurt', 194, { usageCount: 40, unitMode: '100g' })]
  });
  const context = sg.buildSuggestContext(s, SAT, 'Lunch', SAT);
  const budget = sg.mealBudget(context, 'Lunch');
  const request = sg.buildSuggestRequest({ context, meal: 'Lunch', budget, text: 'Going to Macca’s for lunch', preferences: s.settings.aiPreferences, photoCount: 0, now: NOW });
  const out = lines(request);

  assert.equal(out[0], 'SUGGEST REQUEST');
  assert.match(out[1], /^Local time: Saturday/);
  assert.equal(line(request, 'Meal to choose:'), 'Meal to choose: Lunch');
  assert.equal(line(request, 'Goal mode:'), 'Goal mode: Cutting (stay at or under the calorie target; favour protein and fullness)');
  assert.equal(line(request, 'Today\'s calorie target:'), 'Today\'s calorie target: 1450 kcal');
  assert.equal(line(request, 'Eaten so far today:'), 'Eaten so far today: 2180 kcal, so 730 kcal over');
  assert.equal(line(request, 'Suggested range for this meal:'), 'Suggested range for this meal: none: today\'s calorie target is already reached, so suggest the lightest option that will still satisfy');
  assert.equal(line(request, 'Protein:'), 'Protein: 169 g eaten of a 150 g target, so 0 g still to go');
  assert.equal(line(request, 'Carbs:'), 'Carbs: 0 g of 160 g. Fat: 0 g of 60 g.');
  assert.match(line(request, 'Already logged today:'), /^Already logged today: Lunch entry \(Lunch, 2180 kcal\)$/);

  // New in 3.0: the week, from the Week screen's own prompt line, and what they usually eat.
  assert.equal(line(request, 'Week so far:'), `Week so far: net ${MINUS}163 Cal, 1 day left after today, plan about 1,287 Cal a day`);
  assert.equal(line(request, 'Usual foods:'), 'Usual foods: Chicken and rice (520 Cal); Tuna salad sandwich (380 Cal); Greek yoghurt (194 Cal per 100 g)');
  assert.equal(line(request, 'About the user:'), 'About the user: Melbourne. Vegetarian on weekdays.');
  assert.equal(line(request, 'What the user said:'), 'What the user said: Going to Macca’s for lunch');
  assert.equal(out[out.length - 1], 'Menu photos attached: 0');

  // The order: the day, then the week, then the usuals, then the person.
  const at = prefix => out.findIndex(item => item.startsWith(prefix));
  assert.ok(at('Already logged today:') < at('Week so far:'));
  assert.ok(at('Week so far:') < at('Usual foods:'));
  assert.ok(at('Usual foods:') < at('About the user:'));
  assert.ok(at('About the user:') < at('What the user said:'));
});

test('words alone are a request: no photos, no menu', () => {
  setToday(SAT);
  const s = state();
  const context = sg.buildSuggestContext(s, WEEK[2], 'Dinner', SAT);
  const budget = sg.mealBudget(context, 'Dinner');
  const request = sg.buildSuggestRequest({ context, meal: 'Dinner', budget, text: '  cooking at home, have chicken thighs and rice  ', photoCount: 0, now: NOW });
  assert.equal(line(request, 'What the user said:'), 'What the user said: cooking at home, have chicken thighs and rice');
  assert.equal(line(request, 'Menu photos attached:'), 'Menu photos attached: 0');
  assert.equal(line(request, 'About the user:'), 'About the user: nothing saved');
  assert.equal(line(request, 'Usual foods:'), 'Usual foods: none yet');
  // Wednesday: 1450 less 1212 eaten is 238 left, and the dinner range uses most of it, never more than what is left.
  assert.equal(line(request, 'Eaten so far today:'), 'Eaten so far today: 1212 kcal, so 238 kcal left');
  assert.equal(line(request, 'Suggested range for this meal:'), 'Suggested range for this meal: 190-238 kcal (uses most of what is left today)');
});

test('photos alone are a request too, and the request says so', () => {
  setToday(SAT);
  const s = state();
  const context = sg.buildSuggestContext(s, SAT, 'Lunch', SAT);
  const request = sg.buildSuggestRequest({ context, meal: 'Lunch', budget: sg.mealBudget(context, 'Lunch'), text: '', photoCount: 2, now: NOW });
  assert.equal(line(request, 'What the user said:'), 'What the user said: nothing, use the menu photos');
  assert.equal(line(request, 'Menu photos attached:'), 'Menu photos attached: 2');
});

test('the week is always sent in Cal, even for someone who reads kJ', () => {
  setToday(SAT);
  const s = state({ unit: 'kj' });
  assert.equal(sg.weekPromptLine(s, SAT, SAT), `Week so far: net ${MINUS}163 Cal, 1 day left after today, plan about 1,287 Cal a day`);
});

test('a week still to come and a finished week say so instead of a plan', () => {
  setToday(SAT);
  const s = state();
  assert.match(sg.weekPromptLine(s, '2026-10-19', SAT), /^Week not started: budget 10,150 Cal$/);
  setToday('2026-10-12');
  assert.match(sg.weekPromptLine(s, SAT, '2026-10-12'), /^Week finished: net /);
});

test('usual foods: this meal\'s usuals first, then favourites by use, no food twice, ten at most', () => {
  setToday(SAT);
  const extra = [];
  // Lunch usuals: B logged twice, A once. Dinner entries must not count for lunch.
  extra.push(entry('a1', '2026-10-01', 'Chicken wrap', 560), entry('b1', '2026-10-02', 'Chicken and rice', 520), entry('b2', '2026-09-30', 'Chicken and rice', 530, { createdAt: 9 }));
  extra.push(entry('d1', '2026-10-03', 'Salmon and quinoa', 640, { meal: 'Dinner' }));
  const foods = [
    food('f1', 'Flat white', 120, { usageCount: 31 }),
    food('f2', 'Chicken wrap', 560, { usageCount: 50 }),
    food('f3', 'Apple', 95, { favourite: false, usageCount: 99 }),
    food('f4', 'Cottage cheese', 98, { usageCount: 12, unitMode: '100g' })
  ];
  const usuals = sg.usualFoods(state({ extra, foods }), 'Lunch', SAT);
  assert.deepEqual(usuals.map(item => item.name), ['Chicken and rice', 'Chicken wrap', 'Flat white', 'Cottage cheese']);
  assert.equal(usuals[0].calories, 530);
  assert.equal(usuals[3].per100g, true);
  assert.equal(sg.usualFoodsLine(usuals), 'Usual foods: Chicken and rice (530 Cal); Chicken wrap (560 Cal); Flat white (120 Cal); Cottage cheese (98 Cal per 100 g)');

  const many = Array.from({ length: 14 }, (_, i) => food(`m${i}`, `Favourite ${i}`, 100 + i, { usageCount: 20 - i }));
  const capped = sg.usualFoods(state({ foods: many }), 'Lunch', SAT);
  assert.equal(capped.length, sg.MAX_USUAL_FOODS);
  assert.equal(capped[0].name, 'Favourite 0');
});

/* ---------------------------------------------------------------- the budget line (unchanged) */

test('the meal budget is the same share of what is left as before', () => {
  const at = (left, meal) => sg.mealBudget({ calorieTarget: 1800, eaten: { calories: 1800 - left, protein: 0, carbs: 0, fat: 0 } }, meal);
  assert.deepEqual(at(710, 'Lunch'), { remaining: 710, low: 280, high: 360 });
  assert.deepEqual(at(710, 'Dinner'), { remaining: 710, low: 570, high: 710 });
  assert.deepEqual(at(710, 'Breakfast'), { remaining: 710, low: 180, high: 250 });
  // A real meal is rarely under 150, but never more than what is left.
  assert.deepEqual(at(200, 'Snack'), { remaining: 200, low: 150, high: 150 });
  assert.deepEqual(at(90, 'Lunch'), { remaining: 90, low: 90, high: 90 });
  assert.deepEqual(at(200, 'Drink'), { remaining: 200, low: 50, high: 50 });
  // Reached or past the target: no range, so the helper looks for the lightest option.
  assert.deepEqual(at(0, 'Lunch'), { remaining: 0, low: 0, high: 0 });
  assert.deepEqual(at(-730, 'Dinner'), { remaining: -730, low: 0, high: 0 });
  assert.equal(sg.budgetReason('Lunch'), 'leaves room for dinner');
  assert.equal(sg.budgetReason('Dinner'), 'uses most of what is left today');
});

/* ---------------------------------------------------------------- the reply */

const ITEM = { name: 'McChicken', portion: '1 burger', calories: 412.4, protein: 22.2, carbs: 40, fat: 17, reason: 'Fits.', tip: 'Skip the mayo.', source: 'venue', printedEnergy: true, assumptions: ['Published energy'], confidence: 'medium' };
const reply = (pick, extra = {}) => JSON.stringify({ menuReadable: true, venue: 'Macca’s', pick, alternatives: [], summary: 'Two sentences.', note: '', ...extra });

test('a reply is read with its new fields', () => {
  const result = sg.parseSuggest(reply(ITEM, { alternatives: [{ ...ITEM, name: 'Filet-O-Fish', source: 'venue', printedEnergy: false, confidence: 'low' }] }));
  assert.equal(result.menuReadable, true);
  assert.equal(result.venue, 'Macca’s');
  assert.equal(result.summary, 'Two sentences.');
  const { pick } = result;
  assert.equal(pick.name, 'McChicken');
  assert.equal(pick.portion, '1 burger');
  assert.equal(pick.calories, 412);
  assert.equal(pick.protein, 22);
  assert.equal(pick.source, 'venue');
  assert.equal(pick.printedEnergy, true);
  assert.deepEqual(pick.assumptions, ['Published energy']);
  assert.equal(result.alternatives[0].printedEnergy, false);
  assert.equal(result.alternatives[0].confidence, 'low');
});

test('printed energy is high confidence, whatever the reply says', () => {
  assert.equal(sg.parseSuggest(reply({ ...ITEM, confidence: 'low' })).pick.confidence, 'high');
  assert.equal(sg.parseSuggest(reply({ ...ITEM, printedEnergy: false, confidence: 'low' })).pick.confidence, 'low');
  assert.equal(sg.parseSuggest(reply({ ...ITEM, printedEnergy: false, confidence: 'odd' })).pick.confidence, 'medium');
});

test('an older reply that says fromMenu is still understood', () => {
  const old = { name: 'Salmon poke bowl', calories: 480, protein: 34, carbs: 52, fat: 14, reason: 'Lighter.', tip: '', fromMenu: true, assumptions: [], confidence: 'low' };
  const result = sg.parseSuggest(JSON.stringify({ menuReadable: true, pick: old, alternatives: [{ ...old, name: 'Beef bowl', fromMenu: false }], summary: '', note: '' }), true);
  assert.equal(result.pick.printedEnergy, true);
  assert.equal(result.pick.confidence, 'high');
  assert.equal(result.pick.portion, '');
  assert.equal(result.alternatives[0].printedEnergy, false);
  // No source in an older reply: it was a menu photo then.
  assert.equal(result.pick.source, 'menu');
  assert.equal(result.alternatives[0].source, 'menu');
});

test('an item that does not say what kind it is follows what was sent', () => {
  const bare = { name: 'Wrap', calories: 480, protein: 30, carbs: 40, fat: 18, reason: 'Quick.' };
  assert.equal(sg.parseSuggest(reply(bare)).pick.source, 'general');
  assert.equal(sg.parseSuggest(reply(bare), true).pick.source, 'menu');
  assert.equal(sg.parseSuggest(reply({ ...bare, source: 'Home' })).pick.source, 'home');
  assert.equal(sg.parseSuggest(reply({ ...bare, source: 'banana' })).pick.source, 'general');
});

test('an unreadable menu comes back as a note, and a pick alongside it still counts', () => {
  const unreadable = sg.parseSuggest('{"menuReadable": false, "note": "The photo is too dark. Try again in better light."}', true);
  assert.deepEqual(unreadable, { menuReadable: false, venue: '', pick: null, alternatives: [], summary: '', note: 'The photo is too dark. Try again in better light.' });
  // The model fell back to the venue named in the words: that is an answer, not an unreadable menu.
  const fallback = sg.parseSuggest(reply(ITEM, { menuReadable: false, note: 'The photo was unreadable, so this is from what Macca’s usually serves.' }), true);
  assert.equal(fallback.menuReadable, true);
  assert.equal(fallback.pick.name, 'McChicken');
  assert.match(fallback.note, /unreadable/);
});

test('the venue only goes with a venue suggestion, and is kept short', () => {
  assert.equal(sg.parseSuggest(reply({ ...ITEM, source: 'home' })).venue, '');
  assert.equal(sg.parseSuggest(reply(ITEM, { venue: 'x'.repeat(80) })).venue.length, 40);
});

test('at most two different alternatives, and only usable ones', () => {
  const alt = name => ({ ...ITEM, name });
  const result = sg.parseSuggest(reply(ITEM, { alternatives: [alt('McChicken'), alt('Filet-O-Fish'), { name: '', calories: 100 }, alt('filet-o-fish'), alt('Quarter Pounder'), alt('Big Mac')] }));
  assert.deepEqual(result.alternatives.map(item => item.name), ['Filet-O-Fish', 'Quarter Pounder']);
});

test('a reply that is not the JSON asked for is refused', () => {
  assert.equal(sg.parseSuggest('Sorry, I could not work that out.'), null);
  assert.equal(sg.parseSuggest('[]'), null);
  assert.equal(sg.parseSuggest(JSON.stringify({ menuReadable: true, summary: 'No pick here.' })), null);
  assert.equal(sg.parseSuggest(reply({ ...ITEM, calories: -5 })), null);
  assert.equal(sg.parseSuggest('```json\n' + reply(ITEM) + '\n```').pick.name, 'McChicken');
});

/* ---------------------------------------------------------------- what the answer is called */

test('the entry notes lead by what kind of answer it was', () => {
  const item = (source, printedEnergy = false) => ({ source, printedEnergy });
  assert.equal(sg.suggestNotesLead(item('menu'), 'Lunch'), 'Suggested for lunch from the menu.');
  assert.equal(sg.suggestNotesLead(item('menu', true), 'Lunch'), 'Suggested for lunch from the menu. Energy printed on the menu.');
  assert.equal(sg.suggestNotesLead(item('venue'), 'Lunch', 'Macca’s'), 'Suggested for lunch at Macca’s.');
  assert.equal(sg.suggestNotesLead(item('venue', true), 'Dinner', 'Macca’s'), 'Suggested for dinner at Macca’s. Energy as published.');
  assert.equal(sg.suggestNotesLead(item('venue'), 'Snack'), 'Suggested for snack when eating out.');
  assert.equal(sg.suggestNotesLead(item('home'), 'Dinner'), 'Suggested to cook at home.');
  assert.equal(sg.suggestNotesLead(item('general'), 'Breakfast'), 'Suggested for breakfast.');
});

test('the small print under a suggestion depends on where it came from', () => {
  assert.equal(sg.suggestFooter('menu'), 'Estimated from the menu. Portions vary, so check the numbers when you log.');
  assert.equal(sg.suggestFooter('venue', 'Macca’s'), 'Based on what Macca’s usually serves. Check the numbers against the menu board.');
  assert.equal(sg.suggestFooter('venue'), 'Based on what this place usually serves. Check the numbers against the menu board.');
  assert.equal(sg.suggestFooter('home'), 'A suggestion to cook. Log what you actually plate up.');
  assert.equal(sg.suggestFooter('general'), 'A suggestion based on your day. Check the numbers when you log.');
});

test('the sheet is called What should I eat?, with the day when it is not today', () => {
  assert.equal(suggestSheetTitle(SAT, SAT), 'What should I eat?');
  assert.equal(suggestSheetTitle('2026-10-09', SAT), 'What should I eat? · Yesterday');
  assert.equal(estimatingLabel('Lunch', 'suggest'), 'Finding lunch ideas…');
  assert.equal(estimatingLabel(null, 'suggest'), 'Finding ideas…');
  assert.equal(estimatingLabel('Lunch'), 'Estimating lunch…');
});

/* ---------------------------------------------------------------- how long a suggestion stays */

test('a suggestion is kept for three hours, for the same day only', () => {
  const session = { version: 1, date: SAT, createdAt: 1_000_000, meal: 'Lunch', remainingAtRequest: 700, proteinLeftAtRequest: 60, result: sg.parseSuggest(reply(ITEM)) };
  const hours = h => 1_000_000 + h * 3_600_000;
  assert.equal(sg.isSuggestFresh(session, SAT, hours(0)), true);
  assert.equal(sg.isSuggestFresh(session, SAT, hours(3)), true);
  assert.equal(sg.isSuggestFresh(session, SAT, hours(3) + 1), false);
  assert.equal(sg.isSuggestFresh(session, WEEK[4], hours(1)), false);
  assert.equal(sg.isSuggestFresh(session, SAT, 999_999), false);
  assert.equal(sg.isSuggestFresh(null, SAT, hours(1)), false);
  assert.equal(sg.isSuggestFresh({ ...session, version: 2 }, SAT, hours(1)), false);
  assert.equal(sg.isSuggestFresh({ ...session, result: { ...session.result, pick: null } }, SAT, hours(1)), false);
});

/* ---------------------------------------------------------------- the prompt and its schema */

test('the prompt covers all four modes, the goal mode, the week, and keeps the no-guilt words', () => {
  const p = sg.SUGGEST_PROMPT;
  for (const mode of ['"menu"', '"venue"', '"home"', '"general"']) assert.ok(p.includes(mode), mode);
  assert.match(p, /Australia/);
  assert.match(p, /published energy/i);
  assert.match(p, /Cutting:.*Maintaining:.*Bulking:/);
  assert.match(p, /Week so far/);
  assert.match(p, /Usual foods/);
  assert.match(p, /Australian English/);
  assert.match(p, /never "cheat", "bad", "burn it off" or "failed"/);
  assert.match(p, /protein/);
  assert.ok(!p.includes('fromMenu'), 'the old flag is gone from what Gemini is told');
  assert.match(p, /no readable menu photo/, 'words alone are enough');
});

test('the schema asks for source, printedEnergy and portion on every item, and a venue', () => {
  const item = sg.SUGGEST_SCHEMA.properties.pick.properties;
  for (const key of ['name', 'portion', 'calories', 'protein', 'carbs', 'fat', 'reason', 'tip', 'source', 'printedEnergy', 'assumptions', 'confidence']) assert.ok(item[key], key);
  assert.equal(item.printedEnergy.type, 'BOOLEAN');
  assert.equal(item.fromMenu, undefined);
  assert.deepEqual(sg.SUGGEST_SCHEMA.required, ['menuReadable']);
  assert.ok(sg.SUGGEST_SCHEMA.properties.venue);
  assert.deepEqual(sg.SUGGEST_SCHEMA.properties.alternatives.items.properties, item);
});
