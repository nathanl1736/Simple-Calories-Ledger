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

// The fridge (3.1): bought food, read off its label, alongside meal prep.
const label = fields => JSON.stringify({
  source: 'label',
  name: 'Vanilla ice cream (Connoisseur)',
  servingsPerPack: 8,
  servingDescription: '1 scoop (70 g)',
  servingGrams: 70,
  packGrams: 0,
  perServing: { calories: 160, protein: 2.5, carbs: 17, fat: 9.2 },
  per100g: { calories: 229, protein: 3.6, carbs: 24.3, fat: 13.1 },
  assumptions: [],
  confidence: 'high',
  notes: 'A 1 L tub',
  ...fields
});

test('a label reading is one pack: a label serve times the servings per package', () => {
  const pack = m.parsePackEstimate(label());
  assert.equal(pack.source, 'label');
  assert.equal(pack.name, 'Vanilla ice cream (Connoisseur)');
  assert.deepEqual(pack.perPack, { calories: 1280, protein: 20, carbs: 136, fat: 73.6 });
  assert.equal(pack.servingsPerPack, 8);
  assert.equal(pack.servingDescription, '1 scoop (70 g)');
  // The weight comes from the label's serves, not the net amount: a 1 L tub's serves are in grams.
  assert.equal(pack.packGrams, 560);
  assert.equal(m.parsePackEstimate(label({ packGrams: 1000 })).packGrams, 560);
  // With no serve size, the net weight is all there is.
  assert.equal(m.parsePackEstimate(label({ servingGrams: 0, packGrams: 500 })).packGrams, 500);
});

test('a label with only a per 100 g column uses the pack weight', () => {
  const pack = m.parsePackEstimate(label({ perServing: { calories: 0, protein: 0, carbs: 0, fat: 0 }, servingGrams: 0, packGrams: 500 }));
  assert.equal(pack.perPack.calories, 1145);
  assert.equal(pack.perPack.protein, 18);
});

test('unreadable, unnamed or empty label readings are rejected', () => {
  assert.equal(m.parsePackEstimate('nope'), null);
  assert.equal(m.parsePackEstimate(label({ name: '' })), null);
  assert.equal(m.parsePackEstimate(label({ perServing: { calories: 0 }, per100g: { calories: 0 } })), null);
  // A missing servings per package is one serve, as a ready meal is.
  assert.equal(m.parsePackEstimate(label({ servingsPerPack: 0 })).servingsPerPack, 1);
  assert.equal(m.parsePackEstimate(label({ source: 'guess' })).source, 'estimate');
});

test('packs multiply out: two ready meals are two serves, a tub is its label serves', () => {
  const meal = { perPack: { calories: 450, protein: 40, carbs: 35, fat: 15 }, servingsPerPack: 1, packGrams: 350 };
  assert.deepEqual(m.packBatch(meal, 2), { total: { calories: 900, protein: 80, carbs: 70, fat: 30 }, servings: 2, grams: 700 });
  const tub = m.parsePackEstimate(label());
  const lot = m.packBatch(tub, 1);
  assert.equal(lot.servings, 8);
  assert.equal(lot.total.calories, 1280);
  // A label's "approx 2.5" serves rounds to whole serves; packs stay between 1 and 12.
  assert.equal(m.packBatch({ ...meal, servingsPerPack: 2.5 }, 1).servings, 3);
  assert.equal(m.packsValue(0), 1);
  assert.equal(m.packsValue(40), 12);
});

test('the label request says how many packs and photos, and passes corrections on', () => {
  const text = m.buildPackRequest({ description: 'Muscle Chef chicken pesto pasta', photoCount: 2, packs: 2, preferences: '' });
  assert.match(text, /Packs bought: 2 \(for context only; describe one pack\)/);
  assert.match(text, /Photos attached: 2/);
  assert.match(text, /What it is: Muscle Chef chicken pesto pasta/);
  const bare = m.buildPackRequest({ description: '', photoCount: 1, packs: 1, preferences: '', previous: '{}', correction: 'it is the 1 L tub' });
  assert.match(bare, /What it is: see the photos/);
  assert.match(bare, /Correction from the user: it is the 1 L tub/);
  assert.match(m.PACK_ESTIMATE_PROMPT, /Do not multiply by the number of packs/);
  assert.match(m.PACK_ESTIMATE_PROMPT, /kcal = kJ \/ 4\.184/);
});

