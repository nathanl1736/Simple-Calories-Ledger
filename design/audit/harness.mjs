// Harness for the Dawni design audit: browser contexts, screenshots, the shot registry and the problem log.
import fs from 'node:fs';
import path from 'node:path';
import { addDays, buildState, freshState, PHOTO_SCRIPT, writeStateScript, zonedEpoch } from './seed.mjs';
import { installGeminiMock, createGeminiController } from './mock-gemini.mjs';
import { CLIPPED_SCRIPT, FOCUS_SCRIPT, A11Y_SCRIPT, FONT_SIZES_SCRIPT, OVERFLOW_SCRIPT, TARGETS_SCRIPT } from './probes.mjs';

export const VIEWPORT = { width: 390, height: 844 };
export const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

export const slug = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Every screenshot taken, the numbering that keeps light and dark runs aligned, and the problems found along the way. */
export class Registry {
  constructor(outDir, config) {
    this.outDir = outDir;
    this.config = config;
    this.shots = [];
    this.numbers = new Map();
    this.max = 0;
    /** Source of axe-core, when it is installed next to Playwright (optional). */
    this.axeSource = config.axeSource || '';
    this.problems = { console: [], pageErrors: [], failedRequests: [], targets: [], overflow: [], clipped: [], focus: [], dialogs: [], fonts: [], a11y: [], axe: [], notes: [], scenarioErrors: [] };
  }

  numberFor(key) {
    if (!this.numbers.has(key)) this.numbers.set(key, ++this.max);
    return this.numbers.get(key);
  }
}

export class Session {
  constructor({ page, context, registry, theme, scenario, clock, controller, auditing }) {
    Object.assign(this, { page, context, registry, theme, scenario, clock, controller, auditing });
    this.dialogMode = 'dismiss';
    this.dialogs = [];
  }

  /* ---------------------------------------------------------------- waiting */

  async settle(ms = 400) {
    await this.page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    await this.page.waitForTimeout(ms);
  }

  async waitFor(selector, timeout = 8000) {
    await this.page.waitForSelector(selector, { state: 'visible', timeout });
  }

  /* ---------------------------------------------------------------- screenshots */

  async shot(screen, state, desc, { full = false } = {}) {
    const key = `${screen}|${state}`;
    const nn = String(this.registry.numberFor(key)).padStart(3, '0');
    let file = `${nn}-${slug(screen)}-${slug(state)}-${this.theme}.png`;
    // Two shots with the same screen and state would overwrite each other; say so and keep both.
    if (this.registry.shots.some(item => item.file === file)) {
      this.registry.problems.notes.push(`Duplicate shot key ${key} in scenario ${this.scenario} (${this.theme}); kept as -2.`);
      file = file.replace(/\.png$/, '-2.png');
    }
    await this.settle(120);
    await this.page.screenshot({ path: path.join(this.registry.outDir, file), fullPage: full, animations: 'disabled', caret: 'hide' });
    this.registry.shots.push({ nn: Number(nn), file, screen, state, theme: this.theme, clock: this.clock, scenario: this.scenario, desc, full });
    // Cheap check on every shot: does the page scroll sideways?
    const flow = await this.page.evaluate(OVERFLOW_SCRIPT).catch(() => null);
    if (flow?.overflowX && this.auditing) this.registry.problems.overflow.push({ scenario: this.scenario, file, ...flow });
    return file;
  }

