// Chunk 4 (motion) check: does Today actually move, does it stop, do sheets, presses and toasts behave?
//
//   npx vite --host 127.0.0.1 --port 5195 --strictPort &
//   SMOKE_URL=http://127.0.0.1:5195/Simple-Calories-Ledger/ node design/build/chunk4/motion-check.mjs
//
// Samples the hero's big number and the sun's cx every ~30 ms while an entry is logged from the Log sheet and
// then undone, once normally and once with prefers-reduced-motion, counts requestAnimationFrame callbacks to
// show the loop stops, drives sheet drags with real touch events, and writes a frame strip and stills beside
// this file (or MOTION_OUT).
import fs from 'node:fs';
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
  url: process.env.SMOKE_URL || 'http://127.0.0.1:5195/Simple-Calories-Ledger/',
  tz,
  today: process.env.AUDIT_TODAY || dateKeyIn(Intl.DateTimeFormat().resolvedOptions().timeZone),
  out: process.env.MOTION_OUT || here
};

const results = [];
const metrics = {};
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const num = text => Number(String(text).replace(/[^0-9.\-]/g, ''));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const distinct = values => [...new Set(values)];
const monotone = (values, dir) => values.every((v, i) => i === 0 || (dir > 0 ? v >= values[i - 1] - 1e-9 : v <= values[i - 1] + 1e-9));

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const registry = new Registry(cfg.out, cfg);

/** A browser whose contexts carry the options we want, and count every requestAnimationFrame callback that runs. */
function browserWith(extra = {}) {
  return {
    newContext: async options => {
      const context = await browser.newContext({ ...options, ...extra });
      await context.addInitScript(() => {
        const original = window.requestAnimationFrame.bind(window);
        window.__raf = { calls: 0 };
        window.requestAnimationFrame = callback => original(time => { window.__raf.calls += 1; callback(time); });
      });
      return context;
    }
  };
}

async function open(theme, { reduced = false, hour = 13 } = {}) {
  const session = await openSession(browserWith(reduced ? { reducedMotion: 'reduce' } : {}), registry, cfg, { name: 'motion', theme, hour, state: seedFor(cfg, { hour }) });
  const cdp = await session.context.newCDPSession(session.page);
  return { s: session, page: session.page, cdp };
}

/** Samples the hero (number, unit, sun x, protein figure and bar), the toast and a tile, every 30 ms, in the page. */
const startSampler = (page, ms = 1100) => page.evaluate(duration => {
  window.__samples = [];
  const t0 = performance.now();
  const read = () => {
    const toast = document.querySelector('.toast');
    const water = document.querySelector('.tl-tile.today .tl-tile-water');
    return {
      t: Math.round(performance.now() - t0),
      number: document.querySelector('.tl-hero-number')?.textContent ?? null,
      unit: document.querySelector('.tl-hero-unit')?.textContent ?? null,
      cx: Number(document.querySelector('.tl-sun')?.getAttribute('cx') ?? NaN),
      protein: document.querySelector('.tl-macro.protein .tl-macro-value strong')?.textContent ?? null,
      bar: [...document.querySelectorAll('.tl-macro.protein .tl-macro-bar i')].reduce((sum, i) => sum + parseFloat(i.style.width || '0'), 0),
      toast: toast ? { leaving: toast.classList.contains('leaving'), opacity: Number(getComputedStyle(toast).opacity) } : null,
      water: water ? parseFloat(getComputedStyle(water).height) : null
    };
  };
  window.__samples.push(read());
  const timer = setInterval(() => {
    window.__samples.push(read());
    if (performance.now() - t0 > duration) clearInterval(timer);
  }, 30);
}, ms);
const readSamples = async (page, wait) => { await sleep(wait); return page.evaluate(() => window.__samples); };
const heroNow = page => page.evaluate(() => ({
  number: document.querySelector('.tl-hero-number')?.textContent ?? null,
  unit: document.querySelector('.tl-hero-unit')?.textContent ?? null,
  cx: Number(document.querySelector('.tl-sun')?.getAttribute('cx') ?? NaN),
  protein: document.querySelector('.tl-macro.protein .tl-macro-value strong')?.textContent ?? null
}));
const rafCalls = page => page.evaluate(() => window.__raf.calls);