test('bought food keeps 60 days on Today; cooking still a week', () => {
  const tub = batch({ kind: 'bought', cookedOn: '2026-10-05' });
  assert.equal(m.batchLastDay(tub), '2026-12-04');
  assert.equal(m.batchState(tub, [], '2026-11-20'), 'active');
  assert.equal(m.batchState(tub, [], '2026-12-05'), 'expired');
  assert.equal(m.batchShelfDays(batch()), 7);
});

test('a serve knows its weight from the label, and its note says where it came from', () => {
  assert.equal(m.serveGrams({ servings: 8, grams: 560 }), 70);
  assert.equal(m.serveGrams({ servings: 4, grams: 0 }), 0);
  assert.equal(m.serveNote(batch()), 'Meal prep: a serve of a batch of 4.');
  assert.equal(m.serveNote(batch({ kind: 'bought', servings: 8 })), 'From the fridge: a serve of 8.');
});

test('batches saved before the fridge read back as home cooking with no weight', () => {
  const state = normalizeStateShape({ batches: [batch(), batch({ id: 'b2', kind: 'bought', grams: '700' })] });
  assert.equal(state.batches[0].kind, 'cooked');
  assert.equal(state.batches[0].grams, 0);
  assert.equal(state.batches[1].kind, 'bought');
  assert.equal(state.batches[1].grams, 700);
});

/* ---------------------------------------------------------------- a saved food in the fridge */

const savedFood = (fields = {}) => ({ id: 'f1', name: 'Chicken pesto pasta', unitMode: 'serving', calories: 455, protein: 38, carbs: 40, fat: 15, favourite: true, usageCount: 3, lastUsedAt: 1, createdAt: 1, updatedAt: 1, estimateSource: 'label', ...fields });

test('a saved food goes in as so many of its serves, linked to it, with nothing asked of Gemini', () => {
  const lot = m.foodBatch(savedFood({ servingGrams: 350 }), 2);
  assert.equal(lot.foodId, 'f1');
  assert.equal(lot.name, 'Chicken pesto pasta');
  assert.equal(lot.kind, 'bought');
  assert.equal(lot.servings, 2);
  assert.deepEqual(lot.total, { calories: 910, protein: 76, carbs: 80, fat: 30 });
  assert.equal(lot.grams, 700);
  assert.equal(lot.estimateSource, 'label');
  assert.deepEqual(m.batchServe(lot), { calories: 455, protein: 38, carbs: 40, fat: 15 });
});

test('a food saved per 100 g is stocked by the serve: its own serve size, or the grams given, or 100 g', () => {
  const yoghurt = savedFood({ id: 'y', name: 'Greek yoghurt', unitMode: '100g', calories: 66, protein: 9.5, carbs: 5.6, fat: 0.2, servingGrams: 170 });
  assert.equal(m.foodServe(yoghurt).grams, 170);
  assert.equal(Math.round(m.foodServe(yoghurt).serve.calories), 112);
  assert.equal(m.foodServe(yoghurt, 200).grams, 200);
  assert.equal(m.foodServe({ ...yoghurt, servingGrams: undefined }).grams, 100);
  const lot = m.foodBatch(yoghurt, 5);
  assert.equal(lot.grams, 850);
  assert.equal(lot.total.calories, 561);
});

test('a serve of a saved food logs as that food would: per 100 g by its grams, or one serving', () => {
  const yoghurt = savedFood({ unitMode: '100g', calories: 66, protein: 9.5, carbs: 5.6, fat: 0.2, servingGrams: 170 });
  const tub = m.foodBatch(yoghurt, 5);
  assert.deepEqual(m.serveLog(tub, yoghurt, 5), { unitMode: '100g', portion: 170, base: { calories: 66, protein: 9.5, carbs: 5.6, fat: 0.2 } });
  // The last half serve is half its grams; it still counts as what's left.
  assert.equal(m.serveLog(tub, yoghurt, 0.5).portion, 85);
  const meals = m.foodBatch(savedFood(), 2);
  assert.deepEqual(m.serveLog(meals, savedFood(), 2), { unitMode: 'serving', portion: 1, base: { calories: 455, protein: 38, carbs: 40, fat: 15 } });
  // A batch with no saved food behind it (or one since deleted) is a serve, as before.
  assert.equal(m.serveLog(tub, undefined, 5).unitMode, 'serving');
});

