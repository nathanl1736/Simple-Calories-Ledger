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
const KEY_PROFILE_CACHE_KEY = 'geminiKeyProfile';
/** How long the last model that answered is trusted before `models.list` is asked again. */
const MODEL_CHOICE_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * How long "this key's plan can't use these models" is remembered. Long enough
 * that a free key doesn't knock on Pro every day; short enough that adding
 * billing is picked up within a week even without tapping Test key.
 */
const PLAN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Real attempts per request. Plan rejections are instant and free, so they don't count. */
const MAX_MODEL_ATTEMPTS = 8;
const MAX_TOTAL_ATTEMPTS = 16;
/** Caps the Test key call so a paid model costs a fraction of a cent. */
const PING_MAX_OUTPUT_TOKENS = 16;

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

type GenerateBody = {
  systemInstruction?: { parts: GeminiTextPart[] };
  contents: Array<{ role: 'user'; parts: GeminiPart[] }>;
  generationConfig?: Record<string, unknown>;
};

type ListModelsResponse = {
  models?: Array<{
    name?: string;
    supportedGenerationMethods?: string[];
  }>;
  nextPageToken?: string;
  error?: { message?: string };
};

/**
 * What Dawni has learned about one key. Stored per key fingerprint, so a new
 * key starts fresh. `paidOnly` is why a free key goes straight to Flash.
 */
type KeyProfile = {
  version: 2;
  keyHash: string;
  /** Last model that answered, and when. Empty until one has. */
  modelId: string;
  resolvedAt: string;
  /** Google tied a rejection on this key to the free tier. */
  freeTier: boolean;
  /** Models this key's plan rejected outright (a zero quota), not just busy. */
  paidOnly: string[];
  planCheckedAt: string;
};

/** What Settings shows about a key without calling Google. */
export type GeminiKeyStatus = {
  modelId: string;
  freeTier: boolean;
  checkedAt: string;
};

/** Result of Test key: the model Dawni verified and what it learned about the plan. */
export type GeminiKeyCheck = {
  modelId: string;
  modelCount: number;
  freeTier: boolean;
  /** Higher models the key lists but its plan doesn't include. */
  paidOnly: string[];
  /** The verified model is the top of the key's list after plan limits. */
  best: boolean;
};

export type GeminiError = Error & { status?: number; detail?: string };

function geminiError(message: string, status = 0, detail = ''): GeminiError {
  const err = new Error(message) as GeminiError;
  err.status = status;
  if (detail && detail !== message) err.detail = detail;
  return err;
}

function isQuotaFailure(status: number, message: string) {
  const m = message.toLowerCase();
  return status === 429
    || m.includes('resource_exhausted')
    || m.includes('exceeded your current quota')
    || m.includes('quota exceeded');
}

/**
 * The key's plan doesn't include this model at all, as opposed to a model that
 * is busy or rate limited for a minute. Since April 2026 a free-tier key gets a
 * 429 with `limit: 0` for Pro models; the text also says "check your plan and
 * billing details", which must not be read as "this key needs billing".
 */
export function isPlanLimited(status: number, message: string) {
  const m = message.toLowerCase();
  if (isQuotaFailure(status, m)) return /limit:\s*0(?!\d)/.test(m);
  if (status === 401 || m.includes('api key not valid') || m.includes('api_key_invalid')) return false;
  return /free[ _-]?tier|paid[ _-]?tier|upgrade your plan|not available (?:on|in|for) (?:the |your )?(?:free|current)/.test(m);
}

/** Google named the free tier in a rejection, so this key is on it. */
function mentionsFreeTier(message: string) {
  return /free[ _-]?tier/i.test(message);
}

/**
 * A key-level failure means every model would fail the same way (bad key, API
 * not enabled, billing broken). Cascading through models would only hide the
 * real fix. Quota errors never count: they're per model, and their text
 * mentions billing even on a healthy free key.
 */
