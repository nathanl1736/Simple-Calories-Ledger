// Seed data for the Dawni design audit.
//
// buildState() returns an object shaped like AppState (src/types.ts). Normalisation happens
// when the app reads it back (src/state.ts), so it only has to be reasonably shaped.
// Every date is derived from `today` (a YYYY-MM-DD key in the browser's timezone), so the
// script can be re-run on any day. Entries carry a createdAt that matches their meal time
// in the audit timezone, because snacks and drinks without a `part` are placed by it.

export const MOCK_KEY = 'AIza-mock-key-for-screenshots';
export const DB_NAME = 'calorie-tracker-db';

/* ------------------------------------------------------------------ dates and time zones */

const pad = n => String(n).padStart(2, '0');

export function addDays(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function weekdayOf(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
}

export function weekStartMonday(key) {
  const day = weekdayOf(key) || 7;
  return addDays(key, 1 - day);
}

/** Date key for `epoch` as seen in `tz`. */
export function dateKeyIn(tz, epoch = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(epoch));
}

function tzOffsetMs(epoch, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(epoch));
  const get = type => Number(parts.find(part => part.type === type).value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - epoch;
}

/** Epoch ms of wall-clock `hh:mm` on `dateKey` in `tz`. */
export function zonedEpoch(dateKey, hh, mm, tz) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wall;
  for (let i = 0; i < 3; i += 1) guess = wall - tzOffsetMs(guess, tz);
  return guess;
}

/* ------------------------------------------------------------------ photos (drawn in the page) */

/**
 * Source of a function run inside the page (page.evaluate) that paints four small "meal photos"
 * on a canvas and returns them as JPEG data URLs (240x240, a few KB each).
 */
export const PHOTO_SCRIPT = `(() => {
  const size = 240;
  const make = paint => {
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const g = canvas.getContext('2d');
    paint(g);
    return canvas.toDataURL('image/jpeg', 0.7);
  };
  const dot = (g, x, y, r, c) => { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  const plate = (g, bg, rim) => { g.fillStyle = bg; g.fillRect(0, 0, size, size); dot(g, 120, 124, 100, 'rgba(0,0,0,.18)'); dot(g, 120, 120, 98, rim); dot(g, 120, 120, 82, '#FBFAF7'); };
  return {
    yog: make(g => {
      plate(g, '#C9A27A', '#E9E4DA');
      dot(g, 120, 122, 62, '#F4EFE6');
      for (let i = 0; i < 9; i += 1) dot(g, 92 + (i * 37) % 60, 98 + (i * 53) % 52, 9, i % 2 ? '#B0213F' : '#5B3A8E');
      for (let i = 0; i < 14; i += 1) dot(g, 85 + (i * 29) % 80, 90 + (i * 41) % 70, 4, '#D9B26B');
    }),
    chick: make(g => {
      plate(g, '#4F5D63', '#F0EEE8');
      dot(g, 92, 126, 40, '#F7F3E8');
      g.fillStyle = '#B97B3B'; g.beginPath(); g.ellipse(150, 112, 34, 22, 0.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#9A622A'; g.beginPath(); g.ellipse(142, 136, 28, 17, -0.3, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 6; i += 1) dot(g, 112 + i * 9, 164 - (i % 2) * 6, 8, '#3F8F4B');
    }),
    mince: make(g => {
      g.fillStyle = '#2E3338'; g.fillRect(0, 0, size, size);
      dot(g, 120, 126, 98, 'rgba(0,0,0,.35)');
      dot(g, 120, 120, 96, '#EDE8DE'); dot(g, 120, 120, 84, '#FFFFFF');
      g.fillStyle = '#F4F0E6'; g.beginPath(); g.ellipse(100, 120, 44, 56, 0, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 40; i += 1) dot(g, 130 + (i * 17) % 50, 80 + (i * 29) % 80, 6, i % 3 ? '#6B3E26' : '#8A5232');
      for (let i = 0; i < 5; i += 1) dot(g, 70 + i * 14, 180 - (i % 2) * 8, 9, '#7DB35A');
    }),
    pizza: make(g => {
      g.fillStyle = '#7A5638'; g.fillRect(0, 0, size, size);
      dot(g, 120, 120, 104, '#D8A558'); dot(g, 120, 120, 92, '#C0392B'); dot(g, 120, 120, 84, '#F2D27A');
      for (let i = 0; i < 7; i += 1) dot(g, 120 + 52 * Math.cos(i * 0.9), 120 + 52 * Math.sin(i * 0.9), 13, '#F8F4EA');
      for (let i = 0; i < 9; i += 1) dot(g, 120 + 28 * Math.cos(i * 0.7 + 1), 120 + 30 * Math.sin(i * 0.7 + 1), 5, '#2F7A3A');
      g.strokeStyle = 'rgba(120,70,20,.55)'; g.lineWidth = 3;
      for (let i = 0; i < 3; i += 1) { g.beginPath(); g.moveTo(120, 120); g.lineTo(120 + 104 * Math.cos(i * 1.05), 120 + 104 * Math.sin(i * 1.05)); g.stroke(); }
    })
  };
})()`;

