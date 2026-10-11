// The 3.0 "after" gallery: the screens of the finished redesign at 390x844, light and dark, seeded at 13:00 on a
// Saturday (the audit seed), with the mocked Gemini. Start the dev server first, then from the repo root:
//   npx vite --host 127.0.0.1 --port 5197 --strictPort &
//   node design/build/after/shots.mjs "$PWD" design/build/after
// Playwright comes from PLAYWRIGHT_DIR (a folder with node_modules/playwright), as in design/audit/smoke.mjs.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const [worktree, outDir] = process.argv.slice(2);
const { Registry, openSession, freshState } = await import(path.join(worktree, 'design/audit/harness.mjs'));
const { seedFor } = await import(path.join(worktree, 'design/audit/scenarios.mjs'));
const { addDays, weekStartMonday } = await import(path.join(worktree, 'design/audit/seed.mjs'));
const pwDir = process.env.PLAYWRIGHT_DIR || '/tmp/claude-0/-home-user-Simple-Calories-Ledger/c2b3286b-a6c3-570c-8c6a-5df39c844de9/scratchpad/pw';
const { chromium } = createRequire(path.join(pwDir, 'noop.js'))('playwright');

fs.mkdirSync(outDir, { recursive: true });
const URL = process.env.SHOT_URL || 'http://127.0.0.1:5197/Simple-Calories-Ledger/';
const TZ = 'Australia/Melbourne';
const TODAY = process.env.GALLERY_TODAY || '2026-10-10';
const cfg = { url: URL, tz: TZ, today: TODAY };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const registry = new Registry(outDir, cfg);
const report = [];
const wanted = process.env.ONLY ? process.env.ONLY.split(',') : null;

async function step(name, fn) {
  try {
    await fn();
  } catch (err) {
    report.push(`FAIL ${name}: ${String(err.message).split('\n')[0]}`);
  }
}

for (const theme of ['light', 'dark']) {
  const shot = async (s, file) => {
    await s.settle(350);
    await s.page.screenshot({ path: path.join(outDir, `${file}-${theme}.png`), animations: 'disabled', caret: 'hide' });
    report.push(`shot ${file}-${theme}.png`);
  };
  const sheetBody = s => s.page.locator('.modal-panel[role=dialog] .modal-body').last();

  /* Today, the Log sheet, an estimate, the review sheet and a suggestion: one session. */
  const s = await openSession(browser, registry, cfg, { name: `after-${theme}`, theme, hour: 13, state: seedFor(cfg, { hour: 13 }) });
  const { page } = s;
  await step('today', async () => {
    await shot(s, '01-today');
    await s.scrollTo('.tl-dayline');
    await shot(s, '02-today-day-line');
    await s.scrollTop();
  });
  await step('log sheet', async () => {
    await s.sparkle();
    await shot(s, '03-log-sheet');
  });
  await step('estimating and review', async () => {
    s.controller.delayMs = 7000;
    await s.dialog().locator('textarea').first().fill('Chicken burrito bowl from Guzman y Gomez, medium');
    await s.dialog().locator('button.log-estimate').click();
    await s.settle(1500);
    await shot(s, '04-log-estimating');
    await s.dialog().getByText(/Estimated/).first().waitFor({ state: 'visible', timeout: 20000 });
    s.controller.delayMs = 0;
    await s.settle(900);
    await shot(s, '05-review');
    await s.closeAll();
  });
  await step('suggest', async () => {
    await s.sparkle();
    await s.dialog().locator('.log-mode').getByRole('button', { name: 'Suggest', exact: true }).click();
    await s.settle(400);
    await s.dialog().locator('textarea').first().fill('Going to Macca’s for lunch');
    await s.dialog().locator('button.log-estimate').click();
    await s.dialog().locator('.suggest-card').waitFor({ state: 'visible', timeout: 20000 });
    await s.settle(600);
    await shot(s, '06-suggest-venue');
    await s.closeAll();
  });
  await step('week', async () => {
    await s.tab('stats');
    await page.locator('.tl-tiles').first().waitFor({ state: 'visible' });
    await shot(s, '07-week');
    await page.locator('.tl-bank').first().click();
    await s.settle(700);
    await shot(s, '08-week-details');
    await s.closeAll();
  });
  await step('journal day', async () => {
    await s.tab('journal');
    const monthStart = `${TODAY.slice(0, 7)}-01`;
    const cell0 = weekStartMonday(monthStart);
    await page.locator('.daybox').nth(daysBetween(cell0, addDays(TODAY, -1))).click();
    await s.settle(800);
    await shot(s, '09-journal-day');
  });
  await step('foods', async () => {
    await s.tab('library');
    await page.getByRole('tab', { name: 'Recent' }).click().catch(() => {});
    await s.settle(400);
    await shot(s, '10-foods');
  });
  await step('settings', async () => {
    await s.tab('tracking');
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await page.getByRole('heading', { name: 'Settings' }).waitFor({ state: 'visible' });
    await s.settle(700);
    await shot(s, '11-settings');
  });
  await s.context.close();

  /* The update sheet: this build calls itself 2.8.2.0, so the deployed version.json (the real 3.0 notes) is newer. */
  const update = await openSession(browser, registry, cfg, { name: `after-update-${theme}`, theme, hour: 13, state: seedFor(cfg, { hour: 13 }), serviceWorkers: 'block' });
  await step('update sheet', async () => {
    await update.context.addInitScript(() => { try { delete Navigator.prototype.serviceWorker; } catch { /* leave it */ } });
    await update.context.route('**/src/version.ts*', async route => {
      const response = await route.fetch();
      const body = (await response.text()).replace('export const APP_VERSION = pkg.version;', 'export const APP_VERSION = "2.8.2.0";');
      await route.fulfill({ response, body });
    });
    await update.page.reload({ waitUntil: 'domcontentloaded' });
    await update.page.locator('.modal-panel[role=dialog] .update-list').waitFor({ state: 'visible', timeout: 15000 });
    await update.settle(800);
    await shot(update, '12-update-sheet');
  });
  await update.context.close();

  /* First run: nothing logged, no key. */
  const first = await openSession(browser, registry, cfg, { name: `after-first-run-${theme}`, theme, hour: 13, state: ({ theme: t }) => freshState(t) });
  await step('first run', async () => {
    await shot(first, '13-first-run-today');
  });
  await first.context.close();
}

await browser.close();
console.log(report.join('\n'));
