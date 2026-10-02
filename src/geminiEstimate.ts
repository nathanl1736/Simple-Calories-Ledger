import { ESTIMATE_SCHEMA, GEMINI_ESTIMATE_PROMPT, JSON_RETRY_NOTE } from './aiEstimate';
import { MENU_PICK_PROMPT, MENU_PICK_SCHEMA } from './menuPick';
import { readValue, saveValue } from './storage';

/**
 * Model selection is dynamic: we ask the key which models it can actually use
 * (`models.list`), rank them newest-family-first, and cascade down the list when
 * a model rejects the call. Nothing here names a required model, so a new Gemini
 * family is picked up without a code change.
 *
 * This chain is only a last resort for when `models.list` itself fails. Prefer
 * `-latest` aliases here because they keep working after a model is retired.
 */
export const GEMINI_FALLBACK_MODEL_IDS = [
  'gemini-pro-latest',
  'gemini-flash-latest',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash'
];

const GEMINI_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_CHOICE_CACHE_KEY = 'geminiModelChoice';
const MODEL_CHOICE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_MODEL_ATTEMPTS = 8;

type GeminiTextPart = { text: string };
type GeminiInlinePart = { inlineData: { mimeType: string; data: string } };
type GeminiPart = GeminiTextPart | GeminiInlinePart;