/* ------------------------------------------------------------------ foods */

// unit 'serving': values are per serving. unit '100g': values are per 100 g and portion is grams.
const FOODS = {
  yogbowl: { name: 'Greek yoghurt, berries and oats', unit: 'serving', kcal: 330, p: 28, c: 38, f: 7, label: '1 bowl', grams: 320 },
  yoghurt: { name: 'Greek yoghurt, plain', unit: '100g', kcal: 97, p: 9, c: 3.9, f: 5, label: '1 tub (200 g)', grams: 200 },
  flatwhite: { name: 'Flat white', unit: 'serving', kcal: 120, p: 6, c: 9, f: 6, label: '1 medium (300 mL)', grams: 300 },
  latte: { name: 'Iced latte', unit: 'serving', kcal: 150, p: 8, c: 12, f: 7, label: '1 large' },
  eggs: { name: 'Eggs on sourdough', unit: 'serving', kcal: 420, p: 24, c: 32, f: 20, label: '2 eggs, 2 slices' },
  shake: { name: 'Protein shake, vanilla', unit: 'serving', kcal: 160, p: 30, c: 5, f: 2, label: '1 scoop + water' },
  chickrice: { name: 'Chicken and rice', unit: 'serving', kcal: 520, p: 45, c: 58, f: 10, label: '1 container' },
  gyg: { name: 'Guzman y Gomez chicken burrito bowl', unit: 'serving', kcal: 640, p: 41, c: 62, f: 24, label: '1 bowl' },
  tuna: { name: 'Tuna salad sandwich', unit: 'serving', kcal: 380, p: 30, c: 38, f: 10, label: '1 sandwich' },
  caesar: { name: 'Chicken Caesar wrap', unit: 'serving', kcal: 560, p: 36, c: 46, f: 24, label: '1 wrap' },
  salmon: { name: 'Salmon, roast veg and quinoa', unit: 'serving', kcal: 460, p: 38, c: 30, f: 20, label: '1 plate' },
  stirfry: { name: 'Chicken stir-fry with rice', unit: 'serving', kcal: 540, p: 44, c: 60, f: 12, label: '1 bowl' },
  tacos: { name: 'Beef tacos (3)', unit: 'serving', kcal: 610, p: 36, c: 54, f: 28, label: '3 tacos' },
  parmi: { name: 'Chicken parmigiana and chips', unit: 'serving', kcal: 1180, p: 62, c: 98, f: 58, label: '1 pub serve' },
  pizza: { name: 'Margherita pizza, 3 slices', unit: 'serving', kcal: 780, p: 32, c: 96, f: 28, label: '3 slices' },
  beer: { name: 'Pale ale', unit: 'serving', kcal: 150, p: 1, c: 12, f: 0, label: '1 can (375 mL)' },
  timtam: { name: 'Tim Tam Original', unit: 'serving', kcal: 88, p: 1, c: 11.5, f: 4.5, label: '1 biscuit (18 g)', grams: 18 },
  apple: { name: 'Apple', unit: 'serving', kcal: 95, p: 0.5, c: 25, f: 0.3, label: '1 medium' },
  banana: { name: 'Banana', unit: 'serving', kcal: 105, p: 1.3, c: 27, f: 0.4, label: '1 medium' },
  bar: { name: 'Protein bar', unit: 'serving', kcal: 190, p: 20, c: 18, f: 6, label: '1 bar (55 g)' },
  magnum: { name: 'Magnum Classic', unit: 'serving', kcal: 270, p: 3, c: 27, f: 17, label: '1 ice cream' }
};

