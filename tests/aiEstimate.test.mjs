// How a Gemini estimate becomes a log entry: dishes per serving, single foods per 100 g. npm test (Node 22.6+).
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

register('./resolveTs.mjs', import.meta.url);
const { ESTIMATE_SCHEMA, parseGeminiEstimate } = await import('../src/aiEstimate.ts');

const zeros = { calories: 0, protein: 0, carbs: 0, fat: 0 };
const reply = fields => JSON.stringify({
  source: 'estimate',
  name: 'Test food',
  meal: 'Dinner',
  servingsEaten: 1,
  servingDescription: '',
  servingGrams: 0,
  gramsEaten: 0,
  per100g: zeros,
  assumptions: [],
  confidence: 'medium',
  notes: '',
  ...fields
});
const parse = fields => parseGeminiEstimate(reply(fields), 'Snack');

test('a home-cooked recipe comes back as one serve of it', () => {
  const estimate = parse({
    name: 'Beef mince pasta',
    basis: 'serving',
    servingDescription: '1 of 4 serves',
    total: { calories: 640, protein: 42, carbs: 70, fat: 20 }
  });
  assert.equal(estimate.unitMode, 'serving');
  assert.equal(estimate.portion, 1);
  assert.equal(estimate.base.calories, 640);
  assert.equal(estimate.servingLabel, '1 of 4 serves');
  assert.equal(estimate.servingGrams, 0);
});

test('a dish with grams and per-100 g values stays per serving', () => {
  // Typing ingredients in grams used to tip this into "130 Cal per 100 g x 400 g".
  const dish = {
    name: 'Chicken, rice and broccoli',
    gramsEaten: 400,
    total: { calories: 520, protein: 45, carbs: 55, fat: 12 },
    per100g: { calories: 130, protein: 11.3, carbs: 13.8, fat: 3 }
  };
  for (const estimate of [parse({ ...dish, basis: 'serving' }), parse(dish)]) {
    assert.equal(estimate.unitMode, 'serving');
    assert.equal(estimate.portion, 1);
    assert.equal(estimate.base.calories, 520);
    assert.equal(estimate.servingGrams, 400, 'kept so Per 100g converts exactly');
  }
});

test('a yoghurt read off its label is per 100 g times the grams eaten', () => {
  const estimate = parse({
    source: 'label',
    name: 'Greek yoghurt',
    basis: '100g',
    servingDescription: '1 tub (170 g)',
    servingGrams: 170,
    gramsEaten: 170,
    total: { calories: 112, protein: 16.2, carbs: 9.5, fat: 0.3 },
    per100g: { calories: 66, protein: 9.5, carbs: 5.6, fat: 0.2 }
  });
  assert.equal(estimate.unitMode, '100g');
  assert.equal(estimate.portion, 170);
  assert.deepEqual(estimate.base, { calories: 66, protein: 9.5, carbs: 5.6, fat: 0.2 });
  assert.equal(estimate.servingGrams, 170);
});

test('a label reply from before basis existed is still per 100 g', () => {
  const estimate = parse({
    source: 'label',
    gramsEaten: 45,
    total: { calories: 171, protein: 4.5, carbs: 27, fat: 4.5 },
    per100g: { calories: 380, protein: 10, carbs: 60, fat: 10 }
  });
  assert.equal(estimate.unitMode, '100g');
  assert.equal(estimate.portion, 45);
  assert.equal(estimate.base.calories, 380);
});

test('a weighed single food without per-100 g values works them out from the total', () => {
  const estimate = parse({ basis: '100g', gramsEaten: 150, total: { calories: 195, protein: 4, carbs: 42, fat: 0.5 } });
  assert.equal(estimate.unitMode, '100g');
  assert.equal(estimate.portion, 150);
  assert.equal(estimate.base.calories, 130);
});

test('per 100 g without the grams eaten falls back to per serving', () => {
  const estimate = parse({
    basis: '100g',
    total: { calories: 150, protein: 15, carbs: 12, fat: 4 },
    per100g: { calories: 88, protein: 8.8, carbs: 7, fat: 2.4 }
  });
  assert.equal(estimate.unitMode, 'serving');
  assert.equal(estimate.portion, 1);
  assert.equal(estimate.base.calories, 150);
});

test('several servings split the total, so nothing is counted twice', () => {
  const estimate = parse({ basis: 'serving', servingsEaten: 2, gramsEaten: 300, total: { calories: 820, protein: 20, carbs: 120, fat: 28 } });
  assert.equal(estimate.portion, 2);
  assert.equal(estimate.base.calories, 410);
  assert.equal(estimate.servingGrams, 150);
});

test('the older per-unit reply still reads', () => {
  const estimate = parseGeminiEstimate('{"name":"Latte","unitMode":"serving","amount":"2","meal":"Drink","calories":150,"protein":8,"carbs":12,"fat":7}', 'Snack');
  assert.equal(estimate.unitMode, 'serving');
  assert.equal(estimate.portion, 2);
  assert.equal(estimate.base.calories, 150);
  assert.equal(estimate.servingGrams, 0);
});

test('the schema orders every field it defines, and asks for the basis', () => {
  assert.deepEqual([...ESTIMATE_SCHEMA.propertyOrdering].sort(), Object.keys(ESTIMATE_SCHEMA.properties).sort());
  assert.ok(ESTIMATE_SCHEMA.required.includes('basis'));
});
