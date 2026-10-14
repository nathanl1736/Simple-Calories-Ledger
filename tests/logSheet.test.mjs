// The Log sheet's pure parts: the usuals and favourites rows, Undo bookkeeping, and the estimating copy. npm test (Node 22.6+).
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

register('./resolveTs.mjs', import.meta.url);
const { logChips, favouritesByUse, MAX_USUAL_CHIPS } = await import('../src/logUsuals.ts');
const { removeEntry, restoreEntry, revertFoodUse } = await import('../src/undo.ts');
const { elapsedText, estimatingLabel, logSheetTitle, SHOW_ELAPSED_AFTER_MS } = await import('../src/estimateJob.ts');
const { followToday } = await import('../src/utils.ts');

const entry = (id, name, calories, extra = {}) => ({ id, name, calories, protein: 0, carbs: 0, fat: 0, date: '2026-10-09', sourceFoodId: null, createdAt: 1, updatedAt: 1, meal: 'Lunch', ...extra });
const food = (id, name, calories, extra = {}) => ({ id, name, calories, protein: 0, carbs: 0, fat: 0, favourite: true, usageCount: 1, lastUsedAt: 1, createdAt: 1, updatedAt: 1, ...extra });
const batch = (id, name) => ({ id, name, recipe: '', servings: 4, total: { calories: 2000, protein: 0, carbs: 0, fat: 0 }, ingredients: [], estimateSource: null, assumptions: [], confidence: null, cookedOn: '2026-10-08', finishedAt: null, createdAt: 1, updatedAt: 1 });
const usual = (key, latest) => ({ key, name: latest.name, latest });

/* ---------------------------------------------------------------- usuals and favourites rows */

const row = chips => chips.map(chip => `${chip.kind}:${chip.name}`);

test('the fridge with serves left comes first, then usuals; favourites have their own row, most logged first', () => {
  const { usuals, favourites } = logChips({
    usuals: [usual('a', entry('e1', 'Chicken and rice', 520)), usual('b', entry('e2', 'Tuna salad sandwich', 380))],
    batches: [{ batch: batch('b1', 'Beef mince rice bowl'), left: 3, calories: 500 }, { batch: batch('b2', 'Curry'), left: 0, calories: 600 }],
    foods: [food('f1', 'Flat white', 120, { usageCount: 31 }), food('f2', 'Greek yoghurt', 194, { usageCount: 40 }), food('f3', 'Apple', 95, { favourite: false })]
  });
  assert.deepEqual(row(usuals), [
    'prep:Beef mince rice bowl',
    'usual:Chicken and rice',
    'usual:Tuna salad sandwich'
  ]);
  assert.deepEqual(row(favourites), ['favourite:Greek yoghurt', 'favourite:Flat white']);
  const prep = usuals.find(chip => chip.kind === 'prep');
  assert.equal(prep.left, 3);
  assert.equal(prep.calories, 500);
});

test('a full set of usuals no longer pushes the fridge off the row', () => {
  const usuals = Array.from({ length: MAX_USUAL_CHIPS }, (_, i) => usual(`u${i}`, entry(`e${i}`, `Dinner ${i}`, 500)));
  const { usuals: chips } = logChips({
    usuals,
    batches: [{ batch: batch('b1', 'Beef mince rice bowl'), left: 3, calories: 684 }, { batch: batch('b2', 'Muscle Chef pasta'), left: 1, calories: 450 }],
    foods: []
  });
  assert.equal(chips.length, MAX_USUAL_CHIPS);
  assert.deepEqual(row(chips).slice(0, 3), ['prep:Beef mince rice bowl', 'prep:Muscle Chef pasta', 'usual:Dinner 0']);
});

test('a usual with a fridge item’s name gives way to the fridge chip, which counts the serves down', () => {
  const { usuals } = logChips({
    usuals: [usual('a', entry('e1', 'Beef mince rice bowl', 684))],
    batches: [{ batch: batch('b1', 'Beef mince rice bowl'), left: 2, calories: 684 }],
    foods: []
  });
  assert.deepEqual(row(usuals), ['prep:Beef mince rice bowl']);
});