/** Saved foods (Foods tab, Recent and Favourites, Today's search). [key, favourite, usageCount, daysSinceUsed, estimateSource] */
const SAVED = [
  ['yoghurt', true, 12, 3, null],
  ['yogbowl', true, 9, 0, null],
  ['flatwhite', true, 31, 0, null],
  ['chickrice', true, 7, 1, null],
  ['shake', true, 8, 0, null],
  ['gyg', false, 3, 0, 'ai'],
  ['timtam', false, 5, 0, null],
  ['salmon', false, 4, 4, 'ai']
];

/* ------------------------------------------------------------------ day plans */

// [foodKey, meal, hh, mm, options]. options: part, portion, photo, source, batch, rough: kcal, name
// Offsets are days before today. The plans make a mix of completed, over, light, untracked and estimated days.
const PAST_PLANS = {
  1: [['yogbowl', 'Breakfast', 7, 20, { photo: null }], ['flatwhite', 'Drink', 7, 25, { part: 'morning' }], ['chickrice', 'Lunch', 12, 30, { photo: 'chick' }], ['banana', 'Snack', 15, 30, { part: 'afternoon' }], ['__batch', 'Dinner', 19, 10, { photo: 'mince' }]],
  2: [['flatwhite', 'Drink', 8, 15, { part: 'morning' }], ['__batch', 'Lunch', 13, 5, {}]],
  3: [['eggs', 'Breakfast', 7, 45, {}], ['flatwhite', 'Drink', 7, 50, { part: 'morning' }], ['gyg', 'Lunch', 12, 40, { source: 'ai' }], ['timtam', 'Snack', 15, 20, { part: 'afternoon', portion: 2 }], ['pizza', 'Dinner', 19, 30, { photo: 'pizza', source: 'ai' }], ['beer', 'Drink', 20, 10, { part: 'evening' }]],
  4: [['yogbowl', 'Breakfast', 7, 30, {}], ['flatwhite', 'Drink', 7, 35, { part: 'morning' }], ['caesar', 'Lunch', 12, 50, {}], ['shake', 'Drink', 16, 0, { part: 'afternoon' }], ['stirfry', 'Dinner', 18, 50, {}]],
  5: [['eggs', 'Breakfast', 7, 40, {}], ['flatwhite', 'Drink', 7, 45, { part: 'morning' }], ['chickrice', 'Lunch', 12, 20, {}], ['apple', 'Snack', 15, 10, { part: 'afternoon' }], ['timtam', 'Snack', 20, 30, { part: 'evening' }], ['salmon', 'Dinner', 19, 0, { source: 'ai' }]],
  6: [],
  7: [['yogbowl', 'Breakfast', 8, 0, {}], ['flatwhite', 'Drink', 8, 10, { part: 'morning' }], ['gyg', 'Lunch', 13, 15, { source: 'ai' }]],
  8: [['yogbowl', 'Breakfast', 7, 30, {}], ['chickrice', 'Lunch', 12, 30, {}], ['__rough', 'Dinner', 19, 30, { rough: 1200 }]],
  9: [['eggs', 'Breakfast', 7, 40, {}], ['flatwhite', 'Drink', 7, 45, { part: 'morning' }], ['tuna', 'Lunch', 12, 30, {}], ['shake', 'Drink', 16, 0, { part: 'afternoon' }], ['stirfry', 'Dinner', 18, 45, {}]],
  10: [['yogbowl', 'Breakfast', 7, 25, {}], ['flatwhite', 'Drink', 7, 30, { part: 'morning' }], ['caesar', 'Lunch', 12, 40, {}], ['apple', 'Snack', 15, 0, { part: 'afternoon' }], ['tacos', 'Dinner', 19, 15, {}]],
  11: [['yogbowl', 'Breakfast', 7, 30, {}], ['chickrice', 'Lunch', 12, 25, {}], ['bar', 'Snack', 15, 30, { part: 'afternoon' }], ['salmon', 'Dinner', 19, 5, { source: 'ai' }]],
  12: [['eggs', 'Breakfast', 7, 50, {}], ['tuna', 'Lunch', 12, 35, {}], ['shake', 'Drink', 16, 5, { part: 'afternoon' }], ['salmon', 'Dinner', 19, 20, { source: 'ai' }]],
  13: [['yogbowl', 'Breakfast', 8, 10, {}], ['latte', 'Drink', 8, 20, { part: 'morning' }], ['caesar', 'Lunch', 13, 0, {}], ['magnum', 'Snack', 15, 45, { part: 'afternoon' }], ['tacos', 'Dinner', 19, 40, {}]],
  14: [['eggs', 'Breakfast', 8, 30, {}], ['flatwhite', 'Drink', 8, 35, { part: 'morning' }], ['chickrice', 'Lunch', 12, 50, {}], ['timtam', 'Snack', 16, 0, { part: 'afternoon', portion: 2 }], ['stirfry', 'Dinner', 19, 0, {}]],
  15: [['yogbowl', 'Breakfast', 7, 15, {}], ['flatwhite', 'Drink', 7, 20, { part: 'morning' }], ['tuna', 'Lunch', 12, 30, {}], ['shake', 'Drink', 16, 0, { part: 'afternoon' }], ['salmon', 'Dinner', 19, 10, { source: 'ai' }]]
};

