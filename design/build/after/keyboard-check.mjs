// Chunk 5 keyboard check: focus goes into a sheet, Tab and Shift+Tab never leave it, the page behind is inert,
// Escape closes it, and focus returns to what opened it. Checked for the Log sheet (opened from the sparkle),
// the review sheet and a Settings help sheet.
//
//   npx vite --host 127.0.0.1 --port 5197 --strictPort &
//   SMOKE_URL=http://127.0.0.1:5197/Simple-Calories-Ledger/ node design/build/after/keyboard-check.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Registry, openSession } from '../../audit/harness.mjs';
import { dateKeyIn } from '../../audit/seed.mjs';
import { seedFor } from '../../audit/scenarios.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
function loadPlaywright() {
  const dirs = [process.env.PLAYWRIGHT_DIR, '/tmp/claude-0/-home-user-Simple-Calories-Ledger/c2b3286b-a6c3-570c-8c6a-5df39c844de9/scratchpad/pw', here].filter(Boolean);
  for (const dir of dirs) {
    try { return createRequire(path.join(dir, 'noop.js'))('playwright'); } catch { /* next */ }
  }
  throw new Error('Cannot find playwright. Set PLAYWRIGHT_DIR to a folder with node_modules/playwright.');
}
const { chromium } = loadPlaywright();

const tz = process.env.AUDIT_TZ || 'Australia/Melbourne';
const cfg = {
  url: process.env.SMOKE_URL || 'http://127.0.0.1:5197/Simple-Calories-Ledger/',
  tz,
  today: process.env.AUDIT_TODAY || dateKeyIn(Intl.DateTimeFormat().resolvedOptions().timeZone)
};

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const registry = new Registry(here, cfg);
const s = await openSession(browser, registry, cfg, { name: 'keyboard', theme: 'light', hour: 13, state: seedFor(cfg, { hour: 13 }) });
const { page } = s;
const sleep = ms => page.waitForTimeout(ms);

/** Where focus is, relative to the sheet on top. */
const where = () => page.evaluate(() => {
  const sheets = [...document.querySelectorAll('.modal-panel[role=dialog]')];
  const top = sheets[sheets.length - 1] || null;
  const active = document.activeElement;
  const describe = el => el ? (el.getAttribute('aria-label') || el.getAttribute('placeholder') || (el.innerText || '').trim().slice(0, 30) || el.className || el.tagName) : '';
  return {
    sheet: !!top,
    inside: !!(top && active && top.contains(active)),
    onPanel: active === top,
    label: describe(active),
    tag: active ? active.tagName.toLowerCase() : '',
    mainInert: !!document.querySelector('main.app')?.inert,
    tabbarInert: !!document.querySelector('.tabbar-wrap')?.inert
  };
});

/** Tab forward then back, `presses` times each way: focus must stay inside the sheet on top. */
async function tabAround(label, presses = 40) {
  let outside = 0;
  const strays = [];
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < presses; i += 1) {
      await page.keyboard.press(key);
      const w = await where();
      if (!w.inside) { outside += 1; if (strays.length < 4) strays.push(`${key}:${w.tag}:${w.label}`); }
    }
  }
  check(`${label}: Tab and Shift+Tab (${presses * 2} presses) never leave the sheet`, outside === 0, outside ? `left ${outside}x: ${strays.join(' | ')}` : '');
}

async function opensWithFocusInside(label) {
  await sleep(700);
  const w = await where();
  check(`${label}: focus is inside the sheet after it opens`, w.sheet && w.inside, `${w.tag}:${w.label}`);
  check(`${label}: the page and tab bar are inert behind it`, w.mainInert && w.tabbarInert);
}

async function closesWithEscape(label, opener) {
  await page.keyboard.press('Escape');
  await sleep(700);
  const w = await where();
  const focus = await page.evaluate(() => { const a = document.activeElement; return a ? (a.getAttribute('aria-label') || (a.innerText || '').trim().slice(0, 30) || a.tagName) : ''; });
  check(`${label}: Escape closes the sheet`, !w.sheet);
  check(`${label}: the page is no longer inert`, !w.mainInert && !w.tabbarInert);
  const back = await page.evaluate(sel => document.activeElement === document.querySelector(sel), opener);
  check(`${label}: focus returns to the opener`, back, back ? '' : `focus is on "${focus}"`);
}

/* 1. The Log sheet, from the sparkle, by keyboard. */
await page.locator('.tabbar-wrap button.log-button').focus();
await page.keyboard.press('Enter');
await opensWithFocusInside('Log sheet');
await tabAround('Log sheet');
await closesWithEscape('Log sheet', '.tabbar-wrap button.log-button');

/* 2. The Log sheet's Suggest mode keeps the trap too (the content changes under focus). */
await page.locator('.tabbar-wrap button.log-button').focus();
await page.keyboard.press('Enter');
await sleep(700);
await s.dialog().locator('.log-mode').getByRole('button', { name: 'Suggest', exact: true }).click();
await sleep(400);
await tabAround('Log sheet (Suggest)', 25);
await closesWithEscape('Log sheet (Suggest)', '.tabbar-wrap button.log-button');

/* 3. The review sheet, reached by estimating. */
await page.locator('.tabbar-wrap button.log-button').focus();
await page.keyboard.press('Enter');
await sleep(700);
await s.dialog().locator('textarea').first().fill('Chicken burrito bowl from Guzman y Gomez, medium');
await s.dialog().locator('button.log-estimate').focus();
await page.keyboard.press('Enter');
await s.dialog().getByText(/Estimated/).first().waitFor({ state: 'visible', timeout: 15000 });
await sleep(800);
const review = await where();
check('Review sheet: focus is inside the sheet', review.sheet && review.inside, `${review.tag}:${review.label}`);
check('Review sheet: the page and tab bar are inert behind it', review.mainInert && review.tabbarInert);
await tabAround('Review sheet');
await closesWithEscape('Review sheet', '.tabbar-wrap button.log-button');

/* 4. A Settings help sheet, opened from its ? button. */
await page.getByRole('button', { name: 'Settings', exact: true }).first().focus();
await page.keyboard.press('Enter');
await page.getByRole('heading', { name: 'Settings' }).waitFor({ state: 'visible', timeout: 6000 });
await sleep(500);
const help = page.locator('.gemini-settings-card .help-btn');
await help.focus();
await page.keyboard.press('Enter');
await opensWithFocusInside('Settings help sheet');
await tabAround('Settings help sheet');
await page.keyboard.press('Escape');
await sleep(700);
const afterHelp = await page.evaluate(() => ({ sheet: !!document.querySelector('.modal-panel[role=dialog]'), onHelp: document.activeElement === document.querySelector('.gemini-settings-card .help-btn'), inert: !!document.querySelector('main.app')?.inert }));
check('Settings help sheet: Escape closes it and focus returns to the ? button', !afterHelp.sheet && afterHelp.onHelp && !afterHelp.inert);

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(failed.length ? `\nKEYBOARD CHECK FAILED (${failed.length} of ${results.length})` : `\nKEYBOARD CHECK OK (${results.length} checks)`);
process.exit(failed.length ? 1 : 0);