test('a logged per-100 g serve counts as one serve, whatever it weighs', () => {
  const tub = { ...m.foodBatch(savedFood({ unitMode: '100g', servingGrams: 170 }), 5), id: 'b1' };
  const entries = [{ id: 'e1', batchId: 'b1', unitMode: '100g', portion: 170 }, { id: 'e2', batchId: 'b1', unitMode: '100g', portion: 250 }];
  assert.equal(m.batchServesLeft(tub, entries), 3);
});

test('the link to the saved food is kept when the fridge is read back', () => {
  const state = normalizeStateShape({ batches: [{ ...m.foodBatch(savedFood(), 2), id: 'b1', cookedOn: '2026-10-13', finishedAt: null, createdAt: 1, updatedAt: 1 }, { id: 'b2', name: 'Curry', total: { calories: 2000 }, servings: 4 }] });
  assert.equal(state.batches[0].foodId, 'f1');
  assert.equal('foodId' in state.batches[1], false);
});

/* ---------------------------------------------------------------- changing the serves */

test('bought food takes more of the same: each serve keeps its numbers and the lot grows', () => {
  assert.equal(m.defaultServesChange('bought'), 'keep');
  assert.equal(m.defaultServesChange('cooked'), 'split');
  // Batches from before the fridge were all home cooking.
  assert.equal(m.defaultServesChange(undefined), 'split');
  const pots = { total: { calories: 450, protein: 30, carbs: 36, fat: 13.5 }, grams: 510 };
  const four = m.resizeLot(pots, 3, 4, 'keep');
  assert.deepEqual(four, { total: { calories: 600, protein: 40, carbs: 48, fat: 18 }, grams: 680 });
  assert.deepEqual(m.batchServe({ ...four, servings: 4 }), { calories: 150, protein: 10, carbs: 12, fat: 4.5 });
  assert.equal(m.resizeLot(pots, 3, 2, 'keep').total.calories, 300);
});

test('a fourth pot after one is logged: the log comes to four pots, not three split four ways', () => {
  const batch = { id: 'y1', servings: 3, total: { calories: 450, protein: 30, carbs: 36, fat: 13.5 }, grams: 510 };
  const entries = [serve('y1', 1, { calories: 150 })];
  const used = batch.servings - m.batchServesLeft(batch, entries);
  const edited = { ...batch, ...m.resizeLot(batch, 3, 4, 'keep', used), servings: 4 };
  const left = m.batchServesLeft(edited, entries);
  assert.equal(left, 3);
  const each = m.serveLog(edited, undefined, left).base.calories;
  assert.equal(each, 150);
  assert.equal(150 + left * each, 600);
});

test('splitting a cooked batch splits what is left, so the log never comes to more than the pot', () => {
  const batch = { id: 'c1', servings: 4, total: { calories: 2000, protein: 160, carbs: 200, fat: 60 }, grams: 2400 };
  const entries = [serve('c1', 1, { calories: 500 }), serve('c1', 1, { calories: 500 })];
  const used = batch.servings - m.batchServesLeft(batch, entries);
  assert.equal(used, 2);
  // The half that's left goes into four containers: 250 Cal and 300 g each, not 2000 / 6.
  const edited = { ...batch, ...m.resizeLot(batch, 4, 6, 'split', used), servings: 6 };
  assert.deepEqual(m.batchServe(edited), { calories: 250, protein: 20, carbs: 25, fat: 7.5 });
  assert.equal(m.serveGrams(edited), 300);
  const logged = entries.reduce((sum, entry) => sum + entry.calories, 0);
  assert.equal(logged + m.batchServesLeft(edited, entries) * m.batchServe(edited).calories, 2000);
  // Nothing logged yet: the whole batch is split again, as before.
  assert.deepEqual(m.resizeLot(batch, 4, 5, 'split'), { total: batch.total, grams: 2400 });
});

test('with nothing left to split, more serves are more of the same', () => {
  const lot = { total: { calories: 2000, protein: 160, carbs: 200, fat: 60 }, grams: 0 };
  // Every serve logged.
  assert.equal(m.resizeLot(lot, 4, 5, 'split', 4).total.calories, 2500);
  // Down to just the serves logged.
  assert.equal(m.resizeLot(lot, 4, 2, 'split', 2).total.calories, 1000);
  // Half a serve logged: the 3.5 serves left (1750 Cal) go into 4.5, about 389 Cal each.
  const halves = m.resizeLot(lot, 4, 5, 'split', 0.5);
  assert.equal(Math.round(m.batchServe({ ...halves, servings: 5 }).calories), 389);
});