// Days confirmed as fully logged, by offset.
const COMPLETED = [1, 3, 5, 9, 10, 12, 14];

/** What today holds at each clock time. `variant: 'over'` swaps dinner for a big pub meal. */
function todayPlan(hour, variant) {
  const plan = [];
  if (hour >= 7) {
    plan.push(['yogbowl', 'Breakfast', 7, 5, { photo: 'yog' }]);
    plan.push(['flatwhite', 'Drink', 7, 10, { part: 'morning' }]);
  }
  if (variant === 'light') return plan;
  if (hour >= 13 || variant === 'over') plan.push(['gyg', 'Lunch', 12, 40, { source: 'ai' }]);
  if (hour >= 19) {
    plan.push(['timtam', 'Snack', 15, 30, { part: 'afternoon' }]);
    plan.push(['shake', 'Drink', 15, 45, { part: 'afternoon' }]);
  }
  if (hour >= 23) {
    if (variant === 'over') {
      plan.push(['parmi', 'Dinner', 19, 40, {}]);
      plan.push(['beer', 'Drink', 20, 30, { part: 'evening' }]);
    } else {
      plan.push(['salmon', 'Dinner', 19, 30, { source: 'ai' }]);
    }
  }
  return plan;
}

/* ------------------------------------------------------------------ builders */

const MINCE_INGREDIENTS = [
  { name: 'White rice, uncooked', amount: '500 g', calories: 1800, protein: 34, carbs: 394, fat: 3 },
  { name: 'Beef mince, 4 star', amount: '1 kg', calories: 1300, protein: 200, carbs: 0, fat: 50 },
  { name: 'Olive oil', amount: '1 tbsp', calories: 120, protein: 0, carbs: 0, fat: 14 },
  { name: 'Iceberg lettuce', amount: '1 whole', calories: 70, protein: 5, carbs: 12, fat: 1 },
  { name: 'Teriyaki sauce', amount: '1/2 cup', calories: 130, protein: 6, carbs: 24, fat: 0 }
];
const CURRY_INGREDIENTS = [
  { name: 'Chicken thigh fillets', amount: '800 g', calories: 1360, protein: 168, carbs: 0, fat: 72 },
  { name: 'Basmati rice, uncooked', amount: '300 g', calories: 1080, protein: 24, carbs: 234, fat: 2 },
  { name: 'Light coconut milk', amount: '400 mL', calories: 320, protein: 4, carbs: 8, fat: 30 },
  { name: 'Curry paste', amount: '3 tbsp', calories: 120, protein: 3, carbs: 12, fat: 6 }
];

const sumIngredients = list => list.reduce((acc, i) => ({
  calories: acc.calories + i.calories, protein: acc.protein + i.protein, carbs: acc.carbs + i.carbs, fat: acc.fat + i.fat
}), { calories: 0, protein: 0, carbs: 0, fat: 0 });

/**
 * @param {object} o
 * @param {string} o.today       YYYY-MM-DD in the audit timezone
 * @param {string} o.tz          IANA timezone
 * @param {number} o.hour        clock hour today is captured at (7, 13, 19, 23); decides what is already logged today
 * @param {string} [o.theme]     'light' | 'dark' | 'system'
 * @param {boolean} [o.key]      set a (mock) Gemini key
 * @param {string} [o.variant]   'over' for an over-target today, 'light' for a day with only breakfast logged
 * @param {'normal'|'overdue'|'recent'} [o.backup]  backup reminder state
 * @param {object} o.photos      { yog, chick, mince, pizza } data URLs from PHOTO_SCRIPT
 */
