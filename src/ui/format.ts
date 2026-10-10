import type { Food, Meal } from '../types';
import { type FoodDatabaseItem } from '../foodDatabase';
import { addDays, entryUnitModeValue, fmtGram, shortDate, todayKey } from '../utils';

/** Text on an accent fill: white on a deep accent, ink on a pale one. */
export function accentInk(hex: string) {
  const value = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1];
  if (!value) return '#FFFFFF';
  const channel = (offset: number) => {
    const c = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.36 ? '#0F2A2E' : '#FFFFFF';
}

export function defaultMealForCurrentTime(): Meal {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Breakfast';
  if (hour >= 12 && hour < 15) return 'Lunch';
  if (hour >= 17 && hour < 22) return 'Dinner';
  return 'Snack';
}

export const roundedText = (value: number, decimals: number) => String(Number(value.toFixed(decimals)));

export function databaseSourceChip(tags: string[] = [], sourceKind?: FoodDatabaseItem['sourceKind']) {
  if (sourceKind === 'custom') return 'Custom';
  const tagSet = new Set(tags.map(tag => tag.toLowerCase()));
  if (tagSet.has('verified-sample')) return 'Verified sample';
  if (tagSet.has('label-sample')) return 'Label sample';
  if (tagSet.has('partial-label')) return 'Partial label';
  if (tagSet.has('macro-checked') || tagSet.has('macro-checked-generic')) return 'Macro checked';
  if (tagSet.has('estimate') || tagSet.has('alcohol-estimate')) return 'Estimated';
  return '';
}

export function databaseServingText(item: FoodDatabaseItem | Food) {
  if (entryUnitModeValue(item.unitMode) === '100g') return 'per 100g';
  if (item.servingLabel && item.servingGrams && !String(item.servingLabel).includes(`${item.servingGrams}`)) {
    return `${item.servingLabel} (${fmtGram(item.servingGrams)}g)`;
  }
  return item.servingLabel || (item.servingGrams ? `${fmtGram(item.servingGrams)}g` : 'per serving');
}

/** "cooked today", "cooked yesterday", "cooked Mon", or the date once it's a week back. */
export function cookedText(cookedOn: string) {
  const today = todayKey();
  if (cookedOn === today) return 'cooked today';
  if (cookedOn === addDays(today, -1)) return 'cooked yesterday';
  if (cookedOn > addDays(today, -7)) return `cooked ${new Date(`${cookedOn}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short' })}`;
  return `cooked ${shortDate(cookedOn)}`;
}