/** Per-model capability downgrades, turned on only after a model complains. */
type CompatFlags = {
  /** false = stop asking for `responseMimeType: application/json`. */
  jsonMimeType: boolean;
  /** false = fold the prompt into the user turn instead of `systemInstruction`. */
  systemInstruction: boolean;
  /** false = stop sending `responseSchema` and rely on the prompt's JSON shape. */
  responseSchema: boolean;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

type ListModelsResponse = {
  models?: Array<{
    name?: string;
    supportedGenerationMethods?: string[];
  }>;
  nextPageToken?: string;
  error?: { message?: string };
};

type ModelChoiceCache = {
  version: 1;
  keyHash: string;
  modelId: string;
  resolvedAt: string;
};

export type GeminiError = Error & { status?: number; detail?: string };

function geminiError(message: string, status = 0, detail = ''): GeminiError {
  const err = new Error(message) as GeminiError;
  err.status = status;
  if (detail && detail !== message) err.detail = detail;
  return err;
}

/**
 * A key-level failure means every model would fail the same way (bad key, API
 * not enabled, billing). Cascading through models would only hide the real fix.
 */
function isKeyLevelFailure(status: number, message: string) {
  if (status === 401 || status === 403) return true;
  const m = message.toLowerCase();
  return m.includes('api key not valid')
    || m.includes('api_key_invalid')
    || m.includes('api key expired')
    || m.includes('permission_denied')
    || m.includes('has not been used in project')
    || m.includes('it is disabled')
    || m.includes('serviceusage')
    || m.includes('billing');
}

/** A model-level failure means this model is wrong for us — try the next one. */
function isModelLevelFailure(status: number, message: string) {
  if (status === 404 || status === 400 || status === 429 || status === 500 || status === 501 || status === 503) return true;
  const m = message.toLowerCase();
  return m.includes('not found')
    || m.includes('not supported')
    || m.includes('unsupported')
    || m.includes('quota')
    || m.includes('resource_exhausted')
    || m.includes('rate limit')
    || m.includes('overloaded');
}

/** Which capability a 400 is complaining about, so we can retry without it. */
function unsupportedCapability(message: string): keyof CompatFlags | null {
  const m = message.toLowerCase();
  if (m.includes('response_schema') || m.includes('responseschema') || m.includes('schema')) return 'responseSchema';
  if (m.includes('response_mime_type') || m.includes('responsemimetype')) return 'jsonMimeType';
  if (m.includes('system_instruction') || m.includes('systeminstruction')) return 'systemInstruction';
  return null;
}

/** Calm, actionable copy for the cases a new user actually hits. */
export function friendlyGeminiMessage(status: number, message: string, fallback = 'Gemini could not estimate this meal.') {
  const m = message.toLowerCase();
  if (m.includes('api key not valid') || m.includes('api_key_invalid') || status === 401) {
    return 'That Gemini API key isn’t valid. Check you copied the whole key from Google AI Studio.';
  }
  if (m.includes('api key expired')) {
    return 'That Gemini API key has expired. Create a new key in Google AI Studio.';
  }
  if (m.includes('has not been used in project') || m.includes('it is disabled') || m.includes('serviceusage')) {
    return 'Gemini isn’t enabled for that Google project yet. Enable the Generative Language API, then try again.';
  }
  if (m.includes('billing')) {
    return 'That Google project needs billing set up before Gemini will respond.';
  }
  if (status === 403 || m.includes('permission_denied')) {
    return 'That key isn’t allowed to call Gemini. Check the key’s restrictions in Google Cloud.';
  }
  if (status === 429 || m.includes('quota') || m.includes('resource_exhausted') || m.includes('rate limit')) {
    return 'Your Gemini key has hit its quota. Wait a little, or check quota and billing in Google Cloud.';
  }
  if (status === 503 || m.includes('overloaded')) {
    return 'Gemini is busy right now. Try again in a moment.';
  }
  if (status === 404 || m.includes('not found')) {
    return 'None of the Gemini models available to this key could handle this request.';
  }
  return message || fallback;
}

function modelIdFromApiName(name: string) {
  if (!name) return '';
  return name.startsWith('models/') ? name.slice('models/'.length) : name;
}

/**
 * Numeric family version, so a newer family outranks an older one without any
 * per-release code change. `gemini-2.5-flash` -> 250, `gemini-3-pro` -> 300.
 */
function familyVersion(id: string) {
  const match = id.match(/gemini-(\d+)(?:[.-](\d+))?/);
  if (!match) return 0;
  const major = Number(match[1]) || 0;
  const minor = Number(match[2] ?? 0) || 0;
  return major * 100 + Math.min(99, minor);
}

/** Capability tier. "Best available" means a higher tier wins inside a family. */
function tierScore(id: string) {
  if (id.includes('ultra')) return 40;
  if (id.includes('pro')) return 30;
  if (id.includes('lite')) return 10;
  if (id.includes('flash')) return 20;
  return 15;
}

/** Models that answer `generateContent` but can't do our text+photo JSON call. */
function isUsableModelId(id: string) {
  const low = id.toLowerCase();
  if (!low.startsWith('gemini')) return false;
  return !/embedding|embed|aqa|tts|audio|imagen|image|veo|live|vision-only/.test(low);
}

function isAliasId(id: string) {
  return id.endsWith('-latest');
}

function isPreviewId(id: string) {
  return /preview|exp\b|experimental/.test(id);
}

/** Dated snapshots (…-001, …-05-20) are pinned builds; prefer the moving id. */
function isSnapshotId(id: string) {
  return /-\d{2,4}(?:-\d{2})?$/.test(id) && !isAliasId(id);
}

/**
 * How dependable an id is, once family and tier are equal. A stable explicit id
 * is the most predictable; a `-latest` alias is stable but can move under us; a
 * preview can have tighter quota and be withdrawn. So: stable > alias > preview.
 */
function stabilityPenalty(id: string) {
  if (isPreviewId(id)) return 8;
  if (isAliasId(id)) return 3;
  if (isSnapshotId(id)) return 2;
  return 0;
}

/**
 * Best-first: newest family, then highest tier, then most dependable. Aliases
 * inherit the newest observed family version because Google points them at the
 * current model, so `gemini-pro-latest` beats a previous family but loses to a
 * stable id in the newest one.
 */
function rankModelIds(ids: string[]) {
  const usable = [...new Set(ids.filter(Boolean))].filter(isUsableModelId);
  const newestVersion = usable.reduce((max, id) => Math.max(max, familyVersion(id)), 0);
  const score = (id: string) => {
    const version = isAliasId(id) ? Math.max(familyVersion(id), newestVersion) : familyVersion(id);
    return version * 1000 + tierScore(id) * 10 - stabilityPenalty(id);
  };
  return usable.sort((a, b) => score(b) - score(a) || a.length - b.length || a.localeCompare(b));
}

async function listGenerateContentModelIds(apiKey: string, signal?: AbortSignal) {
  const collected: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ key: apiKey, pageSize: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await fetch(`${GEMINI_API_ROOT}/models?${params.toString()}`, { signal });
    const data = (await response.json().catch(() => null)) as ListModelsResponse | null;
    const message = data?.error?.message || '';
    if (!response.ok) {
      throw geminiError(friendlyGeminiMessage(response.status, message), response.status, message);
    }
    if (!data) throw geminiError('Could not read the Gemini model list.', response.status);
    for (const model of data.models || []) {
      const methods = model.supportedGenerationMethods;
      if (!Array.isArray(methods) || !methods.includes('generateContent')) continue;
      const id = modelIdFromApiName(model.name || '');
      if (id) collected.push(id);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return collected;
}

/** Local-only discriminator so a changed key doesn't reuse a stale model choice. */
function keyFingerprint(apiKey: string) {
  let hash = 2166136261;
  for (let i = 0; i < apiKey.length; i += 1) {
    hash ^= apiKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(36)}:${apiKey.length}`;
}

async function readCachedModelId(apiKey: string) {
  const cached = await readValue<ModelChoiceCache>(MODEL_CHOICE_CACHE_KEY);
  if (!cached || cached.version !== 1 || cached.keyHash !== keyFingerprint(apiKey)) return '';
  if (!cached.modelId || !isUsableModelId(cached.modelId)) return '';
  const age = Date.now() - Date.parse(cached.resolvedAt);
  if (!Number.isFinite(age) || age < 0 || age > MODEL_CHOICE_TTL_MS) return '';
  return cached.modelId;
}

async function saveCachedModelId(apiKey: string, modelId: string) {
  try {
    await saveValue<ModelChoiceCache>(MODEL_CHOICE_CACHE_KEY, {
      version: 1,
      keyHash: keyFingerprint(apiKey),
      modelId,
      resolvedAt: new Date().toISOString()
    });
  } catch {
    // A missing cache only costs one extra models.list call next time.
  }
}

function inlineImagePart(imageDataUrl: string): GeminiInlinePart {
  const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw geminiError('Could not prepare the photo for Gemini.');
  return {
    inlineData: {
      mimeType: match[1],
      data: match[2]
    }
  };
}

function responseText(data: GeminiResponse) {
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts.map(part => part.text || '').join('\n').trim();
  if (!text) throw geminiError('Gemini sent back an empty reply. Try again.');
  return text;
}

/** One generateContent request: instructions, the user's text and any photos. */
type GeminiCall = {
  systemPrompt: string;
  userText: string;
  imageParts: GeminiInlinePart[];
  /** Locks the reply to this shape where the model supports structured output. */
  responseSchema?: object;
  /** Whether a reply is usable; an unusable one is retried once. */
  accept?: (text: string) => boolean;
  signal?: AbortSignal;
  fallbackError: string;
};

/**
 * Gemini 3 and later are tuned for the default temperature (1.0); Google warns
 * that lowering it can cause looping or weaker reasoning. Older families get a
 * low temperature for steadier numbers. Aliases may point at a new family, so
 * only explicit 1.x/2.x ids are lowered.
 */
function temperatureFor(modelId: string) {
  return /^gemini-[12](?:[.-]|$)/.test(modelId) ? { temperature: 0.2 } : {};
}

function isAbortError(err: unknown, signal?: AbortSignal) {
  return !!signal?.aborted || (err instanceof Error && err.name === 'AbortError');
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const err = new Error('Request cancelled.');
    err.name = 'AbortError';
    throw err;
  }
}

async function generateOnce(apiKey: string, modelId: string, call: GeminiCall, compat: CompatFlags) {
  const parts: GeminiPart[] = [
    { text: compat.systemInstruction ? call.userText : `${call.systemPrompt}\n\n${call.userText}` },
    ...call.imageParts
  ];

  const response = await fetch(`${GEMINI_API_ROOT}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: call.signal,
    body: JSON.stringify({
      ...(compat.systemInstruction ? { systemInstruction: { parts: [{ text: call.systemPrompt }] } } : {}),
      contents: [{ role: 'user', parts }],
      generationConfig: {
        ...temperatureFor(modelId),
        ...(compat.jsonMimeType ? { responseMimeType: 'application/json' } : {}),
        // A schema needs the JSON mime type, so it goes when that goes.
        ...(compat.jsonMimeType && compat.responseSchema && call.responseSchema ? { responseSchema: call.responseSchema } : {})
      }
    })
  });

  const data = (await response.json().catch(() => null)) as GeminiResponse | null;
  const message = data?.error?.message || '';
  if (!response.ok) {
    throw geminiError(friendlyGeminiMessage(response.status, message, call.fallbackError), response.status, message);
  }
  if (!data) throw geminiError('Gemini returned an unreadable response.', response.status);
  return responseText(data);
}

