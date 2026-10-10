// The Log sheet's pure parts: the usuals row, Undo bookkeeping, and the estimating copy. npm test (Node 22.6+).
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

register('./resolveTs.mjs', import.meta.url);
const { usualChips, MAX_USUAL_CHIPS } = await import('../src/logUsuals.ts');
const { removeEntry, restoreEntry, revertFoodUse } = await import('../src/undo.ts');
const { elapsedText, estimatingLabel, logSheetTitle, SHOW_ELAPSED_AFTER_MS } = await import('../src/estimateJob.ts');

const entry = (id, name, calories, extra = {}) => ({ id, name, calories, protein: 0, carbs: 0, fat: 0, date: '2026-10-09', sourceFoodId: null, createdAt: 1, updatedAt: 1, meal: 'Lunch', ...extra });
const food = (id, name, calories, extra = {}) => ({ id, name, calories, protein: 0, carbs: 0, fat: 0, favourite: true, usageCount: 1, lastUsedAt: 1, createdAt: 1, updatedAt: 1, ...extra });
const batch = (id, name) => ({ id, name, recipe: '', servings: 4, total: { calories: 2000, protein: 0, carbs: 0, fat: 0 }, ingredients: [], estimateSource: null, assumptions: [], confidence: null, cookedOn: '2026-10-08', finishedAt: null, createdAt: 1, updatedAt: 1 });
const usual = (key, latest) => ({ key, name: latest.name, latest });

/* ---------------------------------------------------------------- usuals row */

test('usuals come first, then meal prep with serves left, then favourites by use', () => {
  const chips = usualChips({
    usuals: [usual('a', entry('e1', 'Chicken and rice', 520)), usual('b', entry('e2', 'Tuna salad sandwich', 380))],
    batches: [{ batch: batch('b1', 'Beef mince rice bowl'), left: 3, calories: 500 }, { batch: batch('b2', 'Curry'), left: 0, calories: 600 }],
    foods: [food('f1', 'Flat white', 120, { usageCount: 31 }), food('f2', 'Greek yoghurt', 194, { usageCount: 40 }), food('f3', 'Apple', 95, { favourite: false })]
  });
  assert.deepEqual(chips.map(chip => `${chip.kind}:${chip.name}`), [
    'usual:Chicken and rice',
    'usual:Tuna salad sandwich',
    'prep:Beef mince rice bowl',
    'favourite:Greek yoghurt',
    'favourite:Flat white'
  ]);
  const prep = chips.find(chip => chip.kind === 'prep');
  assert.equal(prep.left, 3);
  assert.equal(prep.calories, 500);
});

test('the same food never shows twice, by saved food or by name', () => {
  const chips = usualChips({
    usuals: [usual('f1', entry('e1', 'Flat white', 120, { sourceFoodId: 'f1' }))],
    batches: [],
    foods: [food('f1', 'Flat white (large)', 150), food('f2', 'flat white ', 130), food('f3', 'Banana', 105)]
  });
  assert.deepEqual(chips.map(chip => chip.name), ['Flat white', 'Banana']);
});

test('the row stops at eight chips', () => {
  const foods = Array.from({ length: 20 }, (_, i) => food(`f${i}`, `Food ${i}`, 100 + i));
  assert.equal(MAX_USUAL_CHIPS, 8);
  assert.equal(usualChips({ usuals: [], batches: [], foods }).length, 8);
  assert.equal(usualChips({ usuals: [], batches: [], foods, limit: 3 }).length, 3);
});

test('a usual logs what was logged last time', () => {
  const latest = entry('e9', 'Eggs on sourdough', 420, { portion: 2 });
  const [chip] = usualChips({ usuals: [usual('x', latest)], batches: [], foods: [] });
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