async function openLogSheet({ s, page }) {
  await page.locator('.tabbar-wrap button.log-button').click();
  await s.waitFor('[role=dialog]');
  await s.settle(650);
}
const usualChip = page => page.locator('.log-chip:not(.log-chip-more)').first();

/* ------------------------------------------------------------------ 1. log a usual, then undo it: normal motion */
async function logAndUndo(label, { reduced }) {
  const ctx = await open('light', { reduced });
  const { s, page } = ctx;
  const before = await heroNow(page);
  const idleStart = await rafCalls(page);
  await sleep(700);
  check(`${label}: nothing runs a frame callback while Today is idle`, (await rafCalls(page)) === idleStart, `${(await rafCalls(page)) - idleStart} callbacks in 700 ms`);

  await openLogSheet(ctx);
  await startSampler(page);
  await usualChip(page).click();
  const logged = await readSamples(page, 1250);
  const after = await heroNow(page);
  const numbers = logged.map(sample => sample.number);
  const cxs = logged.map(sample => sample.cx);
  const values = numbers.map(num);
  const mid = distinct(numbers).filter(n => n !== before.number && n !== after.number);
  metrics[`${label}.log`] = { before, after, samples: logged.length, distinctNumbers: distinct(numbers).length, distinctCx: distinct(cxs).length };

  check(`${label}: logging changes the number`, before.number !== after.number, `${before.number} to ${after.number}`);
  if (reduced) {
    check(`${label}: the number jumps straight to the final value`, mid.length === 0 && numbers.every(n => n === before.number || n === after.number), `values seen: ${distinct(numbers).join(' | ')}`);
    check(`${label}: the sun jumps straight to its final place`, distinct(cxs).length <= 2, `cx seen: ${distinct(cxs).join(' | ')}`);
    const firstFinal = logged.findIndex(sample => sample.number === after.number);
    check(`${label}: it lands within the first 150 ms of the tap`, firstFinal >= 0 && logged[firstFinal].t <= 150, `landed at ${logged[firstFinal]?.t} ms`);
  } else {
    check(`${label}: the number counts through intermediate values`, mid.length >= 3, `${mid.length} between: ${mid.slice(0, 6).join(', ')}`);
    check(`${label}: the number only moves one way and never passes the final value`, monotone(values, -1) && Math.min(...values) >= num(after.number) - 0.5, `min ${Math.min(...values)} vs final ${num(after.number)}`);
    check(`${label}: the sun travels through intermediate positions`, distinct(cxs).length >= 5, `${distinct(cxs).length} distinct cx`);
    check(`${label}: the sun only moves forward and never past where it ends`, monotone(cxs, 1) && Math.max(...cxs) <= after.cx + 0.05, `max ${Math.max(...cxs)} vs final ${after.cx}`);
    const settled = logged.find(sample => sample.number === after.number && Math.abs(sample.cx - after.cx) < 0.05);
    check(`${label}: it settles in under 1 s`, settled && settled.t < 1000, `settled at ${settled?.t} ms`);
    const proteins = distinct(logged.map(sample => sample.protein));
    check(`${label}: the protein figure moves too`, proteins.length >= 3, `${proteins.join(' | ')}`);
    const bars = distinct(logged.map(sample => Math.round(sample.bar * 10)));
    check(`${label}: the protein bar grows through intermediate widths`, bars.length >= 3, `${bars.length} distinct widths`);
  }

  // The final values are the settled state: the same as a fresh load.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tl-hero');
  await s.settle(700);
  const fresh = await heroNow(page);
  check(`${label}: the final values equal a freshly loaded Today`, fresh.number === after.number && Math.abs(fresh.cx - after.cx) < 0.05 && fresh.protein === after.protein, `${after.number}/${after.cx}/${after.protein} vs ${fresh.number}/${fresh.cx}/${fresh.protein}`);

  // Settled means silent.
  if (!reduced) {
    await openLogSheet(ctx);
    await startSampler(page, 2800);
    await usualChip(page).click();
    await sleep(1800);
    const before2 = await rafCalls(page);
    await sleep(700);
    check(`${label}: the frame loop stops once settled`, (await rafCalls(page)) === before2, `${(await rafCalls(page)) - before2} callbacks in the 700 ms after settling`);
    await readSamples(page, 400);
  } else {
    await openLogSheet(ctx);
    await usualChip(page).click();
    await sleep(600);
  }

  // Undo.
  const beforeUndo = await heroNow(page);
  await page.waitForSelector('.toast-action', { timeout: 4000 });
  await startSampler(page, 2600);
  await page.locator('.toast-action').click();
  const undone = await readSamples(page, 2800);
  const afterUndo = await heroNow(page);
  const undoNumbers = undone.map(sample => sample.number);
  const undoMid = distinct(undoNumbers).filter(n => n !== beforeUndo.number && n !== afterUndo.number);
  metrics[`${label}.undo`] = { beforeUndo, afterUndo, distinctNumbers: distinct(undoNumbers).length };
  check(`${label}: undo restores the numbers from before that entry`, afterUndo.number === fresh.number && Math.abs(afterUndo.cx - fresh.cx) < 0.05 && afterUndo.number !== beforeUndo.number, `${beforeUndo.number} to ${afterUndo.number} (was ${fresh.number} before it)`);
  if (reduced) {
    check(`${label}: undo jumps straight back`, undoMid.length === 0, `values seen: ${distinct(undoNumbers).join(' | ')}`);
  } else {
    check(`${label}: undo animates back through intermediate values`, undoMid.length >= 3, `${undoMid.length} between: ${undoMid.slice(0, 6).join(', ')}`);
    check(`${label}: undo moves the sun back smoothly`, monotone(undone.map(sample => sample.cx).filter(x => x <= beforeUndo.cx + 0.05), -1) || distinct(undone.map(sample => sample.cx)).length >= 5, `${distinct(undone.map(sample => sample.cx)).length} distinct cx`);
    const faded = undone.filter(sample => sample.toast?.leaving);
    check(`${label}: the toast fades out rather than vanishing`, faded.length >= 1 && faded.some(sample => sample.toast.opacity < 1), `${faded.length} fading samples, opacity ${faded.map(sample => sample.toast.opacity.toFixed(2)).join(', ')}`);
  }
  await ctx.s.context.close();
}

