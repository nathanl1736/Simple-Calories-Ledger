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
import { addDays, dateKeyIn, zonedEpoch } from './seed.mjs';
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

await step('Typing in Log food searches: results replace the usuals, a tap opens it filled in', async () => {
  await sparkle().click();
  await visible(s.dialog());
  await visible(s.dialog().getByRole('button', { name: /Add to fridge/ }));
  await s.dialog().locator('textarea.log-text').fill('rice');
  await visible(s.dialog().locator('.log-results'));
  const fav = s.dialog().locator('.log-results .food-search-row', { hasText: 'Chicken and rice' });
  await visible(fav);
  await visible(s.dialog().locator('.log-results .food-search-row', { hasText: 'Beef mince rice bowl' }));
  await visible(s.dialog().locator('.log-results .food-search-glyph.database'), 8000);
  if (await s.dialog().getByRole('button', { name: /Add to fridge/ }).count()) throw new Error('Other ways still show while searching');
  if (!(await s.dialog().getByRole('button', { name: /^Estimate$/ }).isEnabled())) throw new Error('Estimate is not available while searching');
  await shot('log-search');
  await fav.first().click();
  await page.waitForFunction(() => [...document.querySelectorAll('.modal-panel[role=dialog] input')].some(input => input.value === 'Chicken and rice'), null, { timeout: 6000 });
  await s.closeAll();
  // What was typed for it is gone the next time.
  await sparkle().click();
  await visible(s.dialog().getByRole('button', { name: /Add to fridge/ }));
  if (await s.dialog().locator('textarea.log-text').inputValue()) throw new Error('The search stayed in the box');
  await s.closeAll();
});

await step('Favourites have their own row in Log food: a tap logs one with Undo, See all shows them all', async () => {
  await sparkle().click();
  await visible(s.dialog());
  const row = s.dialog().locator('.log-favourites');
  await visible(row.getByText('Favourites', { exact: true }));
  // Every favourite is in its own row and none is also a usual.
  const favourites = await row.locator('.log-chip:not(.log-chip-more) b').allInnerTexts();
  const usuals = await s.dialog().locator('.log-usuals .log-chip:not(.log-chip-more) b').allInnerTexts();
  const saved = (s.seeded?.foods || []).filter(food => food.favourite).map(food => food.name);
  if (saved.some(name => !favourites.includes(name))) throw new Error(`Missing favourites: ${saved.filter(name => !favourites.includes(name)).join(', ')}`);
  if (favourites.some(name => usuals.includes(name))) throw new Error('A favourite shows in both rows');
  await shot('log-favourites');
  const seeAll = s.dialog().locator('.log-see-all');
  if (await seeAll.count()) {
    await seeAll.click();
    await visible(s.dialog().locator('#log-favourite-chips.is-wrapped'));
    await shot('log-favourites-all');
  }
  await row.locator('.log-chip', { hasText: 'Flat white' }).first().click();
  await visible(page.getByRole('button', { name: 'Undo' }));
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await page.waitForTimeout(400);
});

