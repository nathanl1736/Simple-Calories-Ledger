// Meal prep (2.8): a cooked batch split into serves, logged a serve at a time. npm test (Node 22.6+).
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

register('./resolveTs.mjs', import.meta.url);
const m = await import('../src/mealPrep.ts');
const { normalizeStateShape } = await import('../src/state.ts');
const { usualsForMeal } = await import('../src/tidelight.ts');

const reply = fields => JSON.stringify({
  name: 'Beef mince rice bowl',
  ingredients: [
    { name: 'White rice, uncooked', amount: '500 g', calories: 1800, protein: 34, carbs: 395, fat: 3 },
    { name: 'Beef mince, regular', amount: '1 kg', calories: 2500, protein: 190, carbs: 0, fat: 190 },
    { name: 'Iceberg lettuce', amount: '1/2 head', calories: 40, protein: 2.4, carbs: 7.6, fat: 0.4 }
  ],
  total: { calories: 4340, protein: 226.4, carbs: 402.6, fat: 193.4 },
  assumptions: ['regular mince (no grade given)'],
  confidence: 'medium',
  notes: 'Rice, mince and lettuce bowls',
  ...fields
});

const batch = (fields = {}) => ({
  id: 'b1',
  name: 'Beef mince rice bowl',
  recipe: '500 g rice, 1 kg mince',
  servings: 4,
  total: { calories: 4000, protein: 200, carbs: 400, fat: 160 },
  ingredients: [],
  estimateSource: 'ai',
  assumptions: [],
  confidence: 'medium',
  cookedOn: '2026-10-05',
  finishedAt: null,
  createdAt: 1,
  updatedAt: 1,
  ...fields
});

const serve = (batchId, portion = 1, fields = {}) => ({ id: `e${Math.random()}`, batchId, unitMode: 'serving', portion, name: 'Beef mince rice bowl', date: '2026-10-06', meal: 'Lunch', calories: 1000 * portion, ...fields });

test('a batch estimate keeps every ingredient for the whole batch', () => {
  const estimate = m.parseBatchEstimate(reply());
  assert.equal(estimate.name, 'Beef mince rice bowl');
  assert.equal(estimate.ingredients.length, 3);
  assert.deepEqual(estimate.ingredients[1], { name: 'Beef mince, regular', amount: '1 kg', calories: 2500, protein: 190, carbs: 0, fat: 190 });
  assert.deepEqual(estimate.assumptions, ['regular mince (no grade given)']);
  assert.equal(estimate.confidence, 'medium');
});

test('the batch total is the sum of its ingredients, not whatever total Gemini wrote', () => {
  const estimate = m.parseBatchEstimate(reply({ total: { calories: 9999, protein: 1, carbs: 1, fat: 1 } }));
  assert.deepEqual(estimate.total, { calories: 4340, protein: 226.4, carbs: 402.6, fat: 193.4 });
});

test('with no ingredient breakdown the stated total is used', () => {
  const estimate = m.parseBatchEstimate(reply({ ingredients: [] }));
  assert.equal(estimate.total.calories, 4340);
  assert.equal(m.parseBatchEstimate(reply({ ingredients: [], total: { calories: 0 } })), null);
});

test('unreadable or unnamed replies are rejected', () => {
  assert.equal(m.parseBatchEstimate('not json'), null);
  assert.equal(m.parseBatchEstimate(reply({ name: '' })), null);
  // Fenced or chatty replies still read.
  assert.equal(m.parseBatchEstimate('```json\n' + reply() + '\n```').ingredients.length, 3);
});

test('the request asks for the whole batch and passes corrections on', () => {
  const text = m.buildBatchRequest({ recipe: '500 g rice\n1 kg mince', servings: 4, preferences: 'high protein' });
  assert.match(text, /split into: 4/);
  assert.match(text, /return the whole batch/);
  assert.match(text, /500 g rice\n1 kg mince/);
  assert.match(text, /About the user: high protein/);
  const refined = m.buildBatchRequest({ recipe: 'x', servings: 4, preferences: '', previous: '{"name":"a"}', correction: 'mince was 5 star' });
  assert.match(refined, /Correction from the user: mince was 5 star/);
  assert.match(m.BATCH_ESTIMATE_PROMPT, /Do not divide by the number of serves/);
  assert.deepEqual(m.BATCH_SCHEMA.propertyOrdering.slice(0, 3), ['name', 'ingredients', 'total']);
});