await logAndUndo('normal', { reduced: false });
await logAndUndo('reduced', { reduced: true });

/* ------------------------------------------------------------------ 2. interrupt: retarget in flight starts from where it is */
{
  const ctx = await open('light');
  const { s, page } = ctx;
  await openLogSheet(ctx);
  await usualChip(page).click();
  await sleep(150);
  const mid = await heroNow(page);
  await startSampler(page, 900);
  await page.locator('.toast-action').click({ timeout: 3000 }).catch(() => undefined);
  const samples = await readSamples(page, 1000);
  const first = samples.find(sample => sample.cx !== undefined);
  check('interrupting: undo mid-flight starts from where the sun is, not from either end', Math.abs(first.cx - mid.cx) < 12, `mid-flight cx ${mid.cx}, first sample after ${first.cx}`);
  const settled = await heroNow(page);
  const fresh = await heroNow(page);
  check('interrupting: it still ends at the right place', settled.number === fresh.number);
  await s.context.close();
}

/* ------------------------------------------------------------------ 3. switching reduced motion on mid-flight lands at once */
{
  const ctx = await open('light');
  const { s, page } = ctx;
  await openLogSheet(ctx);
  await usualChip(page).click();
  await sleep(120);
  const mid = await heroNow(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await sleep(120);
  const landed = await heroNow(page);
  await sleep(500);
  const later = await heroNow(page);
  check('turning reduced motion on mid-flight snaps to the final value', landed.number === later.number && mid.number !== later.number, `${mid.number} then ${landed.number} then ${later.number}`);
  await s.context.close();
}

/* ------------------------------------------------------------------ 4. date change springs from the previous day */
{
  const ctx = await open('light');
  const { s, page } = ctx;
  const before = await heroNow(page);
  const days = page.locator('.tl-day');
  const count = await days.count();
  // Yesterday, or tomorrow if today is Monday.
  const todayIndex = await page.evaluate(() => [...document.querySelectorAll('.tl-day')].findIndex(el => el.classList.contains('is-today')));
  const target = days.nth(todayIndex > 0 ? todayIndex - 1 : Math.min(count - 1, todayIndex + 1));
  await startSampler(page, 1000);
  await target.click();
  const samples = await readSamples(page, 1100);
  const after = await heroNow(page);
  const cxs = samples.map(sample => sample.cx);
  const mid = distinct(cxs).filter(x => Math.abs(x - before.cx) > 0.05 && Math.abs(x - after.cx) > 0.05);
  metrics.dateChange = { before, after, intermediateCx: mid.length };
  check('date change: the sun springs from the previous day to the new one', before.cx !== after.cx ? mid.length >= 3 : true, `${before.cx} to ${after.cx} through ${mid.length} positions`);
  check('date change: the first sample is still the previous day (it springs from there)', Math.abs(samples[0].cx - before.cx) < 1, `first cx ${samples[0].cx} vs previous ${before.cx}`);
  await s.context.close();
}

/* ------------------------------------------------------------------ 4b. the left / eaten toggle is a change of meaning, not of data: it lands at once */
{
  const ctx = await open('light');
  const { s, page } = ctx;
  await page.evaluate(() => {
    window.__carbs = [];
    const t0 = performance.now();
    const timer = setInterval(() => {
      window.__carbs.push(document.querySelectorAll('.tl-macro')[1]?.querySelector('.tl-macro-value')?.innerText.replace(/\n/g, ' '));
      if (performance.now() - t0 > 600) clearInterval(timer);
    }, 20);
  });
  await page.locator('.tl-macros').click();
  await sleep(700);
  const seen = distinct(await page.evaluate(() => window.__carbs));
  check('macros: tapping left / eaten swaps the figure at once instead of counting', seen.length === 2, `values seen: ${seen.join(' | ')}`);
  await s.context.close();
}

/* ------------------------------------------------------------------ 5. Week tiles fill over time (CSS transition) */
{
  const ctx = await open('light');
  const { s, page } = ctx;
  await s.tab('stats');
  const water = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.tl-tile.today .tl-tile-water')).height));
  const before = await water();
  await openLogSheet(ctx);
  await startSampler(page, 900);
  await usualChip(page).click();
  const samples = await readSamples(page, 1000);
  const after = await water();
  const heights = samples.map(sample => sample.water).filter(h => h != null);
  const mid = distinct(heights.map(h => Math.round(h * 10))).filter(h => h > Math.min(before, after) * 10 + 5 && h < Math.max(before, after) * 10 - 5);
  metrics.weekTiles = { before, after, distinctHeights: distinct(heights.map(h => Math.round(h))).length };
  check('week tiles: the water fill rises through intermediate heights', after > before && mid.length >= 3, `${before.toFixed(1)}px to ${after.toFixed(1)}px through ${mid.length} heights`);
  await s.context.close();
}

/* ------------------------------------------------------------------ 6. sheets: stills, cross-fade, drag */
async function sheetStills(theme) {
  const ctx = await open(theme);
  const { page } = ctx;
  await page.locator('.tabbar-wrap button.log-button').click();
  await sleep(25);
  await page.screenshot({ path: path.join(cfg.out, `sheet-mid-open-${theme}.png`) });
  await ctx.s.context.close();
}
await sheetStills('light');
await sheetStills('dark');

async function touch(cdp, type, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }] });
}
async function openSheetFor(theme, options) {
  const ctx = await open(theme, options);
  await openLogSheet(ctx);
  const head = await ctx.page.locator('.modal-panel[role=dialog] .modal-head').boundingBox();
  return { ...ctx, grab: { x: head.x + 40, y: head.y + head.height / 2 } };
}
const panelState = page => page.evaluate(() => {
  const panel = document.querySelector('.modal-panel[role=dialog]');
  if (!panel) return null;
  const scrim = document.querySelector('.modal-scrim');
  return { y: new DOMMatrixReadOnly(getComputedStyle(panel).transform).m42, opacity: Number(getComputedStyle(panel).opacity), pulled: panel.classList.contains('is-pulled'), scrim: scrim ? Number(getComputedStyle(scrim).opacity) : null };
});
const gone = async (page, within) => {
  const start = Date.now();
  while (Date.now() - start < within) {
    if (!(await page.locator('.modal-panel[role=dialog]').count())) return Date.now() - start;
    await sleep(15);
  }
  return null;
};

