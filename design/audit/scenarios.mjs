// The flows of the Dawni design audit. Each scenario gets its own browser context with its own seeded state and clock.
// A flow drives the real controls (text, role and aria-label selectors) and photographs what it finds.
import { addDays, buildState, freshState, weekStartMonday } from './seed.mjs';

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** Seeds as the scenario needs them. `cfg.today` is the audit date in the audit timezone. */
export const seedFor = (cfg, o = {}) => ({ photos, theme }) => buildState({ today: cfg.today, tz: cfg.tz, theme, photos, ...o });

/** Safe helper: runs a step, and records (rather than throws) when a control could not be found, so one change in the UI does not end the audit. */
async function step(s, name, fn) {
  try {
    await fn();
  } catch (err) {
    s.registry.problems.scenarioErrors.push({ scenario: s.scenario, theme: s.theme, step: name, error: String(err.message || err).split('\n')[0].slice(0, 240) });
    await s.closeAll().catch(() => {});
  }
}

const VALID_JSON = JSON.stringify({ name: 'Beef mince rice bowl', unitMode: 'serving', amount: '1', meal: 'Dinner', calories: 520, protein: 45, carbs: 48, fat: 16, notes: 'Lean mince, 1 cup cooked rice, lettuce and teriyaki sauce.' });

/* ================================================================== FIRST RUN */

export async function fresh(s, cfg) {
  const { page } = s;
  await s.page2('today', 'first-run', 'First run: Today with nothing logged.');
  await s.audit('today first run');

  await step(s, 'search empty', async () => {
    await page.locator('.tl-search').click();
    await s.waitFor('.food-search-input, .food-search input');
    await s.settle(700);
    await s.shot('search', 'first-run-browsing', 'Search foods with nothing saved yet: empty state copy.');
    await page.locator('.food-search input').fill('greek yog');
    await s.settle(900);
    await s.shot('search', 'first-run-typed', 'Search "greek yog": food database results and "Log it yourself" row. No saved foods yet.');
    await page.locator('.food-search input').fill('zzqx');
    await s.settle(900);
    await s.shot('search', 'first-run-no-match', 'Search with no match: "No matches" and the Log yourself row.');
    await s.closeTop();
  });

  await step(s, 'log manually', async () => {
    await page.locator('.tl-manual-row').click();
    await s.waitFor('[role=dialog]');
    await s.sheet('log-manually', 'empty', 'Log manually, a new entry: calories first, meal chips, saved food picker, rough meal link, swipe to log.');
    await s.audit('log manually empty');
    await s.focusTrap('log manually (empty)');
    await page.locator('#entryName').fill('Flat white');
    await page.locator('#entryCalories').fill('120');
    await s.fillFields({ 'Fat (g)': 6, 'Carbs (g)': 9, 'Protein (g)': 6 });
    await page.locator('#entryPortion').fill('2');
    await s.settle(300);
    await s.sheet('log-manually', 'filled', 'Log manually filled in: name, 120 Cal, macros, 2 servings. Shows the logged total and what the day has left.');
    await s.closeTop();
  });

  await step(s, 'ai chooser no key', async () => {
    await s.sparkle();
    await s.sheet('log-with-ai', 'chooser-no-key', 'The sparkle opens Log with AI: Estimate with Gemini, Meal prep a batch, Help me pick from a menu, plus Copy prompt and Paste estimate for other chatbots. No key yet, so the Gemini rows will lead to setup.');
    await s.audit('log with AI chooser');
    await s.focusTrap('log with AI chooser');
    await page.getByRole('button', { name: /Estimate with Gemini/ }).click();
    await s.settle(600);
    await s.sheet('gemini-setup', 'no-key', 'Set up Gemini: what tapping Estimate with Gemini does with no key. Steps, the no-key chatbot alternative, Open Gemini settings.');
    await page.getByRole('button', { name: 'Open Gemini settings' }).click();
    await s.settle(1400);
    await s.shot('settings', 'gemini-key-edit-viewport', 'Open Gemini settings lands on Settings with the Gemini key field open for pasting.');
  });

  await step(s, 'gemini key help', async () => {
    await page.locator('.gemini-settings-card .help-btn').click();
    await s.sheet('gemini-api-key-help', 'sheet', 'The ? on the Gemini card: how to get a key, free tier versus paid, privacy.');
    await s.closeTop();
  });

  await step(s, 'settings no key', async () => {
    await s.scrollTop();
    await s.page2('settings', 'no-key', 'Settings with no key (the Gemini field is still open for pasting after Open Gemini settings): Goals, Weekly banking, Display, Backup, Gemini, About you for AI, AI estimate helper, Food estimates, Custom food databases, App.');
    await s.audit('settings no key');
    await page.locator('.ai-prompt-card .help-btn').click();
    await s.sheet('ai-estimate-helper-how-to', 'sheet', 'The ? on AI estimate helper: six steps for using any chatbot.');
    await s.closeTop();
    await page.locator('.custom-db-card .help-btn').click();
    await s.sheet('custom-food-database-help', 'sheet', 'The ? on Custom food databases: JSON format example.');
    await s.closeTop();
    await page.locator('.settings-head .tl-pill').click();
    await s.settle(600);
  });

  await step(s, 'batch no key', async () => {
    await s.sparkle();
    await page.getByRole('button', { name: /Meal prep a batch/ }).click();
    await s.settle(700);
    await s.sheet('meal-prep-sheet', 'describe-no-key', 'Meal prep a batch with no Gemini key: the Estimate button becomes "Set up Gemini to estimate".');
    await s.closeTop();
    await s.sparkle();
    await page.getByRole('button', { name: /Help me pick from a menu/ }).click();
    await s.settle(600);
    await s.sheet('gemini-setup', 'from-menu-pick', 'Help me pick from a menu with no key leads to the same Set up Gemini sheet.');
    await s.closeTop();
  });

  await step(s, 'chatbot paste', async () => {
    await s.sparkle();
    await page.evaluate(() => navigator.clipboard.writeText('')).catch(() => {});
    await page.getByRole('button', { name: /Copy prompt/ }).click();
    await s.settle(250);
    await s.shot('toast', 'prompt-copied', 'Toast "Prompt copied" after Copy prompt (over the Log with AI sheet).');
    await s.settle(1800);
    await page.evaluate(() => navigator.clipboard.writeText('')).catch(() => {});
    await page.getByRole('button', { name: /Paste estimate/ }).click();
    await s.settle(250);
    await s.shot('toast', 'clipboard-empty', 'Paste estimate with an empty clipboard: a toast, and the sheet stays open.');
    await s.closeTop();

    await page.evaluate(() => navigator.clipboard.writeText('Not json at all, just some thoughts about lunch and a coffee')).catch(() => {});
    await s.sparkle();
    await page.getByRole('button', { name: /Paste estimate/ }).click();
    await s.settle(1300);
    await s.sheet('ai-estimate-helper', 'unreadable-paste', 'Paste estimate with text the app cannot parse: the AI estimate helper sheet opens with the pasted text and an error line.');
    await s.closeTop();

    await page.evaluate(v => navigator.clipboard.writeText(v), VALID_JSON).catch(() => {});
    await s.sparkle();
    await page.getByRole('button', { name: /Paste estimate/ }).click();
    await s.settle(900);
    await s.sheet('log-food-review', 'pasted-chatbot-estimate', 'A valid chatbot estimate pasted: the log sheet opens already filled in, tagged Estimated, ready to review.');
    await s.audit('review sheet (pasted estimate)');
    await s.closeTop();
  });

  await step(s, 'other tabs empty', async () => {
    await s.tab('stats');
    await s.page2('week', 'first-run', 'Week with nothing logged.');
    await s.tab('journal');
    await s.page2('journal', 'month-first-run', 'Journal month calendar with no photos.');
    await page.locator('.daybox.today').click();
    await s.settle(700);
    await s.page2('journal', 'day-empty', 'Journal day with nothing logged.');
    await s.tab('library');
    await s.page2('foods', 'recent-empty', 'Foods, Recent: empty.');
    await page.getByRole('tab', { name: 'Favourites' }).click();
    await s.settle(400);
    await s.shot('foods', 'favourites-empty', 'Foods, Favourites: empty state.');
    await page.getByRole('tab', { name: 'Meal prep' }).click();
    await s.settle(400);
    await s.shot('foods', 'meal-prep-empty', 'Foods, Meal prep: empty state with New batch.');
    await s.audit('foods meal prep empty');
  });
}