  /** Viewport shot, then the full page when the page is taller than the screen. */
  async page2(screen, state, desc) {
    await this.shot(screen, `${state}-viewport`, desc);
    const tall = await this.page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 8);
    if (tall) await this.shot(screen, `${state}-full`, `${desc} Full page (the tab bar stays at the bottom of the first screen in full-page captures).`, { full: true });
  }

  /** A sheet: viewport, then the end of the sheet when it scrolls. */
  async sheet(screen, state, desc, { wait = 500 } = {}) {
    await this.settle(wait);
    await this.shot(screen, state, desc);
    const scrolled = await this.page.evaluate(() => {
      const bodies = [...document.querySelectorAll('[role=dialog] .modal-body')];
      const body = bodies[bodies.length - 1];
      if (!body || body.scrollHeight <= body.clientHeight + 6) return false;
      body.scrollTo({ top: body.scrollHeight, behavior: 'instant' });
      return true;
    });
    if (scrolled) {
      await this.settle(250);
      await this.shot(screen, `${state}-scrolled`, `${desc} Scrolled to the end of the sheet.`);
      await this.page.evaluate(() => { const bodies = [...document.querySelectorAll('[role=dialog] .modal-body')]; bodies[bodies.length - 1]?.scrollTo({ top: 0, behavior: 'instant' }); });
    }
  }

  /* ---------------------------------------------------------------- driving the app */

  /** The sheet on top. Modal sheets sit above Today's search overlay even though the overlay is later in the DOM. */
  dialog() {
    const sheets = this.page.locator('.modal-panel[role=dialog]');
    return sheets.last();
  }
  async hasDialog() { return (await this.page.locator('[role=dialog]').count()) > 0; }

  async tab(id) {
    await this.page.locator(`.tabbar .tab-${id}`).click();
    await this.settle(600);
  }

  async sparkle() {
    await this.page.locator('button[aria-label="Log with AI"]').click();
    await this.waitFor('[role=dialog]');
    await this.settle(500);
  }

  /** Closes the topmost sheet or search with its own control, like a person would. */
  async closeTop() {
    const page = this.page;
    if (!(await this.hasDialog())) return;
    if (await page.locator('.modal-panel[role=dialog]').count()) {
      await this.dialog().locator('.modal-head .close').click({ timeout: 4000 });
    } else {
      await page.locator('.food-search-cancel').click({ timeout: 4000 });
    }
    await page.waitForTimeout(550);
  }

  async closeAll() {
    for (let i = 0; i < 5 && (await this.hasDialog()); i += 1) {
      await this.closeTop().catch(async () => { await this.page.keyboard.press('Escape'); await this.page.waitForTimeout(500); });
    }
  }

  async fillFields(map) {
    for (const [label, value] of Object.entries(map)) await this.page.getByLabel(label, { exact: false }).first().fill(String(value));
  }

  /** Drags the swipe-to-confirm control; `to` is the share of its width (0 to 1). Pass release: false to hold. */
  async swipe(to, { release = false } = {}) {
    const box = await this.page.locator('.swipe-confirm').boundingBox();
    const y = box.y + box.height / 2;
    const x0 = box.x + 28;
    await this.page.mouse.move(x0, y);
    await this.page.mouse.down();
    const x1 = box.x + 28 + (box.width - 62) * to;
    const steps = 12;
    for (let i = 1; i <= steps; i += 1) await this.page.mouse.move(x0 + (x1 - x0) * i / steps, y);
    await this.page.waitForTimeout(150);
    if (release) await this.page.mouse.up();
  }

  async releaseSwipe() { await this.page.mouse.up(); }

  /** Lets go of a held swipe without confirming: back to the start, then release. */
  async cancelSwipe() {
    const box = await this.page.locator('.swipe-confirm').boundingBox();
    await this.page.mouse.move(box.x + 28, box.y + box.height / 2, { steps: 4 });
    await this.page.mouse.up();
    await this.page.waitForTimeout(250);
  }

  /** Touch and hold: pointer down, 600 ms, up. */
  async longPress(locator) {
    const box = await locator.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + Math.min(box.height / 2, 30);
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    await this.page.waitForTimeout(650);
    await this.page.mouse.up();
    await this.page.waitForTimeout(350);
  }

  async scrollTo(selector, block = 'start') {
    await this.page.locator(selector).first().evaluate((el, b) => el.scrollIntoView({ block: b, behavior: 'instant' }), block);
    await this.settle(300);
  }

  async scrollTop() {
    await this.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await this.settle(250);
  }

  async toastText() { return this.page.locator('.toast').last().innerText().catch(() => ''); }

  /** A PNG drawn in the page, for file inputs. */
  async makeImage(kind) {
    const base64 = await this.page.evaluate(k => {
      const c = document.createElement('canvas');
      c.width = 640; c.height = 480;
      const g = c.getContext('2d');
      const text = (t, x, y, size = 28, weight = 'normal') => { g.font = `${weight} ${size}px sans-serif`; g.fillText(t, x, y); };
      if (k === 'meal') {
        g.fillStyle = '#B9936A'; g.fillRect(0, 0, 640, 480);
        g.fillStyle = 'rgba(0,0,0,.2)'; g.beginPath(); g.arc(325, 245, 190, 0, 7); g.fill();
        g.fillStyle = '#F6F3EC'; g.beginPath(); g.arc(320, 240, 190, 0, 7); g.fill();
        g.fillStyle = '#E7DFCF'; g.beginPath(); g.arc(320, 240, 150, 0, 7); g.fill();
        [['#C0392B', 270, 210, 46], ['#E5B94A', 360, 230, 52], ['#4F9A4B', 310, 300, 44], ['#F2EAD8', 240, 290, 38]].forEach(([col, x, y, r]) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); });
      } else if (k === 'label') {
        g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, 640, 480);
        g.fillStyle = '#111'; g.fillRect(30, 30, 580, 420); g.fillStyle = '#FFF'; g.fillRect(36, 36, 568, 408);
        g.fillStyle = '#000';
        text('NUTRITION INFORMATION', 56, 84, 30, 'bold');
        text('Servings per package: 1   Serving size: 170 g', 56, 124, 22);
        g.fillRect(56, 138, 528, 5);
        text('                         Per serve    Per 100 g', 56, 174, 22, 'bold');
        [['Energy', '445 kJ (106 Cal)', '262 kJ (62 Cal)'], ['Protein', '16.0 g', '9.4 g'], ['Fat, total', '0.7 g', '0.4 g'], ['Carbohydrate', '8.8 g', '5.2 g'], ['  sugars', '6.5 g', '3.8 g'], ['Sodium', '60 mg', '35 mg']].forEach(([a, b, d], i) => {
          text(a, 56, 216 + i * 40, 24); text(b, 250, 216 + i * 40, 22); text(d, 430, 216 + i * 40, 22);
        });
      } else {
        g.fillStyle = '#F5EFE0'; g.fillRect(0, 0, 640, 480);
        g.fillStyle = '#2B2B2B';
        text('LUNCH', 40, 70, 40, 'bold');
        [['Grilled chicken Caesar salad', '$21', '2170 kJ'], ['Salmon poke bowl', '$22', '2010 kJ'], ['Beef burrito bowl', '$19', ''], ['Margherita pizza', '$20', ''], ['Chicken schnitzel and chips', '$26', ''], ['Pumpkin soup and bread', '$14', '']].forEach(([a, b, d], i) => {
          text(a, 40, 130 + i * 56, 26); text(b, 520, 130 + i * 56, 26); if (d) text(d, 40, 154 + i * 56, 16);
        });
      }
      return c.toDataURL('image/png').split(',')[1];
    }, kind);
    return { name: `${kind}.png`, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
  }

  /** Clicks something that opens the system file picker and hands it a file. */
  async chooseFile(click, file) {
    const [chooser] = await Promise.all([this.page.waitForEvent('filechooser'), click()]);
    await chooser.setFiles(file);
  }

  /* ---------------------------------------------------------------- measuring */

  /** axe-core on the current screen, both themes: contrast, names, target size, viewport zoom. */
  async axe(label) {
    if (!this.registry.axeSource) return;
    try {
      if (!(await this.page.evaluate(() => !!window.axe))) await this.page.addScriptTag({ content: this.registry.axeSource });
      const result = await this.page.evaluate(async () => {
        const rules = ['color-contrast', 'label', 'button-name', 'link-name', 'aria-hidden-focus', 'scrollable-region-focusable', 'target-size', 'nested-interactive', 'aria-dialog-name', 'aria-allowed-role', 'aria-required-children', 'aria-valid-attr-value', 'meta-viewport', 'select-name', 'input-button-name', 'image-alt'];
        const run = await window.axe.run(document, { runOnly: { type: 'rule', values: rules }, resultTypes: ['violations', 'incomplete'] });
        const shape = node => {
          const data = node.any?.[0]?.data || {};
          return { target: (node.target || []).join(' ').slice(0, 90), html: (node.html || '').slice(0, 110), fg: data.fgColor, bg: data.bgColor, ratio: data.contrastRatio, expected: data.expectedContrastRatio, size: data.fontSize, summary: (node.failureSummary || '').split('\n')[1]?.trim().slice(0, 120) };
        };
        return {
          violations: run.violations.map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length, nodes: v.nodes.slice(0, 6).map(shape) })),
          incomplete: run.incomplete.map(v => ({ id: v.id, count: v.nodes.length }))
        };
      });
      this.registry.problems.axe.push({ scenario: this.scenario, theme: this.theme, label, ...result });
    } catch (err) {
      this.registry.problems.notes.push(`axe failed on ${label}: ${String(err.message).split('\n')[0]}`);
    }
  }

  async audit(label) {
    await this.axe(label);
    if (!this.auditing) return;
    const page = this.page;
    const at = { scenario: this.scenario, label };
    const targets = await page.evaluate(TARGETS_SCRIPT).catch(() => []);
    this.registry.problems.targets.push({ ...at, total: targets.length, small: targets.filter(t => t.small) });
    const overflow = await page.evaluate(OVERFLOW_SCRIPT).catch(() => null);
    if (overflow && (overflow.overflowX || overflow.offenders.length)) this.registry.problems.overflow.push({ ...at, ...overflow });
    const clipped = await page.evaluate(CLIPPED_SCRIPT).catch(() => []);
    if (clipped.length) this.registry.problems.clipped.push({ ...at, items: clipped });
    const fonts = await page.evaluate(FONT_SIZES_SCRIPT).catch(() => []);
    this.registry.problems.fonts.push({ ...at, smallest: fonts });
  }

  /** Tab through a sheet: does focus start inside it, and does it ever leave? */
  async focusTrap(label, presses = 30) {
    if (!this.auditing) return;
    const page = this.page;
    const start = await page.evaluate(FOCUS_SCRIPT);
    const a11y = await page.evaluate(A11Y_SCRIPT);
    const trail = [];
    let escapes = 0;
    for (let i = 0; i < presses; i += 1) {
      await page.keyboard.press('Tab');
      const f = await page.evaluate(FOCUS_SCRIPT);
      if (!f.insideDialog) { escapes += 1; if (trail.length < 6) trail.push(`${f.tag}:${f.label}`); }
    }
    await page.keyboard.press('Shift+Tab');
    this.registry.problems.focus.push({ scenario: this.scenario, label, dialog: start.dialogLabel, focusStartsInside: start.insideDialog, startsOn: `${start.tag}:${start.label}`, tabPressesOutside: escapes, of: presses, outsideSample: trail, a11y });
  }
}

