// Fast runtime smoke test for Dawni: one seeded session at 13:00, every tab, the main sheets, one mocked Gemini estimate.
// Fails (exit 1) on any page error, unexpected console error, or a step that cannot be completed.
//
//   npx vite --host 127.0.0.1 --port 5190 &
//   SMOKE_URL=http://127.0.0.1:5190/Simple-Calories-Ledger/ node design/audit/smoke.mjs
//
// Build agents: when your chunk changes a control this script drives, update the step here in the same commit.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Registry, openSession } from './harness.mjs';
import { dateKeyIn } from './seed.mjs';
import { seedFor } from './scenarios.mjs';

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
  url: process.env.SMOKE_URL || 'http://127.0.0.1:5190/Simple-Calories-Ledger/',
  tz,
  today: process.env.AUDIT_TODAY || dateKeyIn(Intl.DateTimeFormat().resolvedOptions().timeZone),
  out: process.env.SMOKE_OUT || ''
};
const theme = process.env.SMOKE_THEME || 'light';

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const registry = new Registry(cfg.out || here, cfg);
const s = await openSession(browser, registry, cfg, { name: 'smoke', theme, hour: 13, state: seedFor(cfg, { hour: 13 }) });
const { page } = s;
const results = [];
const shot = async name => { if (cfg.out) await page.screenshot({ path: path.join(cfg.out, `smoke-${name}-${theme}.png`) }); };

async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: String(err?.message || err).split('\n')[0].slice(0, 220) });
    await s.closeAll().catch(() => {});
  }
}
const visible = (locator, timeout = 6000) => locator.first().waitFor({ state: 'visible', timeout });
const sparkle = () => page.locator('.tabbar-wrap button.log-button');
const settingsButton = () => page.getByRole('button', { name: 'Settings', exact: true }).first();

await step('Today renders the hero and day line', async () => {
  await visible(page.locator('.tl-hero'));
  await visible(page.locator('[aria-label="Day line"]'));
  await shot('today');
});

await step('Week renders and opens its details sheet', async () => {
  await s.tab('stats');
  await visible(page.locator('.tl-tiles'));
  await shot('week');
  await page.locator('.tl-bank').first().click();
  await visible(s.dialog());
  await s.closeTop();
});

await step('Journal renders', async () => {
  await s.tab('journal');
  await visible(page.getByRole('heading', { name: 'Journal' }));
});

await step('Foods renders and opens Manage food', async () => {
  await s.tab('library');
  await visible(page.getByRole('heading', { name: 'Foods' }));
  await page.locator('button[aria-label^="Manage "]').first().click();
  await visible(s.dialog());
  await s.closeTop();
});

await step('Settings opens and Done returns', async () => {
  await s.tab('tracking');
  await settingsButton().click();
  await visible(page.getByRole('heading', { name: 'Settings' }));
  await page.getByRole('button', { name: 'Done' }).click();
  await visible(page.locator('.tl-hero'));
});

await step('Search foods overlay opens and cancels', async () => {
  const trigger = page.getByRole('button', { name: /Search foods/ }).first();
  if (await trigger.count()) {
    await trigger.click();
  } else {
    await sparkle().click();
    await visible(s.dialog());
    await s.dialog().getByRole('button', { name: /Search foods/ }).first().click();
  }
  await visible(page.locator('[role=dialog][aria-label="Search foods"]'));
  await page.locator('.food-search-cancel').click();
  await page.waitForTimeout(500);
  await s.closeAll();
});

await step('Manual entry sheet opens', async () => {
  const row = page.getByRole('button', { name: /Log manually/ }).first();
  if (await row.count()) {
    await row.click();
  } else {
    await sparkle().click();
    await visible(s.dialog());
    await s.dialog().getByRole('button', { name: /Type it in/ }).first().click();
  }
  await visible(s.dialog().getByText(/Log (breakfast|lunch|dinner|snack|drink)/i));
  await s.closeAll();
});

await step('Mocked Gemini estimate reaches the review sheet', async () => {
  await sparkle().click();
  await visible(s.dialog());
  const legacyRow = s.dialog().getByRole('button', { name: /Estimate with Gemini/ });
  if (await legacyRow.count()) await legacyRow.first().click();
  await visible(s.dialog().locator('textarea'));
  await s.dialog().locator('textarea').first().fill('Chicken burrito bowl from Guzman y Gomez, medium');
  await s.dialog().getByRole('button', { name: /^Estimate( food)?$/ }).first().click();
  await visible(page.locator('.modal-panel[role=dialog]').getByText(/Estimated/).first(), 15000);
  await shot('review');
  await s.closeAll();
});

await step('Long-press on an entry opens its menu', async () => {
  await s.scrollTo('[aria-label="Day line"]');
  const row = page.locator('[aria-label="Day line"] .tl-row, [aria-label="Day line"] [role=button]').first();
  await s.longPress(row);
  await visible(page.locator('[role=menu]'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

await browser.close();

const unexpectedConsole = registry.problems.console.filter(c => c.type === 'error' && !c.expected);
const pageErrors = registry.problems.pageErrors;
const failed = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  ->  ${r.error}`}`);
console.log(`\npage errors: ${pageErrors.length}`);
pageErrors.forEach(e => console.log(`  ${e.message}`));
console.log(`unexpected console errors: ${unexpectedConsole.length}`);
unexpectedConsole.forEach(e => console.log(`  ${e.text}`));
const ok = !failed.length && !pageErrors.length && !unexpectedConsole.length;
console.log(ok ? '\nSMOKE OK' : '\nSMOKE FAILED');
process.exit(ok ? 0 : 1);
