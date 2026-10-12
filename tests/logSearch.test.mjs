// Log food's one text box: when it searches, and what a typed search lists. npm test (Node 22.6+).
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

register('./resolveTs.mjs', import.meta.url);
const { composerSearchQuery, searchSections, SEARCH_SAVED_SHOWN, SEARCH_DATABASE_SHOWN, SEARCH_DATABASE_MAX } = await import('../src/searchResults.ts');

const food = (id, name, favourite = false) => ({ id, name, calories: 100, protein: 5, carbs: 0, fat: 0, favourite, usageCount: 1, lastUsedAt: 1, createdAt: 1, updatedAt: 1 });
const batch = (id, name) => ({ id, name, kind: 'cooked', recipe: '', servings: 4, total: { calories: 2000, protein: 0, carbs: 0, fat: 0 }, ingredients: [], estimateSource: null, assumptions: [], confidence: null, cookedOn: '2026-10-08', finishedAt: null, createdAt: 1, updatedAt: 1 });
const sections = (overrides = {}) => searchSections({ query: 'chicken', batches: [], userResults: [], databaseMatches: [], databaseQuery: 'chicken', moreDatabase: false, ...overrides });

/* ---------------------------------------------------------------- when the box searches */

test('typing searches; an empty box or only spaces shows the usuals', () => {
  assert.equal(composerSearchQuery({ text: '  chob ', photos: [] }), 'chob');
  assert.equal(composerSearchQuery({ text: '', photos: [] }), '');
  assert.equal(composerSearchQuery({ text: '   ', photos: [] }), '');
});

test('with a photo attached the words are for Gemini, so nothing is searched', () => {
  assert.equal(composerSearchQuery({ text: 'half of it', photos: ['data:image/jpeg;base64,xx'] }), '');
});

/* ---------------------------------------------------------------- what it lists */

test('favourites and recent foods split, each capped', () => {
  const userResults = [
    ...Array.from({ length: 10 }, (_, i) => food(`f${i}`, `Chicken fav ${i}`, true)),
    ...Array.from({ length: 10 }, (_, i) => food(`r${i}`, `Chicken recent ${i}`))
  ];
  const { favouriteRows, recentRows } = sections({ userResults });
  assert.equal(favouriteRows.length, SEARCH_SAVED_SHOWN);
  assert.equal(recentRows.length, SEARCH_SAVED_SHOWN);
  assert.ok(favouriteRows.every(item => item.favourite));
  assert.ok(recentRows.every(item => !item.favourite));
  assert.equal(favouriteRows[0].id, 'f0', 'in the order the search ranked them');
});

test('the fridge matches by name, accents and case aside', () => {
  const batches = [batch('b1', 'Chicken & rice bowls'), batch('b2', 'Beef ragù'), batch('b3', 'Muscle Chef chicken pesto')];
  assert.deepEqual(sections({ batches }).prepRows.map(item => item.id), ['b1', 'b3']);
  assert.deepEqual(sections({ batches, query: 'RAGU', databaseQuery: 'RAGU' }).prepRows.map(item => item.id), ['b2']);
  assert.deepEqual(sections({ batches, query: '!!', databaseQuery: '!!' }).prepRows, [], 'punctuation alone finds nothing');
});

test('the food database shows three, then up to twenty with Show more', () => {
  const databaseMatches = Array.from({ length: 30 }, (_, i) => ({ id: `d${i}` }));
  const short = sections({ databaseMatches });
  assert.equal(short.databaseRows.length, SEARCH_DATABASE_SHOWN);
  assert.equal(short.moreCount, SEARCH_DATABASE_MAX - SEARCH_DATABASE_SHOWN);
  const long = sections({ databaseMatches, moreDatabase: true });
  assert.equal(long.databaseRows.length, SEARCH_DATABASE_MAX);
  assert.equal(long.moreCount, 0);
  const few = sections({ databaseMatches: databaseMatches.slice(0, 2) });
  assert.equal(few.moreCount, 0, 'no Show more when all of them already show');
});

test('"nothing matches" waits for the food database to answer this search', () => {
  const pending = sections({ databaseQuery: 'chicke' });
  assert.equal(pending.waiting, true);
  assert.equal(pending.nothing, false);
  assert.equal(pending.summary, '');
  const answered = sections();
  assert.equal(answered.nothing, true);
  assert.equal(answered.summary, 'No matches for chicken');
});

test('the summary read to a screen reader counts each group', () => {
  const { summary, nothing } = sections({
    batches: [batch('b1', 'Chicken bowls')],
    userResults: [food('f1', 'Chicken wrap', true), food('r1', 'Chicken salad'), food('r2', 'Chicken soup')],
    databaseMatches: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }, { id: 'd4' }]
  });
  assert.equal(nothing, false);
  assert.equal(summary, '1 in your fridge, 1 favourite, 2 recent, 4 from the food database');
});
