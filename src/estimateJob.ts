import type { Meal } from './types';

/** Gemini usually takes 10 to 30 s. Before this, a counter would only make a normal wait look slow. */
export const SHOW_ELAPSED_AFTER_MS = 8000;

/** The estimating card's counter: nothing at first, then "12 s · usually 10–30 s". */
export function elapsedText(ms: number) {
  if (!(ms >= SHOW_ELAPSED_AFTER_MS)) return '';
  return `${Math.floor(ms / 1000)} s · usually 10–30 s`;
}

/** The pill above the tab bar while a request runs in the background, and the title of the sheet's card. */
export function estimatingLabel(meal: Meal | null, kind: 'estimate' | 'suggest' = 'estimate') {
  if (kind === 'suggest') return meal ? `Finding ${meal.toLowerCase()} ideas…` : 'Finding ideas…';
  return meal ? `Estimating ${meal.toLowerCase()}…` : 'Estimating…';
}

const keyDate = (key: string) => new Date(`${key}T00:00:00`);
const dayGap = (from: string, to: string) => Math.round((keyDate(to).getTime() - keyDate(from).getTime()) / 86_400_000);

/** " · Yesterday", " · Tuesday", " · Tue, 29 Sept", or nothing for today: which day the Log sheet is for. */
function daySuffix(date: string, today: string) {
  if (!date || date === today) return '';
  const gap = dayGap(today, date);
  if (gap === -1) return ' · Yesterday';
  if (gap === 1) return ' · Tomorrow';
  const day = keyDate(date);
  if (Math.abs(gap) < 7) return ` · ${day.toLocaleDateString('en-AU', { weekday: 'long' })}`;
  return ` · ${day.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}`;
}

/**
 * The Log sheet's title. Entries go to the day shown on Today, so when that isn't today the
 * title says which day: "Log food · Yesterday", "Log food · Tuesday", "Log food · Tue, 29 Sept".
 */
export function logSheetTitle(date: string, today: string) {
  return `Log food${daySuffix(date, today)}`;
}

/** The same sheet in Suggest mode: "What should I eat?", with the day when it isn't today. */
export function suggestSheetTitle(date: string, today: string) {
  return `What should I eat?${daySuffix(date, today)}`;
}
