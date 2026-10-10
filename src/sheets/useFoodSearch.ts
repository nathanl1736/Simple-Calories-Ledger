import { useEffect, useMemo, useState } from 'react';
import type { AppState, Food } from '../types';
import { loadFoodDatabaseWithStatus, type FoodDatabaseItem } from '../foodDatabase';
import { flattenEnabledCustomDatabaseItems } from '../customFoodDatabases';
import { nameHasWordStarting, normaliseSearchText, scoreFoodSearch, tokeniseQuery } from '../foodSearch';

function compactKey(value: string | undefined) {
  return normaliseSearchText(value || '').replace(/[^a-z0-9]+/g, '');
}

function userFoodRank(food: Food, query: string) {
  return scoreFoodSearch(food, query);
}

function databaseRank(item: FoodDatabaseItem, query: string) {
  return scoreFoodSearch(item, query);
}

function rankUserFoods(foods: Food[], query: string) {
  return [...foods]
    .map(food => ({ food, rank: userFoodRank(food, query) }))
    .filter(item => item.rank >= 0)
    .sort((a, b) =>
      Number(b.food.favourite) - Number(a.food.favourite)
      || b.rank - a.rank
      || (b.food.lastUsedAt || 0) - (a.food.lastUsedAt || 0)
      || (b.food.usageCount || 0) - (a.food.usageCount || 0)
      || a.food.name.localeCompare(b.food.name)
    )
    .map(item => item.food);
}

function rankDatabaseFoods(items: FoodDatabaseItem[], query: string, foods: Food[]) {
  const sourceIds = new Set(foods.map(food => food.sourceId).filter(Boolean));
  const userNames = new Set(foods.map(food => compactKey(food.name)).filter(Boolean));
  return [...items]
    .map(item => ({ item, rank: databaseRank(item, query) }))
    .filter(({ item, rank }) => rank >= 0 && !sourceIds.has(item.id) && !userNames.has(compactKey(item.name)))
    .sort((a, b) => b.rank - a.rank || a.item.name.localeCompare(b.item.name))
    .map(item => item.item);
}

/**
 * Saved foods and food database matches for a search. Log food's picker and Today's search
 * both use it, so they find the same foods in the same order.
 */
export function useFoodSearch(state: AppState, foods: Food[], query: string) {
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [databaseMatches, setDatabaseMatches] = useState<FoodDatabaseItem[]>([]);
  const [databaseMessage, setDatabaseMessage] = useState('');
  /** The search the database matches belong to, so a result list can tell "none" from "not back yet". */
  const [databaseQuery, setDatabaseQuery] = useState('');
  const recentFoods = useMemo(() => [...foods].sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0)), [foods]);
  const trimmedQuery = query.trim();
  const trimmedDatabaseQuery = debouncedQuery.trim();
  const userResults = useMemo(() => {
    if (!trimmedQuery) return [];
    const ranked = rankUserFoods(recentFoods, trimmedQuery);
    if (tokeniseQuery(trimmedQuery).length) return ranked;
    // One letter is too short to rank on, so it used to match every food.
    return ranked.filter(food => nameHasWordStarting(food.name, trimmedQuery));
  }, [recentFoods, trimmedQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 120);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    if (trimmedDatabaseQuery.length < 2) {
      // Keeps the same empty list, so a search that isn't open doesn't re-render whenever foods change.
      setDatabaseMatches(current => current.length ? [] : current);
      setDatabaseMessage('');
      setDatabaseQuery(trimmedDatabaseQuery);
      return;
    }
    loadFoodDatabaseWithStatus()
      .then(result => {
        if (cancelled) return;
        const customItems = flattenEnabledCustomDatabaseItems(state.customFoodDatabases);
        const matches = rankDatabaseFoods([...result.items, ...customItems], trimmedDatabaseQuery, foods);
        setDatabaseMatches(matches);
        setDatabaseMessage(result.message && !customItems.length ? result.message : (!result.items.length && !customItems.length ? 'Food estimate database is not available right now.' : ''));
        setDatabaseQuery(trimmedDatabaseQuery);
      })
      .catch(() => {
        if (!cancelled) {
          setDatabaseMatches([]);
          setDatabaseMessage('Food estimate database could not be loaded.');
          setDatabaseQuery(trimmedDatabaseQuery);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [foods, state.customFoodDatabases, trimmedDatabaseQuery]);

  return { trimmedQuery, recentFoods, userResults, databaseMatches, databaseMessage, databaseQuery };
}
