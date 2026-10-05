import type { Food } from './types';

/** How logging changed a food's favourite status, for the confirmation toast. */
export type FavouriteChange = 'added' | 'removed' | null;

/** A saved food as one log describes it. */
export type FoodSnapshot = Omit<Food, 'id' | 'favourite' | 'usageCount' | 'lastUsedAt' | 'createdAt' | 'updatedAt'>;

const nameKey = (name: string) => name.toLowerCase().trim();

/** The saved food an entry belongs to: the one it was picked from, else the one with the same name. */
export function linkedFood(foods: Food[], sourceFoodId: string | null | undefined, name: string): Food | undefined {
  const picked = sourceFoodId ? foods.find(food => food.id === sourceFoodId) : undefined;
  if (picked) return picked;
  const key = nameKey(name);
  return key ? foods.find(food => nameKey(food.name) === key) : undefined;
}

/**
 * Keeps saved foods in step with a logged entry. `favourite` is the heart as it
 * was left: null when it wasn't touched, which never changes a favourite.
 * - Hearting saves the food as just logged; un-hearting keeps it in Recent.
 * - A favourite keeps its saved numbers when one log tweaks them. Change those in Foods.
 * - A recent food matched by name follows its latest log; one picked from the list doesn't.
 * - A database pick is only saved once hearted.
 */
export function recordFoodUse(
  foods: Food[],
  { sourceFoodId, snapshot, favourite, fromDatabase, now, newId }: {
    sourceFoodId: string | null | undefined;
    snapshot: FoodSnapshot;
    favourite: boolean | null;
    fromDatabase: boolean;
    now: number;
    newId: () => string;
  }
): FavouriteChange {
  const picked = sourceFoodId ? foods.find(food => food.id === sourceFoodId) : undefined;
  if (!picked && fromDatabase && favourite !== true) return null;
  const food = picked || linkedFood(foods, null, snapshot.name);
  if (!food) {
    foods.push({ ...snapshot, id: newId(), favourite: favourite === true, usageCount: 1, lastUsedAt: now, createdAt: now, updatedAt: now });
    return favourite ? 'added' : null;
  }
  food.usageCount = (food.usageCount || 0) + 1;
  food.lastUsedAt = now;
  const want = favourite ?? food.favourite;
  if (want && !food.favourite) {
    Object.assign(food, snapshot, { favourite: true, updatedAt: now });
    return 'added';
  }
  if (!want && food.favourite) {
    Object.assign(food, { favourite: false, updatedAt: now });
    return 'removed';
  }
  if (!picked && !food.favourite) Object.assign(food, snapshot, { updatedAt: now });
  return null;
}