test('every favourite is in Favourites: one that is a usual for this meal leads it, logging as last time', () => {
  const { usuals, favourites } = logChips({
    usuals: [usual('f2', entry('e1', 'Greek yoghurt', 250, { sourceFoodId: 'f2', portion: 1.3 })), usual('b', entry('e2', 'Tuna salad sandwich', 380))],
    batches: [],
    foods: [food('f1', 'Flat white', 120, { usageCount: 31 }), food('f2', 'Greek yoghurt', 194, { usageCount: 4 })]
  });
  assert.deepEqual(row(usuals), ['usual:Tuna salad sandwich']);
  assert.deepEqual(row(favourites), ['usual:Greek yoghurt', 'favourite:Flat white']);
  assert.equal(favourites[0].calories, 250, 'what was logged last time, not the saved serve');
  assert.equal(favourites[0].entry.portion, 1.3);
});

test('a usual matches its favourite by name when it was not picked from it', () => {
  const { usuals, favourites } = logChips({
    usuals: [usual('flat white', entry('e1', 'Flat White', 130))],
    batches: [],
    foods: [food('f1', 'flat white', 120)]
  });
  assert.deepEqual(usuals, []);
  assert.deepEqual(row(favourites), ['usual:Flat White']);
});

test('the same food never shows twice, by saved food or by name', () => {
  const { usuals, favourites } = logChips({
    usuals: [usual('f1', entry('e1', 'Flat white', 120, { sourceFoodId: 'f1' })), usual('flat white', entry('e2', 'flat white', 118))],
    batches: [],
    foods: [food('f1', 'Flat white (large)', 150), food('f2', 'flat white ', 130), food('f3', 'Banana', 105)]
  });
  assert.deepEqual(usuals, []);
  assert.deepEqual(favourites.map(chip => chip.name), ['Flat white', 'Banana']);
});

test('the usuals row stops at eight chips; favourites keep every one', () => {
  const foods = Array.from({ length: 20 }, (_, i) => food(`f${i}`, `Food ${i}`, 100 + i));
  const usuals = Array.from({ length: 12 }, (_, i) => usual(`u${i}`, entry(`e${i}`, `Usual ${i}`, 200 + i)));
  assert.equal(MAX_USUAL_CHIPS, 8);
  assert.equal(logChips({ usuals, batches: [], foods }).usuals.length, 8);
  assert.equal(logChips({ usuals, batches: [], foods, limit: 3 }).usuals.length, 3);
  assert.equal(logChips({ usuals: [], batches: [], foods }).favourites.length, 20);
});

test('a favourite with serves in the fridge takes one from there, by its link or its name', () => {
  const stocked = { ...batch('b1', 'Greek yoghurt pot'), foodId: 'f1' };
  const { usuals, favourites } = logChips({
    usuals: [usual('u', entry('e1', 'Beef mince rice bowl', 684, { sourceFoodId: 'f3' }))],
    batches: [{ batch: stocked, left: 3, calories: 150 }, { batch: batch('b2', 'Beef mince rice bowl'), left: 2, calories: 684 }],
    foods: [food('f1', 'Greek yoghurt', 160, { usageCount: 9 }), food('f2', 'Flat white', 120, { usageCount: 5 }), food('f3', 'Beef mince rice bowl', 650, { usageCount: 1 })]
  });
  // The fridge still leads the usuals row; in Favourites the same food counts its serves down.
  assert.deepEqual(row(usuals), ['prep:Greek yoghurt pot', 'prep:Beef mince rice bowl']);
  assert.deepEqual(row(favourites), ['prep:Beef mince rice bowl', 'prep:Greek yoghurt pot', 'favourite:Flat white']);
  assert.equal(favourites[1].batch.id, 'b1');
  assert.equal(favourites[1].left, 3);
});

test('once the fridge has none left, the favourite logs as itself again', () => {
  const { favourites } = logChips({
    usuals: [],
    batches: [{ batch: { ...batch('b1', 'Greek yoghurt'), foodId: 'f1' }, left: 0, calories: 150 }],
    foods: [food('f1', 'Greek yoghurt', 160)]
  });
  assert.deepEqual(row(favourites), ['favourite:Greek yoghurt']);
});

test('no favourites, no favourites row', () => {
  const { favourites } = logChips({ usuals: [], batches: [], foods: [food('f1', 'Apple', 95, { favourite: false })] });
  assert.deepEqual(favourites, []);
});

test('favourites tie on use go most recent first', () => {
  const foods = [food('a', 'Older', 100, { usageCount: 5, lastUsedAt: 10 }), food('b', 'Newer', 100, { usageCount: 5, lastUsedAt: 20 }), food('c', 'Not one', 100, { favourite: false, usageCount: 99 })];
  assert.deepEqual(favouritesByUse(foods).map(item => item.name), ['Newer', 'Older']);
});

