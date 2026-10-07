// Which Gemini model a key ends up on: a free key falls through Pro to Flash, a paid key keeps the best. npm test (Node 22.6+).
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

register('./resolveTs.mjs', import.meta.url);
const {
  friendlyGeminiMessage,
  geminiModelLabel,
  isKeyLevelFailure,
  isPlanLimited,
  orderCandidates,
  probeGeminiKey,
  rankModelIds,
  requestMealEstimate
} = await import('../src/geminiEstimate.ts');

// Google's 429 for a model outside the key's plan. It mentions billing, which is the trap.
const planLimit = model => `You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.
* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count, limit: 0, model: ${model}
* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: ${model}
Please retry in 41.2s.`;
// The same 429 once a free model's own daily allowance is used up.
const freeLimitUsed = model => `You exceeded your current quota, please check your plan and billing details.
* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 250, model: ${model}
Please retry in 12.5s.`;

const MODELS = [
  'gemini-3.1-pro-preview',
  'gemini-pro-latest',
  'gemini-2.5-pro',
  'gemini-flash-latest',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-3.1-flash-lite-preview',
  'text-embedding-004'
];
const ESTIMATE_JSON = JSON.stringify({ name: 'Toast', calories: 90 });

/** Stands in for Google: `generate(modelId)` returns [status, errorMessage] or null for success. */
function mockGemini(generate, { list = MODELS, listError = null } = {}) {
  const calls = [];
  globalThis.fetch = async url => {
    const path = new URL(url).pathname;
    if (path.endsWith('/models')) {
      calls.push('list');
      if (listError) return json(listError[0], { error: { message: listError[1] } });
      return json(200, { models: list.map(id => ({ name: `models/${id}`, supportedGenerationMethods: ['generateContent'] })) });
    }
    const modelId = decodeURIComponent(path.split('/models/')[1].split(':')[0]);
    calls.push(modelId);
    const failure = generate(modelId);
    if (failure) return json(failure[0], { error: { message: failure[1] } });
    return json(200, { candidates: [{ content: { parts: [{ text: ESTIMATE_JSON }] } }] });
  };
  return calls;
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const freeKey = id => (id.includes('pro') ? [429, planLimit(id)] : null);
const estimate = key => requestMealEstimate({ apiKey: key, userText: 'toast' });

test('a free-tier rejection is a model problem, not a key that needs billing', () => {
  const message = planLimit('gemini-3.1-pro-preview');
  assert.equal(isPlanLimited(429, message), true);
  assert.equal(isKeyLevelFailure(429, message), false);
  assert.doesNotMatch(friendlyGeminiMessage(429, message), /needs billing/i);

  const used = freeLimitUsed('gemini-2.5-flash');
  assert.equal(isPlanLimited(429, used), false);
  assert.equal(isKeyLevelFailure(429, used), false);
  assert.match(friendlyGeminiMessage(429, used), /free-tier limit/);
});

test('real key problems still stop straight away', () => {
  assert.equal(isKeyLevelFailure(400, 'API key not valid. Please pass a valid API key.'), true);
  assert.equal(isKeyLevelFailure(403, 'This API method requires billing to be enabled. BILLING_DISABLED'), true);
  assert.equal(isKeyLevelFailure(400, 'User location is not supported for the API use.'), true);
  assert.match(friendlyGeminiMessage(403, 'This API method requires billing to be enabled.'), /billing/);
});

test('Test key on a free key settles on Flash and says it is the free tier', async () => {
  const calls = mockGemini(freeKey);
  const result = await probeGeminiKey('free-key');
  assert.match(result.modelId, /flash/);
  assert.doesNotMatch(result.modelId, /lite/);
  assert.equal(result.freeTier, true);
  assert.equal(result.best, true);
  assert.deepEqual(result.paidOnly, [calls[1]]);
  // One Pro rejection is enough to skip the other Pro models.
  assert.equal(calls.filter(id => id.includes('pro')).length, 1);
  assert.equal(result.modelCount, 7);
});

test('Test key on a paid key keeps the best model', async () => {
  const calls = mockGemini(() => null);
  const result = await probeGeminiKey('paid-key');
  assert.equal(result.modelId, rankModelIds(MODELS)[0]);
  assert.match(result.modelId, /pro/);
  assert.equal(result.freeTier, false);
  assert.equal(result.best, true);
  assert.deepEqual(calls, ['list', result.modelId]);
});

test('an estimate on a free key falls through to Flash instead of asking for billing', async () => {
  const calls = mockGemini(freeKey);
  assert.equal(await estimate('free-key'), ESTIMATE_JSON);
  assert.equal(calls.filter(id => id.includes('pro')).length, 1);
  assert.match(calls.at(-1), /flash/);
});

test('when the free allowance is used up, that is what the person is told', async () => {
  mockGemini(id => (id.includes('pro') ? [429, planLimit(id)] : [429, freeLimitUsed(id)]));
  await assert.rejects(estimate('free-key'), /free-tier limit/);
});

test('a key Google rejects is reported without trying every model', async () => {
  const calls = mockGemini(() => null, { listError: [400, 'API key not valid. Please pass a valid API key.'] });
  await assert.rejects(estimate('bad-key'), /isn’t valid/);
  assert.deepEqual(calls, ['list']);
});

test('broken billing on the project stops at the first model', async () => {
  const calls = mockGemini(() => [403, 'This API method requires billing to be enabled. BILLING_DISABLED']);
  await assert.rejects(estimate('billing-key'), /billing/);
  assert.equal(calls.filter(id => id !== 'list').length, 1);
});

test('plan-limited models drop out and their tier waits behind the rest', () => {
  const ranked = rankModelIds(MODELS);
  const ordered = orderCandidates(ranked, ['gemini-3.1-pro-preview']);
  assert.ok(!ordered.includes('gemini-3.1-pro-preview'));
  const firstPro = ordered.findIndex(id => id.includes('pro'));
  const lastOther = ordered.findLastIndex(id => !id.includes('pro'));
  assert.ok(firstPro > lastOther, ordered.join(', '));
  assert.deepEqual(orderCandidates(['a', 'a', 'b'], []), ['a', 'b']);
});

test('model ids read as names', () => {
  assert.equal(geminiModelLabel('gemini-3.1-flash-lite-preview'), 'Gemini 3.1 Flash-Lite (preview)');
  assert.equal(geminiModelLabel('gemini-flash-latest'), 'Gemini Flash (latest)');
  assert.equal(geminiModelLabel('gemini-2.5-pro'), 'Gemini 2.5 Pro');
  assert.equal(geminiModelLabel('gemini-2.0-flash-001'), 'Gemini 2.0 Flash');
  assert.equal(geminiModelLabel('gemini-2.5-flash-preview-05-20'), 'Gemini 2.5 Flash (preview)');
  assert.equal(geminiModelLabel('something-else'), 'something-else');
});
