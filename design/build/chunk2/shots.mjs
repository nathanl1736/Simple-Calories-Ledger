// Chunk 2 screenshots: the owner's Saturday (Mon–Fri +304 −38 +238 −110 +173, Saturday 730 over a 1,450 limit)
// and friends, light and dark, 390x844. Start the dev server first, then from the repo root:
//   npx vite --host 127.0.0.1 --port 5192 --strictPort &
//   SHOT_TEXTS=/tmp/texts.json node design/build/chunk2/shots.mjs "$PWD" design/build/chunk2
// Playwright comes from PLAYWRIGHT_DIR (a folder with node_modules/playwright), as in design/audit/smoke.mjs.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const [worktree, outDir] = process.argv.slice(2);
const { Registry, openSession } = await import(path.join(worktree, 'design/audit/harness.mjs'));
const { zonedEpoch, MOCK_KEY } = await import(path.join(worktree, 'design/audit/seed.mjs'));
const pwDir = process.env.PLAYWRIGHT_DIR || '/tmp/claude-0/-home-user-Simple-Calories-Ledger/c2b3286b-a6c3-570c-8c6a-5df39c844de9/scratchpad/pw';
const { chromium } = createRequire(path.join(pwDir, 'noop.js'))('playwright');

fs.mkdirSync(outDir, { recursive: true });
const URL = process.env.SHOT_URL || 'http://127.0.0.1:5192/Simple-Calories-Ledger/';
const TZ = 'Australia/Melbourne';
const WEEK = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];

// [meal, kcal, protein, hh, mm, name, part?]
const plain = (kcal, protein) => [
  ['Breakfast', 330, 28, 7, 30, 'Greek yoghurt, berries and oats'],
  ['Lunch', 520, 45, 12, 30, 'Chicken and rice'],
  ['Dinner', kcal - 850, protein - 73, 19, 0, 'Salmon, roast veg and quinoa']
];
// The owner's Monday to Friday, to a tenth of a Cal: +304 −38 +238 −110 +173 once rounded.
const OWNER_WEEKDAYS = [1145.8, 1487.8, 1211.8, 1559.8, 1276.8].map(kcal => plain(kcal, 123));
// Saturday: 730 over 1,450, and 169 g protein (19 g past the goal).
const OWNER_SAT = [
  ['Breakfast', 420, 24, 8, 0, 'Eggs on sourdough'],
  ['Lunch', 640, 41, 12, 40, 'Guzman y Gomez chicken burrito bowl'],
  ['Drink', 160, 30, 15, 30, 'Protein shake, vanilla', 'afternoon'],
  ['Dinner', 960, 74, 19, 10, 'Chicken parmigiana and chips']
];

function stateFor({ days, theme, today, overrides = {}, completed = [] }) {
  const entries = [];
  let n = 0;
  days.forEach((list, i) => (list || []).forEach(([meal, kcal, protein, hh, mm, name, part]) => {
    n += 1;
    const createdAt = zonedEpoch(WEEK[i], hh, mm, TZ);
    const e = { id: `c2-${n}`, sourceFoodId: null, date: WEEK[i], name, meal, unitMode: 'serving', portion: 1, baseCalories: kcal, baseProtein: protein, baseCarbs: kcal / 10, baseFat: kcal / 40, calories: kcal, protein, carbs: kcal / 10, fat: kcal / 40, createdAt, updatedAt: createdAt };
    if (part) e.part = part;
    entries.push(e);
  }));
  const now = zonedEpoch(today, 12, 0, TZ);
  return {
    settings: {
      calories: 1450, protein: 150, carbs: 160, fat: 60, accent: '#0E7C76', theme, trackingMode: 'Cutting', energyUnit: 'kcal',
      lastBackupAt: new Date(now - 2 * 86400000).toISOString(), lastBackupMeta: { version: '2.8.2.0', entries: entries.length, foods: 0, completedDates: 0, photos: 0 },
      lastBackupReminderShownAt: today, backupReminderDays: 7, geminiApiKey: MOCK_KEY, aiPreferences: '', spreadWeeklyBank: false
    },
    entries, foods: [], completedDates: completed, dayEstimates: {}, dailyGoals: {}, dayCalorieOverrides: overrides, customFoodDatabases: [], batches: []
  };
}

