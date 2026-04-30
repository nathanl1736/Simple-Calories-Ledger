export type SearchableFood = {
  name: string;
  brand?: string;
  category?: string;
  tags?: string[];
  searchText?: string;
};

type SearchFields = {
  fullQuery: string;
  tokens: string[];
};

const TOKEN_ALIASES: Record<string, string[]> = {
  maccas: ['mcdonalds'],
  mcdonalds: ['mcdonalds'],
  hj: ['hungry', 'jacks'],
  gyg: ['guzman', 'gomez'],
  woolies: ['woolworths'],
  yoghurt: ['yogurt'],
  yogurt: ['yogurt']
};

const normalizeToken = (token: string) => token === 'yoghurt' ? 'yogurt' : token;

export function normaliseSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map(normalizeToken)
    .filter(Boolean)
    .join(' ');
}

export function buildSearchHaystack(item: SearchableFood) {
  return normaliseSearchText([
    item.name,
    item.brand,
    item.category,
    ...(item.tags || []),
    item.searchText
  ].filter(Boolean).join(' '));
}

export function tokeniseQuery(query: string) {
  const rawTokens = normaliseSearchText(query).split(/\s+/).filter(Boolean);
  const tokens = rawTokens.flatMap(token => TOKEN_ALIASES[token] || [token]);
  return [...new Set(tokens.map(normalizeToken).filter(token => token.length > 1 || /\d/.test(token)))];
}

function searchFields(query: string): SearchFields {
  const tokens = tokeniseQuery(query);
  return { tokens, fullQuery: tokens.join(' ') };
}

function fieldText(value: string | string[] | undefined) {
  return normaliseSearchText(Array.isArray(value) ? value.join(' ') : value || '');
}

function tokenCount(tokens: string[], value: string) {
  return tokens.filter(token => value.includes(token)).length;
}

function allTokensIn(tokens: string[], value: string) {
  return tokens.length > 0 && tokens.every(token => value.includes(token));
}

export function foodMatchesQuery(item: SearchableFood, query: string) {
  const { tokens } = searchFields(query);
  if (!tokens.length) return false;
  const haystack = buildSearchHaystack(item);
  return allTokensIn(tokens, haystack);
}

function chobaniCoreGreekBoost(item: SearchableFood, tokens: string[]) {
  const brand = fieldText(item.brand);
  const name = fieldText(item.name);
  const category = fieldText(item.category);
  if (!tokens.includes('chobani')) return 0;
  if (brand !== 'chobani') return 0;
  if (category !== 'dairy and yogurt') return 0;
  if (!name.includes('greek') || !name.includes('yogurt')) return 0;
  if (name.includes('fit')) return 0;
  return 35;
}

export function scoreFoodSearch(item: SearchableFood, query: string) {
  const { tokens, fullQuery } = searchFields(query);
  if (!tokens.length) return 0;

  const name = fieldText(item.name);
  const brand = fieldText(item.brand);
  const category = fieldText(item.category);
  const tags = fieldText(item.tags);
  const searchText = fieldText(item.searchText);
  const haystack = [name, brand, category, tags, searchText].filter(Boolean).join(' ');

  if (!allTokensIn(tokens, haystack)) return -1;

  let score = 25;
  if (name === fullQuery) score += 100;
  if (fullQuery && name.startsWith(fullQuery)) score += 80;
  if (brand === fullQuery) score += 60;
  if (fullQuery && name.includes(fullQuery)) score += 50;
  if (allTokensIn(tokens, name)) score += 40;

  score += tokenCount(tokens, brand) * 12;
  score += tokenCount(tokens, name) * 10;
  score += tokenCount(tokens, `${tags} ${category}`) * 6;
  tokens.forEach(token => {
    if (!brand.includes(token) && !name.includes(token) && !tags.includes(token) && !category.includes(token) && searchText.includes(token)) {
      score += 3;
    }
  });

  return score + chobaniCoreGreekBoost(item, tokens);
}
