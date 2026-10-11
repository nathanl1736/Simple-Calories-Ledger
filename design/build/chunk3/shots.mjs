// Chunk 3 screenshots: "What should I eat?" (Suggest mode of the Log sheet) at 390x844, light and dark, with the
// mocked Gemini. Start the dev server first, then from the repo root:
//   npx vite --host 127.0.0.1 --port 5194 --strictPort &
//   node design/build/chunk3/shots.mjs "$PWD" design/build/chunk3
// Playwright comes from PLAYWRIGHT_DIR (a folder with node_modules/playwright), as in design/audit/smoke.mjs.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const [worktree, outDir] = process.argv.slice(2);
const { Registry, openSession } = await import(path.join(worktree, 'design/audit/harness.mjs'));
const { seedFor } = await import(path.join(worktree, 'design/audit/scenarios.mjs'));
const pwDir = process.env.PLAYWRIGHT_DIR || '/tmp/claude-0/-home-user-Simple-Calories-Ledger/c2b3286b-a6c3-570c-8c6a-5df39c844de9/scratchpad/pw';
const { chromium } = createRequire(path.join(pwDir, 'noop.js'))('playwright');

fs.mkdirSync(outDir, { recursive: true });
const URL = process.env.SHOT_URL || 'http://127.0.0.1:5194/Simple-Calories-Ledger/';
const TZ = 'Australia/Melbourne';
const TODAY = '2026-10-10';
const cfg = { url: URL, tz: TZ, today: TODAY };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const registry = new Registry(outDir, cfg);
const report = [];

async function run(name, theme, spec, fn) {
  const seeded = seedFor(cfg, { hour: 12, ...(spec.seed || {}) });
  const state = args => {
    const result = seeded(args);
    if (spec.prefs) result.settings.aiPreferences = spec.prefs;
    return result;
  };
  const s = await openSession(browser, registry, cfg, { name: `${name}-${theme}`, theme, hour: 12, minute: 15, state, delayMs: spec.delayMs || 0 });
  try {
    await fn(s);
  } catch (err) {
    report.push(`FAIL ${name} ${theme}: ${String(err.message).split('\n')[0]}`);
  }
  await s.context.close();
}

const shot = async (s, file) => {
  await s.settle(300);
  await s.page.screenshot({ path: path.join(outDir, file), animations: 'disabled', caret: 'hide' });
  report.push(`shot ${file}`);
};
const suggestTab = s => s.dialog().locator('.log-mode').getByRole('button', { name: 'Suggest', exact: true });
const openSuggest = async s => {
  await s.sparkle();
  await suggestTab(s).click();
  await s.settle(500);
};
const run1 = s => s.dialog().locator('button.log-estimate');
const sheetScroll = (s, to) => s.page.evaluate(top => {
  const body = [...document.querySelectorAll('[role=dialog] .modal-body')].pop();
  body?.scrollTo({ top: top === 'end' ? body.scrollHeight : top, behavior: 'instant' });
}, to);

for (const theme of ['light', 'dark']) {
  // The empty sheet, then a venue typed, then waiting, then the answer.
  await run('venue', theme, { delayMs: 0 }, async s => {
    await openSuggest(s);
    await shot(s, `01-suggest-empty-${theme}.png`);
    await s.dialog().locator('textarea').first().fill('Going to Macca’s for lunch');
    if (theme === 'light') await shot(s, `02-suggest-typed-${theme}.png`);
    s.controller.delayMs = 10500;
    await run1(s).click();
    await s.page.waitForTimeout(9400);
    if (theme === 'light') await shot(s, `03-suggest-estimating-${theme}.png`);
    s.controller.delayMs = 0;
    await s.dialog().locator('.suggest-card').waitFor({ state: 'visible', timeout: 15000 });
    await s.settle(500);
    await shot(s, `04-suggest-venue-result-${theme}.png`);
    if (theme === 'light') {
      await sheetScroll(s, 'end');
      await shot(s, `05-suggest-venue-result-scrolled-${theme}.png`);
      await sheetScroll(s, 0);
      // Log this: the review sheet, filled in.
      await s.dialog().getByRole('button', { name: 'Log this' }).click();
      await s.settle(900);
      await shot(s, `09-review-from-suggest-${theme}.png`);
      await s.page.evaluate(() => { const b = [...document.querySelectorAll('[role=dialog] .modal-body')].pop(); b?.scrollTo({ top: 360, behavior: 'instant' }); });
      report.push(`notes: ${await s.page.locator('[role=dialog] textarea').last().inputValue().catch(() => '(no notes box)')}`);
    }
  });
}