export function buildState(o) {
  const { today, tz, hour = 13, theme = 'light', key = true, variant = 'normal', backup = 'recent', photos } = o;
  let n = 0;
  const entries = [];
  const dateOf = offset => addDays(today, -offset);
  const foodId = k => `food-${k}`;
  const savedKeys = new Set(SAVED.map(s => s[0]));

  const mince = sumIngredients(MINCE_INGREDIENTS);
  const batchId = 'batch-mince';
  const batchServings = 5;
  const batchServe = { calories: Math.round(mince.calories / batchServings), protein: Math.round(mince.protein / batchServings * 10) / 10, carbs: Math.round(mince.carbs / batchServings * 10) / 10, fat: Math.round(mince.fat / batchServings * 10) / 10 };

  const add = (date, item) => {
    const [fk, meal, hh, mm, opt = {}] = item;
    n += 1;
    const createdAt = zonedEpoch(date, hh, mm, tz);
    const base = { id: `e${String(n).padStart(3, '0')}`, date, meal, createdAt, updatedAt: createdAt, sourceFoodId: null };
    if (fk === '__batch') {
      Object.assign(base, {
        name: 'Beef mince rice bowl', unitMode: 'serving', portion: 1, baseCalories: batchServe.calories, baseProtein: batchServe.protein,
        baseCarbs: batchServe.carbs, baseFat: batchServe.fat, calories: batchServe.calories, protein: batchServe.protein, carbs: batchServe.carbs, fat: batchServe.fat,
        batchId, estimateSource: 'ai', notes: 'Meal prep: a serve of a batch of 5.'
      });
    } else if (fk === '__rough') {
      Object.assign(base, {
        name: 'Dinner (big)', unitMode: 'serving', portion: 1, baseCalories: opt.rough, baseProtein: 0, baseCarbs: 0, baseFat: 0,
        calories: opt.rough, protein: 0, carbs: 0, fat: 0, estimateSource: 'rough', notes: 'Rough guess for a meal that was hard to track. Edit it if you find out more.'
      });
    } else {
      const f = FOODS[fk];
      const portion = opt.portion ?? (f.unit === '100g' ? 200 : 1);
      const mult = f.unit === '100g' ? portion / 100 : portion;
      Object.assign(base, {
        name: f.name, unitMode: f.unit, portion, baseCalories: f.kcal, baseProtein: f.p, baseCarbs: f.c, baseFat: f.f,
        calories: f.kcal * mult, protein: f.p * mult, carbs: f.c * mult, fat: f.f * mult,
        sourceFoodId: savedKeys.has(fk) ? foodId(fk) : null,
        estimateSource: opt.source || null,
        notes: opt.source === 'ai' ? 'Estimated from a description. Assumed: regular serve. Confidence: medium.' : ''
      });
    }
    if (opt.part) base.part = opt.part;
    if (opt.photo && photos?.[opt.photo]) base.photo = photos[opt.photo];
    entries.push(base);
  };

  // Past days.
  Object.entries(PAST_PLANS).forEach(([offset, plan]) => plan.forEach(item => add(dateOf(Number(offset)), item)));
  // Today.
  todayPlan(hour, variant).forEach(item => add(today, item));

  // Saved foods.
  const now = zonedEpoch(today, hour, 0, tz);
  const foods = SAVED.map(([k, fav, usage, daysAgo, est], index) => {
    const f = FOODS[k];
    return {
      id: foodId(k), name: f.name, unitMode: f.unit, servingLabel: f.label, servingGrams: f.grams, calories: f.kcal, protein: f.p, carbs: f.c, fat: f.f,
      estimateSource: est, favourite: fav, usageCount: usage, lastUsedAt: now - daysAgo * 86400000 - index * 60000,
      createdAt: now - 20 * 86400000, updatedAt: now - 20 * 86400000
    };
  });

  const batches = [
    {
      id: batchId, name: 'Beef mince rice bowl', recipe: '500 g rice (uncooked)\n1 kg beef mince, 4 star\n1 tbsp olive oil\n1 iceberg lettuce\n1/2 cup teriyaki sauce',
      servings: batchServings, total: mince, ingredients: MINCE_INGREDIENTS, estimateSource: 'ai',
      assumptions: ['Rice weighed uncooked', 'Mince not drained'], confidence: 'medium', cookedOn: dateOf(3), finishedAt: null,
      createdAt: zonedEpoch(dateOf(3), 17, 30, tz), updatedAt: zonedEpoch(dateOf(3), 17, 30, tz)
    },
    {
      id: 'batch-curry', name: 'Chicken curry with rice', recipe: '800 g chicken thigh\n300 g basmati rice\n400 mL light coconut milk\n3 tbsp curry paste',
      servings: 4, total: sumIngredients(CURRY_INGREDIENTS), ingredients: CURRY_INGREDIENTS, estimateSource: 'ai',
      assumptions: ['Chicken weighed raw'], confidence: 'high', cookedOn: dateOf(12), finishedAt: zonedEpoch(dateOf(8), 19, 0, tz),
      createdAt: zonedEpoch(dateOf(12), 17, 0, tz), updatedAt: zonedEpoch(dateOf(8), 19, 0, tz)
    }
  ];

  const completedDates = COMPLETED.map(dateOf);
  const dayEstimates = { [dateOf(7)]: 500 };

  const backupAge = backup === 'overdue' ? 10 : 2;
  const lastBackupAt = new Date(now - backupAge * 86400000).toISOString();

  const state = {
    settings: {
      calories: 1800, protein: 150, carbs: 160, fat: 60, accent: '#0E7C76', theme, trackingMode: 'Cutting', energyUnit: 'kcal',
      lastBackupAt, lastBackupMeta: { version: '2.8.2.0', entries: entries.length, foods: foods.length, completedDates: completedDates.length, photos: 4 },
      // 'overdue' leaves this empty, so the reminder opens by itself on load; otherwise it is marked as already shown.
      lastBackupReminderShownAt: backup === 'overdue' ? null : today,
      backupReminderDays: 7,
      geminiApiKey: key ? MOCK_KEY : '',
      aiPreferences: 'Melbourne. Cooks with olive oil spray. High protein where possible.',
      spreadWeeklyBank: false
    },
    entries, foods, completedDates, dayEstimates,
    dailyGoals: {}, dayCalorieOverrides: {},
    customFoodDatabases: [{
      id: 'my-cafe-foods', name: 'My Cafe Foods', version: '1.0.0', importedAt: new Date(now - 6 * 86400000).toISOString(), enabled: true, itemCount: 3,
      items: [
        { id: 'banana-bread', name: 'Banana bread, toasted with butter', unitMode: 'serving', servingLabel: '1 thick slice', calories: 360, protein: 6, carbs: 48, fat: 16, tags: ['cafe'] },
        { id: 'chai-latte', name: 'Chai latte, regular', unitMode: 'serving', servingLabel: '1 medium', calories: 190, protein: 7, carbs: 29, fat: 5, tags: ['cafe', 'drink'] },
        { id: 'avo-smash', name: 'Smashed avocado on sourdough', unitMode: 'serving', servingLabel: '1 plate', calories: 430, protein: 12, carbs: 36, fat: 26, tags: ['cafe', 'breakfast'] }
      ]
    }],
    batches
  };
  return state;
}

/** A DEFAULT-shaped state with nothing in it (src/state.ts DEFAULT). */
export function freshState(theme = 'light') {
  return {
    settings: {
      calories: 1800, protein: 150, carbs: 90, fat: 50, accent: '#0E7C76', theme, trackingMode: 'Cutting', energyUnit: 'kcal',
      lastBackupAt: null, lastBackupMeta: null, lastBackupReminderShownAt: null, backupReminderDays: 7,
      geminiApiKey: '', aiPreferences: '', spreadWeeklyBank: false
    },
    entries: [], foods: [], completedDates: [], dayEstimates: {}, dailyGoals: {}, dayCalorieOverrides: {}, customFoodDatabases: [], batches: []
  };
}

/** Writes `state` into IndexedDB the way src/storage.ts does (database calorie-tracker-db, store kv, key state). */
export function writeStateScript(state) {
  return `(async () => {
    const state = ${JSON.stringify(state)};
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('${DB_NAME}', 1);
      open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('kv')) open.result.createObjectStore('kv'); };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(state, 'state');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  })()`;
}

export const FOOD_KEYS = Object.keys(FOODS);
