# User-reported finding: Week screen "Cal banked" headline ignores today

Example (Saturday 10 Oct, daily limit 1,450):
- Mon–Fri deltas: +304, −38, +238, −110, +173 = +567. Screen shows "+568 Cal banked" (rounding).
- Saturday (today, in progress): 730 over.
- Net including today: 567 − 730 = −163.
- Sunday's real allowance: 1,450 + 568 − 730 = 1,288. Screen says "about 1,290".
- "1,288 Cal left this week" is the same figure. Weekly budget 10,150 − consumed 8,863 = 1,287.
- "Average 1,336 Cal" covers Mon–Fri only ("5 of 7 days counted").

Problems:
- "+568 banked" is the balance BEFORE today. Headline excludes current day, so it doesn't match the figure that drives tomorrow's limit.
- User sees "+568 banked" then "1,288 left" (< 1,450 daily limit) and asks how they can be ahead yet have less than a day left. Screen doesn't answer.
- "Still on track" technically true (week not blown) but net is −162, so reassurance contradicts headline.
- Mixed sign convention ("+304", "−38", "730 over") and 567/568, 1,288/1,290 rounding hurt reconciliation.

Recommended (priority order):
1. Headline net of today: show running balance incl. today (−162), or split "banked before today: +568" / "today: −730".
2. Show carry-over to next day explicitly with working: "Sunday: 1,450 − 162 = 1,288".
3. Fix "on track" logic to reflect net balance and remaining budget; add a state like "Recoverable" when net negative but remaining budget positive.
4. Consistent rounding (round once, display the same rounded value everywhere).
5. Label Sunday bar's "1,450" as base limit, or show adjusted limit (1,288) so the bar matches the text.

Principle: the first number a user sees should be the one that determines their next decision ("how much can I eat tomorrow"), not a balance that excludes today.