/* ================================================================== TODAY AT DIFFERENT TIMES */

/** Today at a clock time: viewport and full page, the Now line, a scrolled view with the floating tab bar. */
export async function todayAt(s, cfg, { tag, note, macros = false, done = false, doneLight = false, audit = false }) {
  const { page } = s;
  await s.page2('today', tag, `Today at ${s.clock}. ${note}`);
  if (audit) await s.audit(`today ${tag}`);
  await step(s, 'scrolled', async () => {
    await s.scrollTo('.tl-dayline');
    await s.shot('today', `${tag}-scrolled-to-day-line`, `Today at ${s.clock} scrolled to the day line: the floating tab bar sits over the content.`);
    await s.scrollTop();
  });
  if (macros) {
    await step(s, 'macros', async () => {
      await page.locator('.tl-macros').click();
      await s.settle(350);
      await s.shot('today', `${tag}-macros-eaten`, `Tapping the macros toggles left/to go versus eaten (${s.clock}).`);
      await page.locator('.tl-macros').click();
      await s.settle(250);
    });
  }
  if (done) {
    await step(s, 'done for today', async () => {
      await page.getByRole('button', { name: 'Done for today' }).click();
      await s.settle(250);
      await s.shot('toast', `${tag}-counted`, 'Toast "Counted toward your week" after Done for today.');
      await s.settle(1800);
      await s.scrollTo('.tl-end', 'center');
      await s.shot('today', `${tag}-done-card`, 'Day status card after Done for today: "Done for today", result and an Undo link.');
      await s.scrollTop();
    });
  }
  if (doneLight) {
    await step(s, 'done light', async () => {
      await s.scrollTo('.tl-end', 'center');
      await s.shot('today', `${tag}-status-card`, 'Day status card in the evening with the day still light: Done for today, Add a rough meal, Rough guess for the day.');
      await page.getByRole('button', { name: 'Done for today' }).click();
      await s.settle(400);
      await s.shot('today', `${tag}-only-logged-prompt`, 'Done for today on a light day asks "Only X of Y logged. Is that everything?".');
      await page.getByRole('button', { name: 'Not yet' }).click().catch(() => {});
      await page.getByRole('button', { name: 'Rough guess for the day' }).click();
      await s.settle(400);
      await s.shot('today', `${tag}-rough-day-picker`, 'Rough guess for the day: three options (about on target, a bit over, big day).');
      await page.getByRole('button', { name: 'Cancel' }).click().catch(() => {});
      await s.scrollTop();
    });
  }
}

/* ================================================================== READ-ONLY TOUR OF THE SEEDED APP (13:00) */