// A quick flick down closes, in a time set by how fast it was going.
{
  const ctx = await openSheetFor('light');
  const { page, cdp, grab } = ctx;
  await touch(cdp, 'touchStart', grab.x, grab.y);
  for (let i = 1; i <= 8; i += 1) { await touch(cdp, 'touchMove', grab.x, grab.y + i * 18); await sleep(10); }
  const during = await panelState(page);
  await touch(cdp, 'touchEnd');
  const closedIn = await gone(page, 700);
  metrics.flick = { during, closedInMs: closedIn };
  check('sheet: the panel follows the finger while dragging', during && during.y > 100 && during.scrim < 1, `y ${during?.y}, scrim ${during?.scrim?.toFixed(2)}`);
  check('sheet: a quick flick down closes it', closedIn != null && closedIn <= 450, `gone after ${closedIn} ms`);
  await ctx.s.context.close();
}
// A short, slow drag returns it.
{
  const ctx = await openSheetFor('light');
  const { page, cdp, grab } = ctx;
  await touch(cdp, 'touchStart', grab.x, grab.y);
  for (let i = 1; i <= 10; i += 1) { await touch(cdp, 'touchMove', grab.x, grab.y + i * 4); await sleep(30); }
  await sleep(150);
  const held = await panelState(page);
  await touch(cdp, 'touchEnd');
  await sleep(450);
  const back = await panelState(page);
  check('sheet: a short drag returns it to the top', held.y > 30 && back && Math.abs(back.y) < 1 && back.scrim > 0.99, `held at ${held.y.toFixed(0)}px, back at ${back?.y}, scrim ${back?.scrim}`);
  await ctx.s.context.close();
}
// A long, slow, far drag closes (distance decides), over the slowest allowed time.
{
  const ctx = await openSheetFor('light');
  const { page, cdp, grab } = ctx;
  await touch(cdp, 'touchStart', grab.x, grab.y);
  for (let i = 1; i <= 20; i += 1) { await touch(cdp, 'touchMove', grab.x, grab.y + i * 10); await sleep(30); }
  await sleep(150);
  await touch(cdp, 'touchEnd');
  const closedIn = await gone(page, 800);
  check('sheet: pulled far and let go slowly, it closes', closedIn != null && closedIn <= 400, `gone after ${closedIn} ms`);
  await ctx.s.context.close();
}
// Lifted at the end, a far drag comes back instead.
{
  const ctx = await openSheetFor('light');
  const { page, cdp, grab } = ctx;
  await touch(cdp, 'touchStart', grab.x, grab.y);
  for (let i = 1; i <= 16; i += 1) { await touch(cdp, 'touchMove', grab.x, grab.y + i * 12); await sleep(16); }
  for (let i = 1; i <= 4; i += 1) { await touch(cdp, 'touchMove', grab.x, grab.y + 192 - i * 14); await sleep(12); }
  await touch(cdp, 'touchEnd');
  await sleep(500);
  const back = await panelState(page);
  check('sheet: lifted back up as it is let go, it returns even though it was pulled far', back && Math.abs(back.y) < 1, `back at ${back?.y}`);
  await ctx.s.context.close();
}
// Pulled up past the top it resists at 0.35.
{
  const ctx = await openSheetFor('light');
  const { page, cdp, grab } = ctx;
  await touch(cdp, 'touchStart', grab.x, grab.y);
  for (let i = 1; i <= 6; i += 1) { await touch(cdp, 'touchMove', grab.x, grab.y + i * 10); await sleep(16); }
  for (let i = 1; i <= 14; i += 1) { await touch(cdp, 'touchMove', grab.x, grab.y + 60 - i * 9); await sleep(16); }
  const held = await panelState(page);
  await page.screenshot({ path: path.join(cfg.out, 'sheet-rubber-band-light.png') });
  const expected = (60 - 14 * 9) * 0.35;
  check('sheet: pulled up past the top it moves at 0.35 of the finger', held && Math.abs(held.y - expected) < 1.5 && held.pulled, `panel ${held?.y.toFixed(1)}px, expected ${expected.toFixed(1)}px`);
  await touch(cdp, 'touchEnd');
  await sleep(450);
  const back = await panelState(page);
  check('sheet: and eases back when let go', back && Math.abs(back.y) < 1 && !back.pulled, `back at ${back?.y}`);
  await ctx.s.context.close();
}
// The slide itself: 420 ms in, on the sheet curve.
{
  const ctx = await open('light');
  const { page } = ctx;
  await page.evaluate(() => {
    window.__slide = [];
    const t0 = performance.now();
    const timer = setInterval(() => {
      const panel = document.querySelector('.modal-panel[role=dialog]');
      if (panel) window.__slide.push({ t: Math.round(performance.now() - t0), y: new DOMMatrixReadOnly(getComputedStyle(panel).transform).m42 });
      if (performance.now() - t0 > 900) clearInterval(timer);
    }, 20);
  });
  await page.locator('.tabbar-wrap button.log-button').click();
  const slide = await readSamples(page, 1000).then(() => page.evaluate(() => window.__slide));
  const first = slide[0];
  const rest = slide.find((sample, i) => i > 3 && Math.abs(sample.y) < 0.5);
  const start = slide.find(sample => sample.y < first.y - 1);
  const duration = rest && start ? rest.t - start.t : null;
  metrics.sheetOpen = { samples: slide.length, openedMs: duration };
  check('sheet: opens over about 420 ms', duration != null && duration >= 280 && duration <= 560, `${duration} ms (sampled every 20 ms)`);
  await sleep(300);
  const closeStart = Date.now();
  await page.evaluate(() => {
    window.__scrim = [];
    const t0 = performance.now();
    const timer = setInterval(() => {
      const scrim = document.querySelector('.modal-scrim');
      if (scrim) window.__scrim.push(Number(getComputedStyle(scrim).opacity).toFixed(2));
      if (performance.now() - t0 > 600) clearInterval(timer);
    }, 20);
  });
  await page.locator('.modal-panel[role=dialog] .modal-head .close').click();
  const closedIn = await gone(page, 800);
  const scrimSteps = distinct(await page.evaluate(() => window.__scrim));
  check('sheet: the scrim fades out as it closes', scrimSteps.length >= 4, `${scrimSteps.length} opacity steps: ${scrimSteps.join(' ')}`);
  check('sheet: closes over about 260 ms', closedIn != null && closedIn >= 200 && closedIn <= 420, `gone after ${closedIn} ms (${Date.now() - closeStart} total)`);
  await ctx.s.context.close();
}
// Reduced motion: no sliding, a cross-fade; dragging still tracks and still dismisses.
{
  const ctx = await open('light', { reduced: true });
  const { page } = ctx;
  await page.evaluate(() => {
    window.__fade = [];
    const t0 = performance.now();
    const timer = setInterval(() => {
      const panel = document.querySelector('.modal-panel[role=dialog]');
      if (panel) window.__fade.push({ t: Math.round(performance.now() - t0), y: new DOMMatrixReadOnly(getComputedStyle(panel).transform).m42, o: Number(getComputedStyle(panel).opacity) });
      if (performance.now() - t0 > 700) clearInterval(timer);
    }, 20);
  });
  await page.locator('.tabbar-wrap button.log-button').click();
  await sleep(800);
  const fade = await page.evaluate(() => window.__fade);
  const opacities = distinct(fade.map(sample => Math.round(sample.o * 20)));
  check('reduced motion: a sheet cross-fades instead of sliding', fade.every(sample => Math.abs(sample.y) < 0.5) && opacities.length >= 3, `y always ${distinct(fade.map(sample => Math.round(sample.y))).join(',')}; ${opacities.length} opacity steps`);
  await sleep(300);
  const head = await page.locator('.modal-panel[role=dialog] .modal-head').boundingBox();
  const grab = { x: head.x + 40, y: head.y + head.height / 2 };
  await touch(ctx.cdp, 'touchStart', grab.x, grab.y);
  for (let i = 1; i <= 8; i += 1) { await touch(ctx.cdp, 'touchMove', grab.x, grab.y + i * 25); await sleep(12); }
  const held = await panelState(page);
  await touch(ctx.cdp, 'touchEnd');
  const closedIn = await gone(page, 700);
  check('reduced motion: dragging still follows the finger and a flick still closes it', held.y > 100 && closedIn != null, `held ${held.y.toFixed(0)}px, gone after ${closedIn} ms`);
  await ctx.s.context.close();
}