const SCENES = [
  { name: 'owner', today: '2026-10-10', hour: 19, minute: 30, days: [...OWNER_WEEKDAYS, OWNER_SAT] },
  { name: 'midweek', today: '2026-10-07', hour: 13, minute: 0, days: [plain(1146, 120), plain(1180, 118), [['Breakfast', 330, 28, 7, 30, 'Greek yoghurt, berries and oats'], ['Lunch', 520, 45, 12, 30, 'Chicken and rice']]] },
  { name: 'finished', today: '2026-10-12', hour: 9, minute: 0, days: [...OWNER_WEEKDAYS, OWNER_SAT, plain(1130, 125)] },
  { name: 'lastday', today: '2026-10-11', hour: 13, minute: 0, days: [...OWNER_WEEKDAYS, OWNER_SAT, [['Breakfast', 420, 24, 8, 0, 'Eggs on sourdough'], ['Lunch', 580, 40, 12, 30, 'Chicken Caesar wrap']]] },
  { name: 'custom', today: '2026-10-10', hour: 19, minute: 30, days: [...OWNER_WEEKDAYS, OWNER_SAT], overrides: { '2026-10-10': 2200 } }
];

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const registry = new Registry(outDir, { url: URL, tz: TZ, today: '2026-10-10' });
const report = [];
const texts = {};

async function run(scene, theme, fn) {
  const cfg = { url: URL, tz: TZ, today: scene.today };
  const s = await openSession(browser, registry, cfg, {
    name: `${scene.name}-${theme}`, theme, hour: scene.hour, minute: scene.minute,
    state: ({ theme: t }) => stateFor({ days: scene.days, theme: t, today: scene.today, overrides: scene.overrides, completed: scene.completed })
  });
  try {
    await fn(s);
  } catch (err) {
    report.push(`FAIL ${scene.name} ${theme}: ${String(err.message).split('\n')[0]}`);
  }
  await s.context.close();
}

const shot = async (s, file) => {
  await s.settle(300);
  await s.page.screenshot({ path: path.join(outDir, file), animations: 'disabled', caret: 'hide' });
  report.push(`shot ${file}`);
};
const grab = async (s, key) => {
  texts[key] = await s.page.evaluate(() => {
    const t = sel => [...document.querySelectorAll(sel)].map(el => el.innerText.replace(/\s+/g, ' ').trim());
    return {
      headline: t('.tl-bank'), working: t('.tl-working'), answer: t('.tl-answer'), deltas: t('.tl-deltas span'),
      target: t('.tl-tiles-target'), stats: t('.tl-stat'), platter: t('.tl-platter'),
      weekRow: t('.tl-week-right'), feet: t('.tl-feet'), protein: t('.tl-macro.protein .tl-macro-value'),
      tilesAria: [...document.querySelectorAll('.tl-tile')].map(el => el.getAttribute('aria-label')),
      table: t('.week-table tr'), detailStats: t('.week-details .stat'), bullets: t('.bank-help-list li')
    };
  });
};

for (const theme of ['light', 'dark']) {
  await run(SCENES[0], theme, async s => {
    await shot(s, `01-today-owner-saturday-${theme}.png`);
    await grab(s, `today-owner-${theme}`);
    await s.tab('stats');
    await shot(s, `02-week-owner-saturday-${theme}.png`);
    await grab(s, `week-owner-${theme}`);
    await s.page.locator('.tl-stats').click();
    await s.settle(600);
    await shot(s, `03-week-details-${theme}.png`);
    await grab(s, `details-owner-${theme}`);
    if (theme === 'light') {
      await s.page.evaluate(() => { const b = [...document.querySelectorAll('[role=dialog] .modal-body')].pop(); b?.scrollTo({ top: b.scrollHeight, behavior: 'instant' }); });
      await shot(s, `04-week-details-scrolled-${theme}.png`);
    }
    await s.closeTop();
  });
  await run(SCENES[1], theme, async s => {
    await s.tab('stats');
    await shot(s, `05-week-midweek-ahead-${theme}.png`);
    await grab(s, `week-midweek-${theme}`);
  });
  await run(SCENES[2], theme, async s => {
    await s.tab('stats');
    await s.page.getByRole('button', { name: 'Previous week' }).click();
    await s.settle(600);
    await shot(s, `06-week-finished-${theme}.png`);
    await grab(s, `week-finished-${theme}`);
  });
  await run(SCENES[4], theme, async s => {
    await shot(s, `07-today-custom-target-${theme}.png`);
    await grab(s, `today-custom-${theme}`);
  });
}
await run(SCENES[3], 'light', async s => {
  await s.tab('stats');
  await shot(s, `08-week-last-day-light.png`);
  await grab(s, 'week-lastday-light');
});

await browser.close();
// What each screen printed, for checking the numbers against tests/weekView.test.mjs.
if (process.env.SHOT_TEXTS) fs.writeFileSync(process.env.SHOT_TEXTS, JSON.stringify(texts, null, 2));
const problems = [...registry.problems.pageErrors.map(e => `pageerror ${e.message}`), ...registry.problems.console.filter(c => c.type === 'error' && !c.expected).map(c => `console ${c.text}`)];
console.log(report.join('\n'));
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no page or console errors');
