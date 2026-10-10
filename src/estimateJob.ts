import type { Meal } from './types';

/** Gemini usually takes 10 to 30 s. Before this, a counter would only make a normal wait look slow. */
export const SHOW_ELAPSED_AFTER_MS = 8000;

/** The estimating card's counter: nothing at first, then "12 s · usually 10–30 s". */
export function elapsedText(ms: number) {
  if (!(ms >= SHOW_ELAPSED_AFTER_MS)) return '';
  return `${Math.floor(ms / 1000)} s · usually 10–30 s`;
}

/** The pill above the tab bar while an estimate runs in the background. */
export function estimatingLabel(meal: Meal | null) {
  return meal ? `Estimating ${meal.toLowerCase()}…` : 'Estimating…';
}

const keyDate = (key: string) => new Date(`${key}T00:00:00`);
const dayGap = (from: string, to: string) => Math.round((keyDate(to).getTime() - keyDate(from).getTime()) / 86_400_000);

/**
 * The Log sheet's title. Entries go to the day shown on Today, so when that isn't today the
 * title says which day: "Log food · Yesterday", "Log food · Tuesday", "Log food · Tue, 29 Sept".
 */
export function logSheetTitle(date: string, today: string) {
  if (!date || date === today) return 'Log food';
  const gap = dayGap(today, date);
  if (gap === -1) return 'Log food · Yesterday';
  if (gap === 1) return 'Log food · Tomorrow';
  const day = keyDate(date);
  if (Math.abs(gap) < 7) return `Log food · ${day.toLocaleDateString('en-AU', { weekday: 'long' })}`;
  return `Log food · ${day.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}`;
}
