import type { Entry, Food } from './types';

/** An entry taken out of the log, and where it sat, so Undo can put it back in the same place. */
export type RemovedEntry = { entry: Entry; index: number };

/** Takes one entry out. `removed` is null when it was already gone. */
export function removeEntry(entries: Entry[], id: string): { entries: Entry[]; removed: RemovedEntry | null } {
  const index = entries.findIndex(entry => entry.id === id);
  if (index < 0) return { entries, removed: null };
  return { entries: [...entries.slice(0, index), ...entries.slice(index + 1)], removed: { entry: entries[index], index } };
}

/** Undo for removeEntry: back where it was, unless it has come back some other way meanwhile. */
export function restoreEntry(entries: Entry[], removed: RemovedEntry): Entry[] {
  if (entries.some(entry => entry.id === removed.entry.id)) return entries;
  const index = Math.max(0, Math.min(removed.index, entries.length));
  return [...entries.slice(0, index), removed.entry, ...entries.slice(index)];
}

const sameFood = (a: Food | undefined, b: Food | undefined) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

/**
 * Undo for what logging did to saved foods (Recent, usage counts, a new favourite). `before` and
 * `after` are the foods either side of the log, `current` is now. A food the log created goes;
 * a food it changed goes back to how it was. Anything changed again since the log is left alone,
 * so a late Undo never wipes out a later edit.
 */
export function revertFoodUse(current: Food[], before: Food[], after: Food[]): Food[] {
  const beforeById = new Map(before.map(food => [food.id, food]));
  const afterById = new Map(after.map(food => [food.id, food]));
  const touched = after.filter(food => !sameFood(food, beforeById.get(food.id)));
  if (!touched.length) return current;
  const result: Food[] = [];
  for (const food of current) {
    const atLog = afterById.get(food.id);
    const wasTouched = touched.some(item => item.id === food.id);
    if (!wasTouched || !sameFood(food, atLog)) {
      result.push(food);
      continue;
    }
    const previous = beforeById.get(food.id);
    if (previous) result.push(previous);
    // A food the log created and nothing has used since: it goes.
  }
  return result;
}
