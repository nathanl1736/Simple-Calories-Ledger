#!/usr/bin/env node
/**
 * Dawni design audit: captures every screen of the app in light and dark, with seeded data, a clock that follows
 * the Tidelight sky, and a mocked Gemini API. Output: design/audit/screenshots/*.png, INDEX.md, audit-data.json.
 *
 * ONE-TIME SETUP (Playwright lives outside the repo, so package.json stays untouched)
 *   mkdir -p ~/dawni-audit-pw && cd ~/dawni-audit-pw && npm init -y && npm i playwright@1.56.1
 *   (1.56.x matches the preinstalled Chromium build 1194 in /opt/pw-browsers; never run `playwright install`.
 *    With another Playwright version, set CHROMIUM_PATH to a chrome binary instead.)
 *   export PLAYWRIGHT_DIR=~/dawni-audit-pw        # where node_modules/playwright is
 *
 * RUN (the dev server must be up: `npm run dev`, serving http://127.0.0.1:5173/Simple-Calories-Ledger/)
 *   node design/audit/capture.mjs
 *
 * OPTIONS (environment variables)
 *   AUDIT_URL      app URL                      (default http://127.0.0.1:5173/Simple-Calories-Ledger/)
 *   AUDIT_TZ       IANA time zone of the "user"  (default Australia/Melbourne)
 *   AUDIT_THEMES   comma list                    (default light,dark)
 *   AUDIT_ONLY     comma list of scenario names  (fresh, today-0730, tour-1300, today-1900, today-1900-light, today-2300,
 *                  today-2300-over, midweek, interact, ai, settings, no-key, backup, update)
 *   AUDIT_OUT      output folder                 (default design/audit/screenshots)
 *   PLAYWRIGHT_DIR see above
 *
 * Today is the real date in AUDIT_TZ; seeded entries are dated relative to it, and the browser clock is fixed to that
 * date at 07:30, 13:00, 19:00 and 23:00 so the seeded entries land on "today".
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Registry, openSession } from './harness.mjs';
import { addDays, dateKeyIn, freshState, weekdayOf } from './seed.mjs';
import { aiFlows, backupReminder, fresh, interact, midweek, noKey, seedFor, settingsFlows, todayAt, tour, updateModal } from './scenarios.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function loadPlaywright() {
  const dirs = [process.env.PLAYWRIGHT_DIR, '/tmp/claude-0/-home-user-Simple-Calories-Ledger/c2b3286b-a6c3-570c-8c6a-5df39c844de9/scratchpad/pw', here].filter(Boolean);
  for (const dir of dirs) {
    try { return createRequire(path.join(dir, 'noop.js'))('playwright'); } catch { /* try the next one */ }
  }
  throw new Error('Cannot find the playwright package. Set PLAYWRIGHT_DIR to a folder with node_modules/playwright (see the header of this file).');
}

const tz = process.env.AUDIT_TZ || 'Australia/Melbourne';
const cfg = {
  url: process.env.AUDIT_URL || 'http://127.0.0.1:5173/Simple-Calories-Ledger/',
  tz,
  today: dateKeyIn(tz),
  themes: (process.env.AUDIT_THEMES || 'light,dark').split(',').map(t => t.trim()).filter(Boolean),
  only: (process.env.AUDIT_ONLY || '').split(',').map(t => t.trim()).filter(Boolean),
  out: process.env.AUDIT_OUT || path.join(here, 'screenshots')
};
fs.mkdirSync(cfg.out, { recursive: true });

// A mid-week date (Wednesday on or before today) for a second look at Today and Week with days still to come.
const sinceWed = (weekdayOf(cfg.today) - 3 + 7) % 7;
const midweekOffset = -sinceWed;
const midweekDate = addDays(cfg.today, midweekOffset);

const seed = o => seedFor(cfg, o);
const PLAN = [
  { name: 'fresh', fn: s => fresh(s, cfg), spec: { hour: 8, minute: 30, state: ({ theme }) => freshState(theme) } },
  { name: 'today-0730', fn: s => todayAt(s, cfg, { tag: '0730', note: 'Breakfast and a flat white logged; lunch usuals sit on the Now line.', macros: true, audit: true }), spec: { hour: 7, minute: 30, state: seed({ hour: 7 }) } },
  { name: 'tour-1300', fn: s => tour(s, cfg), spec: { hour: 13, state: seed({ hour: 13 }), audit: true } },
  { name: 'today-1900', fn: s => todayAt(s, cfg, { tag: '1900', note: 'Breakfast, lunch and afternoon snacks logged; dinner still to come, so the Now line offers dinner usuals.', macros: true, audit: true }), spec: { hour: 19, state: seed({ hour: 19 }) } },
  { name: 'today-1900-light', fn: s => todayAt(s, cfg, { tag: '1900-light', note: 'Only breakfast logged by the evening: the day looks light.', doneLight: true }), spec: { hour: 19, state: seed({ hour: 19, variant: 'light' }) } },
  { name: 'today-2300', fn: s => todayAt(s, cfg, { tag: '2300', note: 'Everything logged, just under target; the sun has set on the arc.', macros: true, done: true, audit: true }), spec: { hour: 23, state: seed({ hour: 23 }) } },
  { name: 'today-2300-over', fn: s => todayAt(s, cfg, { tag: '2300-over', note: 'A big pub night: over target, with the afterglow instead of red.', macros: true, audit: true }), spec: { hour: 23, state: seed({ hour: 23, variant: 'over' }) } },
  { name: 'midweek', fn: s => midweek(s, cfg), spec: { hour: 13, dateOffset: midweekOffset, state: seedFor({ ...cfg, today: midweekDate }, { hour: 13 }) } },
  { name: 'interact', fn: s => interact(s, cfg), spec: { hour: 13, state: seed({ hour: 13 }), audit: true } },
  { name: 'ai', fn: s => aiFlows(s, cfg), spec: { hour: 13, state: seed({ hour: 13 }), audit: true } },
  { name: 'settings', fn: s => settingsFlows(s, cfg), spec: { hour: 13, state: seed({ hour: 13 }), audit: true } },
  { name: 'no-key', fn: s => noKey(s, cfg), spec: { hour: 13, state: seed({ hour: 13, key: false }) } },
  { name: 'backup', fn: s => backupReminder(s), spec: { hour: 13, state: seed({ hour: 13, backup: 'overdue' }), audit: true } },
  { name: 'update', fn: s => updateModal(s, cfg), spec: { hour: 13, state: seed({ hour: 13 }), audit: true } }
];