export async function tour(s, cfg) {
  const { page } = s;
  const today = cfg.today;

  /* ---- Today ---- */
  await todayAt(s, cfg, { tag: '1300', note: 'Breakfast and lunch logged, dinner usuals on the Now line.', macros: true, audit: true });

  /* ---- week strip: other days ---- */
  const strip = page.locator('.tl-strip .tl-day');
  const startMon = weekStartMonday(today);
  const stripIndex = date => daysBetween(startMon, date);
  const pickDay = async (offset, tag, desc, full = false) => {
    const date = addDays(today, -offset);
    const idx = stripIndex(date);
    if (idx < 0 || idx > 6) return;
    await strip.nth(idx).click();
    await s.settle(500);
    await (full ? s.page2('today', tag, desc) : s.shot('today', `${tag}-viewport`, desc));
  };
  await step(s, 'past: completed', async () => { await pickDay(1, 'past-completed', 'Yesterday: a completed day, counted into the week. Hero says how it ended (Cal under).', true); });
  await step(s, 'past: over target', async () => { await pickDay(3, 'past-over-target', 'A past day over target: the hero says Cal over, the sun sits at the end of the arc with a glow, a pub dinner and a beer.', true); });
  await step(s, 'past: light', async () => {
    await pickDay(2, 'past-looks-light', 'A past day that looks light (only a coffee and a meal prep serve logged): held at target until checked.', true);
    await s.audit('today past light day');
    await page.getByRole('button', { name: 'Rough guess for the day' }).click().catch(() => {});
    await s.settle(350);
    await s.shot('today', 'past-looks-light-rough-picker', 'Rough guess picker on a light day.');
    await page.getByRole('button', { name: 'Cancel' }).first().click().catch(() => {});
    await page.getByRole('button', { name: 'Add a rough meal' }).first().click();
    await s.sheet('rough-meal', 'sheet', 'Add a rough meal: meal chips, four sizes with example foods and Cal, or type a number.');
    await s.audit('rough meal sheet');
    await s.closeTop();
  });
  await step(s, 'upcoming', async () => {
    if (stripIndex(addDays(today, 1)) <= 6) { await strip.nth(stripIndex(addDays(today, 1))).click(); await s.settle(500); await s.page2('today', 'upcoming-day', 'A day that has not started: "This day hasn\'t started yet" and Coming up.'); }
  });
  await step(s, 'swipe to previous week', async () => {
    await page.locator('.tl-day.is-today').click();
    await s.settle(300);
    const box = await page.locator('.tl-strip').boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 60, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) await page.mouse.move(box.x + 60 + i * 24, y);
    await page.waitForTimeout(100);
    await s.shot('today', 'week-strip-mid-swipe', 'Dragging the week strip sideways: it follows the finger and fades.');
    await page.mouse.up();
    await s.settle(700);
    await s.shot('today', 'previous-week-estimated-day', 'After swiping the strip back one week the same weekday is selected: a day with a rough guess ("Rough guess: a bit over").');
    const prevMon = addDays(startMon, -7);
    const prevIndex = offset => daysBetween(prevMon, addDays(today, -offset));
    if (prevIndex(6) >= 0 && prevIndex(6) <= 6) {
      await strip.nth(prevIndex(6)).click();
      await s.settle(450);
      await s.page2('today', 'untracked-day', 'A day with nothing logged: counts as on target; offers rough guesses and Add a rough meal.');
    }
    if (prevIndex(8) >= 0 && prevIndex(8) <= 6) {
      await strip.nth(prevIndex(8)).click();
      await s.settle(450);
      await s.shot('today', 'rough-meal-day', 'A day with a rough dinner entry ("Dinner (big)", rough guess, about 1,200 Cal): rough rows show a tilde and "Rough guess".');
    }
    await page.locator('.tl-pill', { hasText: 'Today' }).click();
    await s.settle(500);
  });

  /* ---- Week ---- */
  await step(s, 'week', async () => {
    await s.tab('stats');
    await s.page2('week', 'current', 'Week: seven skies filled to each day\'s target, running balance line, plain answer for the days left, week bank headline.');
    await s.audit('week current');
    await s.scrollTop();
    await page.locator('.tl-bank').click();
    await s.sheet('week-details', 'sheet', 'Week details sheet: the bank as a table, budget, counted days, averages, and "How the week bank works".');
    await s.audit('week details sheet');
    await s.focusTrap('week details sheet');
    await s.closeTop();
    await page.getByRole('button', { name: 'Previous week' }).click();
    await s.settle(700);
    await s.page2('week', 'previous-week', 'Previous week: includes a day with nothing logged, a rough guess and a rough meal day.');
    await page.getByRole('button', { name: 'Next week' }).click();
    await s.settle(500);
    await s.shot('week', 'next-week-disabled', 'Week back on the current week: the Next week arrow is disabled.');
    await page.locator('.tl-tile').nth(Math.max(0, stripIndex(addDays(today, -2)))).click();
    await s.settle(700);
    await s.shot('today', 'opened-from-week-tile', 'Tapping a day tile on Week opens that day on Today (a looks-light day).');
  });

  /* ---- Journal ---- */
  await step(s, 'journal', async () => {
    await s.tab('journal');
    await s.page2('journal', 'month', 'Journal month: photo days show up to four thumbnails; other days are plain numbers.');
    await s.audit('journal month');
    await page.getByRole('button', { name: 'Previous month' }).click();
    await s.settle(500);
    await s.shot('journal', 'previous-month', 'Journal, previous month: days with no photos look empty.');
    await page.getByRole('button', { name: 'Return to this month' }).click();
    await s.settle(400);
    const first = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    const monthStart = first.toISOString().slice(0, 10);
    const cell0 = weekStartMonday(monthStart);
    const cellFor = date => daysBetween(cell0, date);
    await page.locator('.daybox').nth(cellFor(addDays(today, -1))).click();
    await s.settle(700);
    await s.page2('journal', 'day-collage-calories', 'Journal day, Collage view, label mode Calories: two photos, meal cards, totals bar.');
    await s.audit('journal day collage');
    const labelBtn = page.locator('.journal-label-toggle.active');
    await labelBtn.click(); await s.settle(300);
    await s.shot('journal', 'day-collage-name-and-cal', 'Journal day, Collage, label mode Name + Cal.');
    await labelBtn.click(); await s.settle(300);
    await s.shot('journal', 'day-collage-photo-only', 'Journal day, Collage, label mode Photo (no captions).');
    await page.getByRole('button', { name: 'Shuffle' }).click(); await s.settle(300);
    await s.shot('journal', 'day-collage-shuffled', 'Journal day, Collage after Shuffle.');
    await page.locator('.journal-toggle button', { hasText: 'List' }).click(); await s.settle(400);
    await s.page2('journal', 'day-list-photo-only', 'Journal day, List view, label mode Photo.');
    await labelBtn.click(); await s.settle(300);
    await s.shot('journal', 'day-list-calories', 'Journal day, List view, label mode Calories.');
    await labelBtn.click(); await s.settle(300);
    await s.shot('journal', 'day-list-name-and-cal', 'Journal day, List view, label mode Name + Cal.');
    await page.locator('.journal-photo-card, .journal-entry-card:has(img)').first().click().catch(() => {});
    await s.settle(600);
    await s.sheet('photo-lightbox', 'journal', 'Photo tapped in Journal: the lightbox sheet (just the picture).');
    await s.closeTop();
    await s.scrollTo('.journal-cards');
    await s.shot('journal', 'day-meal-cards-list', 'Journal day, Meal cards list and "Open this day" button.');
    await page.locator('.journal-card-row').first().click();
    await s.settle(700);
    await s.sheet('meal-card', 'photo-format', 'Meal card sheet: share card in photo format (tap the card to switch formats).');
    await s.audit('meal card sheet');
    await page.locator('.share-card').click();
    await s.settle(400);
    await s.shot('meal-card', 'summary-format', 'Meal card sheet after tapping the card: summary format.');
    await s.closeTop();
    await page.getByRole('button', { name: 'Previous day' }).click();
    await s.settle(500);
    await s.scrollTop();
    await page.locator('.journal-toggle button', { hasText: 'Collage' }).click();
    await s.settle(300);
    await s.shot('journal', 'day-two-days-ago', 'Journal day, the day before (no photos): collage view says "No photos yet".');
    await page.locator('.journal-toggle button', { hasText: 'List' }).click();
    await s.settle(300);
    await s.shot('journal', 'day-list-no-photos', 'Journal day in List view with no photos.');
    await page.locator('.journal-month-btn').click();
    await s.settle(400);
  });

  /* ---- Foods ---- */
  await step(s, 'foods', async () => {
    await s.tab('library');
    await page.getByRole('tab', { name: 'Recent' }).click(); await s.settle(300);
    await s.page2('foods', 'recent', 'Foods, Recent: saved foods by last use with heart, calories, + to log and a manage button.');
    await s.audit('foods recent');
    await page.getByRole('tab', { name: 'Favourites' }).click(); await s.settle(300);
    await s.shot('foods', 'favourites', 'Foods, Favourites.');
    await page.locator('input.search').click();
    await s.settle(400);
    await s.shot('foods', 'search-focused-tab-bar-hidden', 'Focusing the search field on Foods hides the floating tab bar.');
    await page.locator('input.search').fill('flat');
    await s.settle(300);
    await s.shot('foods', 'search-typed', 'Foods search "flat".');
    await page.locator('input.search').fill('xyz');
    await s.settle(300);
    await s.shot('foods', 'search-no-match', 'Foods search with no match.');
    await page.locator('input.search').fill('');
    await page.locator('h1').click();
    await page.getByRole('tab', { name: 'Recent' }).click(); await s.settle(300);
    await page.getByRole('button', { name: 'Manage Flat white' }).click();
    await s.sheet('manage-food', 'sheet', 'Manage food (edit a saved food): name with heart, calories and macros, per serving or per 100g, Save food and Delete.');
    await s.audit('manage food sheet');
    await s.focusTrap('manage food sheet');
    await s.closeTop();
    await page.getByRole('tab', { name: 'Meal prep' }).click(); await s.settle(400);
    await s.page2('foods', 'meal-prep', 'Foods, Meal prep: New batch, the batch on the go (serve pips, serves left, per-serve macros) and Cook again.');
    await s.audit('foods meal prep');
    await page.locator('.prep-again summary').click(); await s.settle(300);
    await s.shot('foods', 'meal-prep-cook-again-open', 'Meal prep with the Cook again list open.');
    await page.getByRole('button', { name: 'Edit Beef mince rice bowl' }).click();
    await s.sheet('meal-prep-sheet', 'edit-batch', 'Edit batch: name, status line, per-serve numbers, serves stepper, what went in, Save changes, Finish batch.');
    await s.audit('edit batch sheet');
    await s.closeTop();
    await page.locator('.prep-again-btn').first().click();
    await s.sheet('meal-prep-sheet', 'cook-again', 'Cook again: a finished batch opened as a new one, with its saved estimate.');
    await s.closeTop();
  });

  /* ---- Today search with real data ---- */
  await step(s, 'today search', async () => {
    await s.tab('tracking');
    await page.locator('.tl-search').click();
    await s.waitFor('.food-search');
    await s.settle(800);
    await s.shot('search', 'browsing-seeded', 'Search foods, browsing: meal prep batch first, favourites, then recent foods.');
    await s.audit('search browsing');
    await s.focusTrap('search overlay');
    await page.locator('.food-search input').fill('chicken');
    await s.settle(1000);
    await s.shot('search', 'typed-chicken', 'Search "chicken": saved foods then food database results with source chips, "Show more", Log it yourself.');
    await page.locator('.food-search input').fill('banana bread');
    await s.settle(1000);
    await s.shot('search', 'typed-custom-database', 'Search "banana bread": a result from the imported custom database (Custom chip).');
    await page.locator('.food-search-row').filter({ hasText: /banana bread/i }).first().click();
    await s.settle(700);
    await s.sheet('food-estimate-preview', 'database-food', 'Tapping a database result shows Food estimate: chips, per-serve numbers, Use this food, Add to My Foods.');
    await s.closeTop();
    await page.locator('.food-search input').fill('flat white');
    await s.settle(900);
    await page.locator('.food-search-row').first().click();
    await s.settle(900);
    await s.sheet('log-food-review', 'prefilled-from-search', 'Choosing a saved food opens the log sheet prefilled (name with heart, numbers, meal).');
    await s.closeTop();
  });
}

