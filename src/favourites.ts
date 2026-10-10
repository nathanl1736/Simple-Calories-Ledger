import type { Food } from './types';

/** How logging changed a food's favourite status, for the confirmation toast. */
export type FavouriteChange = 'added' | 'removed' | null;

/** A saved food as one log describes it. */
export type FoodSnapshot = Omit<Food, 'id' | 'favourite' | 'usageCount' | 'lastUsedAt' | 'createdAt' | 'updatedAt'>;

const nameKey = (name: string) => name.toLowerCase().trim();

/** How long a one-off AI or menu estimate stays in Recent without being logged again. */
export const ONE_OFF_ESTIMATE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Older builds stamped a new food's times a few ms apart, so only a later save counts as an edit in Foods. */
const EDIT_GRACE_MS = 60 * 1000;

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

/**
 * Saved foods minus the one-off estimates nobody went back to. Logging with AI saves each estimate to
 * Recent and its name rarely comes back word for word, so they pile up. A food is dropped once it is:
 * - an AI or menu estimate (one read off a label is a real product, so it stays),
 * - not a favourite, logged only once and not edited in Foods since,
 * - unused for `days`.
 * Diary entries keep their own numbers, so nothing already logged changes.
 */
export function pruneOneOffEstimates(foods: Food[], now: number, days = ONE_OFF_ESTIMATE_DAYS): Food[] {
  const cutoff = now - days * DAY_MS;
  return foods.filter(food => {
    if (food.favourite || (food.estimateSource !== 'ai' && food.estimateSource !== 'menu')) return true;
    if ((food.usageCount || 0) > 1) return true;
    const lastUsed = food.lastUsedAt || food.createdAt || now;
    if ((food.updatedAt || 0) - lastUsed > EDIT_GRACE_MS) return true;
    return lastUsed >= cutoff;
  });
}
