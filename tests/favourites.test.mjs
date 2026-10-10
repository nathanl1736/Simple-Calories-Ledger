// What logging does to saved foods and favourites, run straight from src/favourites.ts: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { linkedFood, pruneOneOffEstimates, recordFoodUse } = await import('../src/favourites.ts');

const NOW = 1_800_000_000_000;
const food = (id, name, extra = {}) => ({ id, name, unitMode: 'serving', calories: 100, protein: 10, carbs: 10, fat: 2, favourite: false, usageCount: 3, lastUsedAt: 1, createdAt: 1, updatedAt: 1, ...extra });
const snapshot = (name, extra = {}) => ({ name, unitMode: 'serving', calories: 150, protein: 12, carbs: 14, fat: 4, ...extra });
const log = (foods, { sourceFoodId = null, name = 'Flat white', favourite = null, fromDatabase = false, extra = {} } = {}) =>
  recordFoodUse(foods, { sourceFoodId, snapshot: snapshot(name, extra), favourite, fromDatabase, now: NOW, newId: () => 'new' });

test('linkedFood prefers the food it was picked from, then the same name', () => {
  const foods = [food('a', 'Flat white'), food('b', 'Flat White ')];
  assert.equal(linkedFood(foods, 'b', 'Flat white')?.id, 'b');
  assert.equal(linkedFood(foods, null, '  flat white')?.id, 'a');
  assert.equal(linkedFood(foods, 'gone', 'flat white')?.id, 'a', 'a deleted pick falls back to the name');
  assert.equal(linkedFood(foods, null, '   '), undefined, 'no name, no match');
});

test('hearting a picked food saves it as just logged', () => {
  const foods = [food('a', 'Flat white')];
  assert.equal(log(foods, { sourceFoodId: 'a', favourite: true }), 'added');
  assert.equal(foods[0].favourite, true);
  assert.equal(foods[0].calories, 150);
  assert.equal(foods[0].usageCount, 4);
  assert.equal(foods[0].lastUsedAt, NOW);
});

test('un-hearting a picked favourite removes it from favourites but keeps it saved', () => {
  const foods = [food('a', 'Flat white', { favourite: true })];
  assert.equal(log(foods, { sourceFoodId: 'a', favourite: false }), 'removed');
  assert.equal(foods.length, 1);
  assert.equal(foods[0].favourite, false);
  assert.equal(foods[0].calories, 100, 'numbers untouched');
});

test('a favourite keeps its saved numbers when one log tweaks them', () => {
  const foods = [food('a', 'Flat white', { favourite: true })];
  assert.equal(log(foods, { sourceFoodId: 'a', favourite: null, extra: { calories: 400 } }), null);
  assert.equal(log(foods, { sourceFoodId: 'a', favourite: true, extra: { calories: 400 } }), null, 'left on, still no change');
  assert.equal(foods[0].calories, 100);
  assert.equal(foods[0].favourite, true);
  assert.equal(foods[0].usageCount, 5);
});

test('an untouched heart never changes a favourite, even one matched by name', () => {
  const foods = [food('a', 'Flat white', { favourite: true })];
  assert.equal(log(foods, { name: 'flat white', favourite: null }), null);
  assert.equal(foods[0].favourite, true);
  assert.equal(foods[0].calories, 100);
});

test('un-hearting a favourite matched by name removes it', () => {
  const foods = [food('a', 'Flat white', { favourite: true })];
  assert.equal(log(foods, { name: 'Flat white', favourite: false }), 'removed');
  assert.equal(foods[0].favourite, false);
});

test('a recent food matched by name follows its latest log; a picked one does not', () => {
  const byName = [food('a', 'Flat white')];
  assert.equal(log(byName, { name: 'Flat white' }), null);
  assert.equal(byName[0].calories, 150);
  const picked = [food('a', 'Flat white')];
  assert.equal(log(picked, { sourceFoodId: 'a' }), null);
  assert.equal(picked[0].calories, 100);
});

test('a new food is saved to Recent, or to favourites when hearted', () => {
  const foods = [];
  assert.equal(log(foods, { name: 'Toast' }), null);
  assert.equal(log(foods, { name: 'Soup', favourite: true }), 'added');
  assert.deepEqual(foods.map(item => [item.name, item.favourite, item.usageCount]), [['Toast', false, 1], ['Soup', true, 1]]);
});

test('a database pick is only saved once hearted', () => {
  const foods = [];
  assert.equal(log(foods, { name: 'Banana', fromDatabase: true }), null);
  assert.equal(log(foods, { name: 'Banana', fromDatabase: true, favourite: false }), null);
  assert.equal(foods.length, 0);
  assert.equal(log(foods, { name: 'Banana', fromDatabase: true, favourite: true }), 'added');
  assert.equal(foods[0].favourite, true);
});

test('a favourite saved from an estimate stays labelled as one', () => {
  const foods = [];
  log(foods, { name: 'Burrito bowl', favourite: true, extra: { estimateSource: 'ai' } });
  assert.equal(foods[0].estimateSource, 'ai');
});

const DAY = 24 * 60 * 60 * 1000;
const ago = days => NOW - days * DAY;
/** An AI estimate logged once, `days` ago, untouched since. */
const oneOff = (id, days, extra = {}) => food(id, id, { estimateSource: 'ai', usageCount: 1, lastUsedAt: ago(days), createdAt: ago(days), updatedAt: ago(days), ...extra });
const kept = foods => pruneOneOffEstimates(foods, NOW).map(item => item.id);

test('a one-off AI or menu estimate clears from Recent after 30 days unused', () => {
  assert.deepEqual(kept([oneOff('fresh', 29), oneOff('stale', 31), oneOff('menu', 31, { estimateSource: 'menu' })]), ['fresh']);
  assert.deepEqual(kept([oneOff('edge', 30)]), ['edge'], 'kept through day 30');
});

test('favourites, repeats and hand edits keep an estimate', () => {
  assert.deepEqual(kept([
    oneOff('hearted', 90, { favourite: true }),
    oneOff('twice', 90, { usageCount: 2 }),
    oneOff('edited', 90, { updatedAt: ago(10) })
  ]), ['hearted', 'twice', 'edited']);
  assert.deepEqual(kept([oneOff('stamped late', 90, { updatedAt: ago(90) + 5 })]), [], 'a few ms between stamps is not an edit');
});

test('only AI and menu estimates are ever cleared', () => {
  assert.deepEqual(kept([
    oneOff('typed', 90, { estimateSource: undefined }),
    oneOff('label', 90, { estimateSource: 'label' }),
    oneOff('rough', 90, { estimateSource: 'rough' })
  ]), ['typed', 'label', 'rough']);
});

test('an estimate with no last-used time falls back to when it was saved', () => {
  assert.deepEqual(kept([oneOff('old', 60, { lastUsedAt: 0 }), oneOff('new', 5, { lastUsedAt: 0 })]), ['new']);
});