/* ================================================================== ENTRY AND LOGGING INTERACTIONS (13:00, mutates its own state) */

export async function interact(s, cfg) {
  const { page } = s;
  const rowByName = name => page.locator('.tl-row', { hasText: name }).first();

  await step(s, 'meal prep serve', async () => {
    await s.scrollTop();
    await page.locator('.tl-prep-row').click();
    await s.settle(350);
    await s.shot('toast', 'meal-prep-logged-undo', 'One tap on the meal prep row logs a serve and shows a toast with Undo ("Logged to lunch · 2 left").');
    await s.audit('toast with undo');
    await page.locator('.toast-action').click();
    await s.settle(300);
    await s.shot('toast', 'meal-prep-undone', 'Toast "Undone" after tapping Undo.');
    await s.settle(1800);
  });

  await step(s, 'now line chip', async () => {
    await s.scrollTo('.tl-now', 'center');
    await s.shot('today', 'now-line-closeup', 'The Now line: next meal usuals as chips (name and Cal) one tap from logging.');
    await page.locator('.tl-chip').first().click();
    await s.waitFor('[role=dialog]');
    await s.sheet('log-food-review', 'from-now-line-usual', 'A usual from the Now line opens the log sheet prefilled with what was logged last time.');
    await s.closeTop();
    await s.scrollTop();
  });

  await step(s, 'long press menu', async () => {
    await s.scrollTo('.tl-dayline');
    await s.longPress(rowByName('Greek yoghurt, berries and oats'));
    await s.shot('entry-menu', 'long-press-with-photo', 'Touch and hold on an entry with a photo: Edit, Log again today, View photo, Delete.');
    await s.audit('entry long-press menu');
    await page.locator('.entry-menu button', { hasText: 'View photo' }).click();
    await s.settle(700);
    await s.sheet('photo-lightbox', 'entry-photo', 'Entry photo sheet from the menu: photo, name and day, Replace, Save / Share PNG, Remove.');
    await s.audit('entry photo sheet');
    await s.closeTop();
    await s.longPress(rowByName('Flat white'));
    await s.shot('entry-menu', 'long-press-no-photo', 'Touch and hold on an entry with no photo: the menu says Add photo.');
    await page.keyboard.press('Escape');
    await s.settle(300);
  });

  await step(s, 'add photo via menu', async () => {
    await s.scrollTo('.tl-dayline');
    await s.longPress(rowByName('Flat white'));
    const file = await s.makeImage('meal');
    await s.chooseFile(() => page.locator('.entry-menu button', { hasText: 'Add photo' }).click(), file);
    await s.settle(900);
    await s.shot('toast', 'meal-photo-saved', 'Toast "Meal photo saved" after adding a photo to an entry; the row now shows the photo.');
    await s.settle(1800);
  });

  await step(s, 'log again', async () => {
    await s.longPress(rowByName('Flat white'));
    await page.locator('.entry-menu button', { hasText: 'Log again today' }).click();
    await s.settle(300);
    await s.shot('toast', 'entry-repeated', 'Toast "Entry repeated to today" after Log again today.');
    await s.settle(1800);
  });

  await step(s, 'delete via menu', async () => {
    await s.longPress(rowByName('Guzman'));
    await page.locator('.entry-menu button.danger-text').click();
    await s.settle(400);
  });

  await step(s, 'edit entry', async () => {
    await rowByName('Guzman').click();
    await s.waitFor('[role=dialog]');
    await s.sheet('edit-entry', 'ai-estimated-entry', 'Tap an entry to edit it: an AI-estimated entry shows the Estimated chip, "Not an estimate", assumptions, meal chips, photo picker, notes, swipe to save, Log again today and Delete entry.');
    await s.audit('edit entry sheet');
    await s.focusTrap('edit entry sheet');
    await page.getByRole('button', { name: 'Per 100g' }).click();
    await s.settle(300);
    await s.shot('edit-entry', 'per-100g-basis', 'Edit entry after switching Per serving to Per 100g (the numbers convert, amount becomes grams).');
    await page.getByRole('button', { name: 'Per serving' }).click();
    await page.locator('.unit-toggle-chip button', { hasText: 'kJ' }).first().click();
    await s.settle(300);
    await s.shot('edit-entry', 'energy-in-kj', 'Edit entry with the energy input switched to kJ.');
    await page.locator('.unit-toggle-chip button', { hasText: 'Cal' }).first().click();
    await s.swipe(0.5);
    await s.shot('edit-entry', 'swipe-halfway', 'Swipe to save, held halfway.');
    await s.cancelSwipe();
    await s.swipe(0.95);
    await s.shot('edit-entry', 'swipe-past-threshold', 'Swipe to save past the threshold: label changes to "Release to save".');
    await s.releaseSwipe();
    await s.settle(300);
    await s.shot('toast', 'entry-updated', 'Toast "Entry updated" after saving an edit.');
    await s.settle(1800);
  });

  await step(s, 'day target', async () => {
    await s.scrollTop();
    await page.locator('.tl-feet button').click();
    await s.sheet('day-target', 'default', 'Today\'s target sheet: explanation, slider with endpoints, "Type a target" with Set, usual target note.');
    await s.audit('day target sheet');
    // Keyboard steps on the slider are 10 Cal and a change within about 27 Cal of the usual target is discarded, so the
    // slider never leaves the usual target that way (recorded as a problem). The typed target is what sets a custom one.
    await page.locator('.day-calorie-slider').focus();
    for (let i = 0; i < 12; i += 1) await page.keyboard.press('ArrowRight');
    await s.settle(300);
    const sliderAfterKeys = await page.locator('.day-calorie-slider').inputValue();
    s.registry.problems.notes.push(`Day target slider: 12 x ArrowRight from 1800 leaves the value at ${sliderAfterKeys} (each 10 Cal step is within the tolerance of the usual target and is discarded).`);
    await s.shot('day-target', 'slider-after-12-arrow-keys', 'Day target slider after 12 ArrowRight presses: still at the usual target (changes within the tolerance snap back).');
    await page.locator('.day-calorie-input').fill('2100');
    await page.getByRole('button', { name: 'Set', exact: true }).click();
    await s.settle(500);
    await s.shot('day-target', 'custom-target', 'Day target after typing 2100 and Set: the slider moves and a "Use usual target" button appears.');
    await s.closeTop();
    await s.shot('today', 'custom-target-applied', 'Today with a custom day target (the target line says "custom" and the arc re-scales).');
    await s.settle(200);
    await page.locator('.tl-feet button').click();
    await s.settle(600);
    await page.getByRole('button', { name: 'Use usual target' }).click().catch(() => {});
    await s.closeTop();
  });

  await step(s, 'log manually', async () => {
    await page.locator('.tl-manual-row').click();
    await s.waitFor('[role=dialog]');
    await s.sheet('log-manually', 'seeded-new-entry', 'Log manually at 13:00: meal defaults to Lunch from the clock; saved-food picker with Favourites and Recent.');
    await page.getByRole('button', { name: 'Snack', exact: true }).click();
    await s.settle(300);
    await s.shot('log-manually', 'snack-part-of-day-picker', 'Choosing Snack (or Drink) asks "When was this snack?" with Morning, Afternoon, Evening.');
    await page.locator('details', { hasText: 'Favourites' }).first().locator('summary').click();
    await s.settle(300);
    await s.shot('log-manually', 'favourites-open', 'Saved food picker with Favourites expanded.');
    await page.locator('.quick-picker input[type=search]').fill('tim');
    await s.settle(1000);
    await s.shot('log-manually', 'picker-typed', 'Saved food picker with "tim" typed: Your foods and From food database.');
    await page.locator('.quick-food-result').first().click();
    await s.settle(700);
    await s.shot('log-manually', 'picked-food', 'After picking a saved food the form fills in and scrolls to the numbers.');
    await page.locator('#entryPortion').fill('3');
    await s.settle(300);
    await s.shot('log-manually', 'three-servings-total', 'Three servings: "Logged total" preview chips and the "After this" line.');
    const file = await s.makeImage('meal');
    await s.chooseFile(() => page.locator('.photo-picker-label').click(), file);
    await s.settle(900);
    await s.sheet('log-manually', 'with-photo', 'A meal photo attached: preview and "Tap to replace the photo".');
    const panelScroll = () => page.evaluate(() => { const p = document.querySelector('.modal-panel'); const b = p?.querySelector('.modal-body'); return { panel: p?.scrollTop ?? null, body: b?.scrollTop ?? null, headTop: Math.round(p?.querySelector('.modal-head')?.getBoundingClientRect().top ?? 0), panelTop: Math.round(p?.getBoundingClientRect().top ?? 0) }; });
    const before = await panelScroll();
    await page.locator('.fav-toggle').first().click();
    await s.settle(300);
    const after = await panelScroll();
    s.registry.problems.notes.push(`Log sheet, heart tapped after scrolling: panel scrollTop ${before.panel} -> ${after.panel}, header top ${before.headTop} -> ${after.headTop} (panel top ${after.panelTop}).`);
    await s.shot('log-manually', 'heart-tapped-header-nudged', 'Heart tapped after scrolling the sheet. Playwright scrolled the heart into view and, because the sheet panel is overflow:hidden but still programmatically scrollable, the whole panel moved about 34 px: the title row is pushed up under the sheet edge and the close button is clipped. iOS does the same when it scrolls to a focused field (see OBSERVATIONS.md).');
    await s.swipe(0.95);
    await s.shot('log-manually', 'favourite-and-swipe', 'Heart tapped ("Also saves it to favourites") and the swipe held past the threshold ("Release to log"). The sheet header is still nudged up (see the previous shot, a side effect of the programmatic scroll).');
    await s.releaseSwipe();
    await s.settle(350);
    await s.shot('toast', 'entry-saved', 'Toast "Entry saved" with the favourites note after logging.');
    await s.settle(1800);
  });

  await step(s, 'save and add another', async () => {
    await page.locator('.tl-manual-row').click();
    await s.waitFor('[role=dialog]');
    await page.locator('#entryCalories').fill('95');
    await page.locator('#entryName').fill('Apple');
    await page.getByRole('button', { name: 'Save and add another' }).click();
    await s.settle(350);
    await s.shot('log-manually', 'saved-and-add-another', 'Save and add another: sheet resets for the next entry and a toast confirms the save.');
    await s.closeTop();
  });

  await step(s, 'rough meal log', async () => {
    await page.locator('.tl-manual-row').click();
    await s.waitFor('[role=dialog]');
    await page.getByRole('button', { name: 'Add a rough meal' }).click();
    await s.settle(600);
    await s.sheet('rough-meal', 'from-log-manually', 'Add a rough meal reached from Log manually.');
    await page.locator('.rough-size', { hasText: 'Regular' }).click();
    await s.settle(300);
    await s.shot('toast', 'rough-meal-logged', 'Toast "Rough lunch logged: 800 Cal" after tapping a size.');
    await s.settle(1800);
  });
}

