// Food search, run straight from src/foodSearch.ts: npm test.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { nameHasWordStarting, scoreFoodSearch, tokeniseQuery } = await import('../src/foodSearch.ts');

test('one letter is too short to rank on, which made it match every food', () => {
  assert.deepEqual(tokeniseQuery('b'), []);
  assert.equal(scoreFoodSearch({ name: 'Flat white' }, 'b'), 0);
});

test('one letter finds names with a word starting with it', () => {
  assert.equal(nameHasWordStarting('Banana', 'b'), true);
  assert.equal(nameHasWordStarting('Oats with banana and milk', 'B'), true, 'any word, any case');
  assert.equal(nameHasWordStarting('Flat white', 'b'), false);
  assert.equal(nameHasWordStarting('Açaí bowl', 'a'), true, 'accents fold away');
  assert.equal(nameHasWordStarting('Tim Tam', '!'), false, 'punctuation alone finds nothing');
});

test('two letters or more still rank, best match first', () => {
  assert.deepEqual(tokeniseQuery('Maccas fries'), ['mcdonalds', 'fries']);
  assert.ok(scoreFoodSearch({ name: 'Flat white' }, 'flat') > scoreFoodSearch({ name: 'White chocolate flat bread' }, 'flat'));
  assert.equal(scoreFoodSearch({ name: 'Flat white' }, 'latte'), -1, 'no match');
});
