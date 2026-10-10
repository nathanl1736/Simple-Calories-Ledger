// Mock of the Google Generative Language API for the Dawni audit.
//
// The app (src/geminiEstimate.ts) first lists models, ranks them, then calls generateContent on the best one.
// installGeminiMock() answers both, and picks the reply that matches the request: the user text of the request
// starts with ESTIMATE REQUEST, BATCH ESTIMATE REQUEST or MENU PICK REQUEST (src/aiEstimate.ts, mealPrep.ts,
// menuPick.ts); Test key sends "Reply with the word OK.".
//
// controller.mode:
//   ok          everything works, on the best model (Gemini 2.5 Pro)
//   free        Pro models answer 429 "limit: 0" (free tier), Flash works
//   rate        every model answers 429 RESOURCE_EXHAUSTED
//   daily       every model answers 429 with a free-tier daily limit
//   badkey      400 API key not valid, on models.list and generateContent
//   busy        503 overloaded on every model
//   unreadable  200, but the text is not the JSON the app asked for
// controller.delayMs holds generateContent replies back, so a loading state can be photographed.

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };

const MODELS = [
  { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent', 'countTokens'] },
  { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
  { name: 'models/gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash-Lite', supportedGenerationMethods: ['generateContent', 'countTokens'] },
  { name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
  { name: 'models/text-embedding-004', displayName: 'Text Embedding 004', supportedGenerationMethods: ['embedContent'] }
];

/* ---- payloads that match ESTIMATE_SCHEMA, BATCH_SCHEMA and MENU_PICK_SCHEMA ---- */

export const ESTIMATE_BOWL = {
  source: 'estimate', name: 'Chicken burrito bowl', meal: 'Lunch', basis: 'serving', servingsEaten: 1, servingDescription: '1 bowl', servingGrams: 0, gramsEaten: 0,
  total: { calories: 720, protein: 42, carbs: 70, fat: 28 }, per100g: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  assumptions: ['Regular size bowl', 'Rice, black beans, chicken, salsa, cheese and guacamole', 'Sour cream included'],
  confidence: 'medium', notes: 'Chicken, rice, beans, cheese, guacamole and salsa in a bowl.'
};

export const ESTIMATE_BOWL_SMALL = {
  ...ESTIMATE_BOWL, name: 'Chicken burrito bowl (small, no sour cream)', servingDescription: '1 small bowl',
  total: { calories: 610, protein: 41, carbs: 64, fat: 21 },
  assumptions: ['Small bowl', 'No sour cream', 'Rice, black beans, chicken, salsa, cheese and guacamole'], confidence: 'medium',
  notes: 'A smaller bowl without sour cream.'
};

export const ESTIMATE_LABEL = {
  source: 'label', name: 'Chobani Fit Greek Yogurt, Vanilla', meal: 'Snack', basis: '100g', servingsEaten: 1, servingDescription: '1 tub (170 g)', servingGrams: 170, gramsEaten: 170,
  total: { calories: 105, protein: 16, carbs: 8.8, fat: 0.7 }, per100g: { calories: 62, protein: 9.4, carbs: 5.2, fat: 0.4 },
  assumptions: ['Ate the whole 170 g tub'], confidence: 'high', notes: 'Read from the nutrition information panel.'
};

const MINCE = [
  { name: 'White rice, uncooked', amount: '500 g', calories: 1800, protein: 34, carbs: 394, fat: 3 },
  { name: 'Beef mince, 4 star', amount: '1 kg', calories: 1300, protein: 200, carbs: 0, fat: 50 },
  { name: 'Olive oil', amount: '1 tbsp', calories: 120, protein: 0, carbs: 0, fat: 14 },
  { name: 'Iceberg lettuce', amount: '1 whole', calories: 70, protein: 5, carbs: 12, fat: 1 },
  { name: 'Teriyaki sauce', amount: '1/2 cup', calories: 130, protein: 6, carbs: 24, fat: 0 }
];
const sum = list => list.reduce((a, i) => ({ calories: a.calories + i.calories, protein: a.protein + i.protein, carbs: a.carbs + i.carbs, fat: a.fat + i.fat }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

export const BATCH_RESULT = {
  name: 'Beef mince rice bowl', ingredients: MINCE, total: sum(MINCE),
  assumptions: ['Rice weighed uncooked', 'Mince not drained', 'Teriyaki sauce about 130 Cal per half cup'], confidence: 'medium',
  notes: 'Beef mince and rice with lettuce and teriyaki sauce.'
};
const MINCE_5STAR = MINCE.map(i => i.name.startsWith('Beef') ? { ...i, name: 'Beef mince, 5 star', calories: 1150, fat: 35 } : i);
export const BATCH_REFINED = { ...BATCH_RESULT, ingredients: MINCE_5STAR, total: sum(MINCE_5STAR), assumptions: ['Rice weighed uncooked', 'Mince is 5 star, not drained'], confidence: 'high' };

export const MENU_RESULT = {
  menuReadable: true,
  pick: {
    name: 'Grilled chicken Caesar salad (dressing on the side)', calories: 520, protein: 46, carbs: 22, fat: 28,
    reason: 'High in protein and fits what is left for lunch.', tip: 'Ask for the dressing on the side.', fromMenu: false,
    assumptions: ['Regular serve', 'Bacon and parmesan included'], confidence: 'medium'
  },
  alternatives: [
    { name: 'Salmon poke bowl', calories: 480, protein: 34, carbs: 52, fat: 14, reason: 'A lighter option with plenty of protein.', tip: '', fromMenu: true, assumptions: [], confidence: 'high' },
    { name: 'Beef burrito bowl', calories: 640, protein: 40, carbs: 60, fat: 24, reason: 'More filling if lunch is your biggest meal.', tip: 'Skip the sour cream.', fromMenu: false, assumptions: ['Large serve of rice'], confidence: 'medium' }
  ],
  summary: 'You have about 710 Cal and 75 g of protein left today, so a protein-led lunch keeps dinner flexible.',
  note: 'The menu photo was a little dark, so portion sizes are estimates.'
};

/* ---- the route handler ---- */

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const quotaMessage = (model, limit) => `You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: ${limit}, model: ${model}`;

export function createGeminiController() {
  return { mode: 'ok', delayMs: 0, log: [] };
}

export async function installGeminiMock(context, controller = createGeminiController()) {
  await context.route(/generativelanguage\.googleapis\.com/, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const reply = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
    const fail = (status, code, message) => reply(status, { error: { code: status, message, status: code } });

    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });

    // models.list
    if (request.method() === 'GET' && /\/v1beta\/models\/?$/.test(url.pathname)) {
      controller.log.push({ kind: 'models.list', mode: controller.mode });
      if (controller.mode === 'badkey') return fail(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.');
      return reply(200, { models: MODELS });
    }

    // generateContent
    const match = url.pathname.match(/\/models\/([^/:]+):generateContent$/);
    if (!match) return fail(404, 'NOT_FOUND', `Mock has no route for ${url.pathname}`);
    const model = decodeURIComponent(match[1]);
    let body = {};
    try { body = request.postDataJSON() || {}; } catch { /* not JSON */ }
    const userText = String(body?.contents?.[0]?.parts?.[0]?.text || '');
    const system = String(body?.systemInstruction?.parts?.[0]?.text || '');
    const photos = (body?.contents?.[0]?.parts || []).filter(part => part.inlineData).length;
    const kind = /Reply with the word OK/.test(userText) ? 'ping'
      : /^BATCH ESTIMATE REQUEST/m.test(userText) || /meal prep for Dawni/.test(system) ? 'batch'
        : /^MENU PICK REQUEST/m.test(userText) || /menu helper in Dawni/.test(system) ? 'menu'
          : 'estimate';
    const refine = /Correction from the user:/.test(userText);
    controller.log.push({ kind: `generate:${kind}`, model, mode: controller.mode, photos, refine });
    if (controller.delayMs && kind !== 'ping') await sleep(controller.delayMs);

    switch (controller.mode) {
      case 'badkey': return fail(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.');
      case 'rate': return fail(429, 'RESOURCE_EXHAUSTED', 'Resource has been exhausted (e.g. check quota).');
      case 'daily': return fail(429, 'RESOURCE_EXHAUSTED', quotaMessage(model, 20));
      case 'busy': return fail(503, 'UNAVAILABLE', 'The model is overloaded. Please try again later.');
      case 'free': if (/pro/.test(model)) return fail(429, 'RESOURCE_EXHAUSTED', quotaMessage(model, 0)); break;
      default: break;
    }

    const text = payloadText(kind, { refine, photos, mode: controller.mode });
    return reply(200, { candidates: [{ content: { parts: [{ text }], role: 'model' }, finishReason: 'STOP' }] });
  });
  return controller;
}

function payloadText(kind, { refine, photos, mode }) {
  if (kind === 'ping') return 'OK';
  if (mode === 'unreadable') return 'Sorry, I could not work that one out. Could you tell me a bit more about what was in it?';
  if (kind === 'batch') return JSON.stringify(refine ? BATCH_REFINED : BATCH_RESULT);
  if (kind === 'menu') return JSON.stringify(MENU_RESULT);
  if (refine) return JSON.stringify(ESTIMATE_BOWL_SMALL);
  return JSON.stringify(photos > 0 ? ESTIMATE_LABEL : ESTIMATE_BOWL);
}