/* ================================================================== AI FLOWS WITH THE MOCK (13:00) */

export async function aiFlows(s, cfg) {
  const { page } = s;
  const ctl = s.controller;

  const openEstimate = async () => {
    await s.sparkle();
    await page.getByRole('button', { name: /Estimate with Gemini/ }).click();
    await s.settle(700);
  };

  await step(s, 'estimate modal states', async () => {
    await openEstimate();
    await s.sheet('estimate-with-gemini', 'empty', 'Estimate with Gemini: empty input, Estimate food disabled, photo add tile, tips.');
    await s.audit('estimate with gemini sheet');
    await s.focusTrap('estimate with gemini sheet');
    await page.locator('details.menu-pick-how summary').click();
    await s.settle(300);
    await s.shot('estimate-with-gemini', 'tips-open', 'The "Tips for accurate numbers" disclosure opened.');
    await page.locator('details.menu-pick-how summary').click();
    await page.locator('.gemini-estimate-modal textarea').fill('Chicken burrito bowl from Guzman y Gomez with rice, beans, salsa, cheese and guac. Medium size.');
    await s.settle(300);
    await s.sheet('estimate-with-gemini', 'text-typed', 'Estimate with Gemini with a description typed; the Estimate food button is enabled.');
    const meal = await s.makeImage('meal');
    await s.chooseFile(() => page.locator('.menu-photo-add').click(), meal);
    await s.settle(900);
    await s.sheet('estimate-with-gemini', 'photo-attached', 'Estimate with Gemini with a photo attached (thumbnail with remove button, "Add another" tile).');
    await s.closeTop();
  });

  await step(s, 'estimate loading and result', async () => {
    ctl.delayMs = 2500;
    await openEstimate();
    await page.locator('.gemini-estimate-modal textarea').fill('Chicken burrito bowl from Guzman y Gomez with rice, beans, salsa, cheese and guac. Medium size.');
    await page.getByRole('button', { name: 'Estimate food' }).click();
    await s.settle(500);
    await s.shot('estimate-with-gemini', 'loading', 'LOADING: the button says "Estimating…", fields and Cancel are disabled, and a toast says "You can close this…" while the sheet cannot be closed.');
    await s.audit('estimate loading');
    ctl.delayMs = 0;
    await page.waitForSelector('#entryName', { timeout: 15000 });
    await s.settle(900);
    await s.sheet('estimate-result', 'review-text-estimate', 'RESULT: the log sheet opens with Gemini\'s numbers (720 Cal per serving), Estimated chip, Medium confidence, assumptions and a Correction field with Refine.');
    await s.audit('estimate result sheet');
    await page.locator('input[aria-label="Correction for Gemini"]').fill('Small bowl, no sour cream');
    await s.settle(300);
    ctl.delayMs = 2000;
    await page.getByRole('button', { name: 'Refine' }).click();
    await s.settle(500);
    await s.shot('estimate-result', 'refining', 'REFINE in progress: the Refine button says "Refining…" and the field is disabled.');
    ctl.delayMs = 0;
    await page.waitForFunction(() => /small/i.test(document.querySelector('#entryName')?.value || ''), null, { timeout: 15000 });
    await s.settle(700);
    await s.sheet('estimate-result', 'refined', 'REFINED result: new numbers (610 Cal), name updated, assumptions updated.');
    await page.locator('#entryCalories').fill('900');
    await s.settle(300);
    await s.shot('estimate-result', 'macros-disagree-warning', 'After editing calories to 900 the macros no longer add up: "Calories and macros don\'t quite add up" warning.');
    await s.closeTop();
  });

  await step(s, 'estimate with photo (label)', async () => {
    await openEstimate();
    const label = await s.makeImage('label');
    await s.chooseFile(() => page.locator('.menu-photo-add').click(), label);
    await s.settle(900);
    await page.getByRole('button', { name: 'Estimate food' }).click();
    await page.waitForSelector('#entryName', { timeout: 15000 });
    await s.settle(900);
    await s.sheet('estimate-result', 'label-reading', 'RESULT from a nutrition label photo: "From label", 100 g basis, 170 g eaten, High confidence and the hint to check it matches the pack.');
    await s.closeTop();
  });

  const errorCase = async (mode, tag, desc, { both = false } = {}) => {
    ctl.mode = mode;
    await openEstimate();
    await page.locator('.gemini-estimate-modal textarea').fill('Two slices of pepperoni pizza');
    await page.getByRole('button', { name: 'Estimate food' }).click();
    await page.waitForSelector('.ai-quick-log-error', { timeout: 20000 }).catch(() => {});
    await s.settle(600);
    // The "Estimating…" toast lasts 6 s and is not cleared when the request fails, so it sits over the error text.
    const covered = await page.locator('.toast').count();
    if (both && covered) await s.shot('estimate-with-gemini', `${tag}-toast-still-showing`, `${desc} Taken straight away: the "Estimating…" toast is still on screen and covers the error text.`);
    await page.waitForSelector('.toast', { state: 'detached', timeout: 9000 }).catch(() => {});
    await s.settle(300);
    await s.shot('estimate-with-gemini', tag, desc);
    if (!both) s.registry.problems.notes.push(`Estimate error (${mode}): the Estimating toast was ${covered ? 'still' : 'no longer'} showing when the error appeared.`);
    await s.closeTop();
    ctl.mode = 'ok';
  };
  await step(s, 'error 429', async () => { await errorCase('rate', 'error-429-rate-limit', 'ERROR (HTTP 429, quota): "Your Gemini key has hit its rate limit…" shown inline in the sheet; the typed description is kept.', { both: true }); });
  await step(s, 'error daily', async () => { await errorCase('daily', 'error-free-tier-daily-limit', 'ERROR (HTTP 429, free tier daily limit).'); });
  await step(s, 'error 400', async () => { await errorCase('badkey', 'error-400-invalid-key', 'ERROR (HTTP 400, API key not valid).'); });
  await step(s, 'error 503', async () => { await errorCase('busy', 'error-503-busy', 'ERROR (HTTP 503, overloaded).'); });

  await step(s, 'unreadable reply', async () => {
    ctl.mode = 'unreadable';
    await openEstimate();
    await page.locator('.gemini-estimate-modal textarea').fill('Some leftover lasagne');
    await page.getByRole('button', { name: 'Estimate food' }).click();
    await page.waitForSelector('.ai-quick-log-textarea', { timeout: 20000 });
    await s.settle(1200);
    await s.sheet('ai-estimate-helper', 'gemini-reply-unreadable', 'When Gemini replies with text the app cannot parse: toast "Gemini returned text Dawni could not read", and the AI estimate helper sheet holds Gemini\'s reply so it can be fixed by hand.');
    await s.closeTop();
    ctl.mode = 'ok';
  });

  /* ---- menu pick ---- */
  await step(s, 'menu pick', async () => {
    await s.sparkle();
    await page.getByRole('button', { name: /Help me pick from a menu/ }).click();
    await s.settle(800);
    await s.sheet('menu-pick', 'input-empty', 'Help me pick from a menu: meal chips (picked from the clock), what is left today, the suggested range, photo tile, note, "What gets sent", Suggest button disabled.');
    await s.audit('menu pick input');
    await s.focusTrap('menu pick sheet');
    const menu = await s.makeImage('menu');
    await s.chooseFile(() => page.locator('.menu-photo-add').click(), menu);
    await s.settle(1000);
    await page.locator('.menu-pick-note').fill('High protein, no seafood');
    await s.sheet('menu-pick', 'photo-and-note', 'Menu pick with a menu photo and a note typed.');
    ctl.delayMs = 2500;
    await page.getByRole('button', { name: 'Suggest what to order' }).click();
    await s.settle(600);
    await s.shot('menu-pick', 'loading', 'LOADING: "Reading the menu…" with a spinner and Cancel (this sheet can be closed while it waits).');
    ctl.delayMs = 0;
    await page.waitForSelector('.menu-pick-result', { timeout: 20000 });
    await s.settle(700);
    await s.sheet('menu-pick', 'result', 'RESULT: best pick card (source and confidence chips, numbers, what it leaves for today, reason, tip, assumptions), Also good, Why this pick, caveat, disclaimer.');
    await s.audit('menu pick result');
    await page.getByRole('button', { name: 'Log this' }).click();
    await s.waitFor('#entryName');
    await s.settle(800);
    await s.sheet('log-food-review', 'from-menu-pick', 'Log this opens the log sheet with the menu item (Estimated chip, assumptions).');
    await s.closeTop();
  });
  await step(s, 'menu pick error', async () => {
    ctl.mode = 'rate';
    await s.sparkle();
    await page.getByRole('button', { name: /Help me pick from a menu/ }).click();
    await s.settle(800);
    // The earlier suggestion is still stored: start a new menu first.
    await page.getByRole('button', { name: 'Start a new menu' }).click().catch(() => {});
    await s.settle(300);
    const menu = await s.makeImage('menu');
    await s.chooseFile(() => page.locator('.menu-photo-add').click(), menu);
    await s.settle(900);
    await page.getByRole('button', { name: 'Suggest what to order' }).click();
    await page.waitForSelector('.ai-quick-log-error', { timeout: 20000 }).catch(() => {});
    await s.settle(500);
    await s.shot('menu-pick', 'error-429', 'ERROR on menu pick (HTTP 429): message inline above the Suggest button.');
    await s.closeTop();
    ctl.mode = 'ok';
  });

  /* ---- meal prep batch ---- */
  await step(s, 'batch', async () => {
    await s.sparkle();
    await page.getByRole('button', { name: /Meal prep a batch/ }).click();
    await s.settle(800);
    await s.sheet('meal-prep-sheet', 'describe-empty', 'Meal prep a batch: ingredients box with a placeholder, serves stepper, Estimate batch disabled, "Enter the numbers yourself".');
    await s.audit('batch describe');
    await s.focusTrap('meal prep sheet');
    await page.locator('.batch-recipe').fill('500 g rice (uncooked)\n1 kg beef mince, 4 star\n1 tbsp olive oil\n1 iceberg lettuce\n1/2 cup teriyaki sauce');
    await page.getByRole('button', { name: 'One serve more' }).click();
    await s.sheet('meal-prep-sheet', 'describe-filled', 'Meal prep describe step filled in, serves set to 5.');
    ctl.delayMs = 2500;
    await page.getByRole('button', { name: 'Estimate batch' }).click();
    await s.settle(600);
    await s.shot('meal-prep-sheet', 'estimating', 'LOADING: Estimate batch says "Estimating…" and everything is disabled, including the close button.');
    ctl.delayMs = 0;
    await page.waitForSelector('#batchName', { timeout: 20000 });
    await s.settle(800);
    await s.sheet('meal-prep-sheet', 'review-result', 'RESULT: Review batch: name, per-serve Cal and macros, serves stepper with whole-batch Cal, Estimated and confidence chips, assumptions, Correction field, "What went in" breakdown, Save 5 serves, Save and log one now.');
    await s.audit('batch review');
    await page.locator('input[aria-label="Correction for Gemini"]').fill('Mince was 5 star');
    ctl.delayMs = 2000;
    await page.getByRole('button', { name: 'Refine' }).click();
    await s.settle(500);
    await s.shot('meal-prep-sheet', 'refining', 'REFINE in progress on the batch.');
    ctl.delayMs = 0;
    await page.waitForFunction(() => /5 star/i.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
    await s.settle(700);
    await s.sheet('meal-prep-sheet', 'refined', 'REFINED batch (5 star mince, High confidence).');
    await page.getByRole('button', { name: 'Save and log one now' }).click();
    await s.settle(500);
    await s.shot('toast', 'batch-saved-and-logged', 'After "Save and log one now": a serve is logged straight away, with an Undo toast; the batch row is on Today.');
    await s.scrollTop();
    await s.settle(5300);
    await s.shot('today', 'with-new-batch-row', 'Today with a second meal prep row.');
  });
  await step(s, 'batch error', async () => {
    ctl.mode = 'rate';
    await s.sparkle();
    await page.getByRole('button', { name: /Meal prep a batch/ }).click();
    await s.settle(700);
    await page.locator('.batch-recipe').fill('2 cups lentils\n1 can coconut milk');
    await page.getByRole('button', { name: 'Estimate batch' }).click();
    await page.waitForSelector('.ai-quick-log-error', { timeout: 20000 }).catch(() => {});
    await s.settle(500);
    await s.shot('meal-prep-sheet', 'error-429', 'ERROR on batch estimate (HTTP 429).');
    await page.getByRole('button', { name: 'Enter the numbers yourself' }).click();
    await s.settle(500);
    await s.sheet('meal-prep-sheet', 'enter-numbers-yourself', 'Enter the numbers yourself: the review step with empty per-serve fields.');
    await s.closeTop();
    ctl.mode = 'ok';
  });
}

/* ================================================================== SETTINGS FLOWS (mutates its own state) */

export async function settingsFlows(s, cfg) {
  const { page } = s;
  const ctl = s.controller;
  await step(s, 'open settings', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await s.settle(800);
    await s.page2('settings', 'with-key', 'Settings with a Gemini key saved: seeded goals, backup 2 days ago, custom database row, saved key masked.');
    await s.audit('settings with key');
  });
  await step(s, 'goals edit', async () => {
    await page.locator('section.card', { has: page.getByRole('heading', { name: 'Goals' }) }).getByRole('button', { name: 'Edit' }).click();
    await s.settle(300);
    await s.shot('settings', 'goals-editing', 'Settings, Goals in edit mode: mode select and numeric fields enabled, the button reads Save goals.');
    await page.locator('section.card', { has: page.getByRole('heading', { name: 'Goals' }) }).getByRole('button', { name: 'Save goals' }).click();
    await s.settle(300);
    await s.shot('toast', 'goals-saved', 'Toast "Goals saved".');
    await s.settle(1800);
  });
  await step(s, 'gemini key states', async () => {
    const card = page.locator('.gemini-settings-card');
    await card.scrollIntoViewIfNeeded();
    await s.shot('settings', 'gemini-card-saved-key', 'Gemini card with a key saved, before any check ("Key saved. Tap Test key…").');
    await card.getByRole('button', { name: 'Test key' }).click();
    await page.waitForSelector('.gemini-status.is-ok', { timeout: 15000 }).catch(() => {});
    await s.settle(400);
    await s.shot('settings', 'gemini-card-ready-paid', 'Test key succeeded on the best model: "Ready. Dawni will use Gemini 2.5 Pro, the best model this key can use." with the model id and count of models.');
    ctl.mode = 'free';
    await card.getByRole('button', { name: 'Test key' }).click();
    await page.waitForSelector('.gemini-status.is-ok', { timeout: 15000 }).catch(() => {});
    await s.settle(500);
    await s.shot('settings', 'gemini-card-ready-free-tier', 'Test key on a free-tier key: Pro was refused, Dawni fell back to Gemini 2.5 Flash and says the key is on Google\'s free tier.');
    ctl.mode = 'badkey';
    await card.getByRole('button', { name: 'Test key' }).click();
    await page.waitForSelector('.gemini-status.is-error', { timeout: 15000 }).catch(() => {});
    await s.settle(500);
    await s.shot('settings', 'gemini-card-error-invalid-key', 'Test key with an invalid key: error copy and a "Details from Google" disclosure.');
    await card.locator('.gemini-status details summary').click().catch(() => {});
    await s.settle(300);
    await s.shot('settings', 'gemini-card-error-details-open', 'The Details from Google disclosure opened.');
    ctl.mode = 'rate';
    await card.getByRole('button', { name: 'Test key' }).click();
    await page.waitForSelector('.gemini-status.is-error', { timeout: 15000 }).catch(() => {});
    await s.settle(500);
    await s.shot('settings', 'gemini-card-error-429', 'Test key when every model is rate limited (HTTP 429).');
    ctl.mode = 'ok';
    await card.getByRole('button', { name: 'Test key' }).click();
    await page.waitForSelector('.gemini-status.is-ok', { timeout: 15000 }).catch(() => {});
    await card.getByRole('button', { name: 'Edit' }).click();
    await s.settle(300);
    await s.shot('settings', 'gemini-card-editing', 'Gemini card in edit mode: the key field is a password input, the button reads Save.');
    await card.getByRole('button', { name: 'Save' }).click();
    await s.settle(900);
    await s.shot('settings', 'gemini-card-after-save', 'After Save the key is checked again automatically.');
  });
  await step(s, 'ai preferences', async () => {
    await page.locator('.ai-preferences-card textarea').fill('Melbourne. Cooks with olive oil spray. High protein where possible. No seafood on weekdays.');
    await s.scrollTo('.ai-preferences-card');
    await s.shot('settings', 'about-you-edited', 'About you, for AI: the Save button enables once the text changes.');
    await page.locator('.ai-prompt-card summary').click();
    await s.scrollTo('.ai-prompt-card');
    await s.shot('settings', 'ai-prompt-shown', 'AI estimate helper with Show prompt opened: the whole prompt in a textarea.');
  });
  await step(s, 'display options', async () => {
    await s.scrollTo('.card:has(h2:text("Display"))');
    await s.shot('settings', 'display-card', 'Settings, Display: theme (System / Dark / Light), energy unit, accent presets and colour input.');
    await page.getByRole('button', { name: 'kJ', exact: true }).first().click();
    await s.settle(300);
    await page.getByRole('button', { name: 'Done' }).click();
    await s.settle(700);
    await s.shot('today', 'energy-in-kj', 'Today with the energy unit set to kJ: hero, entries and macros in kJ.');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await s.settle(600);
    await s.scrollTo('.card:has(h2:text("Display"))');
    await page.getByRole('button', { name: 'Cal', exact: true }).first().click();
    await page.getByRole('button', { name: 'Accent #A04E1E' }).click();
    await s.settle(300);
    await page.getByRole('button', { name: 'Done' }).click();
    await s.settle(700);
    await s.shot('today', 'accent-amber', 'Today with the amber accent preset: tab bar, sparkle button, links and chips take the accent.');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await s.settle(600);
    await s.scrollTo('.card:has(h2:text("Display"))');
    await page.getByRole('button', { name: 'Accent #0E7C76' }).click();
    const bank = page.locator('.check-pill');
    await s.scrollTo('.check-pill');
    await bank.click();
    await s.settle(400);
    await s.shot('settings', 'spread-bank-on', 'Weekly banking, Spread banked calories across remaining days switched on (toast confirms).');
    await s.settle(1800);
    await page.getByRole('button', { name: 'Done' }).click();
    await s.settle(700);
    await s.shot('today', 'spread-bank-on', 'Today with the weekly bank spread across days: the target reads "with bank".');
  });
  await step(s, 'check updates', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await s.settle(500);
    await s.scrollTo('.card:has(h2:text("App"))');
    await s.shot('settings', 'app-card', 'Settings, App card: version, Check for updates, Clear local data (red).');
    await page.getByRole('button', { name: 'Check for updates' }).click();
    await s.settle(3200);
    await s.shot('settings', 'check-updates-result', 'Check for updates when already current (or when the service worker is blocked) shows a toast.');
    await s.settle(1800);
    await page.getByRole('button', { name: 'Clear local data' }).click();
    await s.settle(400);
  });
}