await step('A food database result shows its estimate over Log food', async () => {
  await sparkle().click();
  await visible(s.dialog());
  await s.dialog().locator('textarea.log-text').fill('greek yog');
  const row = s.dialog().locator('.log-results .food-search-row:has(.food-search-glyph.database)');
  await visible(row, 8000);
  await row.first().click();
  const preview = page.locator('.modal-panel[role=dialog][aria-label="Food estimate"]');
  await visible(preview);
  await visible(preview.getByRole('button', { name: 'Use this food' }));
  await shot('log-search-database');
  await s.closeTop();
  // Emptying the box brings the usuals and other ways back.
  await s.dialog().locator('textarea.log-text').fill('');
  await visible(s.dialog().getByRole('button', { name: /Add to fridge/ }));
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

await step('Estimate again: a logged estimate puts what went in back in Log food\u2019s box', async () => {
  await sparkle().click();
  await visible(s.dialog().locator('textarea.log-text'));
  await s.dialog().locator('textarea.log-text').fill('Chicken burrito bowl from Guzman y Gomez, medium');
  await s.dialog().getByRole('button', { name: /^Estimate$/ }).click();
  await visible(s.dialog().getByRole('button', { name: /^Log \d/ }), 15000);
  await s.dialog().getByRole('button', { name: /^Log \d/ }).click();
  await page.waitForTimeout(600);
  await s.scrollTo('[aria-label="Day line"]');
  await page.locator('[aria-label="Day line"]').getByRole('button', { name: /^Chicken burrito bowl, / }).first().click();
  await visible(s.dialog().getByText('Edit entry', { exact: true }));
  await shot('estimate-again-entry');
  await s.dialog().getByRole('button', { name: 'Estimate again' }).click();
  await page.waitForFunction(() => !!document.querySelector('textarea.log-text')?.value, null, { timeout: 6000 });
  const text = await s.dialog().locator('textarea.log-text').inputValue();
  if (!text.startsWith('Chicken burrito bowl:\n1 cup Mexican rice (180 g)\n')) throw new Error(`Log food's box holds ${JSON.stringify(text)}`);
  if (/Assumed|Confidence/.test(text)) throw new Error(`Dawni's notes about the estimate went in the box: ${text}`);
  // A list of what went in is for Gemini, not a search: the usuals and Other ways stay.
  await visible(s.dialog().getByRole('button', { name: /Add to fridge/ }));
  await shot('estimate-again-log');
  await s.dialog().locator('textarea.log-text').fill('');
  await s.closeAll();
});

await step('Suggest: a typed venue reaches a result with Log this', async () => {
  await sparkle().click();
  await visible(s.dialog());
  await s.dialog().locator('.log-mode').getByRole('button', { name: 'Suggest', exact: true }).click();
  await visible(s.dialog().getByText('What should I eat?', { exact: true }));
  await s.dialog().locator('textarea').first().fill('Going to Macca’s for lunch');
  await s.dialog().locator('button.log-estimate').click();
  await visible(s.dialog().locator('.suggest-card'), 15000);
  await visible(s.dialog().getByRole('button', { name: 'Log this' }));
  await shot('suggest');
  await s.closeAll();
});

// A 2x2 PNG stands in for a photo of a nutrition panel; the mocked Gemini reads it as a 1 L tub of 8 serves.
const LABEL_PNG = { name: 'label.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP43+AARAwQCgAz7gb9lkiSPAAAAABJRU5ErkJggg==', 'base64') };

await step('Fridge: a label photo goes in as 8 serves, and one tap on Today logs a serve', async () => {
  await sparkle().click();
  await visible(s.dialog());
  await s.dialog().getByRole('button', { name: /Add to fridge/ }).first().click();
  await visible(s.dialog().getByRole('button', { name: /I bought it/ }));
  await shot('fridge-choose');
  // "I bought it" opens the camera in the same tap.
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 4000 }), s.dialog().getByRole('button', { name: /I bought it/ }).click()]);
  await chooser.setFiles(LABEL_PNG);
  await visible(s.dialog().locator('.fridge-photos .log-thumb'));
  await s.dialog().getByRole('button', { name: 'Read label', exact: true }).click();
  await visible(s.dialog().getByText('From label'), 15000);
  await visible(s.dialog().getByText(/The label’s serve is 1 scoop \(70 g\)/));
  await shot('fridge-review');
  await s.dialog().getByRole('button', { name: 'Save 8 serves', exact: true }).click();
  await page.waitForTimeout(600);
  const row = page.locator('.tl-prep-row', { hasText: 'Vanilla ice cream' });
  await visible(row);
  await row.click();
  await visible(page.getByText(/7 left/).first());
  await shot('fridge-today');
});

