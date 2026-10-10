# Handoff: Dawni 3.0 AI-first redesign

If you are a Claude session picking this up (Fable, Opus or Sonnet), this file is the state of the work. Read it first, then `design/REDESIGN.md`.

## What the owner asked for
- Critique every screen of the calorie tracker and redesign for fluency, with **Gemini estimation as the default way to log** and manual entry kept as an option.
- Generalise "Help me pick from a menu" into a free-text **"What should I eat?"** suggestion (venue, cooking at home, optional menu photo), aware of today's remaining budget and the week.
- Fix the Week screen headline that ignores today (owner's own analysis in `design/notes/owner-finding-week-bank.md`).
- Keep the calm, local-first identity; update the PDD (`Calories_Tracker_Product_Design_Document.txt`) to be AI-first.
- **Build it, open a PR, merge to main, let GitHub Pages deploy.** The owner said not to come back for permission; it is a hobby app used by them and friends.
- Keep Fable usage low: Fable orchestrates and makes design calls; Sonnet/Opus agents (within the owner's plan) do the building. If Fable credit runs out, continue on Opus with this file and the brief.
- If the owner hits a usage limit, resume automatically; two `send_later` check-ins were scheduled for 2026-10-10 16:45Z and 20:05Z.

## Where things are
- Branch: `claude/ai-first-redesign` (pushed). Base: `main` at `5769f7c` (v2.8.2.0).
- `design/REDESIGN.md`: the build brief (audit, spec, chunked plan). Section 9 (visual findings) still to fill after the screenshot review.
- `design/audit/INVENTORY.md`: 846-line factual code inventory with `file:line` references (sections 6.5 and 5.8 are the Week maths and the menu-pick internals).
- `design/audit/capture.mjs` + `harness.mjs` + `scenarios.mjs` + `seed.mjs` + `mock-gemini.mjs` + `probes.mjs`: Playwright capture of every screen with mocked Gemini. Re-run after the build to verify (dev server on 127.0.0.1:5173, base `/Simple-Calories-Ledger/`; Playwright installed in the scratchpad `pw/` folder, Chromium at `/opt/pw-browsers`).
- `design/audit/screenshots/`: 390x844 light + dark reference captures, `INDEX.md` and `OBSERVATIONS.md` (console errors, touch-target offenders, dead ends) once the capture agent finishes.
- Task list (TaskList tool) mirrors the plan below.

## Plan and status
| Step | Status |
|---|---|
| Code inventory (Sonnet) | done |
| Screenshot capture (Sonnet) | running at time of writing |
| Build brief | written; section 9 pending |
| Chunk 0: split `App.tsx` into files, zero behaviour change (Sonnet) | not started — must wait for the capture agent to stop using the dev server |
| Chunk 1: Log sheet + estimate flow + tap-to-save + inline key connect (Opus, worktree) | not started |
| Chunk 2: `weekView.ts` + Week screen + Today week row (Opus, worktree, parallel with 1) | not started |
| Chunk 3: Suggest mode (Sonnet) | after 1+2 merged |
| Chunk 4: Motion (Sonnet, parallel with 3) | after 1+2 merged |
| Chunk 5: a11y/polish, version 3.0.0.0, release notes, PDD (Sonnet) | after 3+4 |
| Verify with re-captured screenshots; fix; PR; CI; merge; confirm Pages deploy | last |

## Conventions for whoever continues
- Commit messages end with the Co-Authored-By and Claude-Session lines used in this branch's history. No model names in code, commits or the PR body.
- Every chunk: `npm test` and `npm run build` green before commit.
- Trim `design/audit/screenshots/` to a curated set (~30 files) before the PR merges; the full dump is 37 MB.
- PR body ends with the "Generated with Claude Code" footer and the session link, as the harness requires.