/* ================================================================== SMALL STATES */

export async function backupReminder(s) {
  await s.settle(600);
  const open = await s.hasDialog();
  await s.shot('backup-reminder', 'auto-on-launch', open ? 'The backup reminder opens by itself on launch when the last backup is older than the reminder interval (10 days against 7).' : 'Expected the backup reminder here but no sheet opened.');
  await s.focusTrap('backup reminder');
  await s.audit('backup reminder');
}

export async function updateModal(s, cfg) {
  const { page } = s;
  // A newer build: version.json answers with a higher version and notes, as a deploy would. The service worker passes
  // version.json straight to the network (where Playwright cannot see it), so the page's own fetch is wrapped instead.
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (/version\.json/.test(url)) {
        return Promise.resolve(new Response(JSON.stringify({
          version: '2.9.0.0',
          notes: ['Search is faster, and recent foods now show the last time you logged them.', 'Meal prep serves can be logged to any day from Foods.', 'Fixes for kJ rounding on Week.']
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      return original(input, init);
    };
  });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await s.settle(600);
  await s.scrollTo('.card:has(h2:text("App"))');
  await page.getByRole('button', { name: 'Check for updates' }).click();
  await page.waitForSelector('[role=dialog]', { timeout: 12000 }).catch(() => {});
  await s.settle(500);
  await s.shot('version', 'toast-over-update-button', 'The "Update ready" toast lands on top of the sheet\'s primary button (Update now) at the moment the sheet opens.');
  await s.settle(2200);
  await s.sheet('version', 'update-available', 'Update available sheet: version badge, explanation, What\'s new notes, Update now and Not now.');
  await s.audit('update sheet');
}

export async function noKey(s, cfg) {
  const { page } = s;
  await s.page2('today', 'no-key-with-entries', 'Today with entries but no Gemini key.');
  await s.sparkle();
  await s.shot('log-with-ai', 'no-key-with-entries', 'Log with AI chooser, with entries but no key. Nothing in the chooser says a key is missing.');
  await page.getByRole('button', { name: /Estimate with Gemini/ }).click();
  await s.settle(700);
  await s.shot('gemini-setup', 'no-key-with-entries', 'Estimate with Gemini without a key: the Set up Gemini sheet.');
  await s.closeTop();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await s.settle(700);
  await s.scrollTo('.gemini-settings-card');
  await s.shot('settings', 'gemini-card-no-key', 'Settings, Gemini card with no key: "Not set up."');
}

export async function midweek(s, cfg) {
  await s.page2('today', 'midweek', 'Wednesday 13:00 (a mid-week date, so upcoming days exist): week strip with future days, rest-of-week pace.');
  await s.tab('stats');
  await s.page2('week', 'midweek', 'Week on a Wednesday: upcoming days drawn as empty skies, plan for the remaining days.');
  await s.tab('tracking');
}