test('a usual logs what was logged last time', () => {
  const latest = entry('e9', 'Eggs on sourdough', 420, { portion: 2 });
  const [chip] = logChips({ usuals: [usual('x', latest)], batches: [], foods: [] }).usuals;
  assert.equal(chip.calories, 420);
  assert.equal(chip.entry, latest);
});

/* ---------------------------------------------------------------- undo */

test('a deleted entry comes back where it was', () => {
  const entries = [entry('a', 'A', 1), entry('b', 'B', 2), entry('c', 'C', 3)];
  const { entries: after, removed } = removeEntry(entries, 'b');
  assert.deepEqual(after.map(item => item.id), ['a', 'c']);
  assert.deepEqual(removed, { entry: entries[1], index: 1 });
  assert.deepEqual(restoreEntry(after, removed).map(item => item.id), ['a', 'b', 'c']);
});

test('undoing twice, or after the list shrank, never duplicates or misplaces', () => {
  const entries = [entry('a', 'A', 1), entry('b', 'B', 2)];
  const { entries: after, removed } = removeEntry(entries, 'b');
  const restored = restoreEntry(after, removed);
  assert.equal(restoreEntry(restored, removed).length, 2);
  assert.deepEqual(restoreEntry([], removed).map(item => item.id), ['b']);
  assert.equal(removeEntry(entries, 'zzz').removed, null);
});

test('undoing a log takes back the food it created and the use it counted', () => {
  const before = [food('f1', 'Flat white', 120, { usageCount: 3 })];
  const after = [food('f1', 'Flat white', 120, { usageCount: 4, lastUsedAt: 99 }), food('f2', 'Banana bread', 360, { favourite: false })];
  assert.deepEqual(revertFoodUse(after, before, after), before);
});

test('undo leaves a food alone if it changed again after the log', () => {
  const before = [food('f1', 'Flat white', 120, { usageCount: 3 })];
  const after = [food('f1', 'Flat white', 120, { usageCount: 4 })];
  const edited = [food('f1', 'Flat white, oat', 140, { usageCount: 4 })];
  assert.deepEqual(revertFoodUse(edited, before, after), edited);
  // And nothing to undo when the log didn't touch foods.
  assert.equal(revertFoodUse(before, before, before), before);
});

/* ---------------------------------------------------------------- estimating copy */

test('the counter waits 8 seconds, then counts', () => {
  assert.equal(SHOW_ELAPSED_AFTER_MS, 8000);
  assert.equal(elapsedText(0), '');
  assert.equal(elapsedText(7999), '');
  assert.equal(elapsedText(8000), '8 s · usually 10–30 s');
  assert.equal(elapsedText(12_700), '12 s · usually 10–30 s');
  assert.equal(elapsedText(Number.NaN), '');
});

test('the pill says which meal is being estimated', () => {
  assert.equal(estimatingLabel('Lunch'), 'Estimating lunch…');
  assert.equal(estimatingLabel(null), 'Estimating…');
});

test('the sheet title says the day when it isn’t today', () => {
  const today = '2026-10-10';
  assert.equal(logSheetTitle(today, today), 'Log food');
  assert.equal(logSheetTitle('2026-10-09', today), 'Log food · Yesterday');
  assert.equal(logSheetTitle('2026-10-11', today), 'Log food · Tomorrow');
  assert.equal(logSheetTitle('2026-10-06', today), 'Log food · Tuesday');
  assert.match(logSheetTitle('2026-09-29', today), /^Log food · Tue,? 29 Sept?$/);
});

/* ---------------------------------------------------------------- past midnight */

test('left open on today overnight, the app moves on to the new today', () => {
  assert.equal(followToday('2026-10-12', '2026-10-12', '2026-10-13'), '2026-10-13');
  // Days later too.
  assert.equal(followToday('2026-10-09', '2026-10-09', '2026-10-13'), '2026-10-13');
});

test('a day picked on purpose stays picked when the date changes', () => {
  assert.equal(followToday('2026-10-10', '2026-10-12', '2026-10-13'), '2026-10-10');
  assert.equal(followToday('2026-10-12', '2026-10-12', '2026-10-12'), '2026-10-12');
});