/**
 * Tries one model, stepping down capabilities if the model rejects a feature
 * rather than the request. Returns null when the model itself is unusable.
 */
async function tryModel(
  apiKey: string,
  modelId: string,
  call: GeminiCall,
  onModelError: (err: GeminiError) => void
) {
  const compat: CompatFlags = { jsonMimeType: true, systemInstruction: true, responseSchema: true };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await generateOnce(apiKey, modelId, call, compat);
    } catch (err) {
      if (isAbortError(err, call.signal)) throw err;
      const error = err as GeminiError;
      const status = error.status ?? 0;
      const raw = error.detail || error.message || '';
      if (isKeyLevelFailure(status, raw)) throw error;

      const capability = status === 400 ? unsupportedCapability(raw) : null;
      if (capability && compat[capability]) {
        compat[capability] = false;
        continue;
      }
      if (isModelLevelFailure(status, raw)) {
        console.warn(`Gemini model "${modelId}" could not be used.`, raw || error.message);
        onModelError(error);
        return null;
      }
      throw error;
    }
  }
  return null;
}

/** 404 tells us least, so keep a more specific error when one turns up. */
function moreInformative(current: GeminiError | null, next: GeminiError) {
  if (!current) return next;
  if (current.status === 404 && next.status !== 404) return next;
  return current;
}

