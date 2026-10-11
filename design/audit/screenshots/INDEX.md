> **Trimmed for the 3.0 merge.** The full capture was 445 images (37 MB). This folder keeps 40 "before" references used by `design/REDESIGN.md` (light and dark). The index below lists the full run; regenerate any shot with `node design/audit/capture.mjs` (see its header) against a 2.8.2.0 build.

# Dawni screenshot index

Captured 2026-10-10 from branch claude/ai-first-redesign (app version in package.json) by `node design/audit/capture.mjs`.
Viewport 390x844 CSS px at 2x (780x1688 px images), iPhone Safari user agent, touch, locale en-AU, time zone Australia/Melbourne. "Today" is 2026-10-10; the browser clock is fixed to the time shown in the Clock column, on that date (the mid-week rows use 2026-10-07).
Gemini is mocked (no real key, no network): the key is the dummy `AIza-mock-key-for-screenshots`.

File names are `NN-screen-state-theme.png`. NN is shared by the light and dark version of the same shot. A state ending `-viewport` is the first screen; `-full` is the same page captured full height (the floating tab bar stays at the bottom of the first screen in full-page captures). A state ending `-scrolled` is a sheet scrolled to its end.

| File | Screen | State | Theme | Clock | What it shows |
| --- | --- | --- | --- | --- | --- |
| 001-today-first-run-viewport-light.png | today | first-run-viewport | light | 08:30 | First run: Today with nothing logged. |
| 001-today-first-run-viewport-dark.png | today | first-run-viewport | dark | 08:30 | First run: Today with nothing logged. |
| 002-today-first-run-full-light.png | today | first-run-full | light | 08:30 | First run: Today with nothing logged. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 002-today-first-run-full-dark.png | today | first-run-full | dark | 08:30 | First run: Today with nothing logged. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 003-search-first-run-browsing-light.png | search | first-run-browsing | light | 08:30 | Search foods with nothing saved yet: empty state copy. |
| 003-search-first-run-browsing-dark.png | search | first-run-browsing | dark | 08:30 | Search foods with nothing saved yet: empty state copy. |
| 004-search-first-run-typed-light.png | search | first-run-typed | light | 08:30 | Search "greek yog": food database results and "Log it yourself" row. No saved foods yet. |
| 004-search-first-run-typed-dark.png | search | first-run-typed | dark | 08:30 | Search "greek yog": food database results and "Log it yourself" row. No saved foods yet. |
| 005-search-first-run-no-match-light.png | search | first-run-no-match | light | 08:30 | Search with no match: "No matches" and the Log yourself row. |
| 005-search-first-run-no-match-dark.png | search | first-run-no-match | dark | 08:30 | Search with no match: "No matches" and the Log yourself row. |
| 006-log-manually-empty-light.png | log-manually | empty | light | 08:30 | Log manually, a new entry: calories first, meal chips, saved food picker, rough meal link, swipe to log. |
| 006-log-manually-empty-dark.png | log-manually | empty | dark | 08:30 | Log manually, a new entry: calories first, meal chips, saved food picker, rough meal link, swipe to log. |
| 007-log-manually-empty-scrolled-light.png | log-manually | empty-scrolled | light | 08:30 | Log manually, a new entry: calories first, meal chips, saved food picker, rough meal link, swipe to log. Scrolled to the end of the sheet. |
| 007-log-manually-empty-scrolled-dark.png | log-manually | empty-scrolled | dark | 08:30 | Log manually, a new entry: calories first, meal chips, saved food picker, rough meal link, swipe to log. Scrolled to the end of the sheet. |
| 008-log-manually-filled-light.png | log-manually | filled | light | 08:30 | Log manually filled in: name, 120 Cal, macros, 2 servings. Shows the logged total and what the day has left. |
| 008-log-manually-filled-dark.png | log-manually | filled | dark | 08:30 | Log manually filled in: name, 120 Cal, macros, 2 servings. Shows the logged total and what the day has left. |
| 009-log-manually-filled-scrolled-light.png | log-manually | filled-scrolled | light | 08:30 | Log manually filled in: name, 120 Cal, macros, 2 servings. Shows the logged total and what the day has left. Scrolled to the end of the sheet. |
| 009-log-manually-filled-scrolled-dark.png | log-manually | filled-scrolled | dark | 08:30 | Log manually filled in: name, 120 Cal, macros, 2 servings. Shows the logged total and what the day has left. Scrolled to the end of the sheet. |
| 010-log-with-ai-chooser-no-key-light.png | log-with-ai | chooser-no-key | light | 08:30 | The sparkle opens Log with AI: Estimate with Gemini, Meal prep a batch, Help me pick from a menu, plus Copy prompt and Paste estimate for other chatbots. No key yet, so the Gemini rows will lead to setup. |
| 010-log-with-ai-chooser-no-key-dark.png | log-with-ai | chooser-no-key | dark | 08:30 | The sparkle opens Log with AI: Estimate with Gemini, Meal prep a batch, Help me pick from a menu, plus Copy prompt and Paste estimate for other chatbots. No key yet, so the Gemini rows will lead to setup. |
| 011-gemini-setup-no-key-light.png | gemini-setup | no-key | light | 08:30 | Set up Gemini: what tapping Estimate with Gemini does with no key. Steps, the no-key chatbot alternative, Open Gemini settings. |
| 011-gemini-setup-no-key-dark.png | gemini-setup | no-key | dark | 08:30 | Set up Gemini: what tapping Estimate with Gemini does with no key. Steps, the no-key chatbot alternative, Open Gemini settings. |
| 012-settings-gemini-key-edit-viewport-light.png | settings | gemini-key-edit-viewport | light | 08:30 | Open Gemini settings lands on Settings with the Gemini key field open for pasting. |
| 012-settings-gemini-key-edit-viewport-dark.png | settings | gemini-key-edit-viewport | dark | 08:30 | Open Gemini settings lands on Settings with the Gemini key field open for pasting. |
| 013-gemini-api-key-help-sheet-light.png | gemini-api-key-help | sheet | light | 08:30 | The ? on the Gemini card: how to get a key, free tier versus paid, privacy. |
| 013-gemini-api-key-help-sheet-dark.png | gemini-api-key-help | sheet | dark | 08:30 | The ? on the Gemini card: how to get a key, free tier versus paid, privacy. |
| 014-settings-no-key-viewport-light.png | settings | no-key-viewport | light | 08:30 | Settings with no key (the Gemini field is still open for pasting after Open Gemini settings): Goals, Weekly banking, Display, Backup, Gemini, About you for AI, AI estimate helper, Food estimates, Custom food databases, App. |
| 014-settings-no-key-viewport-dark.png | settings | no-key-viewport | dark | 08:30 | Settings with no key (the Gemini field is still open for pasting after Open Gemini settings): Goals, Weekly banking, Display, Backup, Gemini, About you for AI, AI estimate helper, Food estimates, Custom food databases, App. |
| 015-settings-no-key-full-light.png | settings | no-key-full | light | 08:30 | Settings with no key (the Gemini field is still open for pasting after Open Gemini settings): Goals, Weekly banking, Display, Backup, Gemini, About you for AI, AI estimate helper, Food estimates, Custom food databases, App. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 015-settings-no-key-full-dark.png | settings | no-key-full | dark | 08:30 | Settings with no key (the Gemini field is still open for pasting after Open Gemini settings): Goals, Weekly banking, Display, Backup, Gemini, About you for AI, AI estimate helper, Food estimates, Custom food databases, App. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 016-ai-estimate-helper-how-to-sheet-light.png | ai-estimate-helper-how-to | sheet | light | 08:30 | The ? on AI estimate helper: six steps for using any chatbot. |
| 016-ai-estimate-helper-how-to-sheet-dark.png | ai-estimate-helper-how-to | sheet | dark | 08:30 | The ? on AI estimate helper: six steps for using any chatbot. |
| 017-custom-food-database-help-sheet-light.png | custom-food-database-help | sheet | light | 08:30 | The ? on Custom food databases: JSON format example. |
| 017-custom-food-database-help-sheet-dark.png | custom-food-database-help | sheet | dark | 08:30 | The ? on Custom food databases: JSON format example. |
| 018-meal-prep-sheet-describe-no-key-light.png | meal-prep-sheet | describe-no-key | light | 08:30 | Meal prep a batch with no Gemini key: the Estimate button becomes "Set up Gemini to estimate". |
| 018-meal-prep-sheet-describe-no-key-dark.png | meal-prep-sheet | describe-no-key | dark | 08:30 | Meal prep a batch with no Gemini key: the Estimate button becomes "Set up Gemini to estimate". |
| 019-gemini-setup-from-menu-pick-light.png | gemini-setup | from-menu-pick | light | 08:30 | Help me pick from a menu with no key leads to the same Set up Gemini sheet. |
| 019-gemini-setup-from-menu-pick-dark.png | gemini-setup | from-menu-pick | dark | 08:30 | Help me pick from a menu with no key leads to the same Set up Gemini sheet. |
| 020-toast-prompt-copied-light.png | toast | prompt-copied | light | 08:30 | Toast "Prompt copied" after Copy prompt (over the Log with AI sheet). |
| 020-toast-prompt-copied-dark.png | toast | prompt-copied | dark | 08:30 | Toast "Prompt copied" after Copy prompt (over the Log with AI sheet). |
| 021-toast-clipboard-empty-light.png | toast | clipboard-empty | light | 08:30 | Paste estimate with an empty clipboard: a toast, and the sheet stays open. |
| 021-toast-clipboard-empty-dark.png | toast | clipboard-empty | dark | 08:30 | Paste estimate with an empty clipboard: a toast, and the sheet stays open. |
| 022-ai-estimate-helper-unreadable-paste-light.png | ai-estimate-helper | unreadable-paste | light | 08:30 | Paste estimate with text the app cannot parse: the AI estimate helper sheet opens with the pasted text and an error line. |
| 022-ai-estimate-helper-unreadable-paste-dark.png | ai-estimate-helper | unreadable-paste | dark | 08:30 | Paste estimate with text the app cannot parse: the AI estimate helper sheet opens with the pasted text and an error line. |
| 023-log-food-review-pasted-chatbot-estimate-light.png | log-food-review | pasted-chatbot-estimate | light | 08:30 | A valid chatbot estimate pasted: the log sheet opens already filled in, tagged Estimated, ready to review. |
| 023-log-food-review-pasted-chatbot-estimate-dark.png | log-food-review | pasted-chatbot-estimate | dark | 08:30 | A valid chatbot estimate pasted: the log sheet opens already filled in, tagged Estimated, ready to review. |
| 024-log-food-review-pasted-chatbot-estimate-scrolled-light.png | log-food-review | pasted-chatbot-estimate-scrolled | light | 08:30 | A valid chatbot estimate pasted: the log sheet opens already filled in, tagged Estimated, ready to review. Scrolled to the end of the sheet. |
| 024-log-food-review-pasted-chatbot-estimate-scrolled-dark.png | log-food-review | pasted-chatbot-estimate-scrolled | dark | 08:30 | A valid chatbot estimate pasted: the log sheet opens already filled in, tagged Estimated, ready to review. Scrolled to the end of the sheet. |
| 025-week-first-run-viewport-light.png | week | first-run-viewport | light | 08:30 | Week with nothing logged. |
| 025-week-first-run-viewport-dark.png | week | first-run-viewport | dark | 08:30 | Week with nothing logged. |
| 026-journal-month-first-run-viewport-light.png | journal | month-first-run-viewport | light | 08:30 | Journal month calendar with no photos. |
| 026-journal-month-first-run-viewport-dark.png | journal | month-first-run-viewport | dark | 08:30 | Journal month calendar with no photos. |
| 027-journal-day-empty-viewport-light.png | journal | day-empty-viewport | light | 08:30 | Journal day with nothing logged. |
| 027-journal-day-empty-viewport-dark.png | journal | day-empty-viewport | dark | 08:30 | Journal day with nothing logged. |
| 028-foods-recent-empty-viewport-light.png | foods | recent-empty-viewport | light | 08:30 | Foods, Recent: empty. |
| 028-foods-recent-empty-viewport-dark.png | foods | recent-empty-viewport | dark | 08:30 | Foods, Recent: empty. |
| 029-foods-favourites-empty-light.png | foods | favourites-empty | light | 08:30 | Foods, Favourites: empty state. |
| 029-foods-favourites-empty-dark.png | foods | favourites-empty | dark | 08:30 | Foods, Favourites: empty state. |
| 030-foods-meal-prep-empty-light.png | foods | meal-prep-empty | light | 08:30 | Foods, Meal prep: empty state with New batch. |
| 030-foods-meal-prep-empty-dark.png | foods | meal-prep-empty | dark | 08:30 | Foods, Meal prep: empty state with New batch. |
| 031-today-0730-viewport-light.png | today | 0730-viewport | light | 07:30 | Today at 07:30. Breakfast and a flat white logged; lunch usuals sit on the Now line. |
| 031-today-0730-viewport-dark.png | today | 0730-viewport | dark | 07:30 | Today at 07:30. Breakfast and a flat white logged; lunch usuals sit on the Now line. |
| 032-today-0730-full-light.png | today | 0730-full | light | 07:30 | Today at 07:30. Breakfast and a flat white logged; lunch usuals sit on the Now line. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 032-today-0730-full-dark.png | today | 0730-full | dark | 07:30 | Today at 07:30. Breakfast and a flat white logged; lunch usuals sit on the Now line. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 033-today-0730-scrolled-to-day-line-light.png | today | 0730-scrolled-to-day-line | light | 07:30 | Today at 07:30 scrolled to the day line: the floating tab bar sits over the content. |
| 033-today-0730-scrolled-to-day-line-dark.png | today | 0730-scrolled-to-day-line | dark | 07:30 | Today at 07:30 scrolled to the day line: the floating tab bar sits over the content. |
| 034-today-0730-macros-eaten-light.png | today | 0730-macros-eaten | light | 07:30 | Tapping the macros toggles left/to go versus eaten (07:30). |
| 034-today-0730-macros-eaten-dark.png | today | 0730-macros-eaten | dark | 07:30 | Tapping the macros toggles left/to go versus eaten (07:30). |
| 035-today-1300-viewport-light.png | today | 1300-viewport | light | 13:00 | Today at 13:00. Breakfast and lunch logged, dinner usuals on the Now line. |
| 035-today-1300-viewport-dark.png | today | 1300-viewport | dark | 13:00 | Today at 13:00. Breakfast and lunch logged, dinner usuals on the Now line. |
| 036-today-1300-full-light.png | today | 1300-full | light | 13:00 | Today at 13:00. Breakfast and lunch logged, dinner usuals on the Now line. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 036-today-1300-full-dark.png | today | 1300-full | dark | 13:00 | Today at 13:00. Breakfast and lunch logged, dinner usuals on the Now line. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 037-today-1300-scrolled-to-day-line-light.png | today | 1300-scrolled-to-day-line | light | 13:00 | Today at 13:00 scrolled to the day line: the floating tab bar sits over the content. |
| 037-today-1300-scrolled-to-day-line-dark.png | today | 1300-scrolled-to-day-line | dark | 13:00 | Today at 13:00 scrolled to the day line: the floating tab bar sits over the content. |
| 038-today-1300-macros-eaten-light.png | today | 1300-macros-eaten | light | 13:00 | Tapping the macros toggles left/to go versus eaten (13:00). |
| 038-today-1300-macros-eaten-dark.png | today | 1300-macros-eaten | dark | 13:00 | Tapping the macros toggles left/to go versus eaten (13:00). |
| 039-today-past-completed-viewport-light.png | today | past-completed-viewport | light | 13:00 | Yesterday: a completed day, counted into the week. Hero says how it ended (Cal under). |
| 039-today-past-completed-viewport-dark.png | today | past-completed-viewport | dark | 13:00 | Yesterday: a completed day, counted into the week. Hero says how it ended (Cal under). |
| 040-today-past-completed-full-light.png | today | past-completed-full | light | 13:00 | Yesterday: a completed day, counted into the week. Hero says how it ended (Cal under). Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 040-today-past-completed-full-dark.png | today | past-completed-full | dark | 13:00 | Yesterday: a completed day, counted into the week. Hero says how it ended (Cal under). Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 041-today-past-over-target-viewport-light.png | today | past-over-target-viewport | light | 13:00 | A past day over target: the hero says Cal over, the sun sits at the end of the arc with a glow, a pub dinner and a beer. |
| 041-today-past-over-target-viewport-dark.png | today | past-over-target-viewport | dark | 13:00 | A past day over target: the hero says Cal over, the sun sits at the end of the arc with a glow, a pub dinner and a beer. |
| 042-today-past-over-target-full-light.png | today | past-over-target-full | light | 13:00 | A past day over target: the hero says Cal over, the sun sits at the end of the arc with a glow, a pub dinner and a beer. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 042-today-past-over-target-full-dark.png | today | past-over-target-full | dark | 13:00 | A past day over target: the hero says Cal over, the sun sits at the end of the arc with a glow, a pub dinner and a beer. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 043-today-past-looks-light-viewport-light.png | today | past-looks-light-viewport | light | 13:00 | A past day that looks light (only a coffee and a meal prep serve logged): held at target until checked. |
| 043-today-past-looks-light-viewport-dark.png | today | past-looks-light-viewport | dark | 13:00 | A past day that looks light (only a coffee and a meal prep serve logged): held at target until checked. |
| 044-today-past-looks-light-full-light.png | today | past-looks-light-full | light | 13:00 | A past day that looks light (only a coffee and a meal prep serve logged): held at target until checked. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 044-today-past-looks-light-full-dark.png | today | past-looks-light-full | dark | 13:00 | A past day that looks light (only a coffee and a meal prep serve logged): held at target until checked. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 045-today-past-looks-light-rough-picker-light.png | today | past-looks-light-rough-picker | light | 13:00 | Rough guess picker on a light day. |
| 045-today-past-looks-light-rough-picker-dark.png | today | past-looks-light-rough-picker | dark | 13:00 | Rough guess picker on a light day. |
| 046-rough-meal-sheet-light.png | rough-meal | sheet | light | 13:00 | Add a rough meal: meal chips, four sizes with example foods and Cal, or type a number. |
| 046-rough-meal-sheet-dark.png | rough-meal | sheet | dark | 13:00 | Add a rough meal: meal chips, four sizes with example foods and Cal, or type a number. |
| 047-today-upcoming-day-viewport-light.png | today | upcoming-day-viewport | light | 13:00 | A day that has not started: "This day hasn't started yet" and Coming up. |
| 047-today-upcoming-day-viewport-dark.png | today | upcoming-day-viewport | dark | 13:00 | A day that has not started: "This day hasn't started yet" and Coming up. |
| 048-today-upcoming-day-full-light.png | today | upcoming-day-full | light | 13:00 | A day that has not started: "This day hasn't started yet" and Coming up. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 048-today-upcoming-day-full-dark.png | today | upcoming-day-full | dark | 13:00 | A day that has not started: "This day hasn't started yet" and Coming up. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 049-today-week-strip-mid-swipe-light.png | today | week-strip-mid-swipe | light | 13:00 | Dragging the week strip sideways: it follows the finger and fades. |
| 049-today-week-strip-mid-swipe-dark.png | today | week-strip-mid-swipe | dark | 13:00 | Dragging the week strip sideways: it follows the finger and fades. |
| 050-today-previous-week-estimated-day-light.png | today | previous-week-estimated-day | light | 13:00 | After swiping the strip back one week the same weekday is selected: a day with a rough guess ("Rough guess: a bit over"). |
| 050-today-previous-week-estimated-day-dark.png | today | previous-week-estimated-day | dark | 13:00 | After swiping the strip back one week the same weekday is selected: a day with a rough guess ("Rough guess: a bit over"). |
| 051-today-untracked-day-viewport-light.png | today | untracked-day-viewport | light | 13:00 | A day with nothing logged: counts as on target; offers rough guesses and Add a rough meal. |
| 051-today-untracked-day-viewport-dark.png | today | untracked-day-viewport | dark | 13:00 | A day with nothing logged: counts as on target; offers rough guesses and Add a rough meal. |
| 052-today-untracked-day-full-light.png | today | untracked-day-full | light | 13:00 | A day with nothing logged: counts as on target; offers rough guesses and Add a rough meal. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 052-today-untracked-day-full-dark.png | today | untracked-day-full | dark | 13:00 | A day with nothing logged: counts as on target; offers rough guesses and Add a rough meal. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 053-today-rough-meal-day-light.png | today | rough-meal-day | light | 13:00 | A day with a rough dinner entry ("Dinner (big)", rough guess, about 1,200 Cal): rough rows show a tilde and "Rough guess". |
| 053-today-rough-meal-day-dark.png | today | rough-meal-day | dark | 13:00 | A day with a rough dinner entry ("Dinner (big)", rough guess, about 1,200 Cal): rough rows show a tilde and "Rough guess". |
| 054-week-current-viewport-light.png | week | current-viewport | light | 13:00 | Week: seven skies filled to each day's target, running balance line, plain answer for the days left, week bank headline. |
| 054-week-current-viewport-dark.png | week | current-viewport | dark | 13:00 | Week: seven skies filled to each day's target, running balance line, plain answer for the days left, week bank headline. |
| 055-week-details-sheet-light.png | week-details | sheet | light | 13:00 | Week details sheet: the bank as a table, budget, counted days, averages, and "How the week bank works". |
| 055-week-details-sheet-dark.png | week-details | sheet | dark | 13:00 | Week details sheet: the bank as a table, budget, counted days, averages, and "How the week bank works". |
| 056-week-details-sheet-scrolled-light.png | week-details | sheet-scrolled | light | 13:00 | Week details sheet: the bank as a table, budget, counted days, averages, and "How the week bank works". Scrolled to the end of the sheet. |
| 056-week-details-sheet-scrolled-dark.png | week-details | sheet-scrolled | dark | 13:00 | Week details sheet: the bank as a table, budget, counted days, averages, and "How the week bank works". Scrolled to the end of the sheet. |
| 057-week-previous-week-viewport-light.png | week | previous-week-viewport | light | 13:00 | Previous week: includes a day with nothing logged, a rough guess and a rough meal day. |
| 057-week-previous-week-viewport-dark.png | week | previous-week-viewport | dark | 13:00 | Previous week: includes a day with nothing logged, a rough guess and a rough meal day. |
| 058-week-next-week-disabled-light.png | week | next-week-disabled | light | 13:00 | Week back on the current week: the Next week arrow is disabled. |
| 058-week-next-week-disabled-dark.png | week | next-week-disabled | dark | 13:00 | Week back on the current week: the Next week arrow is disabled. |
| 059-today-opened-from-week-tile-light.png | today | opened-from-week-tile | light | 13:00 | Tapping a day tile on Week opens that day on Today (a looks-light day). |
| 059-today-opened-from-week-tile-dark.png | today | opened-from-week-tile | dark | 13:00 | Tapping a day tile on Week opens that day on Today (a looks-light day). |
| 060-journal-month-viewport-light.png | journal | month-viewport | light | 13:00 | Journal month: photo days show up to four thumbnails; other days are plain numbers. |
| 060-journal-month-viewport-dark.png | journal | month-viewport | dark | 13:00 | Journal month: photo days show up to four thumbnails; other days are plain numbers. |
| 061-journal-previous-month-light.png | journal | previous-month | light | 13:00 | Journal, previous month: days with no photos look empty. |
| 061-journal-previous-month-dark.png | journal | previous-month | dark | 13:00 | Journal, previous month: days with no photos look empty. |
| 062-journal-day-collage-calories-viewport-light.png | journal | day-collage-calories-viewport | light | 13:00 | Journal day, Collage view, label mode Calories: two photos, meal cards, totals bar. |
| 062-journal-day-collage-calories-viewport-dark.png | journal | day-collage-calories-viewport | dark | 13:00 | Journal day, Collage view, label mode Calories: two photos, meal cards, totals bar. |
| 063-journal-day-collage-calories-full-light.png | journal | day-collage-calories-full | light | 13:00 | Journal day, Collage view, label mode Calories: two photos, meal cards, totals bar. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 063-journal-day-collage-calories-full-dark.png | journal | day-collage-calories-full | dark | 13:00 | Journal day, Collage view, label mode Calories: two photos, meal cards, totals bar. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 064-journal-day-collage-name-and-cal-light.png | journal | day-collage-name-and-cal | light | 13:00 | Journal day, Collage, label mode Name + Cal. |
| 064-journal-day-collage-name-and-cal-dark.png | journal | day-collage-name-and-cal | dark | 13:00 | Journal day, Collage, label mode Name + Cal. |
| 065-journal-day-collage-photo-only-light.png | journal | day-collage-photo-only | light | 13:00 | Journal day, Collage, label mode Photo (no captions). |
| 065-journal-day-collage-photo-only-dark.png | journal | day-collage-photo-only | dark | 13:00 | Journal day, Collage, label mode Photo (no captions). |
| 066-journal-day-collage-shuffled-light.png | journal | day-collage-shuffled | light | 13:00 | Journal day, Collage after Shuffle. |
| 066-journal-day-collage-shuffled-dark.png | journal | day-collage-shuffled | dark | 13:00 | Journal day, Collage after Shuffle. |
| 067-journal-day-list-photo-only-viewport-light.png | journal | day-list-photo-only-viewport | light | 13:00 | Journal day, List view, label mode Photo. |
| 067-journal-day-list-photo-only-viewport-dark.png | journal | day-list-photo-only-viewport | dark | 13:00 | Journal day, List view, label mode Photo. |
| 068-journal-day-list-photo-only-full-light.png | journal | day-list-photo-only-full | light | 13:00 | Journal day, List view, label mode Photo. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 068-journal-day-list-photo-only-full-dark.png | journal | day-list-photo-only-full | dark | 13:00 | Journal day, List view, label mode Photo. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 069-journal-day-list-calories-light.png | journal | day-list-calories | light | 13:00 | Journal day, List view, label mode Calories. |
| 069-journal-day-list-calories-dark.png | journal | day-list-calories | dark | 13:00 | Journal day, List view, label mode Calories. |
| 070-journal-day-list-name-and-cal-light.png | journal | day-list-name-and-cal | light | 13:00 | Journal day, List view, label mode Name + Cal. |
| 070-journal-day-list-name-and-cal-dark.png | journal | day-list-name-and-cal | dark | 13:00 | Journal day, List view, label mode Name + Cal. |
| 071-photo-lightbox-journal-light.png | photo-lightbox | journal | light | 13:00 | Photo tapped in Journal: the lightbox sheet (just the picture). |
| 071-photo-lightbox-journal-dark.png | photo-lightbox | journal | dark | 13:00 | Photo tapped in Journal: the lightbox sheet (just the picture). |
| 072-journal-day-meal-cards-list-light.png | journal | day-meal-cards-list | light | 13:00 | Journal day, Meal cards list and "Open this day" button. |
| 072-journal-day-meal-cards-list-dark.png | journal | day-meal-cards-list | dark | 13:00 | Journal day, Meal cards list and "Open this day" button. |
| 073-meal-card-photo-format-light.png | meal-card | photo-format | light | 13:00 | Meal card sheet: share card in photo format (tap the card to switch formats). |
| 073-meal-card-photo-format-dark.png | meal-card | photo-format | dark | 13:00 | Meal card sheet: share card in photo format (tap the card to switch formats). |
| 074-meal-card-summary-format-light.png | meal-card | summary-format | light | 13:00 | Meal card sheet after tapping the card: summary format. |
| 074-meal-card-summary-format-dark.png | meal-card | summary-format | dark | 13:00 | Meal card sheet after tapping the card: summary format. |
| 075-journal-day-two-days-ago-light.png | journal | day-two-days-ago | light | 13:00 | Journal day, the day before (no photos): collage view says "No photos yet". |
| 075-journal-day-two-days-ago-dark.png | journal | day-two-days-ago | dark | 13:00 | Journal day, the day before (no photos): collage view says "No photos yet". |
| 076-journal-day-list-no-photos-light.png | journal | day-list-no-photos | light | 13:00 | Journal day in List view with no photos. |
| 076-journal-day-list-no-photos-dark.png | journal | day-list-no-photos | dark | 13:00 | Journal day in List view with no photos. |
| 077-foods-recent-viewport-light.png | foods | recent-viewport | light | 13:00 | Foods, Recent: saved foods by last use with heart, calories, + to log and a manage button. |
| 077-foods-recent-viewport-dark.png | foods | recent-viewport | dark | 13:00 | Foods, Recent: saved foods by last use with heart, calories, + to log and a manage button. |
| 078-foods-recent-full-light.png | foods | recent-full | light | 13:00 | Foods, Recent: saved foods by last use with heart, calories, + to log and a manage button. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 078-foods-recent-full-dark.png | foods | recent-full | dark | 13:00 | Foods, Recent: saved foods by last use with heart, calories, + to log and a manage button. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 079-foods-favourites-light.png | foods | favourites | light | 13:00 | Foods, Favourites. |
| 079-foods-favourites-dark.png | foods | favourites | dark | 13:00 | Foods, Favourites. |
| 080-foods-search-focused-tab-bar-hidden-light.png | foods | search-focused-tab-bar-hidden | light | 13:00 | Focusing the search field on Foods hides the floating tab bar. |
| 080-foods-search-focused-tab-bar-hidden-dark.png | foods | search-focused-tab-bar-hidden | dark | 13:00 | Focusing the search field on Foods hides the floating tab bar. |
| 081-foods-search-typed-light.png | foods | search-typed | light | 13:00 | Foods search "flat". |
| 081-foods-search-typed-dark.png | foods | search-typed | dark | 13:00 | Foods search "flat". |
| 082-foods-search-no-match-light.png | foods | search-no-match | light | 13:00 | Foods search with no match. |
| 082-foods-search-no-match-dark.png | foods | search-no-match | dark | 13:00 | Foods search with no match. |
| 083-manage-food-sheet-light.png | manage-food | sheet | light | 13:00 | Manage food (edit a saved food): name with heart, calories and macros, per serving or per 100g, Save food and Delete. |
| 083-manage-food-sheet-dark.png | manage-food | sheet | dark | 13:00 | Manage food (edit a saved food): name with heart, calories and macros, per serving or per 100g, Save food and Delete. |
| 084-foods-meal-prep-viewport-light.png | foods | meal-prep-viewport | light | 13:00 | Foods, Meal prep: New batch, the batch on the go (serve pips, serves left, per-serve macros) and Cook again. |
| 084-foods-meal-prep-viewport-dark.png | foods | meal-prep-viewport | dark | 13:00 | Foods, Meal prep: New batch, the batch on the go (serve pips, serves left, per-serve macros) and Cook again. |
| 085-foods-meal-prep-cook-again-open-light.png | foods | meal-prep-cook-again-open | light | 13:00 | Meal prep with the Cook again list open. |
| 085-foods-meal-prep-cook-again-open-dark.png | foods | meal-prep-cook-again-open | dark | 13:00 | Meal prep with the Cook again list open. |
| 086-meal-prep-sheet-edit-batch-light.png | meal-prep-sheet | edit-batch | light | 13:00 | Edit batch: name, status line, per-serve numbers, serves stepper, what went in, Save changes, Finish batch. |
| 086-meal-prep-sheet-edit-batch-dark.png | meal-prep-sheet | edit-batch | dark | 13:00 | Edit batch: name, status line, per-serve numbers, serves stepper, what went in, Save changes, Finish batch. |
| 087-meal-prep-sheet-cook-again-light.png | meal-prep-sheet | cook-again | light | 13:00 | Cook again: a finished batch opened as a new one, with its saved estimate. |
| 087-meal-prep-sheet-cook-again-dark.png | meal-prep-sheet | cook-again | dark | 13:00 | Cook again: a finished batch opened as a new one, with its saved estimate. |
| 088-search-browsing-seeded-light.png | search | browsing-seeded | light | 13:00 | Search foods, browsing: meal prep batch first, favourites, then recent foods. |
| 088-search-browsing-seeded-dark.png | search | browsing-seeded | dark | 13:00 | Search foods, browsing: meal prep batch first, favourites, then recent foods. |
| 089-search-typed-chicken-light.png | search | typed-chicken | light | 13:00 | Search "chicken": saved foods then food database results with source chips, "Show more", Log it yourself. |
| 089-search-typed-chicken-dark.png | search | typed-chicken | dark | 13:00 | Search "chicken": saved foods then food database results with source chips, "Show more", Log it yourself. |
| 090-search-typed-custom-database-light.png | search | typed-custom-database | light | 13:00 | Search "banana bread": a result from the imported custom database (Custom chip). |
| 090-search-typed-custom-database-dark.png | search | typed-custom-database | dark | 13:00 | Search "banana bread": a result from the imported custom database (Custom chip). |
| 091-food-estimate-preview-database-food-light.png | food-estimate-preview | database-food | light | 13:00 | Tapping a database result shows Food estimate: chips, per-serve numbers, Use this food, Add to My Foods. |
| 091-food-estimate-preview-database-food-dark.png | food-estimate-preview | database-food | dark | 13:00 | Tapping a database result shows Food estimate: chips, per-serve numbers, Use this food, Add to My Foods. |
| 092-log-food-review-prefilled-from-search-light.png | log-food-review | prefilled-from-search | light | 13:00 | Choosing a saved food opens the log sheet prefilled (name with heart, numbers, meal). |
| 092-log-food-review-prefilled-from-search-dark.png | log-food-review | prefilled-from-search | dark | 13:00 | Choosing a saved food opens the log sheet prefilled (name with heart, numbers, meal). |
| 093-log-food-review-prefilled-from-search-scrolled-light.png | log-food-review | prefilled-from-search-scrolled | light | 13:00 | Choosing a saved food opens the log sheet prefilled (name with heart, numbers, meal). Scrolled to the end of the sheet. |
| 093-log-food-review-prefilled-from-search-scrolled-dark.png | log-food-review | prefilled-from-search-scrolled | dark | 13:00 | Choosing a saved food opens the log sheet prefilled (name with heart, numbers, meal). Scrolled to the end of the sheet. |
| 094-today-1900-viewport-light.png | today | 1900-viewport | light | 19:00 | Today at 19:00. Breakfast, lunch and afternoon snacks logged; dinner still to come, so the Now line offers dinner usuals. |
| 094-today-1900-viewport-dark.png | today | 1900-viewport | dark | 19:00 | Today at 19:00. Breakfast, lunch and afternoon snacks logged; dinner still to come, so the Now line offers dinner usuals. |
| 095-today-1900-full-light.png | today | 1900-full | light | 19:00 | Today at 19:00. Breakfast, lunch and afternoon snacks logged; dinner still to come, so the Now line offers dinner usuals. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 095-today-1900-full-dark.png | today | 1900-full | dark | 19:00 | Today at 19:00. Breakfast, lunch and afternoon snacks logged; dinner still to come, so the Now line offers dinner usuals. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 096-today-1900-scrolled-to-day-line-light.png | today | 1900-scrolled-to-day-line | light | 19:00 | Today at 19:00 scrolled to the day line: the floating tab bar sits over the content. |
| 096-today-1900-scrolled-to-day-line-dark.png | today | 1900-scrolled-to-day-line | dark | 19:00 | Today at 19:00 scrolled to the day line: the floating tab bar sits over the content. |
| 097-today-1900-macros-eaten-light.png | today | 1900-macros-eaten | light | 19:00 | Tapping the macros toggles left/to go versus eaten (19:00). |
| 097-today-1900-macros-eaten-dark.png | today | 1900-macros-eaten | dark | 19:00 | Tapping the macros toggles left/to go versus eaten (19:00). |
| 098-today-1900-light-viewport-light.png | today | 1900-light-viewport | light | 19:00 | Today at 19:00. Only breakfast logged by the evening: the day looks light. |
| 098-today-1900-light-viewport-dark.png | today | 1900-light-viewport | dark | 19:00 | Today at 19:00. Only breakfast logged by the evening: the day looks light. |
| 099-today-1900-light-full-light.png | today | 1900-light-full | light | 19:00 | Today at 19:00. Only breakfast logged by the evening: the day looks light. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 099-today-1900-light-full-dark.png | today | 1900-light-full | dark | 19:00 | Today at 19:00. Only breakfast logged by the evening: the day looks light. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 100-today-1900-light-scrolled-to-day-line-light.png | today | 1900-light-scrolled-to-day-line | light | 19:00 | Today at 19:00 scrolled to the day line: the floating tab bar sits over the content. |
| 100-today-1900-light-scrolled-to-day-line-dark.png | today | 1900-light-scrolled-to-day-line | dark | 19:00 | Today at 19:00 scrolled to the day line: the floating tab bar sits over the content. |
| 101-today-1900-light-status-card-light.png | today | 1900-light-status-card | light | 19:00 | Day status card in the evening with the day still light: Done for today, Add a rough meal, Rough guess for the day. |
| 101-today-1900-light-status-card-dark.png | today | 1900-light-status-card | dark | 19:00 | Day status card in the evening with the day still light: Done for today, Add a rough meal, Rough guess for the day. |
| 102-today-1900-light-only-logged-prompt-light.png | today | 1900-light-only-logged-prompt | light | 19:00 | Done for today on a light day asks "Only X of Y logged. Is that everything?". |
| 102-today-1900-light-only-logged-prompt-dark.png | today | 1900-light-only-logged-prompt | dark | 19:00 | Done for today on a light day asks "Only X of Y logged. Is that everything?". |
| 103-today-1900-light-rough-day-picker-light.png | today | 1900-light-rough-day-picker | light | 19:00 | Rough guess for the day: three options (about on target, a bit over, big day). |
| 103-today-1900-light-rough-day-picker-dark.png | today | 1900-light-rough-day-picker | dark | 19:00 | Rough guess for the day: three options (about on target, a bit over, big day). |
| 104-today-2300-viewport-light.png | today | 2300-viewport | light | 23:00 | Today at 23:00. Everything logged, just under target; the sun has set on the arc. |
| 104-today-2300-viewport-dark.png | today | 2300-viewport | dark | 23:00 | Today at 23:00. Everything logged, just under target; the sun has set on the arc. |
| 105-today-2300-full-light.png | today | 2300-full | light | 23:00 | Today at 23:00. Everything logged, just under target; the sun has set on the arc. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 105-today-2300-full-dark.png | today | 2300-full | dark | 23:00 | Today at 23:00. Everything logged, just under target; the sun has set on the arc. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 106-today-2300-scrolled-to-day-line-light.png | today | 2300-scrolled-to-day-line | light | 23:00 | Today at 23:00 scrolled to the day line: the floating tab bar sits over the content. |
| 106-today-2300-scrolled-to-day-line-dark.png | today | 2300-scrolled-to-day-line | dark | 23:00 | Today at 23:00 scrolled to the day line: the floating tab bar sits over the content. |
| 107-today-2300-macros-eaten-light.png | today | 2300-macros-eaten | light | 23:00 | Tapping the macros toggles left/to go versus eaten (23:00). |
| 107-today-2300-macros-eaten-dark.png | today | 2300-macros-eaten | dark | 23:00 | Tapping the macros toggles left/to go versus eaten (23:00). |
| 108-toast-2300-counted-light.png | toast | 2300-counted | light | 23:00 | Toast "Counted toward your week" after Done for today. |
| 108-toast-2300-counted-dark.png | toast | 2300-counted | dark | 23:00 | Toast "Counted toward your week" after Done for today. |
| 109-today-2300-done-card-light.png | today | 2300-done-card | light | 23:00 | Day status card after Done for today: "Done for today", result and an Undo link. |
| 109-today-2300-done-card-dark.png | today | 2300-done-card | dark | 23:00 | Day status card after Done for today: "Done for today", result and an Undo link. |
| 110-today-2300-over-viewport-light.png | today | 2300-over-viewport | light | 23:00 | Today at 23:00. A big pub night: over target, with the afterglow instead of red. |
| 110-today-2300-over-viewport-dark.png | today | 2300-over-viewport | dark | 23:00 | Today at 23:00. A big pub night: over target, with the afterglow instead of red. |
| 111-today-2300-over-full-light.png | today | 2300-over-full | light | 23:00 | Today at 23:00. A big pub night: over target, with the afterglow instead of red. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 111-today-2300-over-full-dark.png | today | 2300-over-full | dark | 23:00 | Today at 23:00. A big pub night: over target, with the afterglow instead of red. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 112-today-2300-over-scrolled-to-day-line-light.png | today | 2300-over-scrolled-to-day-line | light | 23:00 | Today at 23:00 scrolled to the day line: the floating tab bar sits over the content. |
| 112-today-2300-over-scrolled-to-day-line-dark.png | today | 2300-over-scrolled-to-day-line | dark | 23:00 | Today at 23:00 scrolled to the day line: the floating tab bar sits over the content. |
| 113-today-2300-over-macros-eaten-light.png | today | 2300-over-macros-eaten | light | 23:00 | Tapping the macros toggles left/to go versus eaten (23:00). |
| 113-today-2300-over-macros-eaten-dark.png | today | 2300-over-macros-eaten | dark | 23:00 | Tapping the macros toggles left/to go versus eaten (23:00). |
| 114-today-midweek-viewport-light.png | today | midweek-viewport | light | 13:00 | Wednesday 13:00 (a mid-week date, so upcoming days exist): week strip with future days, rest-of-week pace. |
| 114-today-midweek-viewport-dark.png | today | midweek-viewport | dark | 13:00 | Wednesday 13:00 (a mid-week date, so upcoming days exist): week strip with future days, rest-of-week pace. |
| 115-today-midweek-full-light.png | today | midweek-full | light | 13:00 | Wednesday 13:00 (a mid-week date, so upcoming days exist): week strip with future days, rest-of-week pace. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 115-today-midweek-full-dark.png | today | midweek-full | dark | 13:00 | Wednesday 13:00 (a mid-week date, so upcoming days exist): week strip with future days, rest-of-week pace. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 116-week-midweek-viewport-light.png | week | midweek-viewport | light | 13:00 | Week on a Wednesday: upcoming days drawn as empty skies, plan for the remaining days. |
| 116-week-midweek-viewport-dark.png | week | midweek-viewport | dark | 13:00 | Week on a Wednesday: upcoming days drawn as empty skies, plan for the remaining days. |
| 117-toast-meal-prep-logged-undo-light.png | toast | meal-prep-logged-undo | light | 13:00 | One tap on the meal prep row logs a serve and shows a toast with Undo ("Logged to lunch · 2 left"). |
| 117-toast-meal-prep-logged-undo-dark.png | toast | meal-prep-logged-undo | dark | 13:00 | One tap on the meal prep row logs a serve and shows a toast with Undo ("Logged to lunch · 2 left"). |
| 118-toast-meal-prep-undone-light.png | toast | meal-prep-undone | light | 13:00 | Toast "Undone" after tapping Undo. |
| 118-toast-meal-prep-undone-dark.png | toast | meal-prep-undone | dark | 13:00 | Toast "Undone" after tapping Undo. |
| 119-today-now-line-closeup-light.png | today | now-line-closeup | light | 13:00 | The Now line: next meal usuals as chips (name and Cal) one tap from logging. |
| 119-today-now-line-closeup-dark.png | today | now-line-closeup | dark | 13:00 | The Now line: next meal usuals as chips (name and Cal) one tap from logging. |
| 120-log-food-review-from-now-line-usual-light.png | log-food-review | from-now-line-usual | light | 13:00 | A usual from the Now line opens the log sheet prefilled with what was logged last time. |
| 120-log-food-review-from-now-line-usual-dark.png | log-food-review | from-now-line-usual | dark | 13:00 | A usual from the Now line opens the log sheet prefilled with what was logged last time. |
| 121-log-food-review-from-now-line-usual-scrolled-light.png | log-food-review | from-now-line-usual-scrolled | light | 13:00 | A usual from the Now line opens the log sheet prefilled with what was logged last time. Scrolled to the end of the sheet. |
| 121-log-food-review-from-now-line-usual-scrolled-dark.png | log-food-review | from-now-line-usual-scrolled | dark | 13:00 | A usual from the Now line opens the log sheet prefilled with what was logged last time. Scrolled to the end of the sheet. |
| 122-entry-menu-long-press-with-photo-light.png | entry-menu | long-press-with-photo | light | 13:00 | Touch and hold on an entry with a photo: Edit, Log again today, View photo, Delete. |
| 122-entry-menu-long-press-with-photo-dark.png | entry-menu | long-press-with-photo | dark | 13:00 | Touch and hold on an entry with a photo: Edit, Log again today, View photo, Delete. |
| 123-photo-lightbox-entry-photo-light.png | photo-lightbox | entry-photo | light | 13:00 | Entry photo sheet from the menu: photo, name and day, Replace, Save / Share PNG, Remove. |
| 123-photo-lightbox-entry-photo-dark.png | photo-lightbox | entry-photo | dark | 13:00 | Entry photo sheet from the menu: photo, name and day, Replace, Save / Share PNG, Remove. |
| 124-entry-menu-long-press-no-photo-light.png | entry-menu | long-press-no-photo | light | 13:00 | Touch and hold on an entry with no photo: the menu says Add photo. |
| 124-entry-menu-long-press-no-photo-dark.png | entry-menu | long-press-no-photo | dark | 13:00 | Touch and hold on an entry with no photo: the menu says Add photo. |
| 125-toast-meal-photo-saved-light.png | toast | meal-photo-saved | light | 13:00 | Toast "Meal photo saved" after adding a photo to an entry; the row now shows the photo. |
| 125-toast-meal-photo-saved-dark.png | toast | meal-photo-saved | dark | 13:00 | Toast "Meal photo saved" after adding a photo to an entry; the row now shows the photo. |
| 126-toast-entry-repeated-light.png | toast | entry-repeated | light | 13:00 | Toast "Entry repeated to today" after Log again today. |
| 126-toast-entry-repeated-dark.png | toast | entry-repeated | dark | 13:00 | Toast "Entry repeated to today" after Log again today. |
| 127-edit-entry-ai-estimated-entry-light.png | edit-entry | ai-estimated-entry | light | 13:00 | Tap an entry to edit it: an AI-estimated entry shows the Estimated chip, "Not an estimate", assumptions, meal chips, photo picker, notes, swipe to save, Log again today and Delete entry. |
| 127-edit-entry-ai-estimated-entry-dark.png | edit-entry | ai-estimated-entry | dark | 13:00 | Tap an entry to edit it: an AI-estimated entry shows the Estimated chip, "Not an estimate", assumptions, meal chips, photo picker, notes, swipe to save, Log again today and Delete entry. |
| 128-edit-entry-ai-estimated-entry-scrolled-light.png | edit-entry | ai-estimated-entry-scrolled | light | 13:00 | Tap an entry to edit it: an AI-estimated entry shows the Estimated chip, "Not an estimate", assumptions, meal chips, photo picker, notes, swipe to save, Log again today and Delete entry. Scrolled to the end of the sheet. |
| 128-edit-entry-ai-estimated-entry-scrolled-dark.png | edit-entry | ai-estimated-entry-scrolled | dark | 13:00 | Tap an entry to edit it: an AI-estimated entry shows the Estimated chip, "Not an estimate", assumptions, meal chips, photo picker, notes, swipe to save, Log again today and Delete entry. Scrolled to the end of the sheet. |
| 129-edit-entry-per-100g-basis-light.png | edit-entry | per-100g-basis | light | 13:00 | Edit entry after switching Per serving to Per 100g (the numbers convert, amount becomes grams). |
| 129-edit-entry-per-100g-basis-dark.png | edit-entry | per-100g-basis | dark | 13:00 | Edit entry after switching Per serving to Per 100g (the numbers convert, amount becomes grams). |
| 130-edit-entry-energy-in-kj-light.png | edit-entry | energy-in-kj | light | 13:00 | Edit entry with the energy input switched to kJ. |
| 130-edit-entry-energy-in-kj-dark.png | edit-entry | energy-in-kj | dark | 13:00 | Edit entry with the energy input switched to kJ. |
| 131-edit-entry-swipe-halfway-light.png | edit-entry | swipe-halfway | light | 13:00 | Swipe to save, held halfway. |
| 131-edit-entry-swipe-halfway-dark.png | edit-entry | swipe-halfway | dark | 13:00 | Swipe to save, held halfway. |
| 132-edit-entry-swipe-past-threshold-light.png | edit-entry | swipe-past-threshold | light | 13:00 | Swipe to save past the threshold: label changes to "Release to save". |
| 132-edit-entry-swipe-past-threshold-dark.png | edit-entry | swipe-past-threshold | dark | 13:00 | Swipe to save past the threshold: label changes to "Release to save". |
| 133-toast-entry-updated-light.png | toast | entry-updated | light | 13:00 | Toast "Entry updated" after saving an edit. |
| 133-toast-entry-updated-dark.png | toast | entry-updated | dark | 13:00 | Toast "Entry updated" after saving an edit. |
| 134-day-target-default-light.png | day-target | default | light | 13:00 | Today's target sheet: explanation, slider with endpoints, "Type a target" with Set, usual target note. |
| 134-day-target-default-dark.png | day-target | default | dark | 13:00 | Today's target sheet: explanation, slider with endpoints, "Type a target" with Set, usual target note. |
| 135-day-target-slider-after-12-arrow-keys-light.png | day-target | slider-after-12-arrow-keys | light | 13:00 | Day target slider after 12 ArrowRight presses: still at the usual target (changes within the tolerance snap back). |
| 135-day-target-slider-after-12-arrow-keys-dark.png | day-target | slider-after-12-arrow-keys | dark | 13:00 | Day target slider after 12 ArrowRight presses: still at the usual target (changes within the tolerance snap back). |
| 136-day-target-custom-target-light.png | day-target | custom-target | light | 13:00 | Day target after typing 2100 and Set: the slider moves and a "Use usual target" button appears. |
| 136-day-target-custom-target-dark.png | day-target | custom-target | dark | 13:00 | Day target after typing 2100 and Set: the slider moves and a "Use usual target" button appears. |
| 137-today-custom-target-applied-light.png | today | custom-target-applied | light | 13:00 | Today with a custom day target (the target line says "custom" and the arc re-scales). |
| 137-today-custom-target-applied-dark.png | today | custom-target-applied | dark | 13:00 | Today with a custom day target (the target line says "custom" and the arc re-scales). |
| 138-log-manually-seeded-new-entry-light.png | log-manually | seeded-new-entry | light | 13:00 | Log manually at 13:00: meal defaults to Lunch from the clock; saved-food picker with Favourites and Recent. |
| 138-log-manually-seeded-new-entry-dark.png | log-manually | seeded-new-entry | dark | 13:00 | Log manually at 13:00: meal defaults to Lunch from the clock; saved-food picker with Favourites and Recent. |
| 139-log-manually-seeded-new-entry-scrolled-light.png | log-manually | seeded-new-entry-scrolled | light | 13:00 | Log manually at 13:00: meal defaults to Lunch from the clock; saved-food picker with Favourites and Recent. Scrolled to the end of the sheet. |
| 139-log-manually-seeded-new-entry-scrolled-dark.png | log-manually | seeded-new-entry-scrolled | dark | 13:00 | Log manually at 13:00: meal defaults to Lunch from the clock; saved-food picker with Favourites and Recent. Scrolled to the end of the sheet. |
| 140-log-manually-snack-part-of-day-picker-light.png | log-manually | snack-part-of-day-picker | light | 13:00 | Choosing Snack (or Drink) asks "When was this snack?" with Morning, Afternoon, Evening. |
| 140-log-manually-snack-part-of-day-picker-dark.png | log-manually | snack-part-of-day-picker | dark | 13:00 | Choosing Snack (or Drink) asks "When was this snack?" with Morning, Afternoon, Evening. |
| 141-log-manually-favourites-open-light.png | log-manually | favourites-open | light | 13:00 | Saved food picker with Favourites expanded. |
| 141-log-manually-favourites-open-dark.png | log-manually | favourites-open | dark | 13:00 | Saved food picker with Favourites expanded. |
| 142-log-manually-picker-typed-light.png | log-manually | picker-typed | light | 13:00 | Saved food picker with "tim" typed: Your foods and From food database. |
| 142-log-manually-picker-typed-dark.png | log-manually | picker-typed | dark | 13:00 | Saved food picker with "tim" typed: Your foods and From food database. |
| 143-log-manually-picked-food-light.png | log-manually | picked-food | light | 13:00 | After picking a saved food the form fills in and scrolls to the numbers. |
| 143-log-manually-picked-food-dark.png | log-manually | picked-food | dark | 13:00 | After picking a saved food the form fills in and scrolls to the numbers. |
| 144-log-manually-three-servings-total-light.png | log-manually | three-servings-total | light | 13:00 | Three servings: "Logged total" preview chips and the "After this" line. |
| 144-log-manually-three-servings-total-dark.png | log-manually | three-servings-total | dark | 13:00 | Three servings: "Logged total" preview chips and the "After this" line. |
| 145-log-manually-with-photo-light.png | log-manually | with-photo | light | 13:00 | A meal photo attached: preview and "Tap to replace the photo". |
| 145-log-manually-with-photo-dark.png | log-manually | with-photo | dark | 13:00 | A meal photo attached: preview and "Tap to replace the photo". |
| 146-log-manually-with-photo-scrolled-light.png | log-manually | with-photo-scrolled | light | 13:00 | A meal photo attached: preview and "Tap to replace the photo". Scrolled to the end of the sheet. |
| 146-log-manually-with-photo-scrolled-dark.png | log-manually | with-photo-scrolled | dark | 13:00 | A meal photo attached: preview and "Tap to replace the photo". Scrolled to the end of the sheet. |
| 147-log-manually-heart-tapped-header-nudged-light.png | log-manually | heart-tapped-header-nudged | light | 13:00 | Heart tapped after scrolling the sheet. Playwright scrolled the heart into view and, because the sheet panel is overflow:hidden but still programmatically scrollable, the whole panel moved about 34 px: the title row is pushed up under the sheet edge and the close button is clipped. iOS does the same when it scrolls to a focused field (see OBSERVATIONS.md). |
| 147-log-manually-heart-tapped-header-nudged-dark.png | log-manually | heart-tapped-header-nudged | dark | 13:00 | Heart tapped after scrolling the sheet. Playwright scrolled the heart into view and, because the sheet panel is overflow:hidden but still programmatically scrollable, the whole panel moved about 34 px: the title row is pushed up under the sheet edge and the close button is clipped. iOS does the same when it scrolls to a focused field (see OBSERVATIONS.md). |
| 148-log-manually-favourite-and-swipe-light.png | log-manually | favourite-and-swipe | light | 13:00 | Heart tapped ("Also saves it to favourites") and the swipe held past the threshold ("Release to log"). The sheet header is still nudged up (see the previous shot, a side effect of the programmatic scroll). |
| 148-log-manually-favourite-and-swipe-dark.png | log-manually | favourite-and-swipe | dark | 13:00 | Heart tapped ("Also saves it to favourites") and the swipe held past the threshold ("Release to log"). The sheet header is still nudged up (see the previous shot, a side effect of the programmatic scroll). |
| 149-toast-entry-saved-light.png | toast | entry-saved | light | 13:00 | Toast "Entry saved" with the favourites note after logging. |
| 149-toast-entry-saved-dark.png | toast | entry-saved | dark | 13:00 | Toast "Entry saved" with the favourites note after logging. |
| 150-log-manually-saved-and-add-another-light.png | log-manually | saved-and-add-another | light | 13:00 | Save and add another: sheet resets for the next entry and a toast confirms the save. |
| 150-log-manually-saved-and-add-another-dark.png | log-manually | saved-and-add-another | dark | 13:00 | Save and add another: sheet resets for the next entry and a toast confirms the save. |
| 151-rough-meal-from-log-manually-light.png | rough-meal | from-log-manually | light | 13:00 | Add a rough meal reached from Log manually. |
| 151-rough-meal-from-log-manually-dark.png | rough-meal | from-log-manually | dark | 13:00 | Add a rough meal reached from Log manually. |
| 152-toast-rough-meal-logged-light.png | toast | rough-meal-logged | light | 13:00 | Toast "Rough lunch logged: 800 Cal" after tapping a size. |
| 152-toast-rough-meal-logged-dark.png | toast | rough-meal-logged | dark | 13:00 | Toast "Rough lunch logged: 800 Cal" after tapping a size. |
| 153-estimate-with-gemini-empty-light.png | estimate-with-gemini | empty | light | 13:00 | Estimate with Gemini: empty input, Estimate food disabled, photo add tile, tips. |
| 153-estimate-with-gemini-empty-dark.png | estimate-with-gemini | empty | dark | 13:00 | Estimate with Gemini: empty input, Estimate food disabled, photo add tile, tips. |
| 154-estimate-with-gemini-tips-open-light.png | estimate-with-gemini | tips-open | light | 13:00 | The "Tips for accurate numbers" disclosure opened. |
| 154-estimate-with-gemini-tips-open-dark.png | estimate-with-gemini | tips-open | dark | 13:00 | The "Tips for accurate numbers" disclosure opened. |
| 155-estimate-with-gemini-text-typed-light.png | estimate-with-gemini | text-typed | light | 13:00 | Estimate with Gemini with a description typed; the Estimate food button is enabled. |
| 155-estimate-with-gemini-text-typed-dark.png | estimate-with-gemini | text-typed | dark | 13:00 | Estimate with Gemini with a description typed; the Estimate food button is enabled. |
| 156-estimate-with-gemini-photo-attached-light.png | estimate-with-gemini | photo-attached | light | 13:00 | Estimate with Gemini with a photo attached (thumbnail with remove button, "Add another" tile). |
| 156-estimate-with-gemini-photo-attached-dark.png | estimate-with-gemini | photo-attached | dark | 13:00 | Estimate with Gemini with a photo attached (thumbnail with remove button, "Add another" tile). |
| 157-estimate-with-gemini-loading-light.png | estimate-with-gemini | loading | light | 13:00 | LOADING: the button says "Estimating…", fields and Cancel are disabled, and a toast says "You can close this…" while the sheet cannot be closed. |
| 157-estimate-with-gemini-loading-dark.png | estimate-with-gemini | loading | dark | 13:00 | LOADING: the button says "Estimating…", fields and Cancel are disabled, and a toast says "You can close this…" while the sheet cannot be closed. |
| 158-estimate-result-review-text-estimate-light.png | estimate-result | review-text-estimate | light | 13:00 | RESULT: the log sheet opens with Gemini's numbers (720 Cal per serving), Estimated chip, Medium confidence, assumptions and a Correction field with Refine. |
| 158-estimate-result-review-text-estimate-dark.png | estimate-result | review-text-estimate | dark | 13:00 | RESULT: the log sheet opens with Gemini's numbers (720 Cal per serving), Estimated chip, Medium confidence, assumptions and a Correction field with Refine. |
| 159-estimate-result-review-text-estimate-scrolled-light.png | estimate-result | review-text-estimate-scrolled | light | 13:00 | RESULT: the log sheet opens with Gemini's numbers (720 Cal per serving), Estimated chip, Medium confidence, assumptions and a Correction field with Refine. Scrolled to the end of the sheet. |
| 159-estimate-result-review-text-estimate-scrolled-dark.png | estimate-result | review-text-estimate-scrolled | dark | 13:00 | RESULT: the log sheet opens with Gemini's numbers (720 Cal per serving), Estimated chip, Medium confidence, assumptions and a Correction field with Refine. Scrolled to the end of the sheet. |
| 160-estimate-result-refining-light.png | estimate-result | refining | light | 13:00 | REFINE in progress: the Refine button says "Refining…" and the field is disabled. |
| 160-estimate-result-refining-dark.png | estimate-result | refining | dark | 13:00 | REFINE in progress: the Refine button says "Refining…" and the field is disabled. |
| 161-estimate-result-refined-light.png | estimate-result | refined | light | 13:00 | REFINED result: new numbers (610 Cal), name updated, assumptions updated. |
| 161-estimate-result-refined-dark.png | estimate-result | refined | dark | 13:00 | REFINED result: new numbers (610 Cal), name updated, assumptions updated. |
| 162-estimate-result-refined-scrolled-light.png | estimate-result | refined-scrolled | light | 13:00 | REFINED result: new numbers (610 Cal), name updated, assumptions updated. Scrolled to the end of the sheet. |
| 162-estimate-result-refined-scrolled-dark.png | estimate-result | refined-scrolled | dark | 13:00 | REFINED result: new numbers (610 Cal), name updated, assumptions updated. Scrolled to the end of the sheet. |
| 163-estimate-result-macros-disagree-warning-light.png | estimate-result | macros-disagree-warning | light | 13:00 | After editing calories to 900 the macros no longer add up: "Calories and macros don't quite add up" warning. |
| 163-estimate-result-macros-disagree-warning-dark.png | estimate-result | macros-disagree-warning | dark | 13:00 | After editing calories to 900 the macros no longer add up: "Calories and macros don't quite add up" warning. |
| 164-estimate-result-label-reading-light.png | estimate-result | label-reading | light | 13:00 | RESULT from a nutrition label photo: "From label", 100 g basis, 170 g eaten, High confidence and the hint to check it matches the pack. |
| 164-estimate-result-label-reading-dark.png | estimate-result | label-reading | dark | 13:00 | RESULT from a nutrition label photo: "From label", 100 g basis, 170 g eaten, High confidence and the hint to check it matches the pack. |
| 165-estimate-result-label-reading-scrolled-light.png | estimate-result | label-reading-scrolled | light | 13:00 | RESULT from a nutrition label photo: "From label", 100 g basis, 170 g eaten, High confidence and the hint to check it matches the pack. Scrolled to the end of the sheet. |
| 165-estimate-result-label-reading-scrolled-dark.png | estimate-result | label-reading-scrolled | dark | 13:00 | RESULT from a nutrition label photo: "From label", 100 g basis, 170 g eaten, High confidence and the hint to check it matches the pack. Scrolled to the end of the sheet. |
| 166-estimate-with-gemini-error-429-rate-limit-toast-still-showing-light.png | estimate-with-gemini | error-429-rate-limit-toast-still-showing | light | 13:00 | ERROR (HTTP 429, quota): "Your Gemini key has hit its rate limit…" shown inline in the sheet; the typed description is kept. Taken straight away: the "Estimating…" toast is still on screen and covers the error text. |
| 166-estimate-with-gemini-error-429-rate-limit-toast-still-showing-dark.png | estimate-with-gemini | error-429-rate-limit-toast-still-showing | dark | 13:00 | ERROR (HTTP 429, quota): "Your Gemini key has hit its rate limit…" shown inline in the sheet; the typed description is kept. Taken straight away: the "Estimating…" toast is still on screen and covers the error text. |
| 167-estimate-with-gemini-error-429-rate-limit-light.png | estimate-with-gemini | error-429-rate-limit | light | 13:00 | ERROR (HTTP 429, quota): "Your Gemini key has hit its rate limit…" shown inline in the sheet; the typed description is kept. |
| 167-estimate-with-gemini-error-429-rate-limit-dark.png | estimate-with-gemini | error-429-rate-limit | dark | 13:00 | ERROR (HTTP 429, quota): "Your Gemini key has hit its rate limit…" shown inline in the sheet; the typed description is kept. |
| 168-estimate-with-gemini-error-free-tier-daily-limit-light.png | estimate-with-gemini | error-free-tier-daily-limit | light | 13:00 | ERROR (HTTP 429, free tier daily limit). |
| 168-estimate-with-gemini-error-free-tier-daily-limit-dark.png | estimate-with-gemini | error-free-tier-daily-limit | dark | 13:00 | ERROR (HTTP 429, free tier daily limit). |
| 169-estimate-with-gemini-error-400-invalid-key-light.png | estimate-with-gemini | error-400-invalid-key | light | 13:00 | ERROR (HTTP 400, API key not valid). |
| 169-estimate-with-gemini-error-400-invalid-key-dark.png | estimate-with-gemini | error-400-invalid-key | dark | 13:00 | ERROR (HTTP 400, API key not valid). |
| 170-estimate-with-gemini-error-503-busy-light.png | estimate-with-gemini | error-503-busy | light | 13:00 | ERROR (HTTP 503, overloaded). |
| 170-estimate-with-gemini-error-503-busy-dark.png | estimate-with-gemini | error-503-busy | dark | 13:00 | ERROR (HTTP 503, overloaded). |
| 171-ai-estimate-helper-gemini-reply-unreadable-light.png | ai-estimate-helper | gemini-reply-unreadable | light | 13:00 | When Gemini replies with text the app cannot parse: toast "Gemini returned text Dawni could not read", and the AI estimate helper sheet holds Gemini's reply so it can be fixed by hand. |
| 171-ai-estimate-helper-gemini-reply-unreadable-dark.png | ai-estimate-helper | gemini-reply-unreadable | dark | 13:00 | When Gemini replies with text the app cannot parse: toast "Gemini returned text Dawni could not read", and the AI estimate helper sheet holds Gemini's reply so it can be fixed by hand. |
| 172-menu-pick-input-empty-light.png | menu-pick | input-empty | light | 13:00 | Help me pick from a menu: meal chips (picked from the clock), what is left today, the suggested range, photo tile, note, "What gets sent", Suggest button disabled. |
| 172-menu-pick-input-empty-dark.png | menu-pick | input-empty | dark | 13:00 | Help me pick from a menu: meal chips (picked from the clock), what is left today, the suggested range, photo tile, note, "What gets sent", Suggest button disabled. |
| 173-menu-pick-input-empty-scrolled-light.png | menu-pick | input-empty-scrolled | light | 13:00 | Help me pick from a menu: meal chips (picked from the clock), what is left today, the suggested range, photo tile, note, "What gets sent", Suggest button disabled. Scrolled to the end of the sheet. |
| 173-menu-pick-input-empty-scrolled-dark.png | menu-pick | input-empty-scrolled | dark | 13:00 | Help me pick from a menu: meal chips (picked from the clock), what is left today, the suggested range, photo tile, note, "What gets sent", Suggest button disabled. Scrolled to the end of the sheet. |
| 174-menu-pick-photo-and-note-light.png | menu-pick | photo-and-note | light | 13:00 | Menu pick with a menu photo and a note typed. |
| 174-menu-pick-photo-and-note-dark.png | menu-pick | photo-and-note | dark | 13:00 | Menu pick with a menu photo and a note typed. |
| 175-menu-pick-photo-and-note-scrolled-light.png | menu-pick | photo-and-note-scrolled | light | 13:00 | Menu pick with a menu photo and a note typed. Scrolled to the end of the sheet. |
| 175-menu-pick-photo-and-note-scrolled-dark.png | menu-pick | photo-and-note-scrolled | dark | 13:00 | Menu pick with a menu photo and a note typed. Scrolled to the end of the sheet. |
| 176-menu-pick-loading-light.png | menu-pick | loading | light | 13:00 | LOADING: "Reading the menu…" with a spinner and Cancel (this sheet can be closed while it waits). |
| 176-menu-pick-loading-dark.png | menu-pick | loading | dark | 13:00 | LOADING: "Reading the menu…" with a spinner and Cancel (this sheet can be closed while it waits). |
| 177-menu-pick-result-light.png | menu-pick | result | light | 13:00 | RESULT: best pick card (source and confidence chips, numbers, what it leaves for today, reason, tip, assumptions), Also good, Why this pick, caveat, disclaimer. |
| 177-menu-pick-result-dark.png | menu-pick | result | dark | 13:00 | RESULT: best pick card (source and confidence chips, numbers, what it leaves for today, reason, tip, assumptions), Also good, Why this pick, caveat, disclaimer. |
| 178-menu-pick-result-scrolled-light.png | menu-pick | result-scrolled | light | 13:00 | RESULT: best pick card (source and confidence chips, numbers, what it leaves for today, reason, tip, assumptions), Also good, Why this pick, caveat, disclaimer. Scrolled to the end of the sheet. |
| 178-menu-pick-result-scrolled-dark.png | menu-pick | result-scrolled | dark | 13:00 | RESULT: best pick card (source and confidence chips, numbers, what it leaves for today, reason, tip, assumptions), Also good, Why this pick, caveat, disclaimer. Scrolled to the end of the sheet. |
| 179-log-food-review-from-menu-pick-light.png | log-food-review | from-menu-pick | light | 13:00 | Log this opens the log sheet with the menu item (Estimated chip, assumptions). |
| 179-log-food-review-from-menu-pick-dark.png | log-food-review | from-menu-pick | dark | 13:00 | Log this opens the log sheet with the menu item (Estimated chip, assumptions). |
| 180-log-food-review-from-menu-pick-scrolled-light.png | log-food-review | from-menu-pick-scrolled | light | 13:00 | Log this opens the log sheet with the menu item (Estimated chip, assumptions). Scrolled to the end of the sheet. |
| 180-log-food-review-from-menu-pick-scrolled-dark.png | log-food-review | from-menu-pick-scrolled | dark | 13:00 | Log this opens the log sheet with the menu item (Estimated chip, assumptions). Scrolled to the end of the sheet. |
| 181-menu-pick-error-429-light.png | menu-pick | error-429 | light | 13:00 | ERROR on menu pick (HTTP 429): message inline above the Suggest button. |
| 181-menu-pick-error-429-dark.png | menu-pick | error-429 | dark | 13:00 | ERROR on menu pick (HTTP 429): message inline above the Suggest button. |
| 182-meal-prep-sheet-describe-empty-light.png | meal-prep-sheet | describe-empty | light | 13:00 | Meal prep a batch: ingredients box with a placeholder, serves stepper, Estimate batch disabled, "Enter the numbers yourself". |
| 182-meal-prep-sheet-describe-empty-dark.png | meal-prep-sheet | describe-empty | dark | 13:00 | Meal prep a batch: ingredients box with a placeholder, serves stepper, Estimate batch disabled, "Enter the numbers yourself". |
| 183-meal-prep-sheet-describe-filled-light.png | meal-prep-sheet | describe-filled | light | 13:00 | Meal prep describe step filled in, serves set to 5. |
| 183-meal-prep-sheet-describe-filled-dark.png | meal-prep-sheet | describe-filled | dark | 13:00 | Meal prep describe step filled in, serves set to 5. |
| 184-meal-prep-sheet-estimating-light.png | meal-prep-sheet | estimating | light | 13:00 | LOADING: Estimate batch says "Estimating…" and everything is disabled, including the close button. |
| 184-meal-prep-sheet-estimating-dark.png | meal-prep-sheet | estimating | dark | 13:00 | LOADING: Estimate batch says "Estimating…" and everything is disabled, including the close button. |
| 185-meal-prep-sheet-review-result-light.png | meal-prep-sheet | review-result | light | 13:00 | RESULT: Review batch: name, per-serve Cal and macros, serves stepper with whole-batch Cal, Estimated and confidence chips, assumptions, Correction field, "What went in" breakdown, Save 5 serves, Save and log one now. |
| 185-meal-prep-sheet-review-result-dark.png | meal-prep-sheet | review-result | dark | 13:00 | RESULT: Review batch: name, per-serve Cal and macros, serves stepper with whole-batch Cal, Estimated and confidence chips, assumptions, Correction field, "What went in" breakdown, Save 5 serves, Save and log one now. |
| 186-meal-prep-sheet-review-result-scrolled-light.png | meal-prep-sheet | review-result-scrolled | light | 13:00 | RESULT: Review batch: name, per-serve Cal and macros, serves stepper with whole-batch Cal, Estimated and confidence chips, assumptions, Correction field, "What went in" breakdown, Save 5 serves, Save and log one now. Scrolled to the end of the sheet. |
| 186-meal-prep-sheet-review-result-scrolled-dark.png | meal-prep-sheet | review-result-scrolled | dark | 13:00 | RESULT: Review batch: name, per-serve Cal and macros, serves stepper with whole-batch Cal, Estimated and confidence chips, assumptions, Correction field, "What went in" breakdown, Save 5 serves, Save and log one now. Scrolled to the end of the sheet. |
| 187-meal-prep-sheet-refining-light.png | meal-prep-sheet | refining | light | 13:00 | REFINE in progress on the batch. |
| 187-meal-prep-sheet-refining-dark.png | meal-prep-sheet | refining | dark | 13:00 | REFINE in progress on the batch. |
| 188-meal-prep-sheet-refined-light.png | meal-prep-sheet | refined | light | 13:00 | REFINED batch (5 star mince, High confidence). |
| 188-meal-prep-sheet-refined-dark.png | meal-prep-sheet | refined | dark | 13:00 | REFINED batch (5 star mince, High confidence). |
| 189-meal-prep-sheet-refined-scrolled-light.png | meal-prep-sheet | refined-scrolled | light | 13:00 | REFINED batch (5 star mince, High confidence). Scrolled to the end of the sheet. |
| 189-meal-prep-sheet-refined-scrolled-dark.png | meal-prep-sheet | refined-scrolled | dark | 13:00 | REFINED batch (5 star mince, High confidence). Scrolled to the end of the sheet. |
| 190-toast-batch-saved-and-logged-light.png | toast | batch-saved-and-logged | light | 13:00 | After "Save and log one now": a serve is logged straight away, with an Undo toast; the batch row is on Today. |
| 190-toast-batch-saved-and-logged-dark.png | toast | batch-saved-and-logged | dark | 13:00 | After "Save and log one now": a serve is logged straight away, with an Undo toast; the batch row is on Today. |
| 191-today-with-new-batch-row-light.png | today | with-new-batch-row | light | 13:00 | Today with a second meal prep row. |
| 191-today-with-new-batch-row-dark.png | today | with-new-batch-row | dark | 13:00 | Today with a second meal prep row. |
| 192-meal-prep-sheet-error-429-light.png | meal-prep-sheet | error-429 | light | 13:00 | ERROR on batch estimate (HTTP 429). |
| 192-meal-prep-sheet-error-429-dark.png | meal-prep-sheet | error-429 | dark | 13:00 | ERROR on batch estimate (HTTP 429). |
| 193-meal-prep-sheet-enter-numbers-yourself-light.png | meal-prep-sheet | enter-numbers-yourself | light | 13:00 | Enter the numbers yourself: the review step with empty per-serve fields. |
| 193-meal-prep-sheet-enter-numbers-yourself-dark.png | meal-prep-sheet | enter-numbers-yourself | dark | 13:00 | Enter the numbers yourself: the review step with empty per-serve fields. |
| 194-settings-with-key-viewport-light.png | settings | with-key-viewport | light | 13:00 | Settings with a Gemini key saved: seeded goals, backup 2 days ago, custom database row, saved key masked. |
| 194-settings-with-key-viewport-dark.png | settings | with-key-viewport | dark | 13:00 | Settings with a Gemini key saved: seeded goals, backup 2 days ago, custom database row, saved key masked. |
| 195-settings-with-key-full-light.png | settings | with-key-full | light | 13:00 | Settings with a Gemini key saved: seeded goals, backup 2 days ago, custom database row, saved key masked. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 195-settings-with-key-full-dark.png | settings | with-key-full | dark | 13:00 | Settings with a Gemini key saved: seeded goals, backup 2 days ago, custom database row, saved key masked. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 196-settings-goals-editing-light.png | settings | goals-editing | light | 13:00 | Settings, Goals in edit mode: mode select and numeric fields enabled, the button reads Save goals. |
| 196-settings-goals-editing-dark.png | settings | goals-editing | dark | 13:00 | Settings, Goals in edit mode: mode select and numeric fields enabled, the button reads Save goals. |
| 197-toast-goals-saved-light.png | toast | goals-saved | light | 13:00 | Toast "Goals saved". |
| 197-toast-goals-saved-dark.png | toast | goals-saved | dark | 13:00 | Toast "Goals saved". |
| 198-settings-gemini-card-saved-key-light.png | settings | gemini-card-saved-key | light | 13:00 | Gemini card with a key saved, before any check ("Key saved. Tap Test key…"). |
| 198-settings-gemini-card-saved-key-dark.png | settings | gemini-card-saved-key | dark | 13:00 | Gemini card with a key saved, before any check ("Key saved. Tap Test key…"). |
| 199-settings-gemini-card-ready-paid-light.png | settings | gemini-card-ready-paid | light | 13:00 | Test key succeeded on the best model: "Ready. Dawni will use Gemini 2.5 Pro, the best model this key can use." with the model id and count of models. |
| 199-settings-gemini-card-ready-paid-dark.png | settings | gemini-card-ready-paid | dark | 13:00 | Test key succeeded on the best model: "Ready. Dawni will use Gemini 2.5 Pro, the best model this key can use." with the model id and count of models. |
| 200-settings-gemini-card-ready-free-tier-light.png | settings | gemini-card-ready-free-tier | light | 13:00 | Test key on a free-tier key: Pro was refused, Dawni fell back to Gemini 2.5 Flash and says the key is on Google's free tier. |
| 200-settings-gemini-card-ready-free-tier-dark.png | settings | gemini-card-ready-free-tier | dark | 13:00 | Test key on a free-tier key: Pro was refused, Dawni fell back to Gemini 2.5 Flash and says the key is on Google's free tier. |
| 201-settings-gemini-card-error-invalid-key-light.png | settings | gemini-card-error-invalid-key | light | 13:00 | Test key with an invalid key: error copy and a "Details from Google" disclosure. |
| 201-settings-gemini-card-error-invalid-key-dark.png | settings | gemini-card-error-invalid-key | dark | 13:00 | Test key with an invalid key: error copy and a "Details from Google" disclosure. |
| 202-settings-gemini-card-error-details-open-light.png | settings | gemini-card-error-details-open | light | 13:00 | The Details from Google disclosure opened. |
| 202-settings-gemini-card-error-details-open-dark.png | settings | gemini-card-error-details-open | dark | 13:00 | The Details from Google disclosure opened. |
| 203-settings-gemini-card-error-429-light.png | settings | gemini-card-error-429 | light | 13:00 | Test key when every model is rate limited (HTTP 429). |
| 203-settings-gemini-card-error-429-dark.png | settings | gemini-card-error-429 | dark | 13:00 | Test key when every model is rate limited (HTTP 429). |
| 204-settings-gemini-card-editing-light.png | settings | gemini-card-editing | light | 13:00 | Gemini card in edit mode: the key field is a password input, the button reads Save. |
| 204-settings-gemini-card-editing-dark.png | settings | gemini-card-editing | dark | 13:00 | Gemini card in edit mode: the key field is a password input, the button reads Save. |
| 205-settings-gemini-card-after-save-light.png | settings | gemini-card-after-save | light | 13:00 | After Save the key is checked again automatically. |
| 205-settings-gemini-card-after-save-dark.png | settings | gemini-card-after-save | dark | 13:00 | After Save the key is checked again automatically. |
| 206-settings-about-you-edited-light.png | settings | about-you-edited | light | 13:00 | About you, for AI: the Save button enables once the text changes. |
| 206-settings-about-you-edited-dark.png | settings | about-you-edited | dark | 13:00 | About you, for AI: the Save button enables once the text changes. |
| 207-settings-ai-prompt-shown-light.png | settings | ai-prompt-shown | light | 13:00 | AI estimate helper with Show prompt opened: the whole prompt in a textarea. |
| 207-settings-ai-prompt-shown-dark.png | settings | ai-prompt-shown | dark | 13:00 | AI estimate helper with Show prompt opened: the whole prompt in a textarea. |
| 208-settings-display-card-light.png | settings | display-card | light | 13:00 | Settings, Display: theme (System / Dark / Light), energy unit, accent presets and colour input. |
| 208-settings-display-card-dark.png | settings | display-card | dark | 13:00 | Settings, Display: theme (System / Dark / Light), energy unit, accent presets and colour input. |
| 209-today-energy-in-kj-light.png | today | energy-in-kj | light | 13:00 | Today with the energy unit set to kJ: hero, entries and macros in kJ. |
| 209-today-energy-in-kj-dark.png | today | energy-in-kj | dark | 13:00 | Today with the energy unit set to kJ: hero, entries and macros in kJ. |
| 210-today-accent-amber-light.png | today | accent-amber | light | 13:00 | Today with the amber accent preset: tab bar, sparkle button, links and chips take the accent. |
| 210-today-accent-amber-dark.png | today | accent-amber | dark | 13:00 | Today with the amber accent preset: tab bar, sparkle button, links and chips take the accent. |
| 211-settings-spread-bank-on-light.png | settings | spread-bank-on | light | 13:00 | Weekly banking, Spread banked calories across remaining days switched on (toast confirms). |
| 211-settings-spread-bank-on-dark.png | settings | spread-bank-on | dark | 13:00 | Weekly banking, Spread banked calories across remaining days switched on (toast confirms). |
| 212-today-spread-bank-on-light.png | today | spread-bank-on | light | 13:00 | Today with the weekly bank spread across days: the target reads "with bank". |
| 212-today-spread-bank-on-dark.png | today | spread-bank-on | dark | 13:00 | Today with the weekly bank spread across days: the target reads "with bank". |
| 213-settings-app-card-light.png | settings | app-card | light | 13:00 | Settings, App card: version, Check for updates, Clear local data (red). |
| 213-settings-app-card-dark.png | settings | app-card | dark | 13:00 | Settings, App card: version, Check for updates, Clear local data (red). |
| 214-settings-check-updates-result-light.png | settings | check-updates-result | light | 13:00 | Check for updates when already current (or when the service worker is blocked) shows a toast. |
| 214-settings-check-updates-result-dark.png | settings | check-updates-result | dark | 13:00 | Check for updates when already current (or when the service worker is blocked) shows a toast. |
| 215-today-no-key-with-entries-viewport-light.png | today | no-key-with-entries-viewport | light | 13:00 | Today with entries but no Gemini key. |
| 215-today-no-key-with-entries-viewport-dark.png | today | no-key-with-entries-viewport | dark | 13:00 | Today with entries but no Gemini key. |
| 216-today-no-key-with-entries-full-light.png | today | no-key-with-entries-full | light | 13:00 | Today with entries but no Gemini key. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 216-today-no-key-with-entries-full-dark.png | today | no-key-with-entries-full | dark | 13:00 | Today with entries but no Gemini key. Full page (the tab bar stays at the bottom of the first screen in full-page captures). |
| 217-log-with-ai-no-key-with-entries-light.png | log-with-ai | no-key-with-entries | light | 13:00 | Log with AI chooser, with entries but no key. Nothing in the chooser says a key is missing. |
| 217-log-with-ai-no-key-with-entries-dark.png | log-with-ai | no-key-with-entries | dark | 13:00 | Log with AI chooser, with entries but no key. Nothing in the chooser says a key is missing. |
| 218-gemini-setup-no-key-with-entries-light.png | gemini-setup | no-key-with-entries | light | 13:00 | Estimate with Gemini without a key: the Set up Gemini sheet. |
| 218-gemini-setup-no-key-with-entries-dark.png | gemini-setup | no-key-with-entries | dark | 13:00 | Estimate with Gemini without a key: the Set up Gemini sheet. |
| 219-settings-gemini-card-no-key-light.png | settings | gemini-card-no-key | light | 13:00 | Settings, Gemini card with no key: "Not set up." |
| 219-settings-gemini-card-no-key-dark.png | settings | gemini-card-no-key | dark | 13:00 | Settings, Gemini card with no key: "Not set up." |
| 220-backup-reminder-auto-on-launch-light.png | backup-reminder | auto-on-launch | light | 13:00 | The backup reminder opens by itself on launch when the last backup is older than the reminder interval (10 days against 7). |
| 220-backup-reminder-auto-on-launch-dark.png | backup-reminder | auto-on-launch | dark | 13:00 | The backup reminder opens by itself on launch when the last backup is older than the reminder interval (10 days against 7). |
| 221-version-toast-over-update-button-light.png | version | toast-over-update-button | light | 13:00 | The "Update ready" toast lands on top of the sheet's primary button (Update now) at the moment the sheet opens. |
| 221-version-toast-over-update-button-dark.png | version | toast-over-update-button | dark | 13:00 | The "Update ready" toast lands on top of the sheet's primary button (Update now) at the moment the sheet opens. |
| 222-version-update-available-light.png | version | update-available | light | 13:00 | Update available sheet: version badge, explanation, What's new notes, Update now and Not now. |
| 222-version-update-available-dark.png | version | update-available | dark | 13:00 | Update available sheet: version badge, explanation, What's new notes, Update now and Not now. |