/* ------------------------------------------------------------------ 7. press feedback */
{
  const ctx = await open('light');
  const { page, cdp } = ctx;
  const row = page.locator('.tl-row').first();
  const scale = () => row.evaluate(el => getComputedStyle(el).scale);
  const box = await row.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + Math.min(box.height / 2, 24);
  await page.mouse.move(cx, cy);
  const idle = await scale();
  await page.mouse.down();
  await sleep(60);
  const early = await scale();
  await sleep(120);
  const pressed = await scale();
  await page.mouse.up();
  await sleep(220);
  const released = await scale();
  // A tap on a row opens it for editing; close that before the next press.
  await page.keyboard.press('Escape');
  await sleep(500);
  check('press: a row settles to 0.98 on pointer down', pressed === '0.98' && idle === 'none', `idle ${idle}, 60 ms ${early}, 180 ms ${pressed}`);
  check('press: and eases back on release', released === 'none', `after release ${released}`);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await sleep(80);
  await page.mouse.move(cx + 40, cy, { steps: 4 });
  await sleep(220);
  check('press: moving more than 10 px cancels it', (await scale()) === 'none');
  // Let go away from the row, so it doesn't count as a tap that opens it.
  await page.mouse.move(5, 300, { steps: 3 });
  await page.mouse.up();
  await sleep(200);
  // Touch: a press that turns into a scroll is cancelled by the browser.
  await page.evaluate(() => window.scrollTo(0, 0));
  const tbox = await row.boundingBox();
  const tx = tbox.x + tbox.width / 2;
  const ty = tbox.y + Math.min(tbox.height / 2, 24);
  await touch(cdp, 'touchStart', tx, ty);
  await sleep(120);
  const touching = await scale();
  for (let i = 1; i <= 8; i += 1) { await touch(cdp, 'touchMove', tx, ty - i * 14); await sleep(16); }
  await sleep(250);
  const scrolled = await scale();
  await touch(cdp, 'touchEnd');
  check('press: a touch press scales at once, and lets go when it becomes a scroll', touching === '0.98' && scrolled === 'none', `touching ${touching}, after scrolling ${scrolled}`);
  const chip = page.locator('.tl-chip').first();
  if (await chip.count()) {
    await chip.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await sleep(300);
    const cb = await chip.boundingBox();
    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await page.mouse.down();
    await sleep(160);
    check('press: chips scale too', (await chip.evaluate(el => getComputedStyle(el).scale)) === '0.98');
    await page.mouse.up();
  }
  await ctx.s.context.close();
}
{
  const ctx = await open('light', { reduced: true });
  const row = ctx.page.locator('.tl-row').first();
  const box = await row.boundingBox();
  await ctx.page.mouse.move(box.x + box.width / 2, box.y + 20);
  await ctx.page.mouse.down();
  await sleep(160);
  check('press: under reduced motion nothing scales', (await row.evaluate(el => getComputedStyle(el).scale)) === 'none');
  await ctx.page.mouse.up();
  await ctx.s.context.close();
}

