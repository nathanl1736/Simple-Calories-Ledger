# Dawni 3.0 — AI-first redesign brief

Status: build brief. Written from a full code inventory, screenshots of every screen, and the owner's own findings. Build agents implement from this file; the owner reviews the result on the `claude/ai-first-redesign` branch.

Scope decision: this is **not** a visual reskin. Tidelight (the clock-following sky, the sun arc, Fraunces + Nunito, glass chrome, amber-not-red) stays. What changes is the *flow*: how food gets logged, how the week is explained, and how the app moves. Screens that are not on the critical path (Journal, Foods, most of Settings) get polish only.

---

## 1. Direction

**Identity (unchanged):** a calm, local-first calorie ledger for people who want weekly consistency rather than daily perfection. No guilt language. Estimates are labelled and editable. Data stays on the phone.

**What changes:** logging is AI-first. The default way to log is to describe or photograph what you ate and let Gemini (the user's own key) estimate it. Typing numbers in, searching saved foods, favourites and meal prep all stay, one tap away, but they are the secondary path. The app also answers "what should I eat?" against what is left today and how the week is going.

**Three rules every change must pass:**
1. The common path gets shorter. Count gestures from app-open to a saved entry; it must go down.
2. The user is never locked out. No sheet that cannot be closed, no request without a timeout, no save that needs a gesture when a tap would do.
3. Numbers reconcile by eye. One quantity, one rounding, one representation on a screen.

---

## 2. Audit: what is wrong today (ranked)

Severity: **S1** blocks or misleads the core loop; **S2** adds real friction; **S3** polish.

| # | Sev | Finding | Where |
|---|---|---|---|
| A1 | S1 | **AI logging is 5 gestures plus typing plus a 10–30 s wait, and the sheet is locked while waiting.** Sparkle → "Estimate with Gemini" row → textarea → Estimate → (wait) → swipe to log. The chooser sheet ("Log with AI") is a menu of three AI flows plus copy/paste; it adds a tap for every log and front-loads a decision the user does not care about. The toast says "You can close this" while X, scrim and Cancel are all disabled. There is no request timeout, so a stalled call strands the user. | `App:2045-2073` (addFood), `App:3789-3890` (GeminiEstimateModal), `geminiEstimate.ts` (no `AbortSignal`), `App:1418-1421` |
| A2 | S1 | **Saving needs a slide-to-confirm, with no tap alternative**, in manual, prefill and edit modes. Slide-to-confirm is a destructive-action pattern; here it guards the most frequent, fully reversible action in the app. Assistive tech that fires `click` cannot save. | `SwipeConfirm` `App:3108-3167`; `App:4960` |
| A3 | S1 | **Week headline excludes today.** "+568 Cal banked" is the balance before today; "1,288 Cal left this week" and "about 1,290" are figures *after* today's 730 over. The user sees "ahead" and "less than a day left" and the screen does not say why. "Still on track." fires on any overage ≥ 5 Cal as long as the 80 % floor is not binding, so it reads as reassurance that contradicts the headline. Rounding happens per displayed number (signed in one place, absolute in another, to-the-Cal in one sentence, to-10 in the next), so 567/568 and 1,288/1,290 appear for the same value. Custom day targets are ignored by the bank and the plan. The tiles draw base targets, never the plan. | `bankHeadline` `App:2279-2293`, `weekAnswer` `App:5596-5611`, `restOfWeekPlan` `tide:194-206`, `aboutEnergyText` `App:5539`, `App:5726-5744`, `App:5777` |
| A4 | S1 | **No key = a dead end, not an onboarding.** Every AI row bounces to "Set up Gemini" → "Open Gemini settings" → Settings → Edit → paste → Save → Done → back to Today → sparkle again. Roughly 8 extra taps on the very first use of the headline feature. First run on Today is an empty arc and "Tap ✦ to log with AI". | `App:2094-2110`, `App:6018-6047`, `App:2720-2722` |
| A5 | S2 | **"Help me pick from a menu" requires a photo and ignores the week.** Text is an optional note only; the prompt says "Only recommend dishes that appear in the photos". Context sent has today's numbers but not the bank, plan, or usual foods. The "What gets sent" disclosure omits the About-you text that is sent. | `menuPick.ts:64-114, 146-159`, `App:4309-4312, 4547`, `geminiEstimate.ts:809` |
| A6 | S2 | **Nothing moves.** The sun, arc segments, big number, protein figure and Week tiles jump to new values. The only screen motion is a 210 ms opacity settle. Sheets use a single ease curve with no velocity carry-over on drag-dismiss. There is no press-down feedback beyond `:active`. | `tide:57-116`, `css:152-161`, `App:574-668` |
| A7 | S2 | **Settings is reachable from one icon on one tab, and "Done" always returns to Today** (resetting the date), even when Settings was opened from a sheet on Week or Foods. The app can cold-start on Settings. | `App:2550, 966, 1739, 6004, 110-114` |
| A8 | S2 | **The sparkle silently switches tabs.** From Week, Journal or Foods it jumps to Today (resetting the selected date) and opens the sheet there; cancelling leaves you on Today. | `App:1129-1132` |
| A9 | S2 | **Estimate photos are thrown away.** The photo the user just took for the estimate is not attached to the entry; the Journal needs a second, differently compressed upload. | `App:1497-1516`, `App:1900-1903` |
| A10 | S2 | "Now line" chips promise one tap but open the full sheet; only meal-prep rows are one-tap. "Add a rough meal" and "Rough guess for the day" are hidden on today before 17:00 while under 90 % of target. | `App:2723-2735`, `App:2932-3066` |
| A11 | S2 | Accessibility: no focus trap or restoration in sheets, background not `inert`; pinch-zoom disabled; 10–12 px micro text; several 36–40 px targets (Foods "+" 40, "…" 36, `.text-btn` 36, Now chips 36, toast action 36); unlabeled range slider; inline errors not announced; light-mode amber text 4.2:1 on white. | `App:529-731`, `index.html:5`, `css:1975, 801, 879, 1533, 1599-1600, 1905` |
| A12 | S3 | Terminology drift: "Log food / Log Food / Log with AI / Log manually / Estimate with Gemini / Pick from a menu / Help me pick from a menu"; "Foods" vs "My Foods"; "banked / bank / Calories Bank". Brand drift: Dawni / Simple Calories Ledger / Calorie Tracker in file names and titles. | throughout |
| A13 | S3 | Update sheet shows the *oldest* five of nineteen release notes; `Number()` on every keystroke in Foods/Goals blocks typing "1.5"; delete entry is a native `confirm` with no Undo while other actions offer Undo; ~110 dead CSS selectors across three style generations. | `App:2169-2182`, `App:4974-5039`, `App:1310` |

Visual findings from the screenshot review are in section 9.

---

## 3. Navigation and global behaviour

- **Tabs stay:** Today, Week, Journal, Foods. The floating glass bar stays.
- **The sparkle becomes "Log food"** (aria-label and empty-state copy). It opens the **Log sheet** (section 4) *on the current tab* without switching tabs. Entries always go to the day shown on Today; the sheet title says which day ("Log food · Tuesday").
- **Settings** gets a sliders button in the header toolbar of every tab (same 44 px glass button Today has). `settingsReturnTab` is set to the tab that opened it; "Done" returns there. If the stored active tab on cold start is `settings`, start on Today.
- **Tap to save, everywhere.** Delete `SwipeConfirm` and its CSS. Every sheet's primary action is a 48 px accent button: "Log 720 Cal", "Save", "Save 4 serves". After logging, show a toast "Logged 720 Cal · lunch" with **Undo** (5 s). Delete entry becomes a soft delete with Undo instead of `confirm()`.
- **No locked sheets.** Any sheet that is waiting on Gemini can be closed; the request continues; completion is announced (section 4.4). Every Gemini request has a 45 s timeout and an `AbortController` wired to a visible Cancel.
- **Terminology** (use exactly): Log food · Estimate · Suggest / What should I eat? · Type it in · Search foods · Usuals · Meal prep · Rough meal · Week bank · banked · Foods (tab) · Settings. "Gemini" is named only where the key or model matters (Settings, the connect card, the model line in the sheet footer).

---

## 4. The Log sheet (replaces the "Log with AI" chooser)

One bottom sheet, opened by the sparkle, by the "Now" button on Today, by the first-run card, and by Journal's "Log food for this day". It is a composer, not a menu.

### 4.1 Layout, top to bottom

1. **Header**: title "Log food" (Fraunces 24). Right: close. Under the title a small segmented control: **Log** | **Suggest**. Suggest is section 5. The title becomes "What should I eat?" in Suggest mode.
2. **Composer**: a textarea that grows from 2 to 5 lines. Placeholder (Log): *"What did you eat? e.g. 2 eggs on toast with butter, flat white"*. Beneath it a toolbar row: a **Photo** chip (camera glyph, 44 px; opens the picker, multiple allowed, up to 3; thumbnails 56 px with an X appear above the toolbar) and, right-aligned, the primary **Estimate** button (disabled until text or a photo exists; reads "Estimating…" while busy). Enter inside the textarea inserts a newline; the button is the only submit.
3. **Usuals row** (Log mode, hidden while a request runs): a horizontally scrolling row of up to 8 chips, 44 px tall: the day-part's usuals first (`usualsFor`, existing), then meal-prep batches with serves left (prep glyph, "Name · 3 left"), then favourites. Chip = name + Cal. **Tap logs it immediately** to the sheet's meal/day-part with an Undo toast; the sheet closes. Long-press (or the "…" at the end of the row: "More") opens the review sheet prefilled instead.
4. **Other ways** (plain rows, 52 px, chevron): **Search foods** (opens the existing overlay), **Type it in** (opens the manual entry sheet exactly as "Log manually" does now, including the decimal keyboard hand-off), **Rough meal** (opens the rough-meal panel; this also fixes A10's hidden actions), **Meal prep a batch**. These rows are the only manual entry points: the **Search foods** and **Log manually** rows are removed from Today (V1).
5. **Footer**: 13 px muted. Left: *"Estimates can be wrong. You check the numbers before anything is saved."* Right: the model line when a key is set, e.g. *"Gemini 2.5 Flash · your key"* (from the cached key profile; never block on it). Under it a text link **Paste an estimate from another chatbot** (keeps the copy/paste path; "Copy prompt" lives in Settings only).

### 4.2 Gestures to a saved entry (acceptance)

| Path | Before | After |
|---|---|---|
| Estimate by text | 5 + typing + wait | **3** (sparkle, Estimate, Log) + typing + wait |
| Estimate by photo | 5 + OS picker | **3** + OS picker |
| Usual / favourite / meal-prep serve | 2–3 | **2** (sparkle, chip) with Undo |
| Manual typed | 2 + typing | **3** (sparkle, Type it in, Log) + typing. One more gesture than the old "Log manually" row, accepted so the log itself is visible on Today (V1); "Type it in" is the first row under the composer. |
| Suggest → log | 6 | **4** (sparkle, Suggest, Log this, Log) |

### 4.3 Estimating state (in the sheet)

When Estimate is tapped the composer collapses to a **status card**: the first photo thumbnail (or a sparkle glyph), "Estimating…", the text they typed in one muted line, and after 8 s an elapsed counter ("12 s · usually 10–30 s"). A **Cancel** text button aborts. Under it: *"You can close this. Dawni will let you know when it's ready."* and that must be true: X, scrim and swipe all work.

### 4.4 Background completion

If the user closed the sheet: a slim pill above the tab bar on every tab, "Estimating lunch…", with a spinner; on success a toast "Your estimate is ready" with action **Review** (opens the review sheet) and the pill disappears; on failure a toast with the friendly error and action **Try again** (reopens the Log sheet with the text and photos restored). If the user is still in the sheet, the review sheet replaces it directly. Timeout at 45 s: *"Gemini is taking too long. Try again, or type it in."* with buttons **Try again** / **Type it in**.

### 4.5 Review sheet (the existing `EntryModal` in prefill mode, tightened)

- Name, calories panel, macros, servings as today.
- **Estimate header** replaces the chip row: one line, e.g. *"Estimated · medium confidence"* with a chevron that expands "What Gemini assumed" (expanded by default when confidence is not high). Keep the macro mismatch warning and **Refine** (field + button) exactly as they are.
- **Photo**: if the estimate had photos and the source is not `label`, attach the first photo to the entry as its journal photo (recompressed with the journal settings: 1000 px, q .72). Show it in the "Meal photo" card with **Remove**. Label photos are never attached.
- **Primary**: "Log 720 Cal" button (sticky bar). The "After this: N Cal left today" line stays above it.
- Save behaviour unchanged (`saveEntry`), plus the Undo toast.

### 4.6 No key: connect inline

If `settings.geminiApiKey` is empty:
- The sheet opens normally. The usuals row and the "Other ways" rows all work.
- Tapping **Estimate** (or **Suggest**) swaps the composer for a **Connect card** instead of a toast or a trip to Settings: title *"Connect Gemini to estimate"*, two lines: *"Dawni uses your own free Google key. It stays on this phone and is only sent to Google."*; a password field "Paste your API key"; **Save and test** (runs `probeGeminiKey`, shows the status line from Settings inline); a text link **How do I get a key?** (opens the existing `geminiApiKeyHelp` sheet; it already lists the AI Studio steps); and **Type it in instead**. On a successful test the card shows "Ready · Gemini 2.5 Flash" for a beat and then the original request runs with the text and photos the user already entered. Nothing is lost.
- Delete the `geminiSetup` modal. Settings keeps its Gemini card.

### 4.7 First run (no entries, no key)

Today's empty state under the hero becomes a card: *"Log your first meal. Describe it or snap a photo and Gemini estimates it, or type the numbers in."* with one button **Log food**. The hero still shows the full target. When a key is set, the card is the plain line "Nothing logged yet. Tap ✦ to log food."

---

## 5. Suggest: "What should I eat?" (generalises menu pick)

The second mode of the Log sheet. Replaces "Help me pick from a menu" everywhere (rows, Settings copy, help sheets, key status line).

### 5.1 Input
- Textarea placeholder: *"Where are you eating, or what's in the fridge? e.g. Macca's for lunch · cooking at home, have chicken thighs and rice"*.
- Photo chip: up to 4 menu photos (existing compression). **Either text or photos is enough.**
- Meal chips Breakfast / Lunch / Dinner / Snack, default from the clock as now, with the existing "Picked from the time" hint.
- Budget line (existing `mealBudget`): *"Aim for about 340–430 Cal for lunch. That leaves room for dinner."*
- "What gets sent" disclosure: photos, your text, today's calories and macros, targets and goal mode, what you've logged, your week bank and plan, your usual foods, and the "About you" text from Settings. (The current disclosure omits About-you; fix it.)
- Primary **Suggest**; same estimating/background/timeout behaviour as 4.3–4.4.

### 5.2 Prompt and context (new `src/suggest.ts`, built from `menuPick.ts`)
- System prompt: calm, Australian English, no guilt words (keep the existing list). Decide the mode from the input: **menu** when a readable menu photo is present (recommend only dishes in the photos; use the menu's name and any printed energy); **venue** when the text names a restaurant, chain or cuisine with no menu (recommend real items that chain is known for in Australia; use published kJ/Cal where known and say so); **home** when the text describes cooking or ingredients on hand (suggest a dish to make with a short method and the portion that fits); **general** otherwise. Favour protein when much is still to go. Respect the goal mode. Keep the week in mind: if the week is behind, prefer the lighter option; if ahead, say so and allow the fuller one.
- Context lines (extend `buildMenuPickContext`): everything it sends today **plus** `Week so far: net −162 Cal, 1 day left after today, plan about 1,290 Cal a day` (from the week view model, section 6) and `Usual foods: name (N Cal); …` (top 10 by `usualsFor` then favourites). The About-you text stays.
- Response schema: keep `MENU_PICK_SCHEMA` and add to the item: `source` ("menu" | "venue" | "home" | "general"), `printedEnergy` (boolean, replaces `fromMenu`; accept `fromMenu` when parsing old replies), `portion` (short string, e.g. "1 regular bowl, no sour cream"). `menuReadable` stays and is only meaningful when photos were sent.
- Parsing: as `parseMenuPick`, plus the new fields. `printedEnergy === true` forces high confidence as `fromMenu` does today.

### 5.3 Result
- Reuse the existing result card (pick, 4-tile nutrition grid, fit sentence, reason, tip, assumptions, "Also good" alternatives, "Why this pick"). Footer copy by source: menu → *"Estimated from the menu. Portions vary, so check the numbers when you log."*; venue → *"Based on what <venue> usually serves. Check the numbers against the menu board."*; home → *"A suggestion to cook. Log what you actually plate up."*
- **Log this** → review sheet prefilled (`prefillMenuPick`, renamed `prefillSuggestion`), `estimateSource` = `'menu'` when `printedEnergy`, else `'ai'`; notes lead *"Suggested for lunch from the menu."* / *"Suggested for lunch at Macca's."* / *"Suggested to cook at home."*
- Session persistence (3 h, same date) stays.

### 5.4 Entry points
- The Log sheet's **Suggest** segment.
- A **"What should I eat?"** chip at the start of the Now line on Today when `remaining ≥ 150` Cal and a meal slot is open; it opens the Log sheet in Suggest mode with that meal selected.

---

## 6. Week: one model, one rounding, today included

### 6.1 New pure module `src/weekView.ts` (tested)

Takes the existing `weekBank` result, today's date, today's effective target, eaten today, mode and energy unit, and returns **integers already rounded once** that every string and bar on Week and Today's week row must use. Do not round again at render.

```
dayDelta[d]     = round(goal_d − intake_d)              // counted + estimated days, signed
bankedBefore    = Σ dayDelta over counted days ≠ today
todayDelta      = today counted/estimated ? dayDelta[today]
                : today in progress       ? round(todayTarget − eatenToday)
                : null
todayExtra      = today in progress ? max(0, −todayDelta) : 0   // only the overage counts before midnight
net             = bankedBefore + (today counted/estimated ? todayDelta : −todayExtra)
daysAfter       = days after today
baseAfter       = Σ base goal of daysAfter
even            = n ? (baseAfter + net) / n : null
floor           = 0.8 × baseAfter / n
allowance       = round10(max(even, floor))             // "about N", the only rounding to 10
perDayAdjust    = round(net / n)                        // for the working: "1,450 − 162"
overAtFloor     = round((allowance − even) × n) when even < floor else 0
leftInBudget    = round(budget − Σ eaten on all days)   // details sheet only
status          = finished ? 'finished'
                : overAtFloor > 0 || (n == 0 && todayDelta < 0) ? 'overForWeek'
                : net ≤ −100 ? 'recoverable'
                : net ≥ +100 ? 'ahead'
                : 'onPace'                               // Bulking swaps ahead/recoverable wording; Maintaining uses |net|
```
`round` is `Math.round` on the **signed** value; "over" strings use `Math.abs` of that same integer. Negative zero is normalised to 0.

Worked example (the owner's Saturday): deltas +304 −38 +238 −110 +173 → bankedBefore **567**; today 730 over → todayExtra 730, net **−163**; Sunday base 1,450 → even 1,287 → allowance **about 1,290**; status **recoverable**. Every number on the screen comes from these.

### 6.2 Week screen
1. **Headline** (Fraunces 88): `net`. `net ≥ 0` → "+567" / "Cal banked". `net < 0` → "163" / "Cal to even out"; when `status = overForWeek` → "Cal over this week". Bulking: net < 0 → "+163 / Cal ahead", net > 0 → "163 / Cal behind".
2. **Working line** (15 px, under the headline, only when today is in progress with `todayExtra > 0`, or today is counted): *"Before today +567 · today −730"*. When today is under target and still going: *"Before today +567 · today still going"*.
3. **Answer** (17 px semibold), one of:
   - ahead: *"A little ahead. Sunday can have about 2,020 (1,450 + 567)."* / *"Sat & Sun can each have about 1,730 (1,450 + 284 each)."*
   - onPace: *"On pace. Sunday can have about 1,450."*
   - recoverable: *"Recoverable. Sunday can have about 1,290 (1,450 − 163)."*
   - overForWeek: *"Over for the week. Aim for about 1,160 a day; it finishes about 340 over and resets Monday."*
   - last day: *"Last day. About 1,290 left after what's logged."* / *"Last day. It finishes about 160 over and resets Monday."*
   - finished: *"Finished 320 under target."* / *"Finished 160 over target."* / *"Finished right on target."*
   Delete "Still on track." and the `weekStory` line.
4. **Tide chart**: removed (V3). **Deltas row, tiles, weekday labels**: keep. Changes: upcoming tiles draw a **dashed plan line** at `allowance` when it differs from the base target by ≥ 10, labelled in the deltas row as "~1,290"; today's cell keeps "730 over"; the tiles' corner label reads *"target 1,450"*.
5. **Platter**: light-day "Check" platter unchanged. Otherwise the platter is removed and replaced by a **stats block** (V4) under the weekday labels: two columns, 15 px, label muted / value semibold: Weekly budget 10,150 · Left in budget 1,287 (*counting today's unspent*) · Counted 5 of 7 · Average 1,336 · Protein 123g / 150g avg. Tapping the block opens the details sheet.
6. **Details sheet**: table as now but every cell from `weekView`; add a "Plan" row for upcoming days; keep "How the week bank works" and add one bullet: *"Until midnight, today only counts what it is over by. What you haven't eaten yet is still yours."*
7. **Custom targets**: keep the bank on base goals (the weekly budget is the sum of base goals), but Today's Target button reads *"Target 2,400 · custom (week bank uses 1,800)"* when overridden.

### 6.3 Today's "This week" row
Right column, two lines from the same model: `net` with sign and label ("−163 to even out" / "+567 banked"), then the pace line ("Sun about 1,290"). Tapping opens Week.

---

## 7. Today

Keep the sky, hero, week strip, macros, day line, status card. Changes:
- **Remove the Search foods and Log manually rows** (V1). Order under the hero: meal prep rows (if any), This week, macros, day line.
- **Week strip mini-arcs** redrawn for legibility (V2). **Protein tail** copy per V11.
- **Motion** (section 8): sun, arc and numbers animate.
- **Empty state / first run**: section 4.7.
- **Now line**: chips become one-tap logs with Undo (same as meal prep); the "Now" button opens the Log sheet (not the manual sheet); a "What should I eat?" chip leads the row when there is room (5.4).
- **Status card**: "Rough meal" is always reachable from the Log sheet, so the card's own buttons can stay time-gated as they are.
- **Settings button** stays; Week/Journal/Foods get the same one (section 3).
- **Sparkle** aria-label "Log food".

---

## 8. Motion (Apple fluid-interface lens)

Principles: respond on pointer-down; animate from the current on-screen value, never from the target; springs for anything the user might interrupt; reduced motion means cross-fade, not nothing.

- New hook `useSpringValue(target, { response: 0.45, damping: 1 })` in `src/motion.ts`: rAF, critically damped, starts from the current *animated* value (interruptible), returns the live value; under `prefers-reduced-motion` it snaps. One implementation, no dependency.
- **Hero**: sun angle, the lit arc progress and the big number run through the spring. The big number rounds per frame (tabular nums already set). The protein figure and bar use the same. On date change, cross-fade (existing settle) then spring from the previous day's angle; on entry add/remove spring from the current value.
- **Week tiles**: `transition: height 420ms cubic-bezier(.2,.8,.2,1)` on the water fill and cap; tide path is static.
- **Sheets**: open 420 ms `cubic-bezier(.32,.72,0,1)` (iOS sheet feel), close 260 ms. Drag-to-dismiss carries velocity: on release compute remaining distance / release velocity, clamp 120–260 ms, use that as the duration. Rubber-band when dragging up beyond the top: `offset × 0.35`.
- **Press feedback**: rows and chips scale to .98 on `pointerdown` (not just `:active`, so it survives scroll-cancel on iOS); 100 ms ease-out.
- **Toasts** fade out 140 ms. **Spinner** stays.
- Reduced motion: the global 1 ms rule stays; springs and sheet drags check `matchMedia`.

---

## 9. Visual findings from the screenshot review

Reviewed at 390x844, light and dark (`design/audit/screenshots/`). The visual system is strong and stays: the sky, the sun arc with one lit segment per entry, Fraunces numerals, glass chrome, amber-not-red. These are the things the screenshots showed that the code alone did not.

| # | Finding | Decision |
|---|---|---|
| V1 | **The log is below the fold.** On Today the day line (what you actually ate) starts at ~y=1480 of 1688 because five same-weight pill cards sit between the hero and it: Search foods, Log manually, meal prep, This week, macros. The user's own record is the least visible thing on the screen. (`035-today-1300-viewport`) | Remove the **Search foods** and **Log manually** rows from Today; both live in the Log sheet (section 4). Keep meal prep (one-tap serves), This week and macros. The day line rises ~230 px and is on screen at first paint. |
| V2 | **Week strip mini-arcs are near invisible**: 1 px grey arcs, the "check" ring on a held day is a faint dot, over-target days show a 3 px amber dot. They carry the week's story but cannot be read. (`035`, `110`) | Stroke 2 px; eaten share in `--arc` at full opacity, remainder at 45 % ink; held day = hollow ring 2 px; over = amber dot 5 px. Keep the geometry. |
| V3 | **Week's tide chart is 48 px tall with a static "on pace" label** that says "on pace" even when the week is behind; the deltas row beneath it (+97 +90 −486 Check +41 710 left) carries all the information. (`054-week-current`) | Remove the tide chart. The headline, working line and answer sentence (6.2) replace it. |
| V4 | **Week has ~300 px of empty space under the platter**, while the useful stats (counted days, average, left in budget, protein average) are hidden in the details sheet. (`054`, `116`) | Add a compact two-column stats block under the platter: Weekly budget · Left in budget (counting today's unspent) · Counted days · Average on counted days · Average protein. The details sheet keeps the day table. |
| V5 | **The "Log with AI" chooser is a menu, and the Estimate sheet is a form**: hint paragraph, field label, 260 px textarea, dashed photo drop-zone, a "Tips" disclosure, then two stacked buttons. Four blocks before the primary action. (`217`, `153`) | Section 4.1: one composer block (textarea that grows, Photo chip, Estimate button on one row). Tips move into the textarea placeholder and a single "Tips" link in the footer. |
| V6 | **The review sheet is good.** Name, basis toggles, big number, macros, servings with "1 bowl", the estimate card with confidence, assumptions and Refine, and the amber "After this: 10 Cal over today" line read clearly. (`158`, `159`) | Keep the layout. Only change the primary action (tap, not swipe), the estimate header line, and the attached photo (4.5). |
| V7 | **Meal chips wrap to two rows with "Drink" orphaned** in every entry sheet. (`138`, `159`) | Make the chip row a single horizontally scrolling line (44 px chips, 10 px gap) with the selected chip scrolled into view. |
| V8 | **Menu pick is text-heavy**: a three-line intro, a three-line photo tip, a long "What gets sent" block. (`172`) | Suggest mode (section 5): one-line placeholder, chips, the budget line, Photo chip. "What gets sent" stays as a collapsed disclosure. The result card (`177`) is good; reuse it. |
| V9 | **Foods rows truncate** both the name ("Greek yoghurt, ber…") and the meta ("logged 9× ·…") because the heart, "+" disc and "…" eat 150 px. (`077`) | Names wrap to two lines; meta shows only "logged 9×" (drop "per serving ·"); "…" becomes 44 px and sits closer to "+". |
| V10 | **Settings is one long column** with the Gemini card fifth, below Backup. In an AI-first app the key and the About-you text should be near the top. (`195`) | Order: Goals · Gemini · About you, for AI · Weekly banking · Display · Backup · AI estimate helper · Food estimates · Custom food databases · App. |
| V11 | **Protein copy**: "19g past goal" on an over-target day reads as a problem; over on protein is good when cutting. (`110`) | "goal met · +19g". |
| V12 | **Dark mode is excellent** (`036-…-dark`): the night sky, the gold arc and the cream numerals. Nothing to change. | Keep; every new element must be checked in dark. |
| V13 | **Error states** are a red paragraph inside the sheet with the same primary button; nothing is announced. (`167`) | `role="alert"`, and the primary button reads **Try again**; the timeout error offers **Type it in**. |

---

## 10. Accessibility and polish (one chunk)

- `Modal`: on open, move focus to the panel (or the first input in manual mode as now); trap Tab/Shift+Tab inside; on close return focus to the element that opened it; set `inert` on `main` and the tab bar while any sheet or the search overlay is open.
- `index.html`: remove `maximum-scale=1, user-scalable=no`. Inputs are already 16 px so iOS will not auto-zoom.
- Minimum text size 11 px: tab labels, nutrition grid labels, compact picker chips.
- Targets ≥ 44 px: Foods "+" and "…", `.text-btn`, status-card actions, Now chips (44), unit-toggle chips, toast action, prep-again buttons, photo remove (hit area via padding), `.link-btn` (min-height 44 with negative margin so layout is unchanged).
- Day-target range slider: `aria-label="Calorie target for this day"`.
- Inline error paragraphs: `role="alert"`.
- Light-mode amber `--color-review` → `#8C6520` (≥ 4.6:1 on white); check it still reads as amber on the sky.
- Update sheet: show the **newest** five notes.
- Foods "Manage food" and Settings Goals: keep the typed string while editing, parse on blur/save (fixes "1.5").
- Delete entry: soft delete with Undo toast (5 s), no `confirm()`.
- Brand: page title "Dawni", backup title "Dawni backup", share file names `dawni-…`; README updated to the current stack and the AI-first flow.
- Meal chip rows scroll horizontally on one line (V7). Foods rows: two-line names, shorter meta, 44 px "…" (V9). Settings card order per V10.
- Dead CSS: remove a selector only if `grep` over `src/` finds no use of the class; otherwise leave it.

---

## 11. Build plan (branch `claude/ai-first-redesign`)

Each chunk ends with `npm test` and `npm run build` green and one commit. Chunks 1 and 2 run in parallel in separate worktrees after chunk 0; 3 and 4 in parallel after 1 and 2 are merged; 5 last.

| # | Chunk | Model | Files |
|---|---|---|---|
| 0 | **Split `App.tsx`** into files with zero behaviour change: `src/views/{Today,Week,Journal,Library,Settings}View.tsx`, `src/sheets/{EntryModal,GeminiEstimateModal,MenuPickModal,BatchSheet,FoodSearch,DayStatusCard,RoughMeal,DayTarget}.tsx`, `src/ui/{Modal,icons,AppShell,toast}.tsx`, shared helpers `src/ui/format.ts` (fmt, energyText, signed helpers). `App.tsx` keeps state, `updateState`, modal routing and the AI handlers. Pure moves; exports named; no renames except file-level. | Sonnet | all of `src/` |
| 1 | **Log sheet + estimate flow** (sections 3, 4): `src/sheets/LogSheet.tsx` (new), `EntryModal` (tap-to-save, estimate header, attach photo), `geminiEstimate.ts` (timeout, abort), `App.tsx` (background request state, pill, toasts, Undo on log/delete, settings return tab, sparkle no tab switch), delete `SwipeConfirm` and `geminiSetup`, first-run card on Today, styles. | Opus | as listed |
| 2 | **Week model + screens** (section 6): `src/weekView.ts` + `tests/weekView.test.mjs`, `WeekView.tsx`, `WeekDetails`, Today's week row, Target button copy. | Opus | as listed |
| 3 | **Suggest** (section 5): `src/suggest.ts` (from `menuPick.ts`, keep the old module's tests passing or port them), Suggest mode in `LogSheet`, result card reuse, prompt + context, chip on the Now line, rename everywhere. | Sonnet | as listed |
| 4 | **Motion** (section 8): `src/motion.ts`, hero + macros in `TodayView`, tiles CSS, `Modal` curves and velocity, press feedback. | Sonnet | as listed |
| 5 | **Polish + release** (section 10): a11y, targets, text sizes, update sheet order, decimal inputs, brand strings, README; version **3.0.0.0** in `package.json`, `src/version.ts`, `public/version.json`, `index.html`; prepend 3.0.0.0 notes to `src/release-notes.json` (one note per user-visible change, in the app's existing voice); update `Calories_Tracker_Product_Design_Document.txt` per section 12. | Sonnet | as listed |
| 6 | **Verify**: re-run `design/audit/capture.mjs` (dev server up, mocked Gemini) and review every screenshot against sections 4–9; fix regressions; then PR, CI, merge. | Fable + agents | — |

**Rules for every build agent**
- Read this file and `design/audit/OBSERVATIONS.md` first; read the code you touch in full before editing.
- Do not touch `design/audit/*` except to fix a selector the capture script needs after a rename (then say so).
- No new runtime dependencies. No `any`. `tsc` strict stays on.
- Keep every existing test green; add tests for every pure module you create or change.
- Keep the Tidelight tokens and the house easing; do not restyle screens outside your chunk.
- Copy: calm, Australian English, no guilt words, "Cal" with a capital C, numbers via the shared formatter.
- Before you finish: `npm test`, `npm run build`, then start the dev server and drive your flow once with the mocked Gemini in `design/audit/mock-gemini.mjs` (a short Playwright script in the scratchpad is fine) and report what you saw, including anything you could not verify.

---

## 12. PDD update (chunk 5 edits `Calories_Tracker_Product_Design_Document.txt`)

Bump to document version 0.2, dated today. Keep sections 1–5 largely intact but revise these statements:
- Executive summary: the core differentiator is still weekly flexibility, **and** the default way to log is to describe or photograph food and let the user's own Gemini key estimate it. The app is "AI-first, not AI-dependent": every AI path has a manual equivalent one tap away, estimates are labelled and editable, and the key is bring-your-own so there is no hosted AI cost.
- 2.2 identity table: replace "A flashy AI-first novelty" with "An AI that hides its guesses"; add "A transparent estimator that shows its assumptions".
- 6 Core user loop: step 2 becomes "Describe or photograph food; review the estimate; log it. Or pick a usual, search, or type it in." Add step "Ask what to eat when there is room left."
- 7 Feature pillars: Track includes the estimate flow; Plan includes Suggest; Protect adds "the API key stays on the device and is included in backups".
- 9 Current app audit: AI Quick Log → "Keep as fallback"; add rows for Estimate (Keep, primary), Suggest (Keep), Meal prep (Keep), Week view model (Rebuilt, today included).
- 10 Risks: keep the data-source rule; add "AI estimates are never sold as accurate; confidence and assumptions are shown; the user edits before saving."
- 15 Implementation guidance: replace the "Do not add AI" instruction with "AI logging is the default path; keep a manual path beside every AI path; never lock a sheet on a network call."
- 13 Roadmap "Now": "3.0 AI-first logging, Week model rebuilt, motion."
Leave Free/Pro sections as they are (nothing is paywalled in code).
