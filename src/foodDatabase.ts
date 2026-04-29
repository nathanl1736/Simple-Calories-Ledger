import type { Food } from './types';

export type FoodDatabaseItem = {
  id: string;
  name: string;
  brand?: string;
  unitMode: 'serving' | '100g';
  servingLabel?: string;
  servingGrams?: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  category?: string;
  tags: string[];
  searchText: string;
};

const MOCK_DATABASE: FoodDatabaseItem[] = [
  { id: 'mock_chobani_greek_plain_170g', name: 'Chobani Greek Yogurt Plain', brand: 'Chobani', unitMode: 'serving', servingLabel: '170g', servingGrams: 170, calories: 92, protein: 15, carbs: 6, fat: 0, category: 'Yogurt', tags: ['greek yogurt', 'high protein', 'dairy'], searchText: 'chobani greek yogurt plain 170g high protein dairy' },
  { id: 'mock_chobani_fit_strawberry_170g', name: 'Chobani Fit Strawberry', brand: 'Chobani', unitMode: 'serving', servingLabel: '170g', servingGrams: 170, calories: 108, protein: 15, carbs: 10, fat: 0, category: 'Yogurt', tags: ['yogurt', 'high protein', 'dairy'], searchText: 'chobani fit strawberry 170g high protein dairy yogurt' },
  { id: 'mock_chobani_protein_vanilla_170g', name: 'Chobani Protein Vanilla', brand: 'Chobani', unitMode: 'serving', servingLabel: '170g', servingGrams: 170, calories: 145, protein: 20, carbs: 12, fat: 2, category: 'Yogurt', tags: ['protein yogurt', 'vanilla', 'dairy'], searchText: 'chobani protein vanilla 170g high protein dairy yogurt' },
  { id: 'mock_chobani_greek_blueberry_170g', name: 'Chobani Greek Yogurt Blueberry', brand: 'Chobani', unitMode: 'serving', servingLabel: '170g', servingGrams: 170, calories: 120, protein: 14, carbs: 13, fat: 1, category: 'Yogurt', tags: ['greek yogurt', 'blueberry', 'dairy'], searchText: 'chobani greek yogurt blueberry 170g dairy high protein' },
  { id: 'mock_yopro_vanilla_160g', name: 'YoPro High Protein Yogurt Vanilla', brand: 'YoPro', unitMode: 'serving', servingLabel: '160g', servingGrams: 160, calories: 97, protein: 15, carbs: 7, fat: 0, category: 'Yogurt', tags: ['high protein', 'vanilla', 'dairy'], searchText: 'yopro high protein yogurt vanilla 160g dairy' },
  { id: 'mock_skim_milk_250ml', name: 'Skim Milk', brand: '', unitMode: 'serving', servingLabel: '250ml', calories: 86, protein: 8, carbs: 12, fat: 0, category: 'Dairy', tags: ['milk', 'drink'], searchText: 'skim milk 250ml dairy drink' },
  { id: 'mock_whey_protein_concentrate_30g', name: 'Whey Protein Concentrate', brand: '', unitMode: 'serving', servingLabel: '30g', servingGrams: 30, calories: 120, protein: 24, carbs: 3, fat: 2, category: 'Supplement', tags: ['wpc', 'protein powder', 'whey'], searchText: 'whey protein concentrate wpc 30g supplement protein powder' },
  { id: 'mock_chicken_breast_cooked_100g', name: 'Chicken Breast Cooked', unitMode: '100g', servingLabel: '100g', servingGrams: 100, calories: 165, protein: 31, carbs: 0, fat: 4, category: 'Meat', tags: ['chicken', 'lean protein'], searchText: 'chicken breast cooked 100g lean protein meat' },
  { id: 'mock_jasmine_rice_cooked_100g', name: 'Jasmine Rice Cooked', unitMode: '100g', servingLabel: '100g', servingGrams: 100, calories: 130, protein: 3, carbs: 28, fat: 0, category: 'Grain', tags: ['rice', 'carbs'], searchText: 'jasmine rice cooked 100g carbs grain' },
  { id: 'mock_rolled_oats_40g', name: 'Rolled Oats', unitMode: 'serving', servingLabel: '40g', servingGrams: 40, calories: 150, protein: 5, carbs: 27, fat: 3, category: 'Grain', tags: ['oats', 'breakfast'], searchText: 'rolled oats 40g breakfast grain' },
  { id: 'mock_tuna_springwater_95g', name: 'Tuna in Springwater', unitMode: 'serving', servingLabel: '95g', servingGrams: 95, calories: 105, protein: 24, carbs: 0, fat: 1, category: 'Seafood', tags: ['tuna', 'fish', 'high protein'], searchText: 'tuna in springwater 95g fish seafood high protein' },
  { id: 'mock_egg_large', name: 'Egg Large', unitMode: 'serving', servingLabel: '1 egg', calories: 74, protein: 6, carbs: 1, fat: 5, category: 'Eggs', tags: ['egg', 'breakfast'], searchText: 'egg large 1 egg breakfast protein' }
];

let foodDatabasePromise: Promise<FoodDatabaseItem[]> | null = null;

export function loadFoodDatabase() {
  foodDatabasePromise ||= Promise.resolve(MOCK_DATABASE);
  return foodDatabasePromise;
}

export function databaseItemToFood(item: FoodDatabaseItem): Food {
  return {
    id: item.id,
    name: item.name,
    brand: item.brand || undefined,
    unitMode: item.unitMode,
    servingLabel: item.servingLabel,
    servingGrams: item.servingGrams,
    source: 'mockLocalDb',
    sourceId: item.id,
    category: item.category,
    tags: item.tags,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
    favourite: false,
    usageCount: 0,
    lastUsedAt: 0,
    createdAt: 0,
    updatedAt: 0
  };
}
