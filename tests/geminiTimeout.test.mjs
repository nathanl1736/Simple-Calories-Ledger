// A Gemini request that stalls gives up on its own, and a visible Cancel stops it. npm test (Node 22.6+).
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

register('./resolveTs.mjs', import.meta.url);
const { withTimeout } = await import('../src/requestTimeout.ts');
const { GEMINI_TIMEOUT_MS, isGeminiAbort, isGeminiTimeout, probeGeminiKey, requestMealEstimate } = await import('../src/geminiEstimate.ts');

const timeoutError = () => Object.assign(new Error('too slow'), { name: 'TimeoutError' });
const never = () => new Promise(() => {});

/** Google, but every request hangs until its signal aborts. Records each request's signal. */
function hangingGemini() {
  const signals = [];
  globalThis.fetch = (url, init = {}) => {
    signals.push(init.signal);
    return new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })));
    });
  };
  return signals;
}

test('the timeout is 45 seconds', () => {
  assert.equal(GEMINI_TIMEOUT_MS, 45_000);
});

test('withTimeout passes a result straight through', async () => {
  const value = await withTimeout(async signal => {
    assert.equal(signal.aborted, false);
    return 'done';
  }, { timeoutMs: 1000, onTimeout: timeoutError });
  assert.equal(value, 'done');
});

test('withTimeout gives up at the deadline even when the work ignores its signal', async () => {
  let given;
  const started = Date.now();
  await assert.rejects(withTimeout(signal => { given = signal; return never(); }, { timeoutMs: 30, onTimeout: timeoutError }), { name: 'TimeoutError' });
  assert.ok(Date.now() - started < 1000);
  assert.equal(given.aborted, true, 'the work is told to stop too');
});

test('withTimeout stops when the caller cancels, and says it was cancelled', async () => {
  const controller = new AbortController();
  let given;
  const pending = withTimeout(signal => { given = signal; return never(); }, { timeoutMs: 5000, signal: controller.signal, onTimeout: timeoutError });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(given.aborted, true);
});

test('withTimeout never starts work for a request already cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  let ran = false;
  await assert.rejects(withTimeout(async () => { ran = true; }, { timeoutMs: 1000, signal: controller.signal, onTimeout: timeoutError }), { name: 'AbortError' });
  assert.equal(ran, false);
});

test('withTimeout keeps the work’s own error', async () => {
  await assert.rejects(withTimeout(async () => { throw new Error('Gemini is busy right now.'); }, { timeoutMs: 1000, onTimeout: timeoutError }), /busy/);
});

test('a stalled estimate times out with calm copy and aborts the fetch', async () => {
  const signals = hangingGemini();
  globalThis.__dawniGeminiTimeoutMs = 40;
  try {
    const err = await requestMealEstimate({ apiKey: 'slow-key', userText: 'toast' }).then(() => null, e => e);
    assert.ok(err, 'it rejects');
    assert.equal(isGeminiTimeout(err), true);
    assert.equal(isGeminiAbort(err), false);
    assert.equal(err.message, 'Gemini is taking too long. Try again, or type it in.');
    assert.ok(signals.length >= 1);
    assert.ok(signals.every(signal => signal?.aborted), 'every fetch it started was aborted');
  } finally {
    delete globalThis.__dawniGeminiTimeoutMs;
  }
});

test('Cancel stops an estimate straight away', async () => {
  const signals = hangingGemini();
  const controller = new AbortController();
  const pending = requestMealEstimate({ apiKey: 'slow-key', userText: 'toast', signal: controller.signal });
  setTimeout(() => controller.abort(), 15);
  const err = await pending.then(() => null, e => e);
  assert.equal(isGeminiAbort(err), true);
  assert.equal(isGeminiTimeout(err), false);
  assert.ok(signals.every(signal => signal?.aborted));
});

test('Test key has the same timeout', async () => {
  hangingGemini();
  globalThis.__dawniGeminiTimeoutMs = 30;
  try {
    await assert.rejects(probeGeminiKey('slow-key'), err => isGeminiTimeout(err));
  } finally {
    delete globalThis.__dawniGeminiTimeoutMs;
  }
});

test('a request that answers in time is unaffected', async () => {
  globalThis.fetch = async url => {
    const path = new URL(url).pathname;
    const body = path.endsWith('/models')
      ? { models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }
      : { candidates: [{ content: { parts: [{ text: '{"name":"Toast","calories":90}' }] } }] };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  globalThis.__dawniGeminiTimeoutMs = 2000;
  try {
    assert.equal(await requestMealEstimate({ apiKey: 'quick-key', userText: 'toast' }), '{"name":"Toast","calories":90}');
  } finally {
    delete globalThis.__dawniGeminiTimeoutMs;
  }
});