/* ------------------------------------------------------------------ scenario runner */

export async function openSession(browser, registry, cfg, spec) {
  const { name, theme, hour = 13, minute = 0, state, mode = 'ok', delayMs = 0, serviceWorkers = 'allow', auditing = false, dateOffset = 0 } = spec;
  const clockDate = addDays(cfg.today, dateOffset);
  const context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA,
    locale: 'en-AU', timezoneId: cfg.tz, colorScheme: theme === 'dark' ? 'dark' : 'light',
    permissions: ['clipboard-read', 'clipboard-write'], serviceWorkers
  });
  await context.clock.setFixedTime(zonedEpoch(clockDate, hour, minute, cfg.tz));
  await context.addInitScript(t => { try { localStorage.setItem('dawni-theme', t); } catch { /* private mode */ } }, theme);
  const controller = createGeminiController();
  controller.mode = mode;
  controller.delayMs = delayMs;
  await installGeminiMock(context, controller);
  const page = await context.newPage();
  const clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const session = new Session({ page, context, registry, theme, scenario: name, clock, controller, auditing });

  const here = { scenario: name, theme, clock };
  const mocked = url => /generativelanguage\.googleapis\.com/.test(url || '');
  page.on('console', msg => {
    if (!['error', 'warning'].includes(msg.type())) return;
    // Expected: the mock's own 4xx/5xx replies, and the app's console.warn for each model the mock refused.
    const text = msg.text();
    registry.problems.console.push({ ...here, type: msg.type(), text: text.slice(0, 300), url: msg.location()?.url || '', expected: mocked(msg.location()?.url) || /^Gemini model ".+" could not be used\./.test(text) });
  });
  page.on('pageerror', err => registry.problems.pageErrors.push({ ...here, message: String(err.message || err).slice(0, 300) }));
  page.on('requestfailed', req => { if (!mocked(req.url())) registry.problems.failedRequests.push({ ...here, url: req.url().slice(0, 140), failure: req.failure()?.errorText }); });
  page.on('response', res => { if (res.status() >= 400 && !mocked(res.url())) registry.problems.failedRequests.push({ ...here, url: res.url().slice(0, 140), status: res.status() }); });
  page.on('dialog', async dialog => {
    session.dialogs.push({ type: dialog.type(), message: dialog.message() });
    registry.problems.dialogs.push({ ...here, type: dialog.type(), message: dialog.message().slice(0, 160) });
    if (session.dialogMode === 'accept') await dialog.accept(); else await dialog.dismiss();
  });

  await page.goto(cfg.url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tabbar', { timeout: 15000 });
  const photos = await page.evaluate(PHOTO_SCRIPT);
  const seeded = typeof state === 'function' ? state({ photos, theme }) : state;
  await page.evaluate(writeStateScript(seeded));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tabbar', { timeout: 15000 });
  await page.waitForSelector('.tl-hero, .page-title', { timeout: 15000 });
  await session.settle(900);
  session.seeded = seeded;
  return session;
}

export { buildState, freshState, sleep };