const { chromium } = loadPlaywright();
const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const browser = await chromium.launch(launchOptions);
const registry = new Registry(cfg.out, { ...cfg, midweekDate });
const started = Date.now();

for (const theme of cfg.themes) {
  for (const item of PLAN) {
    if (cfg.only.length && !cfg.only.includes(item.name)) continue;
    const t0 = Date.now();
    let session;
    try {
      session = await openSession(browser, registry, cfg, { name: item.name, theme, auditing: theme === cfg.themes[0] && item.spec.audit !== false, ...item.spec });
      await item.fn(session);
      console.log(`${theme.padEnd(5)} ${item.name.padEnd(18)} ${((Date.now() - t0) / 1000).toFixed(1)}s  shots so far: ${registry.shots.length}`);
    } catch (err) {
      console.error(`${theme} ${item.name} FAILED: ${err.stack || err}`);
      registry.problems.scenarioErrors.push({ scenario: item.name, theme, step: 'scenario', error: String(err.message || err).split('\n')[0] });
      try { await session?.page.screenshot({ path: path.join(cfg.out, `_failed-${item.name}-${theme}.png`) }); } catch { /* page gone */ }
    } finally {
      await session?.context.close().catch(() => {});
    }
  }
}
await browser.close();

/* ------------------------------------------------------------------ INDEX.md and audit-data.json */

const full = !cfg.only.length;
const shots = [...registry.shots].sort((a, b) => a.nn - b.nn || cfg.themes.indexOf(a.theme) - cfg.themes.indexOf(b.theme));
const esc = text => String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const lines = [
  '# Dawni screenshot index',
  '',
  `Captured ${new Date().toISOString().slice(0, 10)} from branch claude/ai-first-redesign (app version in package.json) by \`node design/audit/capture.mjs\`.`,
  `Viewport 390x844 CSS px at 2x (780x1688 px images), iPhone Safari user agent, touch, locale en-AU, time zone ${cfg.tz}. "Today" is ${cfg.today}; the browser clock is fixed to the time shown in the Clock column, on that date${midweekOffset ? ` (the mid-week rows use ${midweekDate})` : ''}.`,
  'Gemini is mocked (no real key, no network): the key is the dummy `AIza-mock-key-for-screenshots`.',
  '',
  'File names are `NN-screen-state-theme.png`. NN is shared by the light and dark version of the same shot. A state ending `-viewport` is the first screen; `-full` is the same page captured full height (the floating tab bar stays at the bottom of the first screen in full-page captures). A state ending `-scrolled` is a sheet scrolled to its end.',
  '',
  '| File | Screen | State | Theme | Clock | What it shows |',
  '| --- | --- | --- | --- | --- | --- |',
  ...shots.map(s => `| ${s.file} | ${esc(s.screen)} | ${esc(s.state)} | ${s.theme} | ${s.clock} | ${esc(s.desc)} |`),
  ''
];
fs.writeFileSync(path.join(cfg.out, full ? 'INDEX.md' : 'INDEX.partial.md'), lines.join('\n'));

const audit = { config: { ...cfg, midweekDate }, shotCount: registry.shots.length, seconds: Math.round((Date.now() - started) / 1000), problems: registry.problems };
fs.writeFileSync(path.join(here, full ? 'audit-data.json' : 'audit-data.partial.json'), JSON.stringify(audit, null, 1));

console.log(`\n${registry.shots.length} screenshots in ${audit.seconds}s -> ${cfg.out}`);
console.log(`console messages: ${registry.problems.console.length} (${registry.problems.console.filter(c => !c.expected).length} unexpected), page errors: ${registry.problems.pageErrors.length}, scenario errors: ${registry.problems.scenarioErrors.length}`);
registry.problems.scenarioErrors.forEach(e => console.log(`  ! ${e.theme} ${e.scenario} / ${e.step}: ${e.error}`));
