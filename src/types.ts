export type Meal = 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack' | 'Drink';
export type EnergyUnit = 'kcal' | 'kj';
export type TrackingMode = 'Cutting' | 'Maintaining' | 'Bulking';
export type ThemePreference = 'system' | 'dark' | 'light';
/** Where estimated numbers came from: an AI guess, a nutrition label read from a photo, energy printed on a menu, or a rough size picked for a meal that was hard to track. */
export type EntryEstimateSource = 'ai' | 'label' | 'menu' | 'rough';

export type Settings = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  accent: string;
  theme: ThemePreference;
  trackingMode: TrackingMode;
  energyUnit: EnergyUnit;
  lastBackupAt: string | null;
  lastBackupMeta: BackupMeta | null;
  lastBackupReminderShownAt: string | null;
  backupReminderDays: number;
  geminiApiKey: string;
  /** Sent with every Gemini request, e.g. diet or region. */
  aiPreferences: string;
  spreadWeeklyBank: boolean;
};

export type DailyGoalSnapshot = Pick<Settings, 'calories' | 'protein' | 'carbs' | 'fat' | 'trackingMode'>;

export type Entry = {
  id: string;
  sourceFoodId: string | null;
  date: string;
  name: string;
  autoNamed?: boolean;
  unitMode?: 'serving' | '100g';
  baseCalories?: number;
  baseProtein?: number;
  baseCarbs?: number;
  baseFat?: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  portion?: number;
  meal?: Meal;
  /** Set when the numbers came from AI, so the log can say so. */
  estimateSource?: EntryEstimateSource | null;
  notes?: string;
  photo?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type Food = {
  id: string;
  name: string;
  unitMode?: 'serving' | '100g';
  brand?: string;
  servingLabel?: string;
  servingGrams?: number;
  source?: string;
  sourceId?: string;
  category?: string;
  tags?: string[];
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  favourite: boolean;
  usageCount: number;
  lastUsedAt: number;
  createdAt: number;
  updatedAt: number;
};

export type FoodDatabaseRecord = {
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

export type CustomFoodDatabase = {
  id: string;
  name: string;
  version: string;
  importedAt: string;
  enabled: boolean;
  itemCount: number;
  items: FoodDatabaseRecord[];
};

export type AppState = {
  settings: Settings;
  entries: Entry[];
  foods: Food[];
  /** Days confirmed as fully logged (Done for today, or That's everything on a light day). They count toward the week bank even when they look light. */
  completedDates: string[];
  /** Rough guesses for days whose log can't be trusted, in kcal above that day's target (0 = about on target). The week bank uses the guess instead of the log. */
  dayEstimates: Record<string, number>;
  dailyGoals: Record<string, DailyGoalSnapshot>;
  /** Optional per-day calorie target (kcal) for open days; does not change macro targets on Track. */
  dayCalorieOverrides: Record<string, number>;
  customFoodDatabases: CustomFoodDatabase[];
};

export type Totals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type BackupMeta = {
  version: string;
  entries: number;
  foods: number;
  completedDates: number;
  photos: number;
  customFoodDatabases?: number;
  customFoodItems?: number;
};

export type BackupPayload = {
  exportedAt: string;
  app: 'calorie-tracker';
  version: string;
  counts: BackupMeta;
  state: AppState;
};