/**
 * Checks a key without spending a generate call: `models.list` is free.
 * Returns the model Dawni would use and how many candidates the key exposes.
 */
export async function probeGeminiKey(apiKey: string) {
  const key = apiKey.trim();
  if (!key) throw geminiError('Add a Gemini API key first.');
  const ranked = rankModelIds(await listGenerateContentModelIds(key));
  if (!ranked.length) {
    throw geminiError('That key works, but it has no Gemini models that can run estimates.');
  }
  await saveCachedModelId(key, ranked[0]);
  return { modelId: ranked[0], modelCount: ranked.length };
}

/**
 * Runs a JSON request against the best model the key can use: the cached
 * choice first, then every candidate from `models.list`, then known ids.
 */
async function requestGeminiJson(apiKey: string, call: GeminiCall) {
  const key = apiKey.trim();
  if (!key) throw geminiError('Add a Gemini API key in Settings first.');

  let lastError: GeminiError | null = null;
  const onModelError = (err: GeminiError) => {
    lastError = moreInformative(lastError, err);
  };
  const attempted = new Set<string>();
  let retried = false;
  const attempt = async (modelId: string) => {
    throwIfAborted(call.signal);
    if (!modelId || attempted.has(modelId) || attempted.size >= MAX_MODEL_ATTEMPTS) return null;
    attempted.add(modelId);
    let text = await tryModel(key, modelId, call, onModelError);
    // One second chance when the reply can't be read, on the same model.
    if (text && call.accept && !call.accept(text) && !retried) {
      retried = true;
      throwIfAborted(call.signal);
      const again = await tryModel(key, modelId, { ...call, userText: `${call.userText}\n\n${JSON_RETRY_NOTE}` }, onModelError);
      if (again) text = again;
    }
    if (text) await saveCachedModelId(key, modelId);
    return text;
  };

  // A warm cache skips the models.list round-trip entirely on the happy path.
  const cachedModelId = await readCachedModelId(key);
  if (cachedModelId) {
    const text = await attempt(cachedModelId);
    if (text) return text;
  }

  let ranked: string[] = [];
  try {
    ranked = rankModelIds(await listGenerateContentModelIds(key, call.signal));
  } catch (err) {
    if (isAbortError(err, call.signal)) throw err;
    const error = err as GeminiError;
    // A bad key or disabled API breaks every model, so say so instead of guessing.
    if (isKeyLevelFailure(error.status ?? 0, error.detail || error.message || '')) throw error;
    console.warn('Could not list Gemini models; falling back to known model ids.', error.detail || error.message);
    lastError = moreInformative(lastError, error);
  }

  for (const modelId of [...ranked, ...GEMINI_FALLBACK_MODEL_IDS]) {
    const text = await attempt(modelId);
    if (text) return text;
    if (attempted.size >= MAX_MODEL_ATTEMPTS) break;
  }

  throw lastError || geminiError(call.fallbackError);
}

/** Estimates a meal, product or label; `userText` is built by `buildEstimateRequest`. */
export async function requestMealEstimate({
  apiKey,
  userText,
  imageDataUrls = [],
  accept,
  signal
}: {
  apiKey: string;
  userText: string;
  imageDataUrls?: string[];
  accept?: (text: string) => boolean;
  signal?: AbortSignal;
}) {
  return requestGeminiJson(apiKey, {
    systemPrompt: GEMINI_ESTIMATE_PROMPT,
    userText,
    imageParts: imageDataUrls.map(inlineImagePart),
    responseSchema: ESTIMATE_SCHEMA,
    accept,
    signal,
    fallbackError: 'Gemini could not estimate this meal.'
  });
}

/** Asks Gemini to choose from photographed menu pages; `userText` carries the day's numbers. */
export async function requestMenuPick({
  apiKey,
  userText,
  imageDataUrls,
  accept,
  signal
}: {
  apiKey: string;
  userText: string;
  imageDataUrls: string[];
  accept?: (text: string) => boolean;
  signal?: AbortSignal;
}) {
  if (!imageDataUrls.length) throw geminiError('Add at least one photo of the menu.');
  return requestGeminiJson(apiKey, {
    systemPrompt: MENU_PICK_PROMPT,
    userText,
    imageParts: imageDataUrls.map(inlineImagePart),
    responseSchema: MENU_PICK_SCHEMA,
    accept,
    signal,
    fallbackError: 'Gemini could not suggest anything from this menu.'
  });
}
