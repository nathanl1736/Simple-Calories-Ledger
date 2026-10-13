import type { Batch, Food } from './types';
import type { LogDraft } from './appTypes';
import { normaliseSearchText } from './foodSearch';

/** How many favourites and recent foods a typed search lists, and the food database before and after Show more. */
export const SEARCH_SAVED_SHOWN = 8;
export const SEARCH_DATABASE_SHOWN = 3;
export const SEARCH_DATABASE_MAX = 20;

/**
 * What the Log sheet's text box searches for: what's typed, unless a photo is attached or it runs
 * to more than one line. Then the words describe a meal for Gemini (a photo, or a list of what went
 * in, like the one Estimate again puts there), so the usuals and other ways stay rather than results.
 */
export function composerSearchQuery(draft: LogDraft) {
  const text = draft.text.trim();
  return draft.photos.length || text.includes('\n') ? '' : text;
}

/**
 * A typed search's results, in the order they're listed: the fridge, favourites, recent foods, then
 * the food database. `waiting` holds back "no matches" until the database has answered this query.
 */
export function searchSections<D>({ query, batches, userResults, databaseMatches, databaseQuery, moreDatabase }: {
  /** Trimmed. */
  query: string;
  batches: Batch[];
  /** Saved foods matching the query, best first (useFoodSearch). */
  userResults: Food[];
  databaseMatches: D[];
  /** The query the database matches belong to. */
  databaseQuery: string;
  moreDatabase: boolean;
}) {
  const needle = normaliseSearchText(query);
  const prepRows = needle ? batches.filter(batch => normaliseSearchText(batch.name).includes(needle)) : [];
  const favouriteRows = userResults.filter(food => food.favourite).slice(0, SEARCH_SAVED_SHOWN);
  const recentRows = userResults.filter(food => !food.favourite).slice(0, SEARCH_SAVED_SHOWN);
  const databaseRows = databaseMatches.slice(0, moreDatabase ? SEARCH_DATABASE_MAX : SEARCH_DATABASE_SHOWN);
  const databaseCount = Math.min(databaseMatches.length, SEARCH_DATABASE_MAX);
  const moreCount = databaseCount - databaseRows.length;
  const waiting = databaseQuery !== query;
  const nothing = !waiting && !prepRows.length && !favouriteRows.length && !recentRows.length && !databaseRows.length;
  const summary = waiting ? '' : nothing ? `No matches for ${query}` : [
    prepRows.length ? `${prepRows.length} in your fridge` : '',
    favouriteRows.length ? `${favouriteRows.length} favourite${favouriteRows.length === 1 ? '' : 's'}` : '',
    recentRows.length ? `${recentRows.length} recent` : '',
    databaseCount ? `${databaseCount} from the food database` : ''
  ].filter(Boolean).join(', ');
  return { prepRows, favouriteRows, recentRows, databaseRows, moreCount, waiting, nothing, summary };
}