await step('Fridge: two ready meals typed in by name are 2 serves in Foods → Fridge', async () => {
  await s.tab('library');
  await page.getByRole('tab', { name: 'Fridge' }).click();
  await page.getByRole('button', { name: /Add to fridge/ }).first().click();
  await visible(s.dialog().getByRole('button', { name: /I bought it/ }));
  // The camera opening is checked in the step above; headless Chromium sometimes declines a second chooser in one run.
  const chooser = page.waitForEvent('filechooser', { timeout: 2500 }).catch(() => null);
  await s.dialog().getByRole('button', { name: /I bought it/ }).click();
  await (await chooser)?.setFiles([]);
  await s.dialog().getByPlaceholder(/Muscle Chef/).fill('Muscle Chef chicken pesto pasta');
  await s.dialog().getByRole('button', { name: 'One pack more' }).click();
  await s.dialog().getByRole('button', { name: 'Estimate', exact: true }).click();
  await visible(s.dialog().getByRole('button', { name: 'Save 2 serves', exact: true }), 15000);
  await s.dialog().getByRole('button', { name: 'Save 2 serves', exact: true }).click();
  await page.waitForTimeout(600);
  await visible(page.locator('.prep-row', { hasText: 'Chicken pesto pasta' }));
  await visible(page.getByText(/bought today/).first());
  await shot('fridge-foods');
  await s.tab('tracking');
});

const readState = () => page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open('calorie-tracker-db');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const get = open.result.transaction('kv').objectStore('kv').get('state');
    get.onsuccess = () => resolve(get.result);
    get.onerror = () => reject(get.error);
  };
}));

await step('Fridge: a saved food goes in without a scan, and a serve logs as that food', async () => {
  const name = 'Greek yoghurt, plain';
  const foodsBefore = (await readState()).foods.length;
  await sparkle().click();
  await visible(s.dialog());
  await s.dialog().getByRole('button', { name: /Add to fridge/ }).first().click();
  await s.dialog().getByRole('button', { name: /From my foods/ }).click();
  await visible(s.dialog().getByText('From your foods', { exact: true }));
  await s.dialog().getByRole('searchbox', { name: 'Search your foods' }).fill('yoghurt plain');
  await s.dialog().locator('.food-search-row', { hasText: name }).first().click();
  await visible(s.dialog().locator('.fridge-food', { hasText: name }));
  if ((await s.dialog().locator('#fridgeServeGrams').inputValue()) !== '200') throw new Error('A per 100 g food did not start from its own serve size');
  await s.dialog().getByRole('button', { name: 'One serve more' }).click();
  await shot('fridge-saved-food');
  await s.dialog().getByRole('button', { name: 'Save 2 serves', exact: true }).click();
  await page.waitForTimeout(600);
  const row = page.locator('.tl-prep-row', { hasText: name });
  await visible(row);
  await row.click();
  await visible(page.locator('.toast', { hasText: /1 left/ }));
  await page.waitForTimeout(300);
  const saved = await readState();
  const food = saved.foods.find(item => item.name === name);
  const entry = saved.entries.filter(item => item.name === name && item.batchId).at(-1);
  if (saved.foods.length !== foodsBefore) throw new Error(`Saved foods went from ${foodsBefore} to ${saved.foods.length}`);
  if (!entry || entry.sourceFoodId !== food.id) throw new Error('The serve is not linked to the saved food');
  if (entry.unitMode !== '100g' || entry.portion !== 200) throw new Error(`The serve logged as ${entry.portion} ${entry.unitMode}, not 200 g`);
});