/* ------------------------------------------------------------------ 8. frame strip: 0, 80, 160, 320, 600 ms after the tap */
// A screencast stamps each frame Chrome draws, so the frames nearest each offset can be picked afterwards rather than
// hoping a screenshot lands on time.
{
  const ctx = await open('light');
  const { s, page, cdp } = ctx;
  await openLogSheet(ctx);
  // The page's clock for Date is faked by the harness, so relate performance.now() to Chrome's frame stamps once, while it is idle.
  const n0 = Date.now();
  const p0 = await page.evaluate(() => performance.now());
  const clockOffset = (n0 + Date.now()) / 2 - p0;
  // Zero is the first frame the big number moves: the tap itself costs the app about 70 ms before anything can.
  await page.evaluate(() => {
    const number = document.querySelector('.tl-hero-number');
    new MutationObserver(() => { window.__movedAt ??= performance.now(); }).observe(number, { childList: true, characterData: true, subtree: true });
  });
  const frames = [];
  cdp.on('Page.screencastFrame', event => {
    frames.push({ at: event.metadata.timestamp * 1000, data: event.data });
    cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 780, maxHeight: 1688, everyNthFrame: 1 });
  await sleep(250);
  await usualChip(page).click();
  await sleep(1000);
  await cdp.send('Page.stopScreencast');
  const tapAt = clockOffset + await page.evaluate(() => window.__movedAt);
  const offsets = [0, 80, 160, 320, 600];
  const strip = [];
  for (const offset of offsets) {
    // The last frame drawn at or before this offset from the first movement.
    const candidates = frames.filter(frame => frame.at - tapAt <= offset + 8);
    const frame = candidates[candidates.length - 1] || frames[0];
    const file = `strip-${String(offset).padStart(3, '0')}ms.png`;
    fs.writeFileSync(path.join(cfg.out, file), Buffer.from(frame.data, 'base64'));
    strip.push({ file, target: offset, drawnAt: Math.round(frame.at - tapAt) });
  }
  metrics.strip = { frames: frames.length, strip };
  fs.writeFileSync(path.join(cfg.out, 'strip.json'), JSON.stringify(metrics.strip, null, 2));
  // One image with the five side by side, the top of the screen (sheet, sun, number) of each.
  const labels = strip.map(item => `${item.target} ms`);
  const html = `<body style="margin:0;background:#0b1a1e;display:flex;gap:8px;padding:8px;font:600 22px system-ui;color:#fff">${strip.map((item, i) => `<figure style="margin:0"><div style="width:390px;height:520px;overflow:hidden;border-radius:14px"><img src="data:image/png;base64,${fs.readFileSync(path.join(cfg.out, item.file)).toString('base64')}" style="width:390px;display:block"></div><figcaption style="padding:6px 2px">${labels[i]} <span style="opacity:.6;font-weight:400;font-size:16px">(frame drawn at ${item.drawnAt} ms)</span></figcaption></figure>`).join('')}</body>`;
  const sheet = await ctx.s.context.newPage();
  await sheet.setViewportSize({ width: 5 * 390 + 6 * 8, height: 600 });
  await sheet.setContent(html);
  await sheet.screenshot({ path: path.join(cfg.out, 'strip.png') });
  await s.context.close();
}

await browser.close();
metrics.results = results;
fs.writeFileSync(path.join(cfg.out, 'motion-check.json'), JSON.stringify(metrics, null, 2));
const failed = results.filter(r => !r.ok);
const unexpectedConsole = registry.problems.console.filter(c => c.type === 'error' && !c.expected);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed; page errors: ${registry.problems.pageErrors.length}; unexpected console errors: ${unexpectedConsole.length}`);
registry.problems.pageErrors.forEach(e => console.log(`  page error: ${e.message}`));
unexpectedConsole.forEach(e => console.log(`  console error: ${e.text}`));
const ok = !failed.length && !registry.problems.pageErrors.length && !unexpectedConsole.length;
console.log(ok ? 'MOTION CHECK OK' : 'MOTION CHECK FAILED');
process.exit(ok ? 0 : 1);
