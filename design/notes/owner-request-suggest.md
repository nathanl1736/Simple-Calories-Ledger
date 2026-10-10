# User request: generalise "Help me pick from a menu" into "What should I eat?"

Current: menuPick asks Gemini to look at a menu photo and pick an item that fits remaining calories.

Wanted: a general suggestion feature.
- Free-text input: "I'm going to Macca's", "going to Subway", "cooking at home tonight, what should I make?", "have chicken thighs and rice in the fridge".
- Optional menu photo still supported: same outcome, Gemini reads the menu and picks items.
- Context Gemini must get: today's remaining calories and protein (and other macros), what has been eaten today (names + totals), time of day / day part, weekly bank state (banked / over, days left), tracking mode (cutting/maintaining/bulking), user's AI preferences string.
- Output: 1 to 3 recommendations, each with name, estimated kcal/protein/carbs/fat, why it fits ("leaves ~300 Cal for dinner", "hits your protein"), what to skip/modify ("no mayo", "small fries"), and one-tap "Log this" that creates an AI-estimated entry (reviewable before save, like estimate).
- Keep it calm: suggestions, not orders. No guilt language.
- Entry point: from the Log with AI chooser (rename to e.g. "What should I eat?"), and ideally a contextual nudge on Today when a meal slot is coming up with room left.