test('one serve is the batch divided by its serves', () => {
  assert.deepEqual(m.batchServe(batch()), { calories: 1000, protein: 50, carbs: 100, fat: 40 });
  assert.equal(m.batchServe(batch({ servings: 5 })).calories, 800);
});

test('serves left come from the log: deleting an entry puts the serve back', () => {
  const entries = [serve('b1'), serve('b1', 1.5), serve('other'), { ...serve(undefined) }];
  assert.equal(m.batchServesUsed(batch(), entries), 2.5);
  assert.equal(m.batchServesLeft(batch(), entries), 1.5);
  assert.equal(m.batchServesLeft(batch(), entries.slice(1)), 2.5);
  // Never below none.
  assert.equal(m.batchServesLeft(batch(), [serve('b1', 3), serve('b1', 2)]), 0);
});

test('a batch is active until eaten, finished early, or a week after cooking', () => {
  const today = '2026-10-09';
  assert.equal(m.batchState(batch(), [], today), 'active');
  assert.equal(m.batchState(batch(), [serve('b1', 4)], today), 'eaten');
  assert.equal(m.batchState(batch({ finishedAt: 5 }), [], today), 'finished');
  // Cooked Monday the 5th: still there the next Monday, gone the Tuesday after.
  assert.equal(m.batchLastDay(batch()), '2026-10-12');
  assert.equal(m.batchState(batch(), [], '2026-10-12'), 'active');
  assert.equal(m.batchState(batch(), [], '2026-10-13'), 'expired');
});

test('active batches list the oldest first; finished ones the newest first', () => {
  const batches = [
    batch({ id: 'new', cookedOn: '2026-10-08', createdAt: 30 }),
    batch({ id: 'old', cookedOn: '2026-10-04', createdAt: 10 }),
    batch({ id: 'done', cookedOn: '2026-10-06', createdAt: 20 }),
    batch({ id: 'thrown', cookedOn: '2026-10-07', createdAt: 25, finishedAt: 99 })
  ];
  const entries = [serve('done', 4)];
  assert.deepEqual(m.activeBatches(batches, entries, '2026-10-09').map(b => b.id), ['old', 'new']);
  assert.deepEqual(m.finishedBatches(batches, entries, '2026-10-09').map(b => b.id), ['thrown', 'done']);
});

test('pruning keeps every batch on the go and only the last few finished ones', () => {
  const finished = Array.from({ length: 8 }, (_, i) => batch({ id: `f${i}`, createdAt: i, finishedAt: 1 }));
  const kept = m.pruneBatches([...finished, batch({ id: 'live', createdAt: 0 })], [], '2026-10-09');
  assert.deepEqual(kept.map(b => b.id).sort(), ['f3', 'f4', 'f5', 'f6', 'f7', 'live']);
});

test('serves are whole numbers from 1 to 30, defaulting to 4', () => {
  assert.equal(m.servingsValue(6), 6);
  assert.equal(m.servingsValue(2.6), 3);
  assert.equal(m.servingsValue(0), 4);
  assert.equal(m.servingsValue('abc'), 4);
  assert.equal(m.servingsValue(99), 30);
});

test('batches survive a save and reload, and bad ones are dropped', () => {
  const state = normalizeStateShape({
    batches: [batch({ servings: '5', cookedOn: '2026-10-05T10:00:00' }), { id: 'x' }, null],
    entries: [serve('b1'), serve('')]
  });
  assert.equal(state.batches.length, 1);
  assert.equal(state.batches[0].servings, 5);
  assert.equal(state.batches[0].cookedOn, '2026-10-05');
  assert.equal(state.entries[0].batchId, 'b1');
  assert.equal('batchId' in state.entries[1], false);
  // Older backups have no batches at all.
  assert.deepEqual(normalizeStateShape({}).batches, []);
});

test('meal prep serves never become a usual on the Now line', () => {
  const entries = [
    { ...serve('b1'), date: '2026-10-05', meal: 'Dinner', createdAt: 1 },
    { ...serve('b1'), date: '2026-10-06', meal: 'Dinner', createdAt: 2 },
    { id: 'p', name: 'Salmon', date: '2026-10-06', meal: 'Dinner', createdAt: 3, calories: 600 }
  ];
  assert.deepEqual(usualsForMeal(entries, 'Dinner', '2026-10-09').map(u => u.name), ['Salmon']);
});
