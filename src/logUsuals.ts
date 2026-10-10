import type { Batch, Entry, Food } from './types';

/**
 * One chip in the Log sheet's usuals row. A tap logs it straight away:
 * - usual: what was logged last time for this meal, as it was
 * - prep: a serve of a meal prep batch with serves left
 * - favourite: a hearted food, one serving (or 100 g)
 * `calories` is what the tap logs, in kcal.
 */
export type UsualChip =
  | { kind: 'usual'; key: string; name: string; calories: number; entry: Entry }
  | { kind: 'prep'; key: string; name: string; calories: number; left: number; batch: Batch }
  | { kind: 'favourite'; key: string; name: string; calories: number; food: Food };

/** As many as fit a thumb's sideways scroll. */
export const MAX_USUAL_CHIPS = 8;

const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * The usuals row, in order: this meal's usuals (`usualsForMeal`), then meal prep with serves left,
 * then favourites by how often they're logged. The same food never shows twice, whether it's
 * matched by its saved food or by name.
 */
export function usualChips({ usuals, batches, foods, limit = MAX_USUAL_CHIPS }: {
  usuals: { key: string; name: string; latest: Entry }[];
  batches: { batch: Batch; left: number; calories: number }[];
  foods: Food[];
  limit?: number;
}): UsualChip[] {
  const chips: UsualChip[] = [];
  const names = new Set<string>();
  const foodIds = new Set<string>();
  const take = (chip: UsualChip, foodId?: string | null) => {
    const name = nameKey(chip.name);
    if (!name || names.has(name) || (foodId && foodIds.has(foodId)) || chips.length >= limit) return;
    names.add(name);
    if (foodId) foodIds.add(foodId);
    chips.push(chip);
  };
  usuals.forEach(usual => take({ kind: 'usual', key: `usual:${usual.key}`, name: usual.name, calories: usual.latest.calories, entry: usual.latest }, usual.latest.sourceFoodId));
  batches
    .filter(item => item.left > 0)
    .forEach(item => take({ kind: 'prep', key: `prep:${item.batch.id}`, name: item.batch.name, calories: item.calories, left: item.left, batch: item.batch }));
  foods
    .filter(food => food.favourite)
    .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0) || (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
    .forEach(food => take({ kind: 'favourite', key: `food:${food.id}`, name: food.name, calories: food.calories, food }, food.id));
  return chips;
}