await step('Fridge: one more of something bought keeps each serve; a split only splits what is left', async () => {
  // The ice cream from the label step: 8 serves of 160 Cal, one logged.
  await s.tab('library');
  await page.getByRole('tab', { name: 'Fridge' }).click();
  await page.getByRole('button', { name: /^Edit Vanilla ice cream/ }).first().click();
  await visible(s.dialog().getByRole('button', { name: 'Save changes' }));
  const each = () => s.dialog().locator('#batchCalories').inputValue();
  if ((await each()) !== '160') throw new Error(`A serve opened at ${await each()} Cal, not 160`);
  await s.dialog().getByRole('button', { name: 'One serve more' }).click();
  if ((await each()) !== '160') throw new Error(`One more serve changed each serve to ${await each()} Cal`);
  const choice = s.dialog().getByRole('group', { name: 'What 9 serves means' });
  await visible(choice);
  if ((await choice.getByRole('button', { name: 'Each serve the same' }).getAttribute('aria-pressed')) !== 'true') throw new Error('Bought food did not default to Each serve the same');
  await shot('fridge-edit-more');
  // Split: the 7 serves left (1,120 Cal) go into 8.
  await choice.getByRole('button', { name: 'Split what’s left' }).click();
  if ((await each()) !== '140') throw new Error(`Split what's left gave ${await each()} Cal a serve, not 140`);
  await choice.getByRole('button', { name: 'Each serve the same' }).click();
  await s.dialog().getByRole('button', { name: 'Save changes' }).click();
  await page.waitForTimeout(600);
  const batch = (await readState()).batches.find(item => item.name.startsWith('Vanilla ice cream'));
  if (batch.servings !== 9 || batch.total.calories !== 1440) throw new Error(`Saved as ${batch.servings} serves of ${batch.total.calories} Cal, not 9 of 1440`);
  // Cooking splits by default.
  await page.getByRole('button', { name: /^Edit Beef mince rice bowl/ }).first().click();
  await s.dialog().getByRole('button', { name: 'One serve more' }).click();
  const pressed = s.dialog().locator('.serves-change button[aria-pressed="true"]');
  await visible(pressed);
  if (!/^Split/.test(await pressed.innerText())) throw new Error('A cooked batch did not default to splitting');
  await s.closeTop();
  await s.tab('tracking');
});

await step('Long-press on an entry opens its menu', async () => {
  await s.scrollTo('[aria-label="Day line"]');
  const row = page.locator('[aria-label="Day line"] .tl-row, [aria-label="Day line"] [role=button]').first();
  await s.longPress(row);
  await visible(page.locator('[role=menu]'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

// Last: it moves the clock on a day.
await step('Left open overnight, Today moves on to the new day, and a fridge tap logs there', async () => {
  await s.closeAll();
  await visible(page.locator('.tl-title', { hasText: /^Today$/ }));
  // A home screen app is suspended overnight, then shown again in the morning.
  await page.clock.setFixedTime(zonedEpoch(addDays(cfg.today, 1), 8, 0, cfg.tz));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(300);
  const title = await page.locator('.tl-title').innerText();
  if (title !== 'Today') throw new Error(`Today came back on another day: "${title}"`);
  await s.scrollTo('.tl-prep');
  await page.locator('.tl-prep-row').first().click();
  await visible(page.locator('.toast', { hasText: /^Logged/ }));
  const toast = await page.locator('.toast', { hasText: /^Logged/ }).last().innerText();
  if (/yesterday/i.test(toast)) throw new Error(`The serve went to yesterday: ${toast}`);
  await shot('overnight-fridge');
});

await browser.close();

const unexpectedConsole = registry.problems.console.filter(c => c.type === 'error' && !c.expected);
const pageErrors = registry.problems.pageErrors;
const failed = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  ->  ${r.error}`}`);
console.log(`\npage errors: ${pageErrors.length}`);
pageErrors.forEach(e => console.log(`  ${e.message}`));
console.log(`unexpected console errors: ${unexpectedConsole.length}`);
unexpectedConsole.forEach(e => console.log(`  ${e.text}${e.url ? `  (${e.url})` : ""}`));
const ok = !failed.length && !pageErrors.length && !unexpectedConsole.length;
console.log(ok ? '\nSMOKE OK' : '\nSMOKE FAILED');
process.exit(ok ? 0 : 1);
