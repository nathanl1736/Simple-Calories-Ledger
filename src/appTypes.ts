import type { Batch, DayPart, EnergyUnit, EntryEstimateSource, Meal } from './types';
import { type EstimateConfidence, type GeminiEstimate } from './aiEstimate';

export type Tab = 'tracking' | 'journal' | 'library' | 'stats' | 'settings';

export type EntryOpenMode = 'manual' | 'prefill' | 'edit';
export type JournalDayViewMode = 'list' | 'collage';
export type JournalLabelMode = 'photo' | 'calories' | 'nameCalories';

export type EntryDraft = {
  editingId: string;
  sourceFoodId: string;
  name: string;
  meal: Meal;
  /** Where it goes in the day. Follows breakfast, lunch and dinner; picked for a snack or drink. */
  part: DayPart;
  unitMode: 'serving' | '100g';
  brand: string;
  servingLabel: string;
  servingGrams: string;
  source: string;
  sourceId: string;
  category: string;
  tags: string[];
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  portion: string;
  notes: string;
  /** The heart as it was left: null until it is tapped, so the saved food decides. */
  favourite: boolean | null;
  photo: string | null;
  entryEnergyUnit: EnergyUnit;
  estimateSource: EntryEstimateSource | null;
  /** What Gemini guessed and how sure it was; shown while reviewing, saved into notes. */
  estimateDetails: { confidence: EstimateConfidence; assumptions: string[] } | null;
  /** Set when editing a serve of meal prep, so it keeps counting toward its batch. */
  batchId: string;
};

/** What the meal prep sheet saves; the app adds the id and the dates. */
export type BatchInput = Pick<Batch, 'name' | 'recipe' | 'servings' | 'total' | 'ingredients' | 'estimateSource' | 'assumptions' | 'confidence'>;
/** How the meal prep sheet was opened: a new batch, editing one on the go, or cooking a finished one again. `opened` starts it afresh. */
export type BatchSheetRequest = { mode: 'new' | 'edit' | 'again'; batchId: string | null; opened: number };

/** What's typed and photographed in the Log sheet's composer. Kept by the app, so it survives closing the sheet. */
export type LogDraft = { text: string; photos: string[] };

/**
 * An estimate asked of Gemini from the Log sheet. It carries on when the sheet is closed:
 * `running` shows the pill above the tab bar, `ready` waits for Review, `failed` keeps what
 * went wrong for the sheet to show next to Try again.
 */
export type EstimateJob = {
  id: number;
  status: 'running' | 'ready' | 'failed';
  description: string;
  photos: string[];
  meal: Meal;
  /** performance.now() when it was asked. */
  startedAt: number;
  error?: string;
  timedOut?: boolean;
  result?: { raw: string; parsed: GeminiEstimate | null };
};