export function isKeyLevelFailure(status: number, message: string) {
  if (isQuotaFailure(status, message) || isPlanLimited(status, message)) return false;
  if (status === 401 || status === 403) return true;
  const m = message.toLowerCase();
  return m.includes('api key not valid')
    || m.includes('api_key_invalid')
    || m.includes('api key expired')
    || m.includes('permission_denied')
    || m.includes('has not been used in project')
    || m.includes('it is disabled')
    || m.includes('serviceusage')
    || m.includes('location is not supported')
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
  if (m.includes('location is not supported')) {
    return 'Google doesn’t offer the Gemini API where you are right now.';
  }
  // Before billing: a free-tier quota error says "check your plan and billing details".
  if (isPlanLimited(status, message)) {
    return 'Your key’s plan doesn’t include the Gemini models Dawni tried. Free keys can use Gemini Flash; Pro models need a paid plan.';
  }
  if (isQuotaFailure(status, message)) {
    if (/prepa(?:id|y)|credits? (?:are |is |have |has )?(?:run out|depleted|exhausted)/.test(m)) {
      return 'Your Gemini prepaid credit has run out. Top it up in Google AI Studio.';
    }
    if (mentionsFreeTier(m)) {
      return 'You’ve hit Gemini’s free-tier limit for now. Wait a minute and try again. Daily limits reset at midnight US Pacific time.';
    }
    return 'Your Gemini key has hit its rate limit. Wait a minute and try again.';
  }
  if (m.includes('billing')) {
    return 'Google says billing on that key’s project isn’t working. Fix it in Google AI Studio, or create a key in a project without billing to use the free tier.';
  }
  if (status === 403 || m.includes('permission_denied')) {
    return 'That key isn’t allowed to call Gemini. Check the key’s restrictions in Google Cloud.';
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
  return !/embedding|embed|aqa|tts|audio|imagen|image|veo|live|vision-only|computer-use|robotics/.test(low);
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
export function rankModelIds(ids: string[]) {
  const usable = [...new Set(ids.filter(Boolean))].filter(isUsableModelId);
  const newestVersion = usable.reduce((max, id) => Math.max(max, familyVersion(id)), 0);
  const score = (id: string) => {
    const version = isAliasId(id) ? Math.max(familyVersion(id), newestVersion) : familyVersion(id);
    return version * 1000 + tierScore(id) * 10 - stabilityPenalty(id);
  };
  return usable.sort((a, b) => score(b) - score(a) || a.length - b.length || a.localeCompare(b));
}

/**
 * Drops models the key's plan rejected and moves everything at or above their
 * tier to the back, so a free key reaches Flash in one hop instead of walking
 * through every Pro variant first. Demoted models are still tried last, in
 * case Google's free tier includes some of them.
 */
export function orderCandidates(ids: string[], paidOnly: Iterable<string>) {
  const blocked = new Set(paidOnly);
  const unique = [...new Set(ids.filter(Boolean))].filter(id => !blocked.has(id));
  if (!blocked.size) return unique;
  const blockedTier = Math.min(...[...blocked].map(tierScore));
  return [
    ...unique.filter(id => tierScore(id) < blockedTier),
    ...unique.filter(id => tierScore(id) >= blockedTier)
  ];
}

/** `gemini-3.1-flash-lite-preview` -> `Gemini 3.1 Flash-Lite (preview)`, for people. */
export function geminiModelLabel(modelId: string) {
  const parts = modelId.replace(/^models\//, '').split('-').filter(Boolean);
  if (parts[0]?.toLowerCase() !== 'gemini') return modelId;
  const words: string[] = [];
  const notes: string[] = [];
  for (const part of parts.slice(1)) {
    const low = part.toLowerCase();
    if (low === 'preview' || low === 'latest' || low === 'exp') notes.push(low);
    else if (low === 'lite' && words.length) words[words.length - 1] += '-Lite';
    else if (/^\d+(?:\.\d+)?$/.test(part) && words.length && !/^\d/.test(words[words.length - 1])) notes.push(part);
    else words.push(/^\d/.test(part) ? part : part[0].toUpperCase() + part.slice(1));
  }
  // Dated or numbered builds (…-05-20, …-001) read as noise; the id is shown alongside.
  const shownNotes = notes.filter(note => !/^\d/.test(note));
  return `Gemini ${words.join(' ')}${shownNotes.length ? ` (${shownNotes.join(', ')})` : ''}`.trim();
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

async function readKeyProfile(apiKey: string): Promise<KeyProfile | null> {
  const cached = await readValue<KeyProfile>(KEY_PROFILE_CACHE_KEY);
  if (!cached || cached.version !== 2 || cached.keyHash !== keyFingerprint(apiKey)) return null;
  const fresh = (iso: string, ttl: number) => {
    const age = Date.now() - Date.parse(iso);
    return Number.isFinite(age) && age >= 0 && age <= ttl;
  };
  const planFresh = fresh(cached.planCheckedAt, PLAN_TTL_MS);
  const modelId = typeof cached.modelId === 'string' && isUsableModelId(cached.modelId) ? cached.modelId : '';
  return {
    ...cached,
    modelId,
    freeTier: planFresh && cached.freeTier === true,
    paidOnly: planFresh && Array.isArray(cached.paidOnly) ? cached.paidOnly.filter(id => typeof id === 'string') : [],
    planCheckedAt: planFresh ? cached.planCheckedAt : ''
  };
}

/** The last model that answered for this key, if recent enough to skip `models.list`. */
function cachedModelId(profile: KeyProfile | null) {
  // A stale plan means re-walking from the top, so a key that gained billing finds Pro again.
  if (!profile?.modelId || !profile.planCheckedAt || profile.paidOnly.includes(profile.modelId)) return '';
  const age = Date.now() - Date.parse(profile.resolvedAt);
  return Number.isFinite(age) && age >= 0 && age <= MODEL_CHOICE_TTL_MS ? profile.modelId : '';
}

async function saveKeyProfile(apiKey: string, profile: Omit<KeyProfile, 'version' | 'keyHash'>) {
  try {
    await saveValue<KeyProfile>(KEY_PROFILE_CACHE_KEY, { version: 2, keyHash: keyFingerprint(apiKey), ...profile });
  } catch {
    // A missing profile only costs one extra models.list call next time.
  }
}

/** What Dawni last learned about this key, for Settings. Never calls Google. */
export async function readGeminiKeyStatus(apiKey: string): Promise<GeminiKeyStatus | null> {
  const key = apiKey.trim();
  if (!key) return null;
  const profile = await readKeyProfile(key);
  if (!profile?.modelId) return null;
  return { modelId: profile.modelId, freeTier: profile.freeTier, checkedAt: profile.resolvedAt };
}

/**
 * Tracks what one request learns about a key's plan as it walks the models,
 * and writes it back so the next request starts on a model that works.
 */
function planTracker(apiKey: string, profile: KeyProfile | null) {
  const paidOnly = new Set(profile?.paidOnly || []);
  let freeTier = profile?.freeTier || false;
  let learned = false;
  return {
    paidOnly,
    get freeTier() {
      return freeTier;
    },
    /** Returns true when the model is out of this key's plan and shouldn't count as an attempt. */
    note(modelId: string, error: GeminiError) {
      const status = error.status ?? 0;
      const raw = error.detail || error.message || '';
      if (mentionsFreeTier(raw) && !freeTier) {
        freeTier = true;
        learned = true;
      }
      if (!isPlanLimited(status, raw)) return false;
      if (!paidOnly.has(modelId)) {
        paidOnly.add(modelId);
        learned = true;
      }
      return true;
    },
    async save(modelId: string) {
      if (!modelId && !learned) return;
      await saveKeyProfile(apiKey, {
        modelId: modelId || profile?.modelId || '',
        resolvedAt: modelId ? new Date().toISOString() : profile?.resolvedAt || '',
        freeTier,
        paidOnly: [...paidOnly],
        planCheckedAt: learned || !profile?.planCheckedAt ? new Date().toISOString() : profile.planCheckedAt
      });
    }
  };
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

async function postGenerate(apiKey: string, modelId: string, body: GenerateBody, signal: AbortSignal | undefined, fallbackError: string) {
  const response = await fetch(`${GEMINI_API_ROOT}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify(body)
  });
  const data = (await response.json().catch(() => null)) as GeminiResponse | null;
  const message = data?.error?.message || '';
  if (!response.ok) {
    throw geminiError(friendlyGeminiMessage(response.status, message, fallbackError), response.status, message);
  }
  if (!data) throw geminiError('Gemini returned an unreadable response.', response.status);
  return data;
}

async function generateOnce(apiKey: string, modelId: string, call: GeminiCall, compat: CompatFlags) {
  const parts: GeminiPart[] = [
    { text: compat.systemInstruction ? call.userText : `${call.systemPrompt}\n\n${call.userText}` },
    ...call.imageParts
  ];
  const data = await postGenerate(apiKey, modelId, {
    ...(compat.systemInstruction ? { systemInstruction: { parts: [{ text: call.systemPrompt }] } } : {}),
    contents: [{ role: 'user', parts }],
    generationConfig: {
      ...temperatureFor(modelId),
      ...(compat.jsonMimeType ? { responseMimeType: 'application/json' } : {}),
      // A schema needs the JSON mime type, so it goes when that goes.
      ...(compat.jsonMimeType && compat.responseSchema && call.responseSchema ? { responseSchema: call.responseSchema } : {})
    }
  }, call.signal, call.fallbackError);
  return responseText(data);
}

/**
 * The smallest real call: proves this key's plan can run the model, which
 * `models.list` can't (a free key lists Pro models it isn't allowed to use).
 * Any 200 counts, even an empty reply from a model that spent its few tokens thinking.
 */
async function pingModel(apiKey: string, modelId: string, signal?: AbortSignal) {
  const contents: GenerateBody['contents'] = [{ role: 'user', parts: [{ text: 'Reply with the word OK.' }] }];
  const fallback = 'Could not reach Gemini.';
  try {
    await postGenerate(apiKey, modelId, { contents, generationConfig: { maxOutputTokens: PING_MAX_OUTPUT_TOKENS } }, signal, fallback);
  } catch (err) {
    // A model that dislikes the token cap shouldn't be written off for it.
    if ((err as GeminiError).status !== 400) throw err;
    await postGenerate(apiKey, modelId, { contents }, signal, fallback);
  }
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
      if (isModelLevelFailure(status, raw) || isPlanLimited(status, raw)) {
        console.warn(`Gemini model "${modelId}" could not be used.`, raw || error.message);
        onModelError(error);
        return null;
      }
      throw error;
    }
  }
  return null;
}

/**
 * Which failure to show when nothing worked. A 404 says least; "not in your
 * plan" is expected on a free key and would hide the real reason the models
 * it can use failed (a used-up daily limit, say).
 */
function informativeness(err: GeminiError) {
  if (err.status === 404) return 0;
  if (isPlanLimited(err.status ?? 0, err.detail || err.message || '')) return 1;
  return 2;
}

function moreInformative(current: GeminiError | null, next: GeminiError) {
  if (!current) return next;
  return informativeness(next) > informativeness(current) ? next : current;
}

/**
 * Walks candidates best-first, re-ordering as the key's plan turns models
 * down. `run` returns a value, or null to move on to the next model.
 */
async function walkModels<T>(
  candidates: string[],
  plan: ReturnType<typeof planTracker>,
  run: (modelId: string) => Promise<T | null>,
  signal?: AbortSignal
) {
  const attempted = new Set<string>();
  let queue = orderCandidates(candidates, plan.paidOnly);
  let counted = 0;
  while (queue.length && counted < MAX_MODEL_ATTEMPTS && attempted.size < MAX_TOTAL_ATTEMPTS) {
    throwIfAborted(signal);
    const modelId = queue.shift()!;
    if (attempted.has(modelId)) continue;
    attempted.add(modelId);
    const blockedBefore = plan.paidOnly.size;
    const value = await run(modelId);
    if (value !== null) return { modelId, value };
    if (plan.paidOnly.size > blockedBefore) queue = orderCandidates(queue, plan.paidOnly);
    else counted += 1;
  }
  return null;
}

/**
 * Test key: finds the best model this key's plan can actually run. Lists the
 * models (free), then makes one tiny call per model from the top until one
 * answers. On a free key the Pro rejections cost nothing and the Flash call
 * uses one free request; on a paid key it's one capped call to the best model.
 */
export async function probeGeminiKey(apiKey: string, signal?: AbortSignal): Promise<GeminiKeyCheck> {
  const key = apiKey.trim();
  if (!key) throw geminiError('Add a Gemini API key first.');
  const ranked = rankModelIds(await listGenerateContentModelIds(key, signal));
  if (!ranked.length) {
    throw geminiError('That key works, but it has no Gemini models that can run estimates.');
  }

  // Start from nothing: Test key is how a key that just gained billing finds Pro again.
  const plan = planTracker(key, null);
  let lastError: GeminiError | null = null;
  const found = await walkModels(ranked, plan, async modelId => {
    try {
      await pingModel(key, modelId, signal);
      return modelId;
    } catch (err) {
      if (isAbortError(err, signal)) throw err;
      const error = err as GeminiError;
      if (isKeyLevelFailure(error.status ?? 0, error.detail || error.message || '')) throw error;
      plan.note(modelId, error);
      lastError = moreInformative(lastError, error);
      return null;
    }
  }, signal);

  await plan.save(found?.modelId || '');
  if (!found) throw lastError || geminiError('Could not reach Gemini.');
  return {
    modelId: found.modelId,
    modelCount: ranked.length,
    freeTier: plan.freeTier,
    paidOnly: ranked.filter(id => plan.paidOnly.has(id)),
    best: found.modelId === orderCandidates(ranked, plan.paidOnly)[0]
  };
}

/**
 * Runs a JSON request against the best model the key can use: the last model
 * that worked first, then every candidate from `models.list` minus the ones
 * the key's plan turned down, then known ids.
 */
async function requestGeminiJson(apiKey: string, call: GeminiCall) {
  const key = apiKey.trim();
  if (!key) throw geminiError('Add a Gemini API key in Settings first.');

  const profile = await readKeyProfile(key);
  const plan = planTracker(key, profile);
  let lastError: GeminiError | null = null;
  let retried = false;
  const run = async (modelId: string) => {
    const onModelError = (err: GeminiError) => {
      plan.note(modelId, err);
      lastError = moreInformative(lastError, err);
    };
    let text = await tryModel(key, modelId, call, onModelError);
    // One second chance when the reply can't be read, on the same model.
    if (text && call.accept && !call.accept(text) && !retried) {
      retried = true;
      throwIfAborted(call.signal);
      const again = await tryModel(key, modelId, { ...call, userText: `${call.userText}\n\n${JSON_RETRY_NOTE}` }, onModelError);
      if (again) text = again;
    }
    return text;
  };
  const finish = async (found: { modelId: string; value: string } | null) => {
    if (found) await plan.save(found.modelId);
    return found?.value ?? null;
  };

  // A warm profile skips the models.list round-trip entirely on the happy path.
  const cached = cachedModelId(profile);
  if (cached) {
    const text = await finish(await walkModels([cached], plan, run, call.signal));
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

  const candidates = [...ranked, ...GEMINI_FALLBACK_MODEL_IDS].filter(id => id !== cached);
  const text = await finish(await walkModels(candidates, plan, run, call.signal));
  if (text) return text;
  await plan.save('');
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
