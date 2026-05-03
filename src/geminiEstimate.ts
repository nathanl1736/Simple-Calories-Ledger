import { AI_QUICK_LOG_PROMPT } from './aiQuickLog';

/** Used only if `models.list` fails or returns no suitable model. */
export const GEMINI_MODEL_FALLBACK = 'gemini-1.5-flash';

type GeminiTextPart = { text: string };
type GeminiInlinePart = { inlineData: { mimeType: string; data: string } };
type GeminiPart = GeminiTextPart | GeminiInlinePart;

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

function modelIdFromApiName(name: string) {
  if (!name) return '';
  return name.startsWith('models/') ? name.slice('models/'.length) : name;
}

function scoreModelId(id: string) {
  const s = id.toLowerCase();
  let score = 0;
  if (s.includes('flash')) score += 200;
  if (s.includes('flash-lite') || s.endsWith('-lite') || s.includes('lite')) score -= 45;
  if (/gemini-2\.[0-9]/.test(s)) score += 85;
  if (/gemini-1\.5/.test(s)) score += 65;
  if (s.includes('gemini') && s.includes('pro')) score += 25;
  if (s.includes('preview') || s.includes('exp')) score -= 12;
  return score * 10000 - id.length;
}

function rankModelIds(ids: string[]) {
  return [...new Set(ids.filter(Boolean))].sort((a, b) => scoreModelId(b) - scoreModelId(a));
}

async function listGenerateContentModelIds(apiKey: string) {
  const collected: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ key: apiKey, pageSize: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?${params.toString()}`);
    const data = (await response.json().catch(() => null)) as ListModelsResponse | null;
    if (!response.ok) {
      throw new Error(data?.error?.message || 'Could not list Gemini models for this API key.');
    }
    if (!data) throw new Error('Could not read Gemini model list.');
    for (const model of data.models || []) {
      const methods = model.supportedGenerationMethods;
      if (!Array.isArray(methods) || !methods.includes('generateContent')) continue;
      const id = modelIdFromApiName(model.name || '');
      if (!id) continue;
      const low = id.toLowerCase();
      if (low.includes('embedding') || low.includes('embed')) continue;
      collected.push(id);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return collected;
}

async function rankedModelIdsForKey(apiKey: string) {
  try {
    const ids = await listGenerateContentModelIds(apiKey);
    const ranked = rankModelIds(ids);
    if (ranked.length) return ranked;
  } catch {
    /* use fallback below */
  }
  return [GEMINI_MODEL_FALLBACK];
}

function inlineImagePart(imageDataUrl: string): GeminiInlinePart {
  const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('Could not prepare the photo for Gemini.');
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
  if (!text) throw new Error('Gemini did not return an estimate.');
  return text;
}

function isRetryableModelError(status: number, message: string) {
  if (status === 429) return true;
  const m = message.toLowerCase();
  return m.includes('quota') || m.includes('resource_exhausted') || m.includes('rate limit');
}

function httpError(status: number, message: string) {
  const err = new Error(message || 'Gemini could not estimate this meal.');
  (err as Error & { status?: number }).status = status;
  return err;
}

async function generateMealEstimateOnce(
  apiKey: string,
  modelId: string,
  parts: GeminiPart[]
) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: AI_QUICK_LOG_PROMPT }]
      },
      contents: [
        {
          role: 'user',
          parts
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json'
      }
    })
  });

  const data = (await response.json().catch(() => null)) as GeminiResponse | null;
  const message = data?.error?.message || '';
  if (!response.ok) {
    throw httpError(response.status, message || 'Gemini could not estimate this meal.');
  }
  if (!data) throw new Error('Gemini returned an unreadable response.');
  return responseText(data);
}

export async function requestMealEstimate({
  apiKey,
  userText,
  imageDataUrl
}: {
  apiKey: string;
  userText: string;
  imageDataUrl?: string | null;
}) {
  const key = apiKey.trim();
  if (!key) throw new Error('Add a Gemini API key in Settings first.');

  const trimmed = userText.trim();
  const textForModel =
    trimmed ||
    (imageDataUrl
      ? 'Photo only: identify the food or meal, estimate it for a calorie tracker, and reply only with the JSON object described in your instructions.'
      : '');
  if (!textForModel && !imageDataUrl) {
    throw new Error('Add a short description or attach a photo.');
  }

  const parts: GeminiPart[] = [{ text: textForModel }];
  if (imageDataUrl) parts.push(inlineImagePart(imageDataUrl));

  const ranked = await rankedModelIdsForKey(key);
  const maxTries = Math.min(8, ranked.length);

  for (let index = 0; index < maxTries; index += 1) {
    const modelId = ranked[index];
    try {
      return await generateMealEstimateOnce(key, modelId, parts);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = (err as Error & { status?: number }).status ?? 0;
      const retry = isRetryableModelError(status, message) && index < maxTries - 1;
      if (!retry) throw err instanceof Error ? err : new Error(message);
    }
  }

  throw new Error('Gemini could not estimate this meal.');
}
