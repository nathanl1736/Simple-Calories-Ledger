export type Meal = 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack' | 'Drink';
export type EnergyUnit = 'kcal' | 'kj';
export type TrackingMode = 'Cutting' | 'Maintaining' | 'Bulking';

export type Settings = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  accent: string;
  trackingMode: TrackingMode;
  energyUnit: EnergyUnit;
  lastBackupAt: string | null;
  lastBackupMeta: BackupMeta | null;
  lastBackupReminderShownAt: string | null;
  backupReminderDays: number;
};

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
  notes?: string;
  photo?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type Food = {
  id: string;
  name: string;
  unitMode?: 'serving' | '100g';
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

export type AppState = {
  settings: Settings;
  entries: Entry[];
  foods: Food[];
  completedDates: string[];
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
};

export type BackupPayload = {
  exportedAt: string;
  app: 'calorie-tracker';
  version: string;
  counts: BackupMeta;
  state: AppState;
};
