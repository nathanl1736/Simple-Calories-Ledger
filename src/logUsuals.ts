import type { Batch, Entry, Food } from './types';

/**
 * One chip in the Log sheet's usuals or favourites row. A tap logs it straight away:
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

/** A row of chips where the same food never shows twice, whether it's matched by its saved food or by name. */
function chipRow(limit: number) {
  const chips: UsualChip[] = [];
  const names = new Set<string>();
  const foodIds = new Set<string>();
  return {
    chips,
    has: (name: string, foodId?: string | null) => names.has(nameKey(name)) || (!!foodId && foodIds.has(foodId)),
    take(chip: UsualChip, ...ids: (string | null | undefined)[]) {
      const name = nameKey(chip.name);
      if (!name || names.has(name) || ids.some(id => id && foodIds.has(id)) || chips.length >= limit) return;
      names.add(name);
      ids.forEach(id => id && foodIds.add(id));
      chips.push(chip);
    }
  };
}

/** Favourites, the most logged first, most recent breaking ties. */
export function favouritesByUse(foods: Food[]) {
  return foods
    .filter(food => food.favourite)
    .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0) || (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
}

/**
 * Log food's two rows of one-tap chips:
 * - usuals: the fridge with serves left, then this meal's usuals (`usualsForMeal`) that aren't favourites.
 *   The fridge leads: it's food on hand that runs out, and a full set of usuals once pushed it off the row.
 * - favourites: every favourite. Those that are usuals for this meal come first and log as they were
 *   logged last time; the rest follow by how often they're logged. A favourite with serves in the fridge
 *   (stocked from it, or of the same name) takes one from there, so the fridge counts down either way.
 * Every favourite is in its own row, so it can always be found there, and nothing else shows twice.
 */
export function logChips({ usuals, batches, foods, limit = MAX_USUAL_CHIPS }: {
  usuals: { key: string; name: string; latest: Entry }[];
  batches: { batch: Batch; left: number; calories: number }[];
  foods: Food[];
  limit?: number;
}): { usuals: UsualChip[]; favourites: UsualChip[] } {
  const favourites = favouritesByUse(foods);
  const usualRow = chipRow(limit);
  const favouriteRow = chipRow(Infinity);
  const favouriteFor = (usual: { name: string; latest: Entry }) =>
    favourites.find(food => food.id === usual.latest.sourceFoodId) || favourites.find(food => nameKey(food.name) === nameKey(usual.name));
  const stocked = batches.filter(item => item.left > 0);
  const prepChip = (item: { batch: Batch; left: number; calories: number }): UsualChip =>
    ({ kind: 'prep', key: `prep:${item.batch.id}`, name: item.batch.name, calories: item.calories, left: item.left, batch: item.batch });
  const inFridge = (food: Food) => {
    const item = stocked.find(each => each.batch.foodId === food.id) || stocked.find(each => nameKey(each.batch.name) === nameKey(food.name));
    return item && prepChip(item);
  };
  stocked.forEach(item => usualRow.take(prepChip(item)));
  usuals.forEach(usual => {
    const chip: UsualChip = { kind: 'usual', key: `usual:${usual.key}`, name: usual.name, calories: usual.latest.calories, entry: usual.latest };
    const favourite = favouriteFor(usual);
    if (favourite) favouriteRow.take(inFridge(favourite) || chip, favourite.id, usual.latest.sourceFoodId);
    else if (!favouriteRow.has(usual.name, usual.latest.sourceFoodId)) usualRow.take(chip, usual.latest.sourceFoodId);
  });
  favourites.forEach(food => favouriteRow.take(inFridge(food) || { kind: 'favourite', key: `food:${food.id}`, name: food.name, calories: food.calories, food }, food.id));
  return { usuals: usualRow.chips, favourites: favouriteRow.chips };
}