// At home, then a menu photo, from the same sheet.
await run('home-menu', 'light', {}, async s => {
  await openSuggest(s);
  await s.dialog().locator('textarea').first().fill('Cooking at home tonight, have chicken thighs and rice in the fridge');
  await s.dialog().locator('.meal-chip-row').getByRole('button', { name: 'Dinner' }).click();
  await s.settle(300);
  await run1(s).click();
  await s.dialog().locator('.suggest-card').waitFor({ state: 'visible', timeout: 15000 });
  await s.settle(500);
  await shot(s, '06-suggest-home-result-light.png');

  await s.dialog().getByRole('button', { name: 'Start a new suggestion' }).click();
  await s.settle(500);
  await s.chooseFile(() => s.dialog().locator('.log-photo-chip').click(), await s.makeImage('menu'));
  await s.settle(900);
  await shot(s, '07-suggest-menu-photo-light.png');
  await run1(s).click();
  await s.dialog().locator('.suggest-card').waitFor({ state: 'visible', timeout: 15000 });
  await s.settle(500);
  await shot(s, '08-suggest-menu-result-light.png');
});

// The Now line on Today, and the chip opening Suggest on that meal.
for (const theme of ['light', 'dark']) {
  await run('now', theme, {}, async s => {
    await s.scrollTo('.tl-now', 'center');
    await shot(s, `10-now-chip-${theme}.png`);
    if (theme === 'light') {
      await s.page.locator('.tl-chip-suggest').click();
      await s.page.locator('[role=dialog]').first().waitFor({ state: 'visible' });
      await s.settle(700);
      await shot(s, `11-now-chip-opens-suggest-${theme}.png`);
    }
  });
}

// What gets sent, opened, with the About you text from Settings in it.
await run('sent', 'light', { prefs: 'Melbourne. Vegetarian on weekdays, no seafood. I usually cook with olive oil spray.' }, async s => {
  await openSuggest(s);
  await s.dialog().locator('.suggest-how summary').click();
  await s.settle(400);
  await s.page.evaluate(() => { const b = [...document.querySelectorAll('[role=dialog] .modal-body')].pop(); b?.scrollTo({ top: 420, behavior: 'instant' }); });
  await shot(s, '02b-suggest-what-gets-sent-light.png');
});

// No key: Suggest connects Gemini first, then runs what was typed.
await run('nokey', 'light', { seed: { key: false } }, async s => {
  await openSuggest(s);
  await s.dialog().locator('textarea').first().fill('Going to Subway for lunch');
  await run1(s).click();
  await s.settle(500);
  await shot(s, '12-suggest-connect-light.png');
});

// Closed while it thinks: the pill, then the toast.
await run('background', 'light', { delayMs: 7000 }, async s => {
  await openSuggest(s);
  await s.dialog().locator('textarea').first().fill('Going to Macca’s for lunch');
  await run1(s).click();
  await s.settle(600);
  await s.closeTop();
  await s.settle(600);
  await shot(s, '13-suggest-pill-light.png');
  await s.page.locator('.toast').first().waitFor({ state: 'visible', timeout: 15000 });
  await shot(s, '14-suggest-ready-toast-light.png');
});

await browser.close();
console.log(report.join('\n'));
