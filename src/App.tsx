import { CSSProperties, FormEvent, ReactNode, type MouseEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { APP_VERSION } from './version';
import { createPortal, flushSync } from 'react-dom';
import type { AppState, DailyGoalSnapshot, EnergyUnit, Entry, EntryEstimateSource, Food, Meal, Settings, ThemePreference, TrackingMode } from './types';
import { DEFAULT, normalizeEntry, normalizeFood, normalizeStateShape } from './state';
import { readState, saveState } from './storage';
import { compressImage, downloadBlob, SHARP_PHOTO_OPTIONS } from './image';
import { backupAgeDays, backupCounts, exportBackup, parseBackup } from './backup';
import { applyAppUpdate, checkForAppUpdate, clearUpdateReloadMarkers, dismissUpdatePrompt, registerServiceWorker, watchForUpdatesOnResume, type UpdateInfo } from './pwa';
import { canvasToPngBlob, MealGroup, renderMealCardCanvas } from './canvas';
import { databaseItemToFood, loadFoodDatabaseWithStatus, refreshFoodEstimateDatabase, type FoodDatabaseItem } from './foodDatabase';
import { flattenEnabledCustomDatabaseItems, parseCustomFoodDatabaseText } from './customFoodDatabases';
import { normaliseSearchText, scoreFoodSearch } from './foodSearch';
import { linkedFood, recordFoodUse, type FavouriteChange } from './favourites';
import { AI_ESTIMATE_DISCLAIMER, AI_QUICK_LOG_PROMPT, amountPortionValue, parseAiQuickLog, type AiQuickLogEntry } from './aiQuickLog';
import {
  buildEstimateRequest,
  energyFromMacros,
  estimateNotes,
  estimateSourceLabel,
  estimateSourceValue,
  macrosDisagree,
  MAX_ESTIMATE_PHOTOS,
  parseGeminiEstimate,
  type EstimateConfidence,
  type GeminiEstimate
} from './aiEstimate';
import { probeGeminiKey, requestMealEstimate, requestMenuPick, type GeminiError } from './geminiEstimate';
import {
  budgetReason,
  buildMenuPickContext,
  buildMenuPickRequest,
  isMenuPickFresh,
  loadLastMenuPick,
  MAX_MENU_PHOTOS,
  mealBudget,
  MENU_PHOTO_OPTIONS,
  MENU_PICK_MEALS,
  parseMenuPick,
  saveLastMenuPick,
  type MenuPickItem,
  type MenuPickSession
} from './menuPick';
import {
  addDays,
  applyDayCalorieOverride,
  bankDay,
  dayCalorieSliderBounds,
  dayEntries,
  energyLabel,
  energyInputFromKcal,
  energyInputToKcal,
  energyTextForUnit,
  energyText,
  energyUnitLabel,
  energyUnitValue,
  energyValue,
  energyValueForUnit,
  entryTotals,
  entryUnitModeValue,
  fmt,
  fmtGram,
  fmtPortion,
  foodUnitText,
  goalForDate,
  goalSnapshotFromSettings,
  isDayComplete,
  LIGHT_DAY_SHARE,
  lockPastGoals,
  MEALS,
  mealGroupId,
  macroBase,
  n,
  normalizeDateKey,
  readable,
  resolveDayCalorieTarget,
  setDayComplete,
  setDayEstimate,
  shortDate,
  sum,
  todayKey,
  toKey,
  uid,
  validBackupReminderDays,
  weekBank,
  weekStartMonday,
  weeklyBankAdjustmentForDate,
  type BankDay,
  type DayBankStatus,
  type WeekBank
} from './utils';

type Tab = 'tracking' | 'journal' | 'library' | 'stats' | 'settings';
type ModalName = 'entry' | 'food' | 'photo' | 'entryPhoto' | 'mealCard' | 'bankHelp' | 'adherenceHelp' | 'version' | 'backupReminder' | 'aiQuickLog' | 'aiQuickLogHelp' | 'geminiApiKeyHelp' | 'geminiEstimate' | 'geminiSetup' | 'menuPick' | 'customDbHelp' | 'addFood' | 'dayTarget' | 'roughMeal' | null;
type SetTabOptions = { date?: string; resetScroll?: boolean };

const TABS: [Tab, string][] = [
  ['tracking', 'Today'],
  ['stats', 'Week'],
  ['journal', 'Journal'],
  ['library', 'Foods'],
  ['settings', 'Settings']
];

function storedTab(value: string | null): Tab {
  // Cards used to be its own tab; meal cards now live in Journal's day view.
  if (value === 'cards') return 'journal';
  return TABS.some(([id]) => id === value) ? value as Tab : 'tracking';
}
type EntryOpenMode = 'manual' | 'prefill' | 'edit';
type JournalDayViewMode = 'list' | 'collage';
type JournalLabelMode = 'photo' | 'calories' | 'nameCalories';

type EntryDraft = {
  editingId: string;
  sourceFoodId: string;
  name: string;
  meal: Meal;
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
};

/** The last Gemini estimate request, kept so Refine can send a correction with the same photos. */
type EstimateSession = { description: string; photos: string[]; meal: Meal; reply: string };

const blankEntryDraft = (meal: Meal = 'Snack', entryEnergyUnit: EnergyUnit = 'kcal'): EntryDraft => ({
  editingId: '',
  sourceFoodId: '',
  name: '',
  meal,
  unitMode: 'serving',
  brand: '',
  servingLabel: '',
  servingGrams: '',
  source: '',
  sourceId: '',
  category: '',
  tags: [],
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
  portion: '1',
  notes: '',
  favourite: null,
  photo: null,
  entryEnergyUnit,
  estimateSource: null,
  estimateDetails: null
});

function defaultMealForCurrentTime(): Meal {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Breakfast';
  if (hour >= 12 && hour < 15) return 'Lunch';
  if (hour >= 17 && hour < 22) return 'Dinner';
  return 'Snack';
}

const draftNumberText = (value: unknown) => String(Number.isFinite(Number(value)) ? Number(value) : 0);
const draftEnergyText = (kcal: number, unit: EnergyUnit) => energyInputFromKcal(kcal, unit) || '0';
const roundedText = (value: number, decimals: number) => String(Number(value.toFixed(decimals)));
/** Scales a typed number, leaving a blank field blank. */
const scaledDraftText = (value: string, factor: number, decimals: number) => value.trim() === '' ? value : roundedText(n(value) * factor, decimals);
const positiveOr = (value: unknown, fallback: number) => n(value) > 0 ? n(value) : fallback;
/**
 * Servings eaten, or grams in 100g mode. A blank or invalid amount counts as one
 * serving or 100 g, the same for the total shown, the swipe and what gets saved.
 */
const draftPortion = (draft: Pick<EntryDraft, 'portion' | 'unitMode'>) => positiveOr(draft.portion, draft.unitMode === '100g' ? 100 : 1);

/**
 * Changes what the numbers are per (one serving or 100 g) without changing what
 * gets logged: 140 g at 66 Cal per 100 g becomes 1 serving of 92 Cal, and back.
 */
function switchDraftBasis(draft: EntryDraft, next: EntryDraft['unitMode']): Partial<EntryDraft> {
  if (draft.unitMode === next) return {};
  const scale = (factor: number) => ({
    calories: scaledDraftText(draft.calories, factor, draft.entryEnergyUnit === 'kj' ? 1 : 0),
    fat: scaledDraftText(draft.fat, factor, 1),
    carbs: scaledDraftText(draft.carbs, factor, 1),
    protein: scaledDraftText(draft.protein, factor, 1)
  });
  if (next === 'serving') {
    const grams = draftPortion(draft);
    // Keep a known serving size (1 slice = 30 g); otherwise what was eaten becomes the serving.
    const servingGrams = positiveOr(draft.servingGrams, grams);
    return { unitMode: next, portion: roundedText(grams / servingGrams, 2), servingGrams: roundedText(servingGrams, 1), ...scale(servingGrams / 100) };
  }
  const servings = draftPortion(draft);
  const servingGrams = positiveOr(draft.servingGrams, 0);
  // With no serving weight there is nothing to convert with, so the numbers stay and
  // the grams are set to log the same total until the real amount is typed.
  if (!servingGrams) return { unitMode: next, portion: roundedText(servings * 100, 1) };
  return { unitMode: next, portion: roundedText(servings * servingGrams, 1), ...scale(100 / servingGrams) };
}

type Toast = { id: number; text: string } | null;
type GeminiCheck = {
  state: 'idle' | 'testing' | 'ok' | 'error';
  modelId?: string;
  modelCount?: number;
  message?: string;
  detail?: string;
};
type MacroChipKey = 'fat' | 'carbs' | 'protein';
type EffectiveTheme = 'dark' | 'light';
const THEME_COLORS: Record<EffectiveTheme, string> = {
  dark: '#151713',
  light: '#f8f3e9'
};

const MODAL_SCROLL_LOCK_RELEASED_EVENT = 'modal-scroll-lock-released';
let modalScrollLockCount = 0;
let modalScrollLockY = 0;
let lockTouchStartY = 0;
let lockTouchStartX = 0;

/**
 * True when `target` sits inside a modal element that can still scroll in
 * `direction` ('down' = content moves up, scrollTop grows).
 */
function modalCanScroll(target: EventTarget | null, direction: 'up' | 'down') {
  let el = target instanceof Element ? target : null;
  while (el && !el.classList.contains('modal-backdrop')) {
    if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 1) {
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') {
        if (direction === 'down' ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true;
      }
    }
    el = el.parentElement;
  }
  return false;
}

function onLockTouchStart(event: TouchEvent) {
  lockTouchStartY = event.touches[0]?.clientY ?? 0;
  lockTouchStartX = event.touches[0]?.clientX ?? 0;
}

function onLockTouchMove(event: TouchEvent) {
  const touch = event.touches[0];
  if (!touch || event.touches.length > 1) return;
  const dy = touch.clientY - lockTouchStartY;
  const dx = touch.clientX - lockTouchStartX;
  // Sideways drags (sliders, chip rows) can't scroll the page vertically.
  if (Math.abs(dx) > Math.abs(dy)) return;
  if (!modalCanScroll(event.target, dy < 0 ? 'down' : 'up')) event.preventDefault();
}

function onLockWheel(event: WheelEvent) {
  if (!event.deltaY) return;
  if (!modalCanScroll(event.target, event.deltaY > 0 ? 'down' : 'up')) event.preventDefault();
}

/**
 * Stops the page behind modals from scrolling. This deliberately leaves html and
 * body styles alone: the previous lock made body position:fixed, and in an iOS
 * home-screen app (viewport-fit=cover, translucent status bar) WebKit then
 * measured the viewport about a status bar shorter, so the tab bar and scrim
 * sat too high, the sticky header vanished, and everything snapped back when
 * the lock was released at the end of the close animation. Shared across
 * modals so handoffs never unlock early.
 */
function acquireModalScrollLock() {
  if (modalScrollLockCount === 0) {
    modalScrollLockY = window.scrollY;
    document.addEventListener('touchstart', onLockTouchStart, { passive: true });
    document.addEventListener('touchmove', onLockTouchMove, { passive: false });
    document.addEventListener('wheel', onLockWheel, { passive: false });
  }

  modalScrollLockCount += 1;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    modalScrollLockCount = Math.max(0, modalScrollLockCount - 1);
    if (modalScrollLockCount > 0) return;

    document.removeEventListener('touchstart', onLockTouchStart);
    document.removeEventListener('touchmove', onLockTouchMove);
    document.removeEventListener('wheel', onLockWheel);
    // Only if something moved the page anyway (e.g. iOS scrolling for the keyboard).
    if (Math.abs(window.scrollY - modalScrollLockY) > 1) window.scrollTo(0, modalScrollLockY);
    window.dispatchEvent(new Event(MODAL_SCROLL_LOCK_RELEASED_EVENT));
  };
}

/**
 * Runs `fn` once no modal holds the scroll lock. Releasing the lock can restore
 * the old scroll offset, so scrolling to a section any earlier could be undone.
 */
function afterModalScrollLock(fn: () => void) {
  const run = () => requestAnimationFrame(() => requestAnimationFrame(fn));
  if (!modalScrollLockCount) {
    run();
    return;
  }
  const onReleased = () => {
    window.removeEventListener(MODAL_SCROLL_LOCK_RELEASED_EVENT, onReleased);
    run();
  };
  window.addEventListener(MODAL_SCROLL_LOCK_RELEASED_EVENT, onReleased);
}

function resolvedTheme(theme: ThemePreference): EffectiveTheme {
  if (theme === 'light' || theme === 'dark') return theme;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyThemePreference(theme: ThemePreference) {
  const effectiveTheme = resolvedTheme(theme);
  document.documentElement.dataset.theme = effectiveTheme;
  document.documentElement.dataset.themePreference = theme;
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) themeColor.content = THEME_COLORS[effectiveTheme];
  // index.html reads this before first paint, so a cold start opens straight in the right theme.
  try { localStorage.setItem('dawni-theme', theme); } catch { /* private mode */ }
}

/**
 * Replays the settle animation when `token` changes. Previously each screen used
 * `key={date}`, which remounted the whole subtree on every arrow tap: children
 * lost state and re-ran their effects (the food database load, menu positioning)
 * and the DOM was rebuilt. Restarting the animation on a stable node is cheaper.
 */
function useSettleAnimation(token: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove('view-transition');
    void el.offsetWidth; // reflow, so re-adding the class restarts the animation
    el.classList.add('view-transition');
  }, [token]);
  return ref;
}

type IconName = 'today' | 'week' | 'journal' | 'foods' | 'settings' | 'plus' | 'search' | 'sparkle' | 'menu' | 'chevron' | 'copy' | 'paste' | 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'drink' | 'edit' | 'heart';

/** Line icons drawn on a 24px grid, stroked in the current text colour. */
const ICON_PATHS: Record<IconName, ReactNode> = {
  today: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" strokeWidth="3" /></>,
  week: <><path d="M5 20V12M10 20V7M15 20v-6M20 20V4" /></>,
  journal: <><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" /><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" /><path d="M9 7.5h6" /></>,
  foods: <><path d="M7 3.5h10a1 1 0 0 1 1 1V21l-6-3.8L6 21V4.5a1 1 0 0 1 1-1z" /></>,
  settings: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  sparkle: <><path d="M10 3.5 11.7 8.3 16.5 10l-4.8 1.7L10 16.5l-1.7-4.8L3.5 10l4.8-1.7z" /><path d="M18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" /></>,
  menu: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
  chevron: <><path d="m9 5 7 7-7 7" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></>,
  paste: <><rect x="5" y="4.5" width="14" height="16.5" rx="2" /><path d="M9 4.5V3.5h6v1M9 11h6M9 15h4" /></>,
  breakfast: <><path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" /><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16" /><path d="M8 3.5c0 1.5 1.5 1.5 1.5 3M12 3.5c0 1.5 1.5 1.5 1.5 3" /></>,
  lunch: <><path d="M3.5 11h17a8.5 8.5 0 0 1-17 0z" /><path d="M8 11c0-2.5 1.8-4.5 4-4.5s4 2 4 4.5M12 6.5V4" /></>,
  dinner: <><path d="M6 3v7a2 2 0 0 0 4 0V3M8 10v11M17 21V3c-2 1-3 3.5-3 6.5V13h3" /></>,
  snack: <><path d="M12 7.5c-1.5-1.3-6.5-1.8-6.5 4 0 4.5 3 8.5 6.5 7 3.5 1.5 6.5-2.5 6.5-7 0-5.8-5-5.3-6.5-4z" /><path d="M12 7.5c0-2 1-3.5 3-4" /></>,
  drink: <><path d="M6 4h12l-1.5 15.2a2 2 0 0 1-2 1.8h-5a2 2 0 0 1-2-1.8z" /><path d="M6.6 10h10.8" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>,
  heart: <><path d="M12 19.5 5.5 13a4.6 4.6 0 0 1 6.5-6.5 4.6 4.6 0 0 1 6.5 6.5z" /></>
};

function Icon({ name, size = 22, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICON_PATHS[name]}
    </svg>
  );
}

/** Heart for a saved food: outlined, or filled once it's a favourite. What a tap changes is up to the caller. */
function FavouriteToggle({ on, onToggle, label = 'Favourite', size = 22 }: { on: boolean; onToggle: () => void; label?: string; size?: number }) {
  const [pop, setPop] = useState(false);
  return (
    <button
      type="button"
      className={['fav-toggle', on ? 'on' : '', pop ? 'pop' : ''].filter(Boolean).join(' ')}
      aria-label={label}
      aria-pressed={on}
      onClick={() => {
        setPop(!on);
        onToggle();
      }}
      onAnimationEnd={() => setPop(false)}
    >
      <Icon name="heart" size={size} filled={on} />
    </button>
  );
}

const MEAL_ICON: Record<Meal, IconName> = { Breakfast: 'breakfast', Lunch: 'lunch', Dinner: 'dinner', Snack: 'snack', Drink: 'drink' };
const TAB_ICON: Record<Tab, IconName> = { tracking: 'today', stats: 'week', journal: 'journal', library: 'foods', settings: 'settings' };

function MacroChips({ fat = 0, carbs = 0, protein = 0, show = ['fat', 'carbs', 'protein'] }: { fat?: number; carbs?: number; protein?: number; show?: MacroChipKey[] }) {
  const chips: Record<MacroChipKey, { label: string; value: number; className: string }> = {
    fat: { label: 'F', value: fat, className: 'fat' },
    carbs: { label: 'C', value: carbs, className: 'carb' },
    protein: { label: 'P', value: protein, className: 'protein' }
  };
  return (
    <>
      {show.map(key => {
        const chip = chips[key];
        return <span key={key} className={`meta-chip macro-chip ${chip.className}`}>{chip.label} {fmt(chip.value)}g</span>;
      })}
    </>
  );
}

function Modal({ open, title, children, onClose, wide = false, className = '', bottomSheet = false, closeDisabled = false }: { open: boolean; title: string; children: ReactNode; onClose: () => void; wide?: boolean; className?: string; bottomSheet?: boolean; closeDisabled?: boolean }) {
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);
  // `entered` drives the CSS transition for bottom-sheet open/close.
  // Default (not entered) = panel offscreen; entered = panel in view.
  const [entered, setEntered] = useState(false);
  const closingRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof window.setTimeout> | undefined>(undefined);
  const rafRef = useRef<ReturnType<typeof requestAnimationFrame> | undefined>(undefined);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const renderedRef = useRef(rendered);
  renderedRef.current = rendered;
  const closeDisabledRef = useRef(closeDisabled);
  closeDisabledRef.current = closeDisabled;
  const panelRef = useRef<HTMLElement>(null);
  const CLOSE_MS = bottomSheet ? 320 : 180;

  // Body scroll lock is shared across modal instances so handoffs cannot unlock the page early.
  useEffect(() => {
    if (!rendered) return;
    return acquireModalScrollLock();
  }, [rendered]);

  // Single close gate — all dismiss paths funnel here.
  const requestClose = useCallback((force = false) => {
    if (closeDisabled && !force) return;
    if (closingRef.current) return;
    closingRef.current = true;
    cancelAnimationFrame(rafRef.current!);
    // Removing `entered` triggers the CSS transition back to translate3d(0,110%,0).
    setEntered(false);
    setClosing(true);
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setRendered(false);
      setClosing(false);
      closingRef.current = false;
      onCloseRef.current();
    }, CLOSE_MS);
  }, [CLOSE_MS, closeDisabled]);

  // Swipe down to close, like an iOS sheet: from the handle/title bar, or from the
  // content once it is scrolled to the top. Native listeners, because React's
  // touch handlers are passive and could not stop the page scrolling.
  useEffect(() => {
    const panel = panelRef.current;
    if (!rendered || !panel) return;
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let eligible = false;
    let decided = false;
    let dragging = false;
    let offset = 0;
    const scrim = () => panel.parentElement?.querySelector<HTMLElement>(':scope > .modal-scrim') || null;
    const isTopmost = () => {
      const backdrops = document.querySelectorAll('.modal-backdrop');
      return backdrops[backdrops.length - 1] === panel.parentElement;
    };
    const reset = () => {
      dragging = false;
      decided = false;
      offset = 0;
    };
    const onStart = (event: TouchEvent) => {
      reset();
      const target = event.target instanceof Element ? event.target : null;
      eligible = !!target
        && event.touches.length === 1
        && !closeDisabledRef.current
        && !closingRef.current
        && isTopmost()
        // Typing, sliders and swipe-to-confirm keep their own gestures.
        && !target.closest('input, textarea, select, [contenteditable="true"], .swipe-confirm')
        && (!!target.closest('.modal-head') || !modalCanScroll(target, 'up'));
      startX = event.touches[0]?.clientX ?? 0;
      startY = event.touches[0]?.clientY ?? 0;
      startTime = performance.now();
    };
    const onMove = (event: TouchEvent) => {
      if (!eligible) return;
      const touch = event.touches[0];
      if (!touch) return;
      const dy = touch.clientY - startY;
      const dx = touch.clientX - startX;
      if (!decided) {
        if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
        decided = true;
        dragging = dy > 0 && Math.abs(dy) > Math.abs(dx);
        if (!dragging) return;
        panel.style.transition = 'none';
      }
      if (!dragging) return;
      event.preventDefault();
      offset = Math.max(0, dy);
      panel.style.transform = `translate3d(0, ${offset}px, 0)`;
      const fade = scrim();
      if (fade) fade.style.opacity = String(Math.max(0.25, 1 - offset / Math.max(panel.offsetHeight, 1)));
    };
    const onEnd = () => {
      if (!dragging) return reset();
      const elapsed = Math.max(1, performance.now() - startTime);
      const fast = offset / elapsed > 0.6 && offset > 40;
      const far = offset > Math.min(140, panel.offsetHeight * 0.25);
      const fade = scrim();
      if (fast || far) {
        panel.style.transition = `transform ${Math.min(CLOSE_MS, 220)}ms cubic-bezier(.2, .8, .2, 1)`;
        panel.style.transform = 'translate3d(0, 110%, 0)';
        if (fade) {
          fade.style.transition = `opacity ${Math.min(CLOSE_MS, 220)}ms ease`;
          fade.style.opacity = '0';
        }
        requestClose();
      } else {
        panel.style.transition = 'transform 220ms cubic-bezier(.2, .8, .2, 1)';
        panel.style.transform = '';
        if (fade) {
          fade.style.transition = 'opacity 220ms ease';
          fade.style.opacity = '';
        }
        window.setTimeout(() => {
          if (closingRef.current) return;
          panel.style.transition = '';
          if (fade) fade.style.transition = '';
        }, 240);
      }
      reset();
    };
    panel.addEventListener('touchstart', onStart, { passive: true });
    panel.addEventListener('touchmove', onMove, { passive: false });
    panel.addEventListener('touchend', onEnd, { passive: true });
    panel.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      panel.removeEventListener('touchstart', onStart);
      panel.removeEventListener('touchmove', onMove);
      panel.removeEventListener('touchend', onEnd);
      panel.removeEventListener('touchcancel', onEnd);
    };
  }, [rendered, requestClose, CLOSE_MS]);

  // Esc closes the topmost modal on desktop.
  useEffect(() => {
    if (!rendered || !open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const backdrops = document.querySelectorAll('.modal-backdrop');
      if (backdrops[backdrops.length - 1] !== panelRef.current?.parentElement) return;
      event.preventDefault();
      requestClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [rendered, open, requestClose]);

  useEffect(() => {
    if (open) {
      window.clearTimeout(closeTimerRef.current);
      cancelAnimationFrame(rafRef.current!);
      closingRef.current = false;
      setRendered(true);
      setClosing(false);
      setEntered(false); // start off-screen
      if (!bottomSheet) {
        // Non-bottom-sheet: no entrance transition needed, always entered.
        setEntered(true);
        return;
      }
      // Bottom sheet: one RAF so the browser paints the offscreen starting
      // position before the enter transition fires.
      rafRef.current = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(rafRef.current!);
    }
    // Nothing on screen (e.g. first mount while closed): closing anyway would
    // call onClose a moment later and shut whichever modal opened meanwhile,
    // which is how the launch-time backup reminder vanished before it was seen.
    if (!renderedRef.current || closingRef.current) return;
    requestClose(true);
  }, [open, requestClose, bottomSheet]);

  if (!rendered) return null;
  const panelClass = ['modal-panel', wide ? 'wide' : '', bottomSheet ? 'modal-panel--bottom-sheet' : '', className].filter(Boolean).join(' ');
  const backdropMouse = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    requestClose();
  };
  return (
    <div
      className={`modal-backdrop ${entered ? 'entered' : ''} ${closing ? 'closing' : ''} ${bottomSheet ? 'modal-backdrop--scrim' : ''}`}
      data-swipe-lock
      onMouseDown={bottomSheet ? undefined : backdropMouse}
    >
      {bottomSheet && <div className="modal-scrim" data-swipe-lock onMouseDown={backdropMouse} />}
      <section ref={panelRef} className={panelClass} data-swipe-lock role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="close" type="button" onClick={() => requestClose()} aria-label="Close" disabled={closeDisabled}><span aria-hidden="true" /></button>
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

function Field({ label, children, full = false }: { label: string; children: ReactNode; full?: boolean }) {
  return <label className={full ? 'field full' : 'field'}><span>{label}</span>{children}</label>;
}

function DayNav({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const isToday = value === todayKey();
  return (
    <div className="date-row">
      <button className="date-btn prev" type="button" aria-label="Previous day" onClick={() => onChange(addDays(value, -1))} />
      <button className={`date-pill ${isToday ? 'current' : 'can-reset'}`} type="button" onClick={() => !isToday && onChange(todayKey())}>
        <span>{isToday ? 'Today' : 'Back to today'}</span>
        <small>{new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</small>
      </button>
      <button className="date-btn next" type="button" aria-label="Next day" onClick={() => onChange(addDays(value, 1))} />
    </div>
  );
}

function MonthNav({ value, onChange }: { value: Date; onChange: (date: Date) => void }) {
  const year = value.getFullYear();
  const month = value.getMonth();
  const now = new Date();
  const isThisMonth = year === now.getFullYear() && month === now.getMonth();
  return (
    <div className="month-tools">
      <button className="small-btn month-nav prev" type="button" aria-label="Previous month" onClick={() => onChange(new Date(year, month - 1, 1))} />
      <button className={`month-title ${isThisMonth ? 'current' : 'can-reset'}`} type="button" onClick={() => !isThisMonth && onChange(new Date(now.getFullYear(), now.getMonth(), 1))}>
        <span>{isThisMonth ? 'This month' : 'Return to this month'}</span>
        <strong>{value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
      </button>
      <button className="small-btn month-nav next" type="button" aria-label="Next month" onClick={() => onChange(new Date(year, month + 1, 1))} />
    </div>
  );
}

function DayCalorieGoalPanel({
  state,
  date,
  suggested,
  effective,
  hasOverride,
  past,
  onPersist
}: {
  state: AppState;
  date: string;
  suggested: number;
  effective: number;
  hasOverride: boolean;
  past: boolean;
  onPersist: (kcal: number | null) => void;
}) {
  const [typedValue, setTypedValue] = useState('');
  const { min, max } = dayCalorieSliderBounds(suggested);
  const safe = Math.min(max, Math.max(min, effective));
  const unit = energyUnitValue(state.settings.energyUnit);
  const sliderStepKcal = 10;
  const sliderId = `day-cal-goal-${date}`;
  const inputId = `day-cal-goal-input-${date}`;
  const applyTyped = () => {
    const raw = typedValue.trim();
    if (!raw) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const kcal = energyInputToKcal(parsed, unit);
    onPersist(kcal);
    setTypedValue('');
  };
  if (past) return <p className="hint">This day has finished, so it keeps its usual target.</p>;
  return (
        <div className="day-calorie-goal-expand">
          <p className="hint day-calorie-goal-hint">Eating more or less on purpose today? Set this day&apos;s calories here. Protein, carbs and fat keep your usual targets.</p>
          <div className="day-calorie-slider-well">
            <div className="day-calorie-slider-row">
              <span className="day-calorie-endpoint" aria-hidden="true">{fmt(energyValue(state, min))}</span>
              <input
                id={sliderId}
                className="day-calorie-slider"
                type="range"
                aria-valuemin={min}
                aria-valuemax={max}
                aria-valuenow={safe}
                min={min}
                max={max}
                step={sliderStepKcal}
                value={safe}
                onChange={event => {
                  const kcal = Number(event.target.value);
                  if (!Number.isFinite(kcal)) return;
                  onPersist(kcal);
                }}
              />
              <span className="day-calorie-endpoint" aria-hidden="true">{fmt(energyValue(state, max))}</span>
            </div>
            <div className="day-calorie-input-row">
              <label className="day-calorie-input-label" htmlFor={inputId}>Type a target ({energyUnitLabel(unit)})</label>
              <div className="day-calorie-input-controls">
                <input
                  id={inputId}
                  className="day-calorie-input"
                  inputMode="numeric"
                  type="number"
                  step={unit === 'kj' ? 10 : 10}
                  placeholder={String(fmt(energyValue(state, safe))).replaceAll(',', '')}
                  value={typedValue}
                  onChange={event => setTypedValue(event.target.value)}
                  onKeyDown={event => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    applyTyped();
                  }}
                />
                <button type="button" className="secondary day-calorie-apply" onClick={applyTyped} disabled={!typedValue.trim()}>
                  Set
                </button>
              </div>
            </div>
          </div>
          <div className="day-calorie-goal-foot">
            <span className="hint">Your usual target is {energyText(state, suggested)}{state.settings.spreadWeeklyBank ? ' · includes week bank spread' : ''}</span>
            {hasOverride ? (
              <button type="button" className="secondary day-calorie-reset" onClick={() => onPersist(null)}>
                Use usual target
              </button>
            ) : null}
          </div>
        </div>
  );
}

function AppShell({ tab, setTab, children }: { tab: Tab; setTab: (tab: Tab) => void; children: ReactNode }) {
  const [navHidden, setNavHidden] = useState(false);

  useEffect(() => {
    const inputTypesWithoutKeyboard = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);
    const isInsideAppModal = (el: EventTarget | null) => el instanceof HTMLElement && !!el.closest('.modal-backdrop');
    /** True while any modal backdrop is mounted (including during close animation). */
    const isModalLayerPresent = () => !!document.querySelector('.modal-backdrop');
    const isTextEntryElement = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (isInsideAppModal(target)) return false;
      if (target.matches('textarea, select, [contenteditable="true"]')) return true;
      if (!(target instanceof HTMLInputElement)) return false;
      return !inputTypesWithoutKeyboard.has(target.type);
    };
    const refresh = () => {
      if (isModalLayerPresent()) return;
      setNavHidden(isTextEntryElement(document.activeElement));
    };
    const onModalScrollLockReleased = () => requestAnimationFrame(refresh);
    const onFocusIn = (event: FocusEvent) => {
      if (isModalLayerPresent()) return;
      setNavHidden(isTextEntryElement(event.target));
    };
    const onFocusOut = () => {
      const hadModal = !!document.querySelector('.modal-backdrop');
      window.setTimeout(refresh, 0);
      if (hadModal) window.setTimeout(refresh, 400);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    window.addEventListener(MODAL_SCROLL_LOCK_RELEASED_EVENT, onModalScrollLockReleased);
    refresh();
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      window.removeEventListener(MODAL_SCROLL_LOCK_RELEASED_EVENT, onModalScrollLockReleased);
    };
  }, []);

  return (
    <>
      <div className="status-bar-scrim" aria-hidden="true" />
      <main className="app">{children}</main>
      <nav className={`nav ${navHidden ? 'hidden' : ''}`} aria-label="Main tabs" aria-hidden={navHidden}>
        <div className="nav-inner">
          {TABS.map(([id, label]) => (
            <button key={id} className={`tab tab-${id} ${tab === id ? 'active' : ''}`} type="button" onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}>
              <Icon name={TAB_ICON[id]} size={24} />
              {label}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}

export function App() {
  const [state, setState] = useState<AppState>(() => structuredClone(DEFAULT));
  const [loaded, setLoaded] = useState(false);
  const [tab, setTabState] = useState<Tab>(() => storedTab(localStorage.getItem('calorie-tracker-active-tab')));
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [journalMonth, setJournalMonth] = useState(() => new Date());
  const [journalDay, setJournalDay] = useState<string | null>(null);
  const [journalDayViewMode, setJournalDayViewMode] = useState<JournalDayViewMode>('collage');
  const [journalLabelMode, setJournalLabelMode] = useState<JournalLabelMode>('calories');
  const [journalShuffleSeed, setJournalShuffleSeed] = useState(0);
  const [librarySub, setLibrarySub] = useState(() => localStorage.getItem('calorie-tracker-library-sub') || 'favourites');
  const [historySearch, setHistorySearch] = useState('');
  const [dayLogView, setDayLogView] = useState<'group' | 'list'>('group');
  const [modal, setModal] = useState<ModalName>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [entryDraft, setEntryDraft] = useState<EntryDraft>(() => blankEntryDraft());
  const [entryOpenMode, setEntryOpenMode] = useState<EntryOpenMode>('manual');
  const [activeFoodId, setActiveFoodId] = useState('');
  const [activePhotoEntryId, setActivePhotoEntryId] = useState('');
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [activeMealCard, setActiveMealCard] = useState<MealGroup | null>(null);
  const [bankingWeekStart, setBankingWeekStart] = useState(() => weekStartMonday(todayKey()));
  const [settingsFocus, setSettingsFocus] = useState<'gemini' | null>(null);
  const [goalsEditing, setGoalsEditing] = useState(false);
  const [goalDraft, setGoalDraft] = useState<Settings>(DEFAULT.settings);
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);
  const [aiQuickLogMeal, setAiQuickLogMeal] = useState<Meal>('Snack');
  const [aiQuickLogSeedText, setAiQuickLogSeedText] = useState('');
  const [estimateSession, setEstimateSession] = useState<EstimateSession | null>(null);
  const tabScrollRef = useRef<Partial<Record<Tab, number>>>({});
  const nextTabScrollRef = useRef(0);
  const importRef = useRef<HTMLInputElement>(null);
  const customDatabaseImportRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const entryPhotoInputRef = useRef<HTMLInputElement>(null);

  const notify = (text: string, durationMs: number = 1800) => {
    const id = Date.now();
    setToast({ id, text });
    window.setTimeout(() => setToast(current => current?.id === id ? null : current), durationMs);
  };

  const persist = async (next: AppState) => {
    const normalized = normalizeStateShape(next);
    setState(normalized);
    await saveState(normalized);
  };

  useEffect(() => {
    readState().then(next => {
      setState(next);
      setGoalDraft(next.settings);
      setLoaded(true);
      document.documentElement.style.setProperty('--accent', next.settings.accent || '#c9dc86');
      applyThemePreference(next.settings.theme || DEFAULT.settings.theme);
    });
  }, []);

  useEffect(() => {
    // Until the saved settings load, keep what index.html applied rather than flashing the defaults.
    if (!loaded) return;
    const accent = state.settings.accent || '#c9dc86';
    document.documentElement.style.setProperty('--accent', accent);
    try { localStorage.setItem('dawni-accent', accent); } catch { /* private mode */ }
  }, [state.settings.accent, loaded]);

  useEffect(() => {
    if (!loaded) return;
    const theme = state.settings.theme || DEFAULT.settings.theme;
    applyThemePreference(theme);
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => applyThemePreference(theme);
    if (media.addEventListener) {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, [state.settings.theme, loaded]);

  useEffect(() => {
    if (!loaded) return;
    console.info(`[Dawni] v${APP_VERSION}`);
    clearUpdateReloadMarkers();
    const onUpdate = (update: UpdateInfo) => {
      setAvailableUpdate(update);
      setModal('version');
    };
    registerServiceWorker(onUpdate).catch(console.warn);
    checkForAppUpdate(onUpdate).catch(console.warn);
    // Installed on a home screen, the app is suspended rather than closed, so it
    // also has to re-check whenever it comes back to the foreground.
    return watchForUpdatesOnResume(onUpdate);
  }, [loaded]);

  useEffect(() => {
    if (!loaded || modal) return;
    const hasData = state.entries.length || state.foods.length;
    if (!hasData) return;
    const due = validBackupReminderDays(state.settings.backupReminderDays);
    if (backupAgeDays(state) >= due && normalizeDateKey(state.settings.lastBackupReminderShownAt) !== todayKey()) {
      setModal('backupReminder');
      persist({ ...state, settings: { ...state.settings, lastBackupReminderShownAt: todayKey() } }).catch(console.warn);
    }
    // `state` belongs here: without it this read a stale snapshot. Re-running is
    // safe because setting lastBackupReminderShownAt closes the guard above.
  }, [loaded, modal, state]);

  const setTab = (next: Tab, options: SetTabOptions = {}) => {
    const reTap = next === tab && !options.date;
    // A modal can let iOS nudge the page (keyboard), so only remember offsets
    // taken while no modal is open.
    if (!modalScrollLockCount) tabScrollRef.current[tab] = window.scrollY;
    // Track always opens at the top on today (or the day another screen asked
    // for), and re-tapping a tab resets it.
    const resetToTop = next === 'tracking' || reTap || !!options.resetScroll;
    if (next === 'tracking') setSelectedDate(options.date || todayKey());
    if (next === 'journal' && reTap) {
      setJournalDay(null);
      setJournalMonth(new Date());
    }
    if (next === 'stats' && reTap) {
      setSelectedDate(todayKey());
      setBankingWeekStart(weekStartMonday(todayKey()));
    }
    if (resetToTop) tabScrollRef.current[next] = 0;
    nextTabScrollRef.current = tabScrollRef.current[next] ?? 0;
    if (reTap) {
      // Same tab, so the restore effect below will not fire: scroll here instead.
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch {
        window.scrollTo(0, 0);
      }
    }
    setTabState(next);
    localStorage.setItem('calorie-tracker-active-tab', next);
  };

  const updateState = (recipe: (state: AppState) => AppState | void) => {
    const draft = structuredClone(state);
    const result = recipe(draft) || draft;
    return persist(result);
  };

  // Each tab keeps its own scroll offset, the way a native tab bar does. Before
  // paint, so switching never flashes at the offset from the previous tab.
  useLayoutEffect(() => {
    window.scrollTo({ top: nextTabScrollRef.current, behavior: 'auto' });
  }, [tab]);

  // Shortcuts between screens: a day or week shown in one place opens where it can be acted on.
  const openDayInTrack = (date: string) => setTab('tracking', { date });
  const openWeek = (date: string) => {
    setBankingWeekStart(weekStartMonday(date));
    setTab('stats', { resetScroll: true });
  };
  const openSettingsSection = (sectionId: 'backupSection' | 'geminiSection') => {
    setModal(null);
    if (sectionId === 'geminiSection') setSettingsFocus('gemini');
    setTab('settings', { resetScroll: true });
    afterModalScrollLock(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const entries = useMemo(() => dayEntries(state, selectedDate), [state, selectedDate]);
  const totals = useMemo(() => sum(entries), [entries]);
  const mealGroups = useMemo(() => getMealGroups(state), [state]);
  // The selected day without the entry being edited, so Log food can show what saving it leaves.
  const entryDay = useMemo(() => ({
    eaten: sum(entries.filter(entry => entry.id !== entryDraft.editingId)).calories,
    target: resolveDayCalorieTarget(state, selectedDate).effective,
    bulking: goalForDate(state, selectedDate).trackingMode === 'Bulking',
    date: selectedDate
  }), [entries, entryDraft.editingId, state, selectedDate]);

  const openEntry = (meal: Meal = defaultMealForCurrentTime()) => {
    flushSync(() => {
      setEntryDraft(blankEntryDraft(meal, energyUnitValue(state.settings.energyUnit)));
      setEntryOpenMode('manual');
      setModal('entry');
    });
    const caloriesInput = document.getElementById('entryCalories') as HTMLInputElement | null;
    caloriesInput?.focus({ preventScroll: true });
    caloriesInput?.select();
  };

  const editEntry = (entry: Entry) => {
    const sourceFood = entry.sourceFoodId ? state.foods.find(food => food.id === entry.sourceFoodId) : null;
    setEntryDraft({
      editingId: entry.id,
      sourceFoodId: entry.sourceFoodId || '',
      name: entry.name,
      meal: entry.meal || 'Snack',
      unitMode: entryUnitModeValue(entry.unitMode),
      brand: sourceFood?.brand || '',
      servingLabel: sourceFood?.servingLabel || '',
      servingGrams: sourceFood?.servingGrams ? String(sourceFood.servingGrams) : '',
      source: sourceFood?.source || '',
      sourceId: sourceFood?.sourceId || '',
      category: sourceFood?.category || '',
      tags: sourceFood?.tags || [],
      entryEnergyUnit: energyUnitValue(state.settings.energyUnit),
      calories: draftEnergyText(macroBase(entry, 'calories'), energyUnitValue(state.settings.energyUnit)),
      protein: draftNumberText(macroBase(entry, 'protein')),
      carbs: draftNumberText(macroBase(entry, 'carbs')),
      fat: draftNumberText(macroBase(entry, 'fat')),
      portion: fmtPortion(entry.portion),
      notes: entry.notes || '',
      favourite: null,
      photo: entry.photo || null,
      estimateSource: estimateSourceValue(entry.estimateSource),
      estimateDetails: null
    });
    setEntryOpenMode('edit');
    setModal('entry');
  };

  const formEntry = () => {
    const id = entryDraft.editingId || uid();
    const rawName = entryDraft.name.trim();
    const autoNamed = !rawName;
    return normalizeEntry({
      id,
      sourceFoodId: entryDraft.sourceFoodId || null,
      date: selectedDate,
      name: rawName || `${entryDraft.meal} entry`,
      autoNamed,
      unitMode: entryDraft.unitMode,
      baseCalories: energyInputToKcal(entryDraft.calories, entryDraft.entryEnergyUnit),
      baseProtein: n(entryDraft.protein),
      baseCarbs: n(entryDraft.carbs),
      baseFat: n(entryDraft.fat),
      portion: draftPortion(entryDraft),
      calories: energyInputToKcal(entryDraft.calories, entryDraft.entryEnergyUnit),
      protein: n(entryDraft.protein),
      carbs: n(entryDraft.carbs),
      fat: n(entryDraft.fat),
      meal: entryDraft.meal,
      estimateSource: entryDraft.estimateSource,
      notes: entryDraft.notes.trim(),
      photo: entryDraft.photo,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  };

  const touchFoodAfterLog = (draftState: AppState, entry: Entry): FavouriteChange => {
    if (entry.autoNamed) return null;
    const isDatabaseFood = entryDraft.source === 'foodEstimateDatabase' || entryDraft.source === 'customFoodDatabase';
    return recordFoodUse(draftState.foods, {
      sourceFoodId: entry.sourceFoodId,
      favourite: entryDraft.favourite,
      fromDatabase: isDatabaseFood,
      now: Date.now(),
      newId: uid,
      snapshot: {
        name: entry.name,
        unitMode: entryUnitModeValue(entry.unitMode),
        brand: entryDraft.brand.trim() || undefined,
        servingLabel: entryDraft.servingLabel.trim() || undefined,
        servingGrams: n(entryDraft.servingGrams) || undefined,
        source: isDatabaseFood ? undefined : entryDraft.source.trim() || undefined,
        sourceId: entryDraft.sourceId.trim() || undefined,
        category: entryDraft.category.trim() || undefined,
        tags: entryDraft.tags.length ? entryDraft.tags : undefined,
        calories: macroBase(entry, 'calories'),
        protein: macroBase(entry, 'protein'),
        carbs: macroBase(entry, 'carbs'),
        fat: macroBase(entry, 'fat'),
        estimateSource: entry.estimateSource || undefined
      }
    });
  };

  const saveEntry = async (keepOpen = false) => {
    if (!entryDraft.calories) return notify(`${energyUnitLabel(entryDraft.entryEnergyUnit)} required`);
    if (entryDraft.favourite && !entryDraft.name.trim()) {
      document.getElementById('entryName')?.focus();
      return notify('Name this food to save it as a favourite');
    }
    const entry = formEntry();
    let favouriteChange = null as FavouriteChange;
    await updateState(draft => {
      const idx = draft.entries.findIndex(item => item.id === entry.id);
      if (idx >= 0) {
        entry.createdAt = draft.entries[idx].createdAt;
        draft.entries[idx] = entry;
      } else {
        draft.entries.push(entry);
      }
      favouriteChange = touchFoodAfterLog(draft, entry);
    });
    const saved = entryDraft.editingId ? 'Entry updated' : 'Entry saved';
    notify(favouriteChange ? `${saved} · ${favouriteChange === 'added' ? 'added to' : 'removed from'} favourites` : saved);
    if (keepOpen) setEntryDraft(blankEntryDraft(entryDraft.meal, energyUnitValue(state.settings.energyUnit)));
    else setModal(null);
  };

  const repeatEntry = async (entry: Entry) => {
    const destination = todayKey();
    await updateState(draft => {
      const { photo: _photo, ...entryWithoutPhoto } = entry;
      const copy = normalizeEntry({ ...entryWithoutPhoto, id: uid(), date: destination, photo: null, createdAt: Date.now(), updatedAt: Date.now() });
      draft.entries.push(copy);
    });
    notify('Entry repeated to today');
  };

  /** Calories only, tagged Rough guess, and kept out of saved foods and recents. */
  const logRoughMeal = async (meal: Meal, kcal: number, size: string | null) => {
    const entry = normalizeEntry({
      id: uid(),
      sourceFoodId: null,
      date: selectedDate,
      name: `${meal} (${size ? size.toLowerCase() : 'rough'})`,
      unitMode: 'serving',
      portion: 1,
      baseCalories: kcal,
      baseProtein: 0,
      baseCarbs: 0,
      baseFat: 0,
      calories: kcal,
      protein: 0,
      carbs: 0,
      fat: 0,
      meal,
      estimateSource: 'rough',
      notes: 'Rough guess for a meal that was hard to track. Edit it if you find out more.',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    await updateState(draft => {
      draft.entries.push(entry);
    });
    setModal(null);
    notify(`Rough ${meal.toLowerCase()} logged: ${energyText(state, kcal)}`);
  };

  const deleteEntry = async (id: string) => {
    if (!confirm('Delete this entry?')) return;
    await updateState(draft => {
      draft.entries = draft.entries.filter(entry => entry.id !== id);
    });
    notify('Entry deleted');
  };

  const prefillFood = (food: Food) => {
    const entryEnergyUnit = energyUnitValue(state.settings.energyUnit);
    setEntryDraft({
      ...blankEntryDraft(defaultMealForCurrentTime(), entryEnergyUnit),
      sourceFoodId: food.source ? '' : food.id,
      name: food.name,
      unitMode: entryUnitModeValue(food.unitMode),
      brand: food.brand || '',
      servingLabel: food.servingLabel || '',
      servingGrams: food.servingGrams ? String(food.servingGrams) : '',
      source: food.source || '',
      sourceId: food.sourceId || '',
      category: food.category || '',
      tags: food.tags || [],
      calories: draftEnergyText(food.calories, entryEnergyUnit),
      protein: draftNumberText(food.protein),
      carbs: draftNumberText(food.carbs),
      fat: draftNumberText(food.fat),
      portion: entryUnitModeValue(food.unitMode) === '100g' ? '100' : '1',
      estimateSource: estimateSourceValue(food.estimateSource)
    });
    setEntryOpenMode('prefill');
    setModal('entry');
  };

  const prefillAiQuickLog = (entry: AiQuickLogEntry) => {
    setAiQuickLogSeedText('');
    const entryEnergyUnit = energyUnitValue(state.settings.energyUnit);
    const portion = amountPortionValue(entry.amount);
    const servingLabel =
      entry.unitMode === '100g'
        ? (entry.amount.trim() ? entry.amount : `${portion} g`)
        : entry.amount;
    flushSync(() => {
      setEntryDraft({
        ...blankEntryDraft(entry.meal, entryEnergyUnit),
        name: entry.name,
        unitMode: entry.unitMode,
        servingLabel,
        calories: draftEnergyText(entry.calories, entryEnergyUnit),
        protein: draftNumberText(entry.protein),
        carbs: draftNumberText(entry.carbs),
        fat: draftNumberText(entry.fat),
        portion,
        notes: entry.notes,
        estimateSource: 'ai',
        estimateDetails: null
      });
      setEntryOpenMode('prefill');
      setModal('entry');
    });
  };

  const pasteAiQuickLogFromClipboard = async () => {
    if (!navigator.clipboard?.readText) return notify('Clipboard paste is not available here.');
    try {
      const raw = await navigator.clipboard.readText();
      const trimmed = raw.trim();
      if (!trimmed) return notify('Clipboard is empty.');
      const parsed = parseAiQuickLog(trimmed, defaultMealForCurrentTime());
      if (parsed) {
        setAiQuickLogSeedText('');
        prefillAiQuickLog(parsed);
        return;
      }
      notify('Couldn\u2019t read that format. You can fix it below.');
      setAiQuickLogMeal(defaultMealForCurrentTime());
      setAiQuickLogSeedText(raw);
      setModal('aiQuickLog');
    } catch {
      notify('Could not read from clipboard.');
    }
  };

  const openGeminiEstimate = () => {
    if (!state.settings.geminiApiKey.trim()) return setModal('geminiSetup');
    setModal('geminiEstimate');
  };

  const openMenuPick = () => {
    if (!state.settings.geminiApiKey.trim()) return setModal('geminiSetup');
    setModal('menuPick');
  };

  const prefillMenuPick = (item: MenuPickItem, meal: Meal) => {
    const entryEnergyUnit = energyUnitValue(state.settings.energyUnit);
    // Refine re-asks the last Gemini estimate, so an earlier one must not replace this pick.
    setEstimateSession(null);
    flushSync(() => {
      setEntryDraft({
        ...blankEntryDraft(meal, entryEnergyUnit),
        name: item.name,
        calories: draftEnergyText(item.calories, entryEnergyUnit),
        protein: draftNumberText(item.protein),
        carbs: draftNumberText(item.carbs),
        fat: draftNumberText(item.fat),
        notes: estimateNotes(item.fromMenu ? 'Energy printed on the menu.' : 'Estimated from a menu photo.', item.assumptions, item.confidence),
        estimateSource: item.fromMenu ? 'menu' : 'ai',
        estimateDetails: { confidence: item.confidence, assumptions: item.assumptions }
      });
      setEntryOpenMode('prefill');
      setModal('entry');
    });
  };

  /** With `keepChoices` (a refine), Gemini's new numbers replace the old ones but the meal, photo and favourite picked while reviewing stay. */
  const prefillGeminiEstimate = (estimate: GeminiEstimate, keepChoices = false) => {
    setToast(null); // The "Estimating…" message would otherwise cover the result.
    const entryEnergyUnit = energyUnitValue(state.settings.energyUnit);
    const fromLabel = estimate.source === 'label';
    flushSync(() => {
      setEntryDraft(current => {
        const next: EntryDraft = {
          ...blankEntryDraft(estimate.meal, entryEnergyUnit),
          name: estimate.name,
          unitMode: estimate.unitMode,
          servingLabel: estimate.servingLabel,
          calories: draftEnergyText(estimate.base.calories, entryEnergyUnit),
          protein: draftNumberText(Math.round(estimate.base.protein * 10) / 10),
          carbs: draftNumberText(Math.round(estimate.base.carbs * 10) / 10),
          fat: draftNumberText(Math.round(estimate.base.fat * 10) / 10),
          portion: String(estimate.portion),
          notes: estimateNotes(fromLabel ? 'Read from the nutrition label.' : estimate.notes, estimate.assumptions, estimate.confidence),
          estimateSource: fromLabel ? 'label' : 'ai',
          estimateDetails: { confidence: estimate.confidence, assumptions: estimate.assumptions }
        };
        return keepChoices ? { ...next, meal: current.meal, photo: current.photo, favourite: current.favourite } : next;
      });
      setEntryOpenMode('prefill');
      setModal('entry');
    });
  };

  /** Asks Gemini; with `correction`, refines the last estimate using the same photos. */
  const runGeminiEstimate = async (description: string, photos: string[], correction?: string) => {
    const meal = correction && estimateSession ? estimateSession.meal : defaultMealForCurrentTime();
    const raw = await requestMealEstimate({
      apiKey: state.settings.geminiApiKey,
      userText: buildEstimateRequest({
        description,
        photoCount: photos.length,
        meal,
        preferences: state.settings.aiPreferences,
        previous: correction ? estimateSession?.reply : undefined,
        correction
      }),
      imageDataUrls: photos,
      accept: text => !!parseGeminiEstimate(text, meal)
    });
    return { raw, meal, parsed: parseGeminiEstimate(raw, meal) };
  };

  const estimateWithGemini = async (description: string, photos: string[]) => {
    notify('Estimating… You can close this and navigate again once the result is back.', 6000);
    const { raw, meal, parsed } = await runGeminiEstimate(description, photos);
    if (parsed) {
      setEstimateSession({ description, photos, meal, reply: raw });
      setAiQuickLogSeedText('');
      prefillGeminiEstimate(parsed);
      return;
    }
    notify('Gemini returned text Dawni could not read. You can fix it below.');
    setAiQuickLogMeal(meal);
    setAiQuickLogSeedText(raw);
    setModal('aiQuickLog');
  };

  const refineGeminiEstimate = async (correction: string) => {
    if (!estimateSession) throw new Error('Start a new estimate to refine it.');
    const { raw, parsed } = await runGeminiEstimate(estimateSession.description, estimateSession.photos, correction);
    if (!parsed) throw new Error('Gemini replied in a format Dawni couldn’t read. Try again.');
    setEstimateSession({ ...estimateSession, reply: raw, description: `${estimateSession.description}\n(Correction: ${correction.trim()})`.trim() });
    prefillGeminiEstimate(parsed, true);
  };

  const toggleFavourite = (food: Food) => {
    const next = !food.favourite;
    updateState(draft => {
      const target = draft.foods.find(item => item.id === food.id);
      if (target) Object.assign(target, { favourite: next, updatedAt: Date.now() });
    }).then(() => notify(next ? 'Added to favourites' : 'Removed from favourites'));
  };

  const saveDatabaseFood = async (item: FoodDatabaseItem) => {
    let added = false;
    await updateState(draft => {
      if (draft.foods.some(food => food.sourceId === item.id)) return;
      const now = Date.now();
      draft.foods.push(normalizeFood({
        ...databaseItemToFood(item),
        id: uid(),
        source: undefined,
        sourceId: item.id,
        favourite: false,
        usageCount: 0,
        lastUsedAt: 0,
        createdAt: now,
        updatedAt: now
      }));
      added = true;
    });
    notify(added ? 'Food added to My Foods' : 'Food is already in My Foods');
  };

  const activeFood = state.foods.find(food => food.id === activeFoodId) || null;
  const activePhotoEntry = state.entries.find(entry => entry.id === activePhotoEntryId) || null;
  const updateNotes = (availableUpdate?.notes?.length ? availableUpdate.notes : ['Update available.']).slice(0, 5);
  const incomingVersion = availableUpdate?.version || '';
  const copyAiPrompt = () => navigator.clipboard
    ? navigator.clipboard.writeText(state.settings.aiPreferences.trim() ? `${AI_QUICK_LOG_PROMPT}\n\nAbout me: ${state.settings.aiPreferences.trim()}` : AI_QUICK_LOG_PROMPT).then(() => notify('Prompt copied')).catch(() => notify('Could not copy prompt'))
    : (notify('Clipboard is not available'), Promise.resolve());
  const importCustomFoodDatabase = async (file: File) => {
    try {
      const result = parseCustomFoodDatabaseText(await file.text(), file.name);
      const incoming = result.database;
      const existing = state.customFoodDatabases.find(database => database.id === incoming.id || database.name.toLowerCase() === incoming.name.toLowerCase());
      if (existing && !confirm(`Replace "${existing.name}" with "${incoming.name}"?`)) {
        notify('Custom database import cancelled');
        return;
      }
      await updateState(draft => {
        draft.customFoodDatabases = [
          ...draft.customFoodDatabases.filter(database => database.id !== incoming.id && database.name.toLowerCase() !== incoming.name.toLowerCase()),
          incoming
        ].sort((a, b) => a.name.localeCompare(b.name));
      });
      const skipped = result.skippedCount + result.duplicateCount;
      notify(`${existing ? 'Replaced' : 'Imported'} ${incoming.name}: ${fmt(incoming.itemCount)} foods${skipped ? `, skipped ${fmt(skipped)}` : ''}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not import that food database');
    }
  };
  const setCustomDatabaseEnabled = (id: string, enabled: boolean) => updateState(draft => {
    const database = draft.customFoodDatabases.find(item => item.id === id);
    if (database) database.enabled = enabled;
  }).then(() => notify(enabled ? 'Custom database enabled' : 'Custom database disabled'));
  const deleteCustomDatabase = (id: string) => {
    const database = state.customFoodDatabases.find(item => item.id === id);
    if (!database || !confirm(`Delete "${database.name}" from this browser?`)) return;
    updateState(draft => {
      draft.customFoodDatabases = draft.customFoodDatabases.filter(item => item.id !== id);
    }).then(() => notify('Custom database deleted'));
  };

  if (!loaded) {
    // A blank screen in the right colour: the read takes a few milliseconds, so text here only flickers.
    return <main className="app loading" aria-busy="true" />;
  }

  return (
    <AppShell tab={tab} setTab={setTab}>
      {tab === 'tracking' && (
        <TrackingView
          state={state}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          entries={entries}
          totals={totals}
          dayLogView={dayLogView}
          setDayLogView={setDayLogView}
          onOpenEntry={openEntry}
          onEditEntry={editEntry}
          onRepeatEntry={repeatEntry}
          onDeleteEntry={deleteEntry}
          onPhotoEntry={entry => {
            if (entry.photo) {
              setActivePhotoEntryId(entry.id);
              setModal('entryPhoto');
            } else {
              setActivePhotoEntryId(entry.id);
              entryPhotoInputRef.current?.click();
            }
          }}
          onConfirmDay={on => updateState(draft => setDayComplete(draft, selectedDate, on)).then(() => notify(on ? 'Counted toward your week' : 'Undone'))}
          onSetEstimate={kcal => updateState(draft => setDayEstimate(draft, selectedDate, kcal)).then(() => notify(kcal == null ? 'Rough guess cleared' : 'Rough guess saved'))}
          onUseLog={() => updateState(draft => setDayComplete(setDayEstimate(draft, selectedDate, null), selectedDate, true)).then(() => notify('Using your log'))}
          onRoughMeal={() => setModal('roughMeal')}
          onOpenAi={() => setModal('addFood')}
          onPrefillFood={prefillFood}
          onSaveDatabaseFood={saveDatabaseFood}
          onOpenTarget={() => setModal('dayTarget')}
          onOpenWeek={() => openWeek(selectedDate)}
        />
      )}
      {tab === 'journal' && (
        <JournalView
          state={state}
          journalMonth={journalMonth}
          setJournalMonth={setJournalMonth}
          journalDay={journalDay}
          setJournalDay={setJournalDay}
          dayViewMode={journalDayViewMode}
          setDayViewMode={setJournalDayViewMode}
          labelMode={journalLabelMode}
          setLabelMode={setJournalLabelMode}
          shuffleSeed={journalShuffleSeed}
          onShuffle={() => setJournalShuffleSeed(Date.now())}
          onPhoto={entry => {
            setPhotoPreview(entry.photo || null);
            setModal('photo');
          }}
          mealGroups={mealGroups}
          onOpenMealCard={group => {
            setActiveMealCard(group);
            setModal('mealCard');
          }}
          onOpenDay={openDayInTrack}
        />
      )}
      {tab === 'library' && (
        <LibraryView
          state={state}
          sub={librarySub}
          setSub={next => {
            setLibrarySub(next);
            localStorage.setItem('calorie-tracker-library-sub', next);
          }}
          query={historySearch}
          setQuery={setHistorySearch}
          onPrefill={prefillFood}
          onToggleFavourite={toggleFavourite}
          onManage={food => {
            setActiveFoodId(food.id);
            setModal('food');
          }}
        />
      )}
      {tab === 'stats' && (
        <RichStatsView
          state={state}
          selectedDate={selectedDate}
          bankingWeekStart={bankingWeekStart}
          setBankingWeekStart={setBankingWeekStart}
          onBankHelp={() => setModal('bankHelp')}
          onAdherenceHelp={() => setModal('adherenceHelp')}
          onOpenDay={openDayInTrack}
        />
      )}
      {tab === 'settings' && (
        <SettingsView
          state={state}
          focus={settingsFocus}
          onFocusHandled={() => setSettingsFocus(null)}
          goalsEditing={goalsEditing}
          goalDraft={goalDraft}
          setGoalDraft={setGoalDraft}
          setGoalsEditing={setGoalsEditing}
          onSaveGoals={() => updateState(draft => {
            const previousGoal = goalSnapshotFromSettings(draft.settings);
            Object.assign(draft, lockPastGoals(draft, todayKey(), previousGoal));
            draft.settings = { ...draft.settings, ...goalDraft, calories: energyInputToKcal(goalDraft.calories, state.settings.energyUnit) };
          }).then(() => {
            setGoalsEditing(false);
            notify('Goals saved');
          })}
          onAccent={color => updateState(draft => {
            draft.settings.accent = color;
          })}
          onTheme={theme => {
            if (goalsEditing) setGoalDraft(current => ({ ...current, theme }));
            updateState(draft => {
              draft.settings.theme = theme;
            });
          }}
          onEnergyUnit={unit => {
            const previousUnit = energyUnitValue(state.settings.energyUnit);
            if (goalsEditing) {
              setGoalDraft(current => ({
                ...current,
                energyUnit: unit,
                calories: n(energyInputFromKcal(energyInputToKcal(current.calories, previousUnit), unit))
              }));
            }
            updateState(draft => {
              draft.settings.energyUnit = unit;
            });
          }}
          onBackupDays={days => updateState(draft => {
            draft.settings.backupReminderDays = validBackupReminderDays(days);
          })}
          onSpreadWeeklyBank={enabled => {
            if (goalsEditing) setGoalDraft(current => ({ ...current, spreadWeeklyBank: enabled }));
            updateState(draft => {
              draft.settings.spreadWeeklyBank = enabled;
            }).then(() => notify(enabled ? 'Weekly bank spread enabled' : 'Weekly bank spread disabled'));
          }}
          onRefreshFoodDatabase={() => refreshFoodEstimateDatabase()
            .then(result => notify(`Loaded ${fmt(result.validCount)} food estimates`))
            .catch(() => notify('Could not update local food estimates'))}
          onImportCustomDatabase={() => customDatabaseImportRef.current?.click()}
          onToggleCustomDatabase={setCustomDatabaseEnabled}
          onDeleteCustomDatabase={deleteCustomDatabase}
          onCustomDatabaseHelp={() => setModal('customDbHelp')}
          onGeminiApiKey={key => updateState(draft => {
            draft.settings.geminiApiKey = key.trim();
          }).then(() => notify(key.trim() ? 'Gemini API key saved' : 'Gemini API key cleared'))}
          onGeminiApiKeyHelp={() => setModal('geminiApiKeyHelp')}
          onAiPreferences={text => updateState(draft => {
            draft.settings.aiPreferences = text.trim().slice(0, 500);
          }).then(() => notify(text.trim() ? 'Saved. Gemini will use this.' : 'Cleared'))}
          onCopyAiPrompt={copyAiPrompt}
          onAiPromptHelp={() => setModal('aiQuickLogHelp')}
          onExport={() => exportBackup(state).then(next => persist(next)).then(() => notify('Backup exported')).catch(err => err?.name !== 'AbortError' && notify('Could not export backup'))}
          onImport={() => importRef.current?.click()}
          onCheckUpdates={() => checkForAppUpdate(update => {
            setAvailableUpdate(update);
            setModal('version');
          }, true).then(found => notify(found ? 'Update ready' : 'You are on the latest version')).catch(() => notify('Could not check for updates'))}
          onClear={() => {
            if (confirm('Delete all entries, foods, settings, and photos from this browser? Export a backup first if unsure.')) {
              persist(structuredClone(DEFAULT)).then(() => notify('Local data deleted'));
            }
          }}
        />
      )}

      <input ref={importRef} hidden type="file" accept="application/json" onChange={event => {
        const file = event.target.files?.[0];
        if (!file) return;
        parseBackup(file).then(next => {
          const counts = backupCounts(next);
          if (!confirm(`Import backup and replace current local data? This backup has ${counts.entries} entries and ${counts.photos} photos.`)) return;
          return persist(next).then(() => notify(`Backup imported: ${counts.entries} entries`));
        }).catch(err => alert(err.message)).finally(() => {
          if (importRef.current) importRef.current.value = '';
        });
      }} />
      <input ref={customDatabaseImportRef} hidden type="file" accept="application/json" onChange={event => {
        const file = event.target.files?.[0];
        if (!file) return;
        importCustomFoodDatabase(file).finally(() => {
          if (customDatabaseImportRef.current) customDatabaseImportRef.current.value = '';
        });
      }} />
      <input ref={photoInputRef} hidden type="file" accept="image/*" onChange={event => {
        compressImage(event.target.files?.[0]).then(photo => {
          setEntryDraft(draft => ({ ...draft, photo }));
          if (photo) notify('Photo attached');
        });
      }} />
      <input ref={entryPhotoInputRef} hidden type="file" accept="image/*" onChange={event => {
        const file = event.target.files?.[0];
        if (!file || !activePhotoEntryId) return;
        compressImage(file).then(photo => updateState(draft => {
          const entry = draft.entries.find(item => item.id === activePhotoEntryId);
          if (entry) {
            entry.photo = photo;
            entry.updatedAt = Date.now();
          }
        })).then(() => notify('Meal photo saved'));
      }} />

      <EntryModal
        open={modal === 'entry'}
        openMode={entryOpenMode}
        state={state}
        foods={state.foods}
        draft={entryDraft}
        setDraft={setEntryDraft}
        onClose={() => setModal(null)}
        onSave={saveEntry}
        onPickPhoto={() => photoInputRef.current?.click()}
        onSaveDatabaseFood={saveDatabaseFood}
        onRefine={estimateSession && entryDraft.estimateDetails && !entryDraft.editingId ? refineGeminiEstimate : undefined}
        day={entryDay}
      />
      <FoodModal
        food={activeFood}
        open={modal === 'food'}
        energyUnit={state.settings.energyUnit}
        onClose={() => setModal(null)}
        onSave={food => updateState(draft => {
          const target = draft.foods.find(item => item.id === food.id);
          if (target) Object.assign(target, food, { updatedAt: Date.now() });
        }).then(() => {
          setModal(null);
          notify('Food updated');
        })}
        onDelete={food => {
          if (!confirm('Delete this food from history? Existing diary entries stay.')) return;
          updateState(draft => {
            draft.foods = draft.foods.filter(item => item.id !== food.id);
          }).then(() => {
            setModal(null);
            notify('Food deleted');
          });
        }}
      />
      <EntryPhotoModal
        entry={activePhotoEntry}
        open={modal === 'entryPhoto'}
        onClose={() => setModal(null)}
        onReplace={() => entryPhotoInputRef.current?.click()}
        onRemove={() => activePhotoEntry && updateState(draft => {
          const entry = draft.entries.find(item => item.id === activePhotoEntry.id);
          if (entry) entry.photo = null;
        }).then(() => {
          setModal(null);
          notify('Photo removed');
        })}
        onShare={() => activePhotoEntry?.photo && sharePhoto(activePhotoEntry.photo, `simple-calories-ledger-photo-${activePhotoEntry.date}.png`, notify)}
      />
      <MealCardModal
        state={state}
        group={activeMealCard}
        open={modal === 'mealCard'}
        onClose={() => setModal(null)}
        onShare={() => activeMealCard && shareMealCard(activeMealCard, energyUnitValue(state.settings.energyUnit), notify)}
      />
      <Modal open={modal === 'photo'} title="Meal photo" onClose={() => setModal(null)} className="lightbox" bottomSheet>
        <div className="photo-preview-shell">{photoPreview ? <img className="photo-preview-large" src={photoPreview} alt="Meal" /> : <div className="empty">No photo available.</div>}</div>
      </Modal>
      <AiQuickLogModal
        open={modal === 'aiQuickLog'}
        fallbackMeal={aiQuickLogMeal}
        seedText={aiQuickLogSeedText}
        // Modal runs a close animation then calls onClose; if we already opened Log Food, do not setModal(null).
        onClose={() => {
          setAiQuickLogSeedText('');
          setModal(current => (current === 'aiQuickLog' ? null : current));
        }}
        onParsed={prefillAiQuickLog}
      />
      <GeminiEstimateModal
        open={modal === 'geminiEstimate'}
        // Modal runs a close animation then calls onClose; if we already opened Log Food, do not setModal(null).
        onClose={() => setModal(current => (current === 'geminiEstimate' ? null : current))}
        onEstimate={estimateWithGemini}
      />
      <MenuPickModal
        open={modal === 'menuPick'}
        state={state}
        date={selectedDate}
        apiKey={state.settings.geminiApiKey}
        // Same handoff as above: Log this opens Log Food, which must not be closed again.
        onClose={() => setModal(current => (current === 'menuPick' ? null : current))}
        onLog={prefillMenuPick}
        onBackgroundNotice={message => notify(message, 4000)}
      />
      <Modal open={modal === 'addFood'} title="Log with AI" onClose={() => setModal(current => (current === 'addFood' ? null : current))} bottomSheet>
        <div className="add-sheet">
          <div className="add-list">
            <button className="add-row" type="button" onClick={openGeminiEstimate}>
              <span className="add-icon"><Icon name="sparkle" /></span>
              <span className="add-text"><strong>Estimate with Gemini</strong><small>Describe it, or photograph the meal or nutrition label</small></span>
              <Icon name="chevron" size={18} />
            </button>
            <button className="add-row" type="button" onClick={openMenuPick}>
              <span className="add-icon"><Icon name="menu" /></span>
              <span className="add-text"><strong>Help me pick from a menu</strong><small>Snap the menu and get a pick that fits today</small></span>
              <Icon name="chevron" size={18} />
            </button>
          </div>
          <div className="add-chatbot">
            <span className="add-chatbot-label">Using another AI chatbot?</span>
            <div className="add-chatbot-actions">
              <button className="secondary" type="button" onClick={() => copyAiPrompt()}><Icon name="copy" size={18} />Copy prompt</button>
              <button className="secondary" type="button" onClick={() => pasteAiQuickLogFromClipboard()}><Icon name="paste" size={18} />Paste estimate</button>
            </div>
          </div>
          <p className="hint add-disclaimer">{AI_ESTIMATE_DISCLAIMER}</p>
        </div>
      </Modal>
      <Modal open={modal === 'dayTarget'} title={selectedDate === todayKey() ? 'Today\u2019s target' : `Target for ${readable(selectedDate)}`} onClose={() => setModal(null)} bottomSheet>
        <DayCalorieGoalPanel
          key={selectedDate}
          state={state}
          date={selectedDate}
          suggested={resolveDayCalorieTarget(state, selectedDate).suggested}
          effective={resolveDayCalorieTarget(state, selectedDate).effective}
          hasOverride={resolveDayCalorieTarget(state, selectedDate).hasOverride}
          past={selectedDate < todayKey()}
          onPersist={kcal => updateState(draft => applyDayCalorieOverride(draft, selectedDate, kcal))}
        />
      </Modal>
      <Modal open={modal === 'roughMeal'} title="Add a rough meal" onClose={() => setModal(null)} bottomSheet>
        <RoughMealPanel
          key={selectedDate}
          state={state}
          defaultMeal={selectedDate === todayKey() ? defaultMealForCurrentTime() : 'Dinner'}
          onLog={logRoughMeal}
        />
      </Modal>
      <Modal open={modal === 'geminiSetup'} title="Set up Gemini" onClose={() => setModal(null)}>
        <p className="hint">Estimate with Gemini and Help me pick from a menu use your own Google Gemini API key. It takes a couple of minutes to set up, and the key stays on this device.</p>
        <ol className="update-list ai-help-list">
          <li>
            Create a key in Google AI Studio at{' '}
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">aistudio.google.com/app/apikey</a>.
          </li>
          <li>Paste it into Settings → Gemini and tap Save.</li>
          <li>Tap Test key to check Dawni can reach Gemini.</li>
        </ol>
        <div className="help-callout">No key? Tap ✦ next to the search bar on Today, then Copy prompt and Paste estimate. That works with any AI chatbot.</div>
        <div className="actions vertical">
          <button className="primary" type="button" onClick={() => openSettingsSection('geminiSection')}>Open Gemini settings</button>
          <button className="secondary" type="button" onClick={() => setModal(null)}>Not now</button>
        </div>
      </Modal>
      <Modal open={modal === 'aiQuickLogHelp'} title="AI estimate helper" onClose={() => setModal(null)}>
        <ol className="update-list ai-help-list">
          <li>Copy the prompt.</li>
          <li>Paste it into your AI chatbot.</li>
          <li>Tell it your ingredients, amounts, sauces, oils, and cooking method.</li>
          <li>Copy the returned JSON (it must include unitMode: per serving or per 100g, with calories matching that choice so nothing double-counts).</li>
          <li>On Today, tap ✦ next to the search bar, then Paste estimate.</li>
          <li>Review the Log Food form, then save normally.</li>
        </ol>
      </Modal>
      <Modal open={modal === 'geminiApiKeyHelp'} title="Gemini API key" onClose={() => setModal(null)}>
        <ol className="update-list ai-help-list">
          <li>
            Open Google AI Studio at{' '}
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">https://aistudio.google.com/app/apikey</a>
            .
          </li>
          <li>Create or copy an API key for a Google project where the Generative Language API is enabled.</li>
          <li>Paste the key into Dawni&apos;s Gemini API key field in Settings, then tap Save.</li>
          <li>Tap Test key. This is free — it only asks Google which models the key can use, and shows which one Dawni will pick.</li>
          <li>Manage billing, budgets, and quota limits in Google Cloud. Dawni only uses the key when you tap Estimate with Gemini or Help me pick from a menu.</li>
          <li>The key is stored locally in this browser and is included in exported backups.</li>
        </ol>
        <div className="help-callout">Dawni asks your key which models it can use and picks the best available one, so it keeps working as Google releases new models. If one model is busy or unavailable, it tries the next.</div>
      </Modal>
      <Modal open={modal === 'customDbHelp'} title="Custom Food Database Help" onClose={() => setModal(null)}>
        <div className="custom-db-help">
          <ol className="update-list ai-help-list">
            <li>Create a JSON file on your device.</li>
            <li>Add foods using the supported fields.</li>
            <li>Import it from Settings.</li>
            <li>Enabled databases will appear in Quick Picks search.</li>
            <li>You can disable or delete databases anytime.</li>
          </ol>
          <pre className="json-example">{`{
  "id": "my_custom_database",
  "name": "My Custom Foods",
  "version": "1.0.0",
  "items": [
    {
      "id": "sample_food",
      "name": "Sample Food",
      "unitMode": "serving",
      "servingLabel": "1 serving",
      "calories": 100,
      "protein": 10,
      "carbs": 10,
      "fat": 2,
      "tags": ["sample"]
    }
  ]
}`}</pre>
        </div>
      </Modal>
      <Modal open={modal === 'bankHelp'} title="Weekly calorie bank" onClose={() => setModal(null)}>
        <p className="hint">Each finished day adds what you ate under target to your bank, or takes off what you ate over. Days count on their own at midnight, so there’s nothing to swipe. Tap Done for today if you want today counted sooner.</p>
        <ul className="update-list bank-help-list">
          <li><strong>Looks light:</strong> a day logged under {Math.round(LIGHT_DAY_SHARE * 100)}% of target waits for a check, so a forgotten dinner doesn’t bank as savings.</li>
          <li><strong>Nothing logged:</strong> counts as on target, so it can’t help or hurt the bank. If it was bigger, give it a rough guess.</li>
          <li><strong>Ate out or hard to track:</strong> add a rough meal by size, or give the whole day a rough guess. Rough numbers show with ≈.</li>
          <li><strong>Spread across the week</strong> (in Settings) shares the bank out over the days left, but never takes a day below 80% of target. The bank resets each Monday.</li>
        </ul>
      </Modal>
      <Modal open={modal === 'adherenceHelp'} title="Consistency this week" onClose={() => setModal(null)}>
        <p className="hint">Consistency scores the days that count toward your bank, rough guesses included. “On track” uses each day’s saved target. Today, days ahead, light days waiting for a check and days with nothing logged aren’t scored.</p>
      </Modal>
      <Modal open={modal === 'version'} title="Update available" onClose={() => setModal(null)}>
        <div className="version-badge">{incomingVersion && incomingVersion !== APP_VERSION ? `Version ${APP_VERSION} → ${incomingVersion}` : `Version ${APP_VERSION}`}</div>
        <p className="hint">
          {availableUpdate?.source === 'service-worker'
            ? 'A newer build is already downloaded and waiting. Tap Update now to reload Dawni with the latest changes. Your journal, foods, and settings stay on this device.'
            : 'A newer build is live on the server. Tap Update now to reload Dawni and load it. Your journal, foods, and settings stay on this device.'}
        </p>
        <p className="page-kicker update-notes-heading">What&apos;s new</p>
        <ul className="update-list">{updateNotes.map(item => <li key={item}>{item}</li>)}</ul>
        <div className="actions vertical">
          <button className="primary" type="button" onClick={() => applyAppUpdate(availableUpdate)}>Update now</button>
          <button className="secondary" type="button" onClick={() => { dismissUpdatePrompt(availableUpdate?.version); setModal(null); }}>Not now</button>
        </div>
      </Modal>
      <Modal open={modal === 'backupReminder'} title="Backup reminder" onClose={() => setModal(null)}>
        <p className="hint">Your local tracker data is worth protecting. Backups include compressed journal photos, goals, saved foods, and completed days.</p>
        <div className="actions vertical">
          <button className="primary" type="button" onClick={() => openSettingsSection('backupSection')}>Open Backup</button>
          <button className="secondary" type="button" onClick={() => setModal(null)}>Later today</button>
        </div>
      </Modal>
      {toast && <div key={toast.id} className="toast">{toast.text}</div>}
    </AppShell>
  );
}

function DayHeader({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const isToday = value === todayKey();
  const date = new Date(`${value}T00:00:00`);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const full = date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
  return (
    <header className="day-header">
      <div className="day-header-text">
        <div className="page-kicker">{full}</div>
        <h1 className="page-title">{isToday ? 'Today' : readable(value)}</h1>
      </div>
      <div className="day-header-actions">
        {!isToday && <button className="day-today-btn" type="button" onClick={() => onChange(todayKey())}>Today</button>}
        <button className="date-btn prev" type="button" aria-label="Previous day" onClick={() => onChange(addDays(value, -1))} />
        <button className="date-btn next" type="button" aria-label="Next day" onClick={() => onChange(addDays(value, 1))} />
      </div>
    </header>
  );
}

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

type MacroView = 'left' | 'eaten';
const MACRO_VIEW_KEY = 'dawni-macro-view';
const storedMacroView = (): MacroView => {
  try {
    return localStorage.getItem(MACRO_VIEW_KEY) === 'eaten' ? 'eaten' : 'left';
  } catch {
    return 'left';
  }
};

function TrackingView(props: {
  state: AppState;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  entries: Entry[];
  totals: ReturnType<typeof sum>;
  dayLogView: 'group' | 'list';
  setDayLogView: (view: 'group' | 'list') => void;
  onOpenEntry: (meal?: Meal) => void;
  onEditEntry: (entry: Entry) => void;
  onRepeatEntry: (entry: Entry) => void;
  onDeleteEntry: (id: string) => void;
  onPhotoEntry: (entry: Entry) => void;
  onConfirmDay: (on: boolean) => void;
  onSetEstimate: (kcal: number | null) => void;
  onUseLog: () => void;
  onRoughMeal: () => void;
  onOpenAi: () => void;
  onPrefillFood: (food: Food) => void;
  onSaveDatabaseFood: (item: FoodDatabaseItem) => Promise<void> | void;
  onOpenTarget: () => void;
  onOpenWeek: () => void;
}) {
  const { state } = props;
  const baseDayGoal = goalForDate(state, props.selectedDate);
  const bankAdjustment = weeklyBankAdjustmentForDate(state, props.selectedDate);
  const calorieTarget = resolveDayCalorieTarget(state, props.selectedDate);
  const goalCalories = calorieTarget.effective;
  const goal = goalCalories || 1;
  const remaining = goal - props.totals.calories;
  const overTarget = remaining < 0;
  const bulking = baseDayGoal.trackingMode === 'Bulking';
  const deg = Math.min(360, Math.max(0, props.totals.calories) / goal * 360);
  const unit = energyLabel(state);
  const remainingText = fmt(energyValue(state, Math.abs(remaining)));
  const ringLabel = overTarget ? `${unit} over` : bulking ? `${unit} to go` : `${unit} left`;
  const [macroView, setMacroView] = useState<MacroView>(storedMacroView);
  const toggleMacroView = () => {
    const next: MacroView = macroView === 'left' ? 'eaten' : 'left';
    setMacroView(next);
    try { localStorage.setItem(MACRO_VIEW_KEY, next); } catch { /* private mode */ }
  };
  const isPast = props.selectedDate < todayKey();
  const day = bankDay(state, props.selectedDate);
  const week = weekBank(state, weekStartMonday(props.selectedDate));
  const weekMeta = [
    week.counted.length ? `${signedEnergyText(state, week.banked)} banked` : '',
    week.toCheck.length ? `${week.toCheck.length} to check` : ''
  ].filter(Boolean).join(' · ') || 'Nothing counted yet';
  const note = calorieTarget.hasOverride
    ? `Custom target for this day. Your usual target is ${energyText(state, calorieTarget.suggested)}.`
    : bankAdjustment !== 0
      ? `Includes ${signedEnergyText(state, bankAdjustment)} a day from your week bank.`
      : '';
  const macros: [string, number, number, string][] = [
    ['Protein', props.totals.protein, baseDayGoal.protein, '--protein'],
    ['Carbs', props.totals.carbs, baseDayGoal.carbs, '--carbs'],
    ['Fat', props.totals.fat, baseDayGoal.fat, '--fat']
  ];
  const settleRef = useSettleAnimation(props.selectedDate);
  const statusCard = (
    <DayStatusCard
      key={props.selectedDate}
      state={state}
      day={day}
      onConfirmDay={props.onConfirmDay}
      onSetEstimate={props.onSetEstimate}
      onUseLog={props.onUseLog}
      onRoughMeal={props.onRoughMeal}
    />
  );
  const rowProps = { state, onPhoto: props.onPhotoEntry, onEdit: props.onEditEntry, onRepeat: props.onRepeatEntry, onDelete: props.onDeleteEntry };
  return (
    <div className="screen-swipe-zone today-screen view-transition" ref={settleRef}>
      <div className="sticky-screen-top">
        <DayHeader value={props.selectedDate} onChange={props.setSelectedDate} />
      </div>

      <section className={`summary-card ${overTarget ? 'over-target' : ''}`} aria-label="Day summary">
        <div className="summary-main">
          <div className="summary-stat">
            <strong>{fmt(energyValue(state, props.totals.calories))}</strong>
            <span>Eaten</span>
          </div>
          <div className="summary-ring" style={{ '--deg': `${deg}deg` } as React.CSSProperties}>
            <div>
              <strong className={remainingText.length > 5 ? 'long' : ''}>{remainingText}</strong>
              <span>{ringLabel}</span>
            </div>
          </div>
          <button className="summary-stat summary-target" type="button" onClick={props.onOpenTarget} disabled={isPast} aria-label={`Target ${energyText(state, goalCalories)}${isPast ? '' : '. Change this day’s target'}`}>
            <strong>{fmt(energyValue(state, goalCalories))}</strong>
            <span>Target{!isPast && <Icon name="edit" size={13} />}</span>
          </button>
        </div>
        {(note || overTarget) && (
          <p className="summary-note">{overTarget ? `Over ${bulking || isPast ? 'target' : 'today'} by ${energyText(state, Math.abs(remaining))}. The week can still balance.` : note}</p>
        )}
        {/* Grams left by default, like the ring; a tap swaps to eaten / target and is remembered. */}
        <button
          type="button"
          className="summary-macros"
          onClick={toggleMacroView}
          aria-label={`${macros.map(([name, value, target]) => `${name} ${fmt(value)} of ${fmt(target)} grams`).join(', ')}. Tap to show ${macroView === 'left' ? 'eaten and target' : 'grams left'}.`}
        >
          {macros.map(([name, value, target, color]) => {
            const left = Math.round(target - value);
            // Past the protein target is the goal; past carbs or fat is worth a look.
            const overTone = left < 0 ? (name === 'Protein' ? 'is-good' : 'is-over') : '';
            return (
              <span className="summary-macro" key={name} aria-hidden="true">
                <span className="summary-macro-name">{name}</span>
                <span className="summary-macro-bar"><i style={{ background: `var(${color})`, width: `${Math.min(100, value / (target || 1) * 100)}%` }} /></span>
                {macroView === 'eaten'
                  ? <span className="summary-macro-num"><strong>{fmt(value)}</strong> / {fmt(target)}g</span>
                  : <span className={`summary-macro-num ${overTone}`}>
                    {left === 0 ? <strong>On target</strong> : <><strong>{fmt(Math.abs(left))}g</strong> {left > 0 ? 'left' : 'over'}</>}
                  </span>}
              </span>
            );
          })}
        </button>
      </section>

      {isPast && statusCard}

      <section className="quick-log" aria-label="Log food">
        <SavedFoodPicker
          state={state}
          foods={state.foods}
          onChoose={props.onPrefillFood}
          onSaveDatabaseFood={props.onSaveDatabaseFood}
          browseToggle
          trailing={(
            <button className="quick-ai-btn" type="button" aria-label="Log with AI" onClick={props.onOpenAi}>
              <Icon name="sparkle" size={20} />
            </button>
          )}
        />
      </section>

      <button type="button" className="week-row" onClick={props.onOpenWeek}>
        <span className="week-row-head">
          <span className="week-row-title">This week</span>
          <span className="week-row-meta">{weekMeta}</span>
          <Icon name="chevron" size={18} />
        </span>
        <span className="week-dots" aria-hidden="true">
          {week.days.map((row, index) => {
            return (
              <span key={row.date} className={`week-dot ${dayTone(row)} ${row.status === 'estimated' ? 'rough' : ''} ${row.date === props.selectedDate ? 'is-selected' : ''}`}>
                <i />
                {WEEKDAY_LETTERS[index]}
              </span>
            );
          })}
        </span>
      </button>

      <div className="section-head">
        <h2>Meals</h2>
        <button className="text-btn" type="button" onClick={() => props.setDayLogView(props.dayLogView === 'group' ? 'list' : 'group')}>{props.dayLogView === 'group' ? 'Show as list' : 'Group by meal'}</button>
      </div>
      <section className="meals-card" aria-label="Meals">
        {props.dayLogView === 'group'
          ? MEALS.map(meal => {
            const items = props.entries.filter(entry => (entry.meal || 'Snack') === meal);
            const mealTotal = sum(items).calories;
            return (
              <div className="meal-block" key={meal} data-swipe-lock>
                <div className="meal-block-head">
                  <span className={`meal-icon meal-icon--${meal.toLowerCase()}`}><Icon name={MEAL_ICON[meal]} size={20} /></span>
                  <span className="meal-block-title">
                    <strong>{meal}</strong>
                    <small>{items.length ? `${energyText(state, mealTotal)} · ${items.length} item${items.length === 1 ? '' : 's'}` : 'Nothing yet'}</small>
                  </span>
                  <button className="meal-add" type="button" aria-label={`Add to ${meal.toLowerCase()}`} onClick={() => props.onOpenEntry(meal)}>
                    <Icon name="plus" size={20} />
                  </button>
                </div>
                {items.length > 0 && <EntryList {...rowProps} entries={items} />}
              </div>
            );
          })
          : props.entries.length
            ? <EntryList {...rowProps} entries={props.entries} showMeal />
            : <div className="meals-empty">Nothing logged yet. Search above, or tap + to type in the numbers.</div>}
      </section>

      {!isPast && statusCard}

      <button className="fab" type="button" aria-label="Log food" onClick={() => props.onOpenEntry()}>
        <Icon name="plus" size={28} />
      </button>
    </div>
  );
}

const ROUGH_DAY_OPTIONS: { kcal: number; label: string }[] = [
  { kcal: 0, label: 'About on target' },
  { kcal: 500, label: 'A bit over' },
  { kcal: 1000, label: 'Big day' }
];

/** Where a day stands in the week bank, and the one or two things worth doing about it. Replaces the old swipe to complete. */
function DayStatusCard({ state, day, onConfirmDay, onSetEstimate, onUseLog, onRoughMeal }: {
  state: AppState;
  day: BankDay;
  onConfirmDay: (on: boolean) => void;
  onSetEstimate: (kcal: number | null) => void;
  onUseLog: () => void;
  onRoughMeal: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [checkingDone, setCheckingDone] = useState(false);
  const eaten = day.totals.calories;
  const target = day.goal.calories;
  const isToday = day.date === todayKey();
  const light = eaten < target * LIGHT_DAY_SHARE;
  const confirmed = isDayComplete(state, day.date);
  const estimate = state.dayEstimates?.[day.date] ?? 0;
  const result = day.delta > 0
    ? `${energyText(state, day.delta)} under target`
    : day.delta < 0 ? `${energyText(state, -day.delta)} over target` : 'Right on target';
  const roughMeal = <button className="secondary" type="button" onClick={onRoughMeal}>Add a rough meal</button>;
  const roughDay = <button className="text-btn" type="button" onClick={() => setPicking(true)}>Rough guess for the day</button>;
  const option = (item: { kcal: number; label: string }) => (
    <button
      key={item.kcal}
      type="button"
      className={`rough-option ${day.status === 'estimated' && estimate === item.kcal ? 'active' : ''}`}
      onClick={() => { setPicking(false); onSetEstimate(item.kcal); }}
    >
      <strong>{item.label}</strong>
      <small>About {energyText(state, target + item.kcal)}</small>
    </button>
  );

  let tone = 'open';
  let title: string;
  let body: string;
  let actions: ReactNode = null;
  if (picking) {
    title = 'How did the day go, roughly?';
    body = 'Your week bank will use this instead of the log. Pick the closest.';
    actions = (
      <>
        <div className="rough-day-options">{ROUGH_DAY_OPTIONS.map(option)}</div>
        <button className="text-btn" type="button" onClick={() => setPicking(false)}>Cancel</button>
      </>
    );
  } else if (day.status === 'today' && checkingDone) {
    tone = 'check';
    title = `Only ${energyText(state, eaten)} of ${energyText(state, target)} logged`;
    body = 'Is that everything for today?';
    actions = (
      <>
        <button className="primary" type="button" onClick={() => { setCheckingDone(false); onConfirmDay(true); }}>That&apos;s everything</button>
        {roughMeal}
        <button className="text-btn" type="button" onClick={() => setCheckingDone(false)}>Not yet</button>
      </>
    );
  } else if (day.status === 'today') {
    title = 'Today counts at midnight';
    body = eaten > 0
      ? 'It joins your week bank automatically. Tap Done if you’ve finished eating and want it counted now.'
      : 'Log what you eat and it joins your week bank automatically at midnight.';
    actions = (
      <>
        {eaten > 0 && <button className="primary" type="button" onClick={() => (light ? setCheckingDone(true) : onConfirmDay(true))}>Done for today</button>}
        {roughMeal}
        {roughDay}
      </>
    );
  } else if (day.status === 'counted') {
    tone = 'counted';
    title = isToday ? 'Done for today' : 'Counted';
    body = isToday
      ? `${result}, and it’s in your week bank.`
      : `${result}. Missed something? Log it here, or add a rough meal.`;
    actions = (
      <>
        {roughMeal}
        {confirmed && (isToday || light)
          ? <button className="text-btn" type="button" onClick={() => onConfirmDay(false)}>Undo</button>
          : roughDay}
      </>
    );
  } else if (day.status === 'light') {
    tone = 'check';
    title = 'Looks light. Anything missing?';
    body = `Only ${energyText(state, eaten)} of ${energyText(state, target)} logged. Until you check it, this day counts as on target.`;
    actions = (
      <>
        {roughMeal}
        <button className="secondary" type="button" onClick={() => onConfirmDay(true)}>That&apos;s everything</button>
        {roughDay}
      </>
    );
  } else if (day.status === 'untracked') {
    tone = 'none';
    title = 'Nothing logged';
    body = 'This day counts as on target, so it won’t change your bank. If it was bigger, pick a rough guess.';
    actions = (
      <>
        <div className="rough-day-options">{ROUGH_DAY_OPTIONS.filter(item => item.kcal > 0).map(option)}</div>
        {roughMeal}
      </>
    );
  } else if (day.status === 'estimated') {
    tone = 'rough';
    title = `Rough guess: ${(ROUGH_DAY_OPTIONS.find(item => item.kcal === estimate)?.label || signedEnergyText(state, estimate)).toLowerCase()}`;
    body = `Counts as about ${energyText(state, target + estimate)} in your week bank${eaten > 0 ? `, instead of the ${energyText(state, eaten)} logged` : ''}.`;
    actions = (
      <>
        <button className="secondary" type="button" onClick={() => setPicking(true)}>Change</button>
        {eaten > 0
          ? <button className="text-btn" type="button" onClick={onUseLog}>Use my log instead</button>
          : <button className="text-btn" type="button" onClick={() => onSetEstimate(null)}>Clear guess</button>}
      </>
    );
  } else {
    title = 'Coming up';
    body = 'It joins your week bank once the day is over.';
  }

  return (
    <section className={`card day-status ${tone}`} aria-label="This day in your week bank">
      <div className="day-status-head"><span className="day-status-dot" aria-hidden="true" /><strong>{title}</strong></div>
      <p className="hint">{body}</p>
      {actions && <div className="day-status-actions">{actions}</div>}
    </section>
  );
}

const ROUGH_MEAL_SIZES: { size: string; kcal: number; hint: string }[] = [
  { size: 'Light', kcal: 500, hint: 'Salad, sushi, a poke bowl' },
  { size: 'Regular', kcal: 800, hint: 'A restaurant main or a burrito' },
  { size: 'Big', kcal: 1200, hint: 'Burger and chips, pizza, creamy pasta' },
  { size: 'Feast', kcal: 1800, hint: 'Shared plates, dessert or a few drinks' }
];

/** One tap for a meal that was hard to track: a size, not a breakdown. */
function RoughMealPanel({ state, defaultMeal, onLog }: { state: AppState; defaultMeal: Meal; onLog: (meal: Meal, kcal: number, size: string | null) => void }) {
  const [meal, setMeal] = useState<Meal>(defaultMeal);
  const [typed, setTyped] = useState('');
  const unit = energyUnitValue(state.settings.energyUnit);
  const typedKcal = energyInputToKcal(typed, unit);
  return (
    <div className="rough-meal">
      <p className="hint">Ate out, or forgot to log it? Pick the closest size. It logs calories only, marked as a rough guess, and you can edit it later.</p>
      <div className="chips rough-meal-meals" role="group" aria-label="Meal">
        {MEALS.map(item => (
          <button key={item} type="button" className={`chip ${item === meal ? 'active' : ''}`} aria-pressed={item === meal} onClick={() => setMeal(item)}>{item}</button>
        ))}
      </div>
      <div className="add-list">
        {ROUGH_MEAL_SIZES.map(item => (
          <button key={item.size} className="add-row rough-size" type="button" onClick={() => onLog(meal, item.kcal, item.size)}>
            <span className="add-text"><strong>{item.size}</strong><small>{item.hint}</small></span>
            <span className="rough-size-energy">~{energyText(state, item.kcal)}</span>
          </button>
        ))}
      </div>
      <form className="rough-meal-custom" onSubmit={event => { event.preventDefault(); if (typedKcal > 0) onLog(meal, typedKcal, null); }}>
        <label className="field">
          <span>Or type a number ({energyUnitLabel(unit)})</span>
          <input inputMode="numeric" type="number" min="1" value={typed} onChange={event => setTyped(event.target.value)} placeholder={unit === 'kj' ? 'e.g. 4000' : 'e.g. 950'} />
        </label>
        <button className="secondary" type="submit" disabled={!(typedKcal > 0)}>Log</button>
      </form>
    </div>
  );
}

function EntryList({ state, entries, onPhoto, onEdit, onRepeat, onDelete, showMeal = false }: { state: AppState; entries: Entry[]; onPhoto: (entry: Entry) => void; onEdit: (entry: Entry) => void; onRepeat: (entry: Entry) => void; onDelete: (id: string) => void; showMeal?: boolean }) {
  return (
    <div data-swipe-lock className="entry-list-stack">
      {entries.map(entry => <EntryRow key={entry.id} state={state} entry={entry} showMeal={showMeal} onPhoto={onPhoto} onEdit={onEdit} onRepeat={onRepeat} onDelete={onDelete} />)}
    </div>
  );
}

function EntryRow({ state, entry, showMeal = false, onPhoto, onEdit, onRepeat, onDelete }: { state: AppState; entry: Entry; showMeal?: boolean; onPhoto: (entry: Entry) => void; onEdit: (entry: Entry) => void; onRepeat: (entry: Entry) => void; onDelete: (id: string) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const totals = entryTotals(entry);
  const portion = entryUnitModeValue(entry.unitMode) === '100g'
    ? `${fmtGram(entry.portion)}g`
    : entry.portion && entry.portion !== 1 ? `${fmtPortion(entry.portion)} servings` : '';
  const sub = [showMeal ? entry.meal || 'Snack' : '', portion, `P ${fmt(totals.protein)} · C ${fmt(totals.carbs)} · F ${fmt(totals.fat)}g`].filter(Boolean).join(' · ');
  useEffect(() => {
    if (!menuOpen) return;
    const positionMenu = () => {
      const button = menuButtonRef.current;
      const menu = menuRef.current;
      if (!button || !menu) return;
      const buttonRect = button.getBoundingClientRect();
      const menuWidth = menu.offsetWidth || 150;
      const menuHeight = menu.offsetHeight || 136;
      const margin = 10;
      const bottomGuard = 96;
      const left = Math.min(window.innerWidth - menuWidth - margin, Math.max(margin, buttonRect.right - menuWidth));
      const roomBelow = window.innerHeight - buttonRect.bottom - bottomGuard;
      const openUp = roomBelow < menuHeight + 8 && buttonRect.top > menuHeight + margin;
      const top = openUp
        ? Math.max(margin, buttonRect.top - menuHeight - 8)
        : Math.min(buttonRect.bottom + 8, window.innerHeight - bottomGuard - menuHeight);
      setMenuStyle({ left, top });
    };
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !menuButtonRef.current?.contains(target)) setMenuOpen(false);
    };
    const closeOnScroll = () => setMenuOpen(false);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    positionMenu();
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [menuOpen]);
  return (
    <div className="entry" data-swipe-lock>
      <button className="thumb" type="button" onClick={() => onPhoto(entry)} aria-label="Add or change food photo">
        {entry.photo ? <img src={entry.photo} alt="" /> : <span className="empty-photo-icon" aria-hidden="true" />}
      </button>
      <div className="entry-main">
        <div className="entry-name">{entry.name}</div>
        <div className="entry-sub">
          {entry.estimateSource && <span className="entry-tag">{estimateSourceLabel(entry.estimateSource)}</span>}
          {sub}
        </div>
      </div>
      <div className="entry-cal">{fmt(energyValue(state, totals.calories))}<small>{energyLabel(state)}</small></div>
      <div className="entry-menu-wrap">
        <button ref={menuButtonRef} className="entry-menu-btn" type="button" aria-label="Entry actions" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}><span aria-hidden="true" /></button>
        {menuOpen && createPortal(
          <div ref={menuRef} className="entry-menu" data-swipe-lock style={menuStyle}>
            <button type="button" onClick={() => { setMenuOpen(false); onRepeat(entry); }}>Repeat</button>
            <button type="button" onClick={() => { setMenuOpen(false); onEdit(entry); }}>Edit</button>
            <button type="button" className="danger-text" onClick={() => { setMenuOpen(false); onDelete(entry.id); }}>Delete</button>
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}

function SwipeConfirm({ label, confirmLabel, className = '', onConfirm }: { label: string; confirmLabel?: string; className?: string; onConfirm: () => void }) {
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);

  const updateProgress = (clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const usable = Math.max(1, rect.width - 62);
    const next = Math.max(0, Math.min(1, (clientX - startX.current) / usable));
    setProgress(next);
  };
  const reset = () => {
    setDragging(false);
    setProgress(0);
  };
  const finish = () => {
    if (progress >= 0.82) {
      setProgress(1);
      window.setTimeout(() => {
        onConfirm();
        reset();
      }, 120);
    } else {
      reset();
    }
  };

  return (
    <div
      ref={wrapRef}
      className={`swipe-confirm ${dragging ? 'dragging' : ''} ${className}`}
      data-swipe-lock
      role="button"
      tabIndex={0}
      aria-label={label}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onConfirm();
        }
      }}
      onPointerDown={event => {
        startX.current = event.clientX;
        setProgress(0);
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => dragging && updateProgress(event.clientX)}
      onPointerUp={finish}
      onPointerCancel={reset}
      style={{ '--swipe': `${progress * 100}%` } as React.CSSProperties}
    >
      <span className="swipe-confirm-fill" />
      <span className="swipe-confirm-handle" aria-hidden="true" />
      <span className="swipe-confirm-label">{progress >= 0.82 ? (confirmLabel || 'Release to confirm') : label}</span>
    </div>
  );
}

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

function databaseSourceChip(tags: string[] = [], sourceKind?: FoodDatabaseItem['sourceKind']) {
  if (sourceKind === 'custom') return 'Custom';
  const tagSet = new Set(tags.map(tag => tag.toLowerCase()));
  if (tagSet.has('verified-sample')) return 'Verified sample';
  if (tagSet.has('label-sample')) return 'Label sample';
  if (tagSet.has('partial-label')) return 'Partial label';
  if (tagSet.has('macro-checked') || tagSet.has('macro-checked-generic')) return 'Macro checked';
  if (tagSet.has('estimate') || tagSet.has('alcohol-estimate')) return 'Estimated';
  return '';
}

function readableTag(tag: string) {
  return tag.replace(/[-_]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function databaseServingText(item: FoodDatabaseItem | Food) {
  if (entryUnitModeValue(item.unitMode) === '100g') return 'per 100g';
  if (item.servingLabel && item.servingGrams && !String(item.servingLabel).includes(`${item.servingGrams}`)) {
    return `${item.servingLabel} (${fmtGram(item.servingGrams)}g)`;
  }
  return item.servingLabel || (item.servingGrams ? `${fmtGram(item.servingGrams)}g` : 'per serving');
}

function QuickFoodResultRow({ state, food, databaseSuggestion = false, sourceChip = '', sourceName = '', onChoose }: { state: AppState; food: Food; databaseSuggestion?: boolean; sourceChip?: string; sourceName?: string; onChoose: (food: Food) => void }) {
  const meta = databaseSuggestion
    ? [food.brand || 'Generic', databaseServingText(food), food.category, sourceName].filter(Boolean).join(' · ')
    : [food.brand, food.servingLabel, foodUnitText(food), food.category].filter(Boolean).join(' · ');
  const chip = sourceChip || (databaseSuggestion ? '' : estimateSourceLabel(food.estimateSource));
  return (
    <button className={`quick-food-result ${databaseSuggestion ? 'database' : 'user-food'}`} type="button" onClick={() => onChoose(food)}>
      <span className={`quick-food-icon ${food.favourite ? 'fav' : ''}`}>{food.favourite ? <><Icon name="heart" size={18} filled /><span className="sr-only">Favourite</span></> : databaseSuggestion ? 'DB' : ''}</span>
      <span className="quick-food-main">
        <strong>{food.name}</strong>
        <small>{meta || foodUnitText(food)}</small>
        <span className="quick-food-macros">
          {chip && <span className="meta-chip source-chip">{chip}</span>}
          <MacroChips fat={food.fat} carbs={food.carbs} protein={food.protein} />
        </span>
      </span>
      <span className="quick-food-cal">{energyText(state, food.calories)}</span>
    </button>
  );
}

function QuickResultSection({ title, children }: { title: string; children: ReactNode }) {
  return <div className="quick-result-section"><div className="quick-section-label">{title}</div><div className="quick-result-list">{children}</div></div>;
}

/** Moves the Today search bar up under the sticky header once the keyboard opens, so results show below it. */
function liftSearchAboveKeyboard(input: HTMLInputElement) {
  window.setTimeout(() => {
    const row = input.closest('.quick-log') || input;
    const header = document.querySelector('.sticky-screen-top');
    const offset = (header?.getBoundingClientRect().height || 0) + 8;
    const top = row.getBoundingClientRect().top + window.scrollY - offset;
    if (Math.abs(top - window.scrollY) > 4) window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, 280);
}

function SavedFoodPicker({ state, foods, onChoose, onSaveDatabaseFood, compact = false, browseToggle = false, collapseSignal, trailing }: { state: AppState; foods: Food[]; onChoose: (food: Food) => void; onSaveDatabaseFood: (item: FoodDatabaseItem) => Promise<void> | void; compact?: boolean; browseToggle?: boolean; collapseSignal?: number; trailing?: React.ReactNode }) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [browseOpen, setBrowseOpen] = useState(false);
  const [favouritesOpen, setFavouritesOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const prevCollapseSignal = useRef<number | null>(null);
  const [databaseMatches, setDatabaseMatches] = useState<FoodDatabaseItem[]>([]);
  const [databaseOpen, setDatabaseOpen] = useState(false);
  const [databasePreview, setDatabasePreview] = useState<FoodDatabaseItem | null>(null);
  const [databaseMessage, setDatabaseMessage] = useState('');
  const recentFoods = [...foods].sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
  const favourites = recentFoods.filter(food => food.favourite).slice(0, 12);
  const recent = recentFoods.slice(0, 14);
  const trimmedQuery = query.trim();
  const trimmedDatabaseQuery = debouncedQuery.trim();
  const userResults = useMemo(() => trimmedQuery ? rankUserFoods(recentFoods, trimmedQuery).slice(0, 5) : [], [recentFoods, trimmedQuery]);
  const shownDatabase = databaseMatches.slice(0, 3);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 120);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!browseToggle || collapseSignal === undefined) return;
    if (prevCollapseSignal.current !== null && collapseSignal !== prevCollapseSignal.current) {
      setBrowseOpen(false);
      setFavouritesOpen(false);
      setRecentOpen(false);
    }
    prevCollapseSignal.current = collapseSignal;
  }, [browseToggle, collapseSignal]);

  useEffect(() => {
    let cancelled = false;
    if (trimmedDatabaseQuery.length < 2) {
      setDatabaseMatches([]);
      setDatabaseMessage('');
      return;
    }
    loadFoodDatabaseWithStatus()
      .then(result => {
        if (cancelled) return;
        const customItems = flattenEnabledCustomDatabaseItems(state.customFoodDatabases);
        const matches = rankDatabaseFoods([...result.items, ...customItems], trimmedDatabaseQuery, foods);
        setDatabaseMatches(matches);
        setDatabaseMessage(result.message && !customItems.length ? result.message : (!result.items.length && !customItems.length ? 'Food estimate database is not available right now.' : ''));
      })
      .catch(() => {
        if (!cancelled) {
          setDatabaseMatches([]);
          setDatabaseMessage('Food estimate database could not be loaded.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [foods, state.customFoodDatabases, trimmedDatabaseQuery]);

  const choose = (food: Food) => {
    setDatabaseOpen(false);
    setQuery('');
    if (browseToggle) {
      setBrowseOpen(false);
      setFavouritesOpen(false);
      setRecentOpen(false);
    }
    onChoose(food);
  };
  const previewDatabase = (item: FoodDatabaseItem) => {
    setDatabaseOpen(false);
    setDatabasePreview(item);
  };
  const useDatabaseFood = (item: FoodDatabaseItem) => {
    setDatabasePreview(null);
    setDatabaseOpen(false);
    setQuery('');
    if (browseToggle) {
      setBrowseOpen(false);
      setFavouritesOpen(false);
      setRecentOpen(false);
    }
    onChoose(databaseItemToFood(item));
  };
  const saveDatabaseFood = async (item: FoodDatabaseItem) => {
    await onSaveDatabaseFood(item);
    setDatabasePreview(null);
  };
  const rows = (items: Food[], empty: string) => (
    <div className="quick-result-list">
      {items.length ? items.map(food => <QuickFoodResultRow key={food.id} state={state} food={food} onChoose={choose} />) : <span className="hint">{empty}</span>}
    </div>
  );
  const dbRows = (items: FoodDatabaseItem[]) => items.map(item => {
    const food = databaseItemToFood(item);
    return <QuickFoodResultRow key={item.id} state={state} food={food} sourceChip={databaseSourceChip(item.tags, item.sourceKind)} sourceName={item.customDatabaseName} databaseSuggestion onChoose={() => previewDatabase(item)} />;
  });
  const browsePanels = (
    <>
      <details open={favouritesOpen} onToggle={event => setFavouritesOpen(event.currentTarget.open)}>
        <summary>Favourites</summary>
        {rows(favourites, 'No favourites yet.')}
      </details>
      <details open={recentOpen} onToggle={event => setRecentOpen(event.currentTarget.open)}>
        <summary>Recent foods</summary>
        {rows(recent, 'Recent foods appear after saving entries.')}
      </details>
    </>
  );
  return (
    <section className={`quick-picker ${compact ? 'compact' : ''} ${browseToggle ? 'tracking-search' : ''}`}>
      {browseToggle ? (
        <div className={`quick-search-row ${trailing ? 'has-trailing' : ''}`}>
          <span className="quick-search-field">
            <Icon name="search" size={18} />
            <input type="search" aria-label="Search foods" placeholder="Search foods" value={query} onChange={event => setQuery(event.target.value)} onFocus={event => liftSearchAboveKeyboard(event.currentTarget)} autoCapitalize="none" autoCorrect="off" enterKeyHint="search" />
          </span>
          <button className={`quick-browse-toggle ${browseOpen ? 'open' : ''}`} type="button" aria-label={browseOpen ? 'Hide favourites and recent foods' : 'Show favourites and recent foods'} aria-expanded={browseOpen} onClick={() => setBrowseOpen(open => !open)}><span aria-hidden="true" /></button>
          {trailing}
        </div>
      ) : (
        <input type="search" placeholder="Search saved foods" value={query} onChange={event => setQuery(event.target.value)} autoCapitalize="none" autoCorrect="off" enterKeyHint="search" />
      )}
      {trimmedQuery ? (
        <>
          {userResults.length ? (
            <QuickResultSection title="Your foods">
              {userResults.map(food => <QuickFoodResultRow key={food.id} state={state} food={food} onChoose={choose} />)}
            </QuickResultSection>
          ) : <div className="quick-empty"><strong>{shownDatabase.length ? 'No saved matches yet' : 'No matching foods yet'}</strong><span>Try a different search or log manually.</span></div>}
          {shownDatabase.length > 0 && (
            <QuickResultSection title="From food database">
              {dbRows(shownDatabase)}
              {databaseMatches.length > shownDatabase.length && <button className="quick-more-btn" type="button" onClick={() => setDatabaseOpen(true)}>Show more database results</button>}
            </QuickResultSection>
          )}
          {databaseMessage && <p className="hint database-load-message">{databaseMessage}</p>}
        </>
      ) : browseToggle ? (browseOpen ? browsePanels : null) : browsePanels}
      <Modal open={databaseOpen} title="Food database results" onClose={() => setDatabaseOpen(false)} wide>
        <p className="hint database-query">Results for “{trimmedQuery}”</p>
        <div className="quick-result-list modal-results">{dbRows(databaseMatches.slice(0, 20))}</div>
      </Modal>
      <FoodDatabasePreviewModal
        state={state}
        item={databasePreview}
        onUse={useDatabaseFood}
        onSave={saveDatabaseFood}
        onClose={() => setDatabasePreview(null)}
      />
    </section>
  );
}

function FoodDatabasePreviewModal({ state, item, onUse, onSave, onClose }: { state: AppState; item: FoodDatabaseItem | null; onUse: (item: FoodDatabaseItem) => void; onSave: (item: FoodDatabaseItem) => Promise<void> | void; onClose: () => void }) {
  if (!item) return null;
  const chip = databaseSourceChip(item.tags, item.sourceKind);
  return (
    <Modal open title="Food estimate" onClose={onClose}>
      <div className="database-preview">
        <div>
          <h3>{item.name}</h3>
          <p className="hint">{[item.brand, item.category, item.customDatabaseName].filter(Boolean).join(' · ') || item.category || 'Generic food estimate'}</p>
        </div>
        <div className="meta-chips">
          {chip && <span className="meta-chip source-chip">{chip}</span>}
          <span className="meta-chip neutral">{databaseServingText(item)}</span>
          {item.servingGrams && entryUnitModeValue(item.unitMode) === 'serving' && !String(item.servingLabel || '').includes(`${item.servingGrams}`) && <span className="meta-chip neutral">{fmtGram(item.servingGrams)}g</span>}
        </div>
        <div className="database-preview-nutrition">
          <div><span>Calories</span><strong>{energyText(state, item.calories)}</strong></div>
          <div><span>Protein</span><strong>{fmt(item.protein)}g</strong></div>
          <div><span>Carbs</span><strong>{fmt(item.carbs)}g</strong></div>
          <div><span>Fat</span><strong>{fmt(item.fat)}g</strong></div>
        </div>
        {item.tags.length > 0 && <div className="tag-chip-row">{item.tags.map(tag => <span key={tag} className="tag-chip">{readableTag(tag)}</span>)}</div>}
        <div className="actions vertical">
          <button className="primary" type="button" onClick={() => onUse(item)}>Use this food</button>
          <button className="secondary" type="button" onClick={() => onSave(item)}>Add to My Foods</button>
          <button className="secondary" type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

function GeminiEstimateModal({ open, onClose, onEstimate }: { open: boolean; onClose: () => void; onEstimate: (description: string, photos: string[]) => Promise<void> }) {
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingPhotos, setAddingPhotos] = useState(false);
  const [error, setError] = useState('');
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setText('');
      setPhotos([]);
      setLoading(false);
      setError('');
    }
  }, [open]);

  const addPhotos = async (files: FileList | null) => {
    const list = Array.from(files || []).slice(0, MAX_ESTIMATE_PHOTOS - photos.length);
    if (photoInputRef.current) photoInputRef.current.value = '';
    if (!list.length) return;
    setError('');
    setAddingPhotos(true);
    const added: string[] = [];
    // One at a time: full-size phone photos decoded together can exhaust memory.
    for (const file of list) {
      try {
        const photo = await compressImage(file, SHARP_PHOTO_OPTIONS);
        if (photo) added.push(photo);
      } catch {
        setError('One photo couldn’t be read. Try taking it again.');
      }
    }
    setPhotos(current => [...current, ...added].slice(0, MAX_ESTIMATE_PHOTOS));
    setAddingPhotos(false);
  };

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed && !photos.length) {
      setError('Add a short description or a photo.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await onEstimate(trimmed, photos);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gemini could not estimate this meal.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} title="Estimate with Gemini" onClose={onClose} bottomSheet closeDisabled={loading}>
      <form className="gemini-estimate-modal" onSubmit={(event: FormEvent) => { event.preventDefault(); submit(); }}>
        <p className="hint">Describe what you ate, add photos, or both. You’ll review the numbers before saving.</p>
        <Field label="What did you eat?" full>
          <textarea disabled={loading} value={text} onChange={event => { setText(event.target.value); setError(''); }} placeholder="e.g. chicken stir fry, about 150 g chicken, 1 cup rice, 1 tbsp oil. Or for a label: ate half the tub." />
        </Field>
        <div className="menu-pick-section">
          <div className="section">Photos (optional, up to {MAX_ESTIMATE_PHOTOS})</div>
          <input ref={photoInputRef} hidden type="file" accept="image/*" multiple onChange={event => addPhotos(event.target.files)} />
          <div className="menu-photo-grid">
            {photos.map((src, index) => (
              <div key={`${index}-${src.length}`} className="menu-photo">
                <img src={src} alt={`Photo ${index + 1}`} />
                {!loading && (
                  <button type="button" className="menu-photo-remove" aria-label={`Remove photo ${index + 1}`} onClick={() => setPhotos(current => current.filter((_, i) => i !== index))}>
                    <span aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
            {photos.length < MAX_ESTIMATE_PHOTOS && (
              <button type="button" className="menu-photo-add" disabled={loading || addingPhotos} onClick={() => photoInputRef.current?.click()}>
                <span className="empty-photo-icon" aria-hidden="true" />
                <span>{addingPhotos ? 'Adding…' : photos.length ? 'Add another' : 'Add photo'}</span>
              </button>
            )}
          </div>
        </div>
        <details className="extra-info menu-pick-how">
          <summary>Tips for accurate numbers</summary>
          <div className="extra-info-body">
            <ul className="menu-pick-how-list">
              <li>Packaged food: photograph the nutrition panel flat and close, plus the front of the pack. Say how much you ate (e.g. 150 g, half the tub).</li>
              <li>Home cooking: list ingredients and amounts, including oil, butter and sauces.</li>
              <li>Meals out: a photo from above plus a short description works best.</li>
            </ul>
          </div>
        </details>
        {error && <p className="ai-quick-log-error">{error}</p>}
        <div className="actions vertical">
          <button className="primary" type="submit" disabled={loading || addingPhotos || (!text.trim() && !photos.length)}>{loading ? 'Estimating…' : 'Estimate food'}</button>
          <button className="secondary" type="button" disabled={loading} onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

function MenuPickModal({ open, state, date, apiKey, onClose, onLog, onBackgroundNotice }: {
  open: boolean;
  state: AppState;
  date: string;
  apiKey: string;
  onClose: () => void;
  onLog: (item: MenuPickItem, meal: Meal) => void;
  onBackgroundNotice: (message: string) => void;
}) {
  // Unlike the estimate sheet, nothing resets on close: the sheet can be closed
  // while Gemini reads the menu, and the suggestion should still be here after.
  const [meal, setMeal] = useState<Meal>(() => defaultMealForCurrentTime());
  const [mealPicked, setMealPicked] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [addingPhotos, setAddingPhotos] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [session, setSession] = useState<MenuPickSession | null>(null);
  const [showResult, setShowResult] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const photoInputRef = useRef<HTMLInputElement>(null);

  const context = useMemo(() => buildMenuPickContext(state, date), [state, date]);
  const budget = mealBudget(context, meal);
  const activeSession = isMenuPickFresh(session, date) ? session : null;
  const unit = energyUnitValue(state.settings.energyUnit);
  const proteinLeft = Math.max(0, context.proteinTarget - context.eaten.protein);
  const rangeText = budget.low === budget.high
    ? energyText(state, budget.high)
    : `${fmt(energyValueForUnit(budget.low, unit))}–${energyText(state, budget.high)}`;

  // Bring back a recent suggestion if the app was closed while ordering.
  useEffect(() => {
    let cancelled = false;
    loadLastMenuPick(date)
      .then(saved => {
        if (cancelled || !saved) return;
        setSession(current => current || saved);
        setShowResult(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [date]);

  useEffect(() => {
    if (!open) return;
    setError('');
    // A fresh visit with nothing in progress follows the clock.
    if (!loading && !photos.length && !activeSession) {
      setMeal(defaultMealForCurrentTime());
      setMealPicked(false);
    }
  }, [open]);

  const addPhotos = async (files: FileList | null) => {
    const list = Array.from(files || []);
    if (photoInputRef.current) photoInputRef.current.value = '';
    const room = MAX_MENU_PHOTOS - photos.length;
    if (!list.length || room <= 0) return;
    const accepted = list.slice(0, room);
    setError('');
    setNotice(list.length > accepted.length ? `Dawni sends up to ${MAX_MENU_PHOTOS} photos, so only the first ${accepted.length} ${accepted.length === 1 ? 'was' : 'were'} added.` : '');
    setAddingPhotos(true);
    const added: string[] = [];
    let failed = 0;
    // One at a time: decoding several full-size phone photos at once can run a phone out of memory.
    for (const file of accepted) {
      try {
        const photo = await compressImage(file, MENU_PHOTO_OPTIONS);
        if (photo) added.push(photo);
      } catch {
        failed += 1;
      }
    }
    setPhotos(current => [...current, ...added].slice(0, MAX_MENU_PHOTOS));
    if (failed) setError(failed === 1 ? 'One photo couldn’t be read. Try taking it again.' : `${failed} photos couldn’t be read. Try taking them again.`);
    setAddingPhotos(false);
  };

  const submit = async () => {
    if (!photos.length) {
      setError('Add at least one photo of the menu.');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const requestMeal = meal;
    const requestContext = context;
    const requestBudget = budget;
    setLoading(true);
    setError('');
    setNotice('');
    const finishedClosed = (message: string) => {
      if (!openRef.current) onBackgroundNotice(message);
    };
    try {
      const raw = await requestMenuPick({
        apiKey,
        userText: buildMenuPickRequest({ context: requestContext, meal: requestMeal, budget: requestBudget, note, preferences: state.settings.aiPreferences, photoCount: photos.length }),
        imageDataUrls: photos,
        accept: text => !!parseMenuPick(text),
        signal: controller.signal
      });
      const result = parseMenuPick(raw);
      if (!result) {
        setError('Gemini replied in a format Dawni couldn’t read. Try again.');
        finishedClosed('Your menu pick couldn’t finish. Open Help me pick from a menu to see why.');
        return;
      }
      if (!result.menuReadable || !result.pick) {
        setNotice(result.note || 'Gemini couldn’t read a menu in these photos. Try a closer, well-lit photo of the menu text.');
        finishedClosed('Gemini couldn’t read that menu. Open Help me pick from a menu for tips.');
        return;
      }
      const next: MenuPickSession = {
        version: 1,
        date: requestContext.date,
        createdAt: Date.now(),
        meal: requestMeal,
        remainingAtRequest: requestBudget.remaining,
        proteinLeftAtRequest: Math.max(0, requestContext.proteinTarget - requestContext.eaten.protein),
        result
      };
      setSession(next);
      setShowResult(true);
      void saveLastMenuPick(next);
      finishedClosed('Your menu pick is ready. Tap Help me pick from a menu to see it.');
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Gemini could not suggest anything from this menu.');
      finishedClosed('Your menu pick couldn’t finish. Open Help me pick from a menu to see why.');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  };

  const startOver = () => {
    abortRef.current?.abort();
    setPhotos([]);
    setNote('');
    setError('');
    setNotice('');
    setSession(null);
    setShowResult(false);
    setMeal(defaultMealForCurrentTime());
    setMealPicked(false);
    void saveLastMenuPick(null);
  };

  if (showResult && activeSession && !loading) {
    const { result } = activeSession;
    const pick = result.pick as MenuPickItem;
    const leftAfter = activeSession.remainingAtRequest - pick.calories;
    const proteinAfter = Math.max(0, activeSession.proteinLeftAtRequest - pick.protein);
    const fitText = activeSession.remainingAtRequest <= 0
      ? 'You’d already reached today’s target before this meal. The week can still balance.'
      : leftAfter >= 0
        ? `Leaves about ${energyText(state, leftAfter)} and ${fmt(proteinAfter)}g of protein to go for the rest of today.`
        : `About ${energyText(state, -leftAfter)} over today’s target. The week can still balance.`;
    const madeAt = new Date(activeSession.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return (
      <Modal open={open} title="Pick from a menu" onClose={onClose} bottomSheet>
        <div className="menu-pick-result">
          <div className="menu-pick-result-head">
            <div className="section">Best pick for {activeSession.meal.toLowerCase()}</div>
            <span className="hint">Suggested at {madeAt}</span>
          </div>
          <article className="menu-pick-card">
            <h3>{pick.name}</h3>
            <div className="meta-chips">
              <span className="meta-chip source-chip">{pick.fromMenu ? 'From menu' : 'Estimated'}</span>
              <span className={`meta-chip confidence-chip confidence-${pick.confidence}`}>{pick.confidence[0].toUpperCase() + pick.confidence.slice(1)} confidence</span>
            </div>
            <div className="database-preview-nutrition menu-pick-nutrition">
              <div><span>Calories</span><strong>{energyText(state, pick.calories)}</strong></div>
              <div><span>Protein</span><strong>{fmt(pick.protein)}g</strong></div>
              <div><span>Carbs</span><strong>{fmt(pick.carbs)}g</strong></div>
              <div><span>Fat</span><strong>{fmt(pick.fat)}g</strong></div>
            </div>
            <p className="menu-pick-fit">{fitText}</p>
            {pick.reason && <p className="menu-pick-reason">{pick.reason}</p>}
            {pick.tip && <p className="menu-pick-tip"><strong>Tip:</strong> {pick.tip}</p>}
            {pick.assumptions.length > 0 && (
              <ul className="estimate-assumptions" aria-label="What Gemini assumed">
                {pick.assumptions.map(item => <li key={item}>{item}</li>)}
              </ul>
            )}
            {macrosDisagree(pick) && <p className="estimate-warning">Calories and macros don’t quite add up, so treat these numbers loosely.</p>}
            <button className="primary menu-pick-log" type="button" onClick={() => onLog(pick, activeSession.meal)}>Log this</button>
          </article>
          {result.alternatives.length > 0 && (
            <div className="menu-pick-section">
              <div className="section">Also good</div>
              <div className="menu-pick-alt-list">
                {result.alternatives.map(item => (
                  <div key={item.name} className="menu-pick-alt">
                    <div className="menu-pick-alt-main">
                      <strong>{item.name}</strong>
                      <div className="meta-chips">
                        <span className="meta-chip accent">{energyText(state, item.calories)}</span>
                        {item.fromMenu && <span className="meta-chip source-chip">From menu</span>}
                        <MacroChips fat={item.fat} carbs={item.carbs} protein={item.protein} />
                      </div>
                      {item.reason && <small>{item.reason}</small>}
                    </div>
                    <button className="secondary menu-pick-alt-log" type="button" onClick={() => onLog(item, activeSession.meal)}>Log</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {result.summary && (
            <div className="help-callout menu-pick-summary">
              <strong>Why this pick</strong>
              <p>{result.summary}</p>
            </div>
          )}
          {result.note && <p className="hint menu-pick-caveat">{result.note}</p>}
          <p className="hint menu-pick-disclaimer">Estimated from a menu photo. Restaurant portions vary, so check the numbers when you log.</p>
        </div>
        <div className="actions vertical">
          {photos.length > 0 && <button className="secondary" type="button" onClick={() => setShowResult(false)}>Change meal, note or photos</button>}
          <button className="secondary" type="button" onClick={startOver}>Start a new menu</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} title="Pick from a menu" onClose={onClose} bottomSheet>
      <div className="menu-pick-modal">
        <p className="hint menu-pick-intro">Take a photo of the menu you’re ordering from, either the whole page or just the part you’re choosing from. Gemini suggests a dish that fits the rest of your day.</p>

        <div className="menu-pick-section">
          <div className="section">Choosing for</div>
          <div className="meal-chip-row" role="group" aria-label="Meal">
            {MENU_PICK_MEALS.map(item => (
              <button key={item} type="button" className={`meal-chip ${meal === item ? 'active' : ''}`} disabled={loading} aria-pressed={meal === item} onClick={() => { setMeal(item); setMealPicked(true); }}>{item}</button>
            ))}
          </div>
          {!mealPicked && <p className="hint menu-pick-meal-hint">Picked from the time ({new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}). Tap to change.</p>}
        </div>

        <div className="menu-pick-today" aria-label="Today so far">
          <div className="menu-pick-stat">
            <span>{budget.remaining >= 0 ? 'Calories left today' : 'Over today’s target'}</span>
            <strong>{energyText(state, Math.abs(budget.remaining))}</strong>
            <small>{energyText(state, context.eaten.calories)} of {energyText(state, context.calorieTarget)} eaten</small>
          </div>
          <div className="menu-pick-stat">
            <span>Protein to go</span>
            <strong>{fmt(proteinLeft)}g</strong>
            <small>{fmt(context.eaten.protein)}g of {fmt(context.proteinTarget)}g eaten</small>
          </div>
          <p className="menu-pick-budget">
            {budget.remaining > 0
              ? <>Aim for about <strong>{rangeText}</strong> for {meal.toLowerCase()}. That {budgetReason(meal)}.</>
              : <>You’ve reached today’s target, so Gemini will look for the lightest option that still satisfies. The week can still balance.</>}
          </p>
        </div>

        <div className="menu-pick-section">
          <div className="section">Menu photos</div>
          <input ref={photoInputRef} hidden type="file" accept="image/*" multiple onChange={event => addPhotos(event.target.files)} />
          <div className="menu-photo-grid">
            {photos.map((src, index) => (
              <div key={`${index}-${src.length}`} className="menu-photo">
                <img src={src} alt={`Menu photo ${index + 1}`} />
                {!loading && (
                  <button type="button" className="menu-photo-remove" aria-label={`Remove menu photo ${index + 1}`} onClick={() => setPhotos(current => current.filter((_, i) => i !== index))}>
                    <span aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
            {photos.length < MAX_MENU_PHOTOS && (
              <button type="button" className="menu-photo-add" disabled={loading || addingPhotos} onClick={() => photoInputRef.current?.click()}>
                <span className="empty-photo-icon" aria-hidden="true" />
                <span>{addingPhotos ? 'Adding…' : photos.length ? 'Add page' : 'Add menu photo'}</span>
              </button>
            )}
          </div>
          <p className="hint menu-photo-tip">Up to {MAX_MENU_PHOTOS} photos. Hold your phone flat over the menu in good light so the small print is readable, and include dish descriptions and sides if you can.</p>
        </div>

        <Field label="Anything Gemini should know? (optional)" full>
          <textarea className="menu-pick-note" disabled={loading} value={note} onChange={event => setNote(event.target.value)} placeholder="e.g. high protein, no seafood, I’m sharing the chips" />
        </Field>

        <details className="extra-info menu-pick-how">
          <summary>What gets sent to Gemini</summary>
          <div className="extra-info-body">
            <ul className="menu-pick-how-list">
              <li>Your menu photos and note.</li>
              <li>Today’s calories and macros so far, your targets and goal mode, and what you’ve logged today.</li>
              <li>The meal you’re choosing for and the time.</li>
            </ul>
            <p className="hint">It goes to Google using your own Gemini key. Menu photos aren’t saved to your journal, and nothing is logged until you tap Log this.</p>
          </div>
        </details>

        {notice && <div className="help-callout menu-pick-notice">{notice}</div>}
        {error && <p className="ai-quick-log-error">{error}</p>}
      </div>
      <div className="actions vertical">
        {/* In the sticky bar so it's on screen however far the sheet is scrolled. */}
        {loading && (
          <div className="menu-pick-loading" role="status" aria-live="polite">
            <span className="menu-pick-spinner" aria-hidden="true" />
            <div>
              <strong>Reading the menu…</strong>
              <p className="hint">Usually 10–30 seconds. You can close this sheet and Dawni will let you know when it’s ready.</p>
            </div>
          </div>
        )}
        {loading
          ? <button className="secondary" type="button" onClick={() => abortRef.current?.abort()}>Cancel</button>
          : <button className="primary" type="button" disabled={!photos.length || addingPhotos} onClick={submit}>{activeSession ? 'Suggest again' : 'Suggest what to order'}</button>}
        {!loading && (activeSession
          ? <button className="secondary" type="button" onClick={() => setShowResult(true)}>Back to suggestion</button>
          : <button className="secondary" type="button" onClick={onClose}>Close</button>)}
      </div>
    </Modal>
  );
}

function AiQuickLogModal({ open, fallbackMeal, seedText, onClose, onParsed }: { open: boolean; fallbackMeal: Meal; seedText: string; onClose: () => void; onParsed: (entry: AiQuickLogEntry) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const parsedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setText('');
      setError('');
      parsedRef.current = false;
      return;
    }
    if (seedText) {
      setText(seedText);
      setError('');
      parsedRef.current = false;
    }
  }, [open, seedText]);

  const tryParse = (value: string, showError: boolean) => {
    if (parsedRef.current) return true;
    const trimmed = value.trim();
    if (!trimmed) {
      setError('');
      return false;
    }
    const parsed = parseAiQuickLog(trimmed, fallbackMeal);
    if (parsed) {
      parsedRef.current = true;
      setError('');
      onParsed(parsed);
      return true;
    }
    if (showError && trimmed.length > 12) {
      setError('Couldn\u2019t read that format. Check the prompt output and try again.');
    }
    return false;
  };

  useEffect(() => {
    if (!open) return;
    const trimmed = text.trim();
    if (!trimmed) {
      setError('');
      return;
    }
    const timer = window.setTimeout(() => {
      tryParse(trimmed, true);
    }, 550);
    return () => window.clearTimeout(timer);
  }, [open, text]);

  const updateText = (next: string) => {
    setText(next);
    setError('');
    tryParse(next, false);
  };

  const pasteFromClipboard = async () => {
    if (!navigator.clipboard?.readText) {
      setError('Clipboard paste is not available here. Paste manually instead.');
      return;
    }
    try {
      const next = await navigator.clipboard.readText();
      setText(next);
      setError('');
      tryParse(next, true);
    } catch {
      setError('Could not read from clipboard. Paste manually instead.');
    }
  };

  return (
    <Modal open={open} title="AI estimate helper" onClose={onClose}>
      <div className="ai-quick-log-modal">
        <p className="hint">Paste an AI-generated estimate. If the format is correct, it will fill the Log Food form for review.</p>
        <div className="help-callout">{AI_ESTIMATE_DISCLAIMER}</div>
        <div className="actions">
          <button className="secondary" type="button" onClick={pasteFromClipboard}>Paste from clipboard</button>
          <button className="secondary" type="button" onClick={() => { setText(''); setError(''); }}>Clear</button>
        </div>
        <Field label="Quick log JSON" full>
          <textarea className="ai-quick-log-textarea" value={text} onChange={event => updateText(event.target.value)} placeholder='{"name":"Beef mince bowl","unitMode":"serving","amount":"1","meal":"Dinner","calories":520,"protein":45,"carbs":18,"fat":28,"notes":"Ingredients and estimate notes"}' />
        </Field>
        {error && <p className="ai-quick-log-error">{error}</p>}
      </div>
    </Modal>
  );
}

function EntryModal({
  open,
  openMode,
  state,
  foods,
  draft,
  setDraft,
  onClose,
  onSave,
  onPickPhoto,
  onSaveDatabaseFood,
  onRefine,
  day
}: {
  open: boolean;
  openMode: EntryOpenMode;
  state: AppState;
  foods: Food[];
  draft: EntryDraft;
  setDraft: (fn: EntryDraft | ((draft: EntryDraft) => EntryDraft)) => void;
  onClose: () => void;
  onSave: (keepOpen?: boolean) => void;
  onPickPhoto: () => void;
  onSaveDatabaseFood: (item: FoodDatabaseItem) => Promise<void> | void;
  /** Present while the draft is the latest Gemini estimate. */
  onRefine?: (correction: string) => Promise<void>;
  /** The day being logged to, without this entry. Energy in kcal. */
  day: { eaten: number; target: number; bulking: boolean; date: string };
}) {
  const [refineText, setRefineText] = useState('');
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState('');
  const caloriesPanelRef = useRef<HTMLDivElement>(null);
  const caloriesInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const update = (patch: Partial<EntryDraft>) => setDraft(current => ({ ...current, ...patch }));
  const baseCalories = energyInputToKcal(draft.calories, draft.entryEnergyUnit);
  const multiplier = draft.unitMode === '100g' ? draftPortion(draft) / 100 : draftPortion(draft);
  const total = { calories: baseCalories * multiplier, fat: n(draft.fat) * multiplier, carbs: n(draft.carbs) * multiplier, protein: n(draft.protein) * multiplier };
  // Reviewing a picked food, an AI estimate or a saved entry starts from what it is; typing one in starts from the numbers.
  const reviewing = openMode !== 'manual';
  const scrollCaloriesPanel = (behavior: ScrollBehavior = 'smooth') => {
    requestAnimationFrame(() => {
      // The numbers are at or near the top of the sheet, so showing them means back to the top.
      caloriesPanelRef.current?.closest('.modal-body')?.scrollTo({ top: 0, behavior });
    });
  };
  const focusCaloriesInput = () => {
    requestAnimationFrame(() => {
      caloriesInputRef.current?.focus({ preventScroll: true });
      caloriesInputRef.current?.select();
    });
  };
  // Each option sets its own value, so tapping the one already chosen changes nothing.
  const setEntryEnergyUnit = (nextUnit: EnergyUnit) => setDraft(current => current.entryEnergyUnit === nextUnit
    ? current
    : { ...current, entryEnergyUnit: nextUnit, calories: energyInputFromKcal(energyInputToKcal(current.calories, current.entryEnergyUnit), nextUnit) });
  const setUnitMode = (nextUnitMode: EntryDraft['unitMode']) => setDraft(current => ({ ...current, ...switchDraftBasis(current, nextUnitMode) }));
  const chooseFood = (food: Food) => {
    const unit = draft.entryEnergyUnit;
    setDraft(current => ({
      ...current,
      sourceFoodId: food.source ? '' : food.id,
      name: food.name,
      unitMode: entryUnitModeValue(food.unitMode),
      brand: food.brand || '',
      servingLabel: food.servingLabel || '',
      servingGrams: food.servingGrams ? String(food.servingGrams) : '',
      source: food.source || '',
      sourceId: food.sourceId || '',
      category: food.category || '',
      tags: food.tags || [],
      calories: draftEnergyText(food.calories, unit),
      protein: draftNumberText(food.protein),
      carbs: draftNumberText(food.carbs),
      fat: draftNumberText(food.fat),
      portion: entryUnitModeValue(food.unitMode) === '100g' ? '100' : '1',
      favourite: null,
      estimateSource: estimateSourceValue(food.estimateSource),
      estimateDetails: null
    }));
    scrollCaloriesPanel();
  };

  useEffect(() => {
    if (!open) return;
    scrollCaloriesPanel('auto');
    if (openMode === 'manual') focusCaloriesInput();
  }, [open, openMode]);

  useEffect(() => {
    if (open) return;
    setRefineText('');
    setRefineError('');
  }, [open]);

  const perUnit = { calories: baseCalories, protein: n(draft.protein), carbs: n(draft.carbs), fat: n(draft.fat) };
  const macroCheckFails = !!draft.estimateSource && macrosDisagree(perUnit);
  const refine = async () => {
    if (!onRefine || !refineText.trim() || refining) return;
    setRefining(true);
    setRefineError('');
    try {
      await onRefine(refineText);
      setRefineText('');
    } catch (err) {
      setRefineError(err instanceof Error ? err.message : 'Gemini could not refine this estimate.');
    } finally {
      setRefining(false);
    }
  };

  const per100g = draft.unitMode === '100g';
  const basisText = per100g ? 'per 100 g' : 'per serving';
  // What one serving is ("1 pouch (140g)", "1 tsp (5g)"), so the amount can be checked against it.
  // A bare weight or "1 serve" would only repeat the amount.
  const servingCaption = draft.servingLabel.trim();
  const showServingCaption = !!servingCaption && !/^[\d.,]+\s*g$/i.test(servingCaption) && !/^1\s*serv(e|ing)$/i.test(servingCaption);
  const displayUnit = state.settings.energyUnit;
  const hasCalories = draft.calories.trim() !== '';
  const loggedText = energyTextForUnit(total.calories, displayUnit);
  const dayName = readable(day.date);
  const dayWord = ['Today', 'Yesterday', 'Tomorrow'].includes(dayName) ? dayName.toLowerCase() : `on ${dayName}`;
  const remaining = Math.round(day.target - day.eaten - (hasCalories ? total.calories : 0));
  const dayLine = !(day.target > 0)
    ? ''
    : remaining < 0
      ? `${energyTextForUnit(-remaining, displayUnit)} over${day.bulking ? ' target' : ''} ${dayWord}`
      : `${energyTextForUnit(remaining, displayUnit)} ${day.bulking ? 'to go' : 'left'} ${dayWord}`;
  const swipeLabel = draft.editingId
    ? hasCalories ? `Swipe to save ${loggedText}` : 'Swipe to save entry'
    : hasCalories ? `Swipe to log ${loggedText}` : 'Swipe to log food';
  // The heart shows the saved food this entry belongs to, and only changes it once tapped.
  const savedFavourite = !!linkedFood(foods, draft.sourceFoodId, draft.name)?.favourite;
  const isFavourite = draft.favourite ?? savedFavourite;
  const favouriteNote = draft.favourite === null || draft.favourite === savedFavourite ? '' : draft.favourite ? 'Also saves it to favourites' : 'Also removes it from favourites';
  const toggleFavourite = () => {
    update({ favourite: !isFavourite });
    // A favourite needs a name to be found again.
    if (!isFavourite && !draft.name.trim()) nameInputRef.current?.focus();
  };
  const nameField = (
    <div className="field full name-field">
      <label className="field-caption" htmlFor="entryName">Food name</label>
      <div className="name-row">
        <input ref={nameInputRef} id="entryName" value={draft.name} placeholder={isFavourite && !draft.name.trim() ? 'Name your favourite' : `${draft.meal} entry`} onChange={event => update({ name: event.target.value })} />
        <FavouriteToggle on={isFavourite} onToggle={toggleFavourite} />
      </div>
    </div>
  );

  return (
    <Modal open={open} title={draft.editingId ? 'Edit entry' : `Log ${draft.meal.toLowerCase()}`} onClose={onClose} wide bottomSheet>
      <form className="form entry-form" onSubmit={(event: FormEvent) => { event.preventDefault(); onSave(false); }}>
        {reviewing && nameField}
        <div ref={caloriesPanelRef} className="calories-priority full" role="group" aria-label="Calories and macros">
          <div className="entry-panel-head">
            <span className="unit-toggle-chip" role="group" aria-label="Nutrition values are">
              <button type="button" className={per100g ? '' : 'active'} aria-pressed={!per100g} onClick={() => setUnitMode('serving')}>Per serving</button>
              <button type="button" className={per100g ? 'active' : ''} aria-pressed={per100g} onClick={() => setUnitMode('100g')}>Per 100g</button>
            </span>
            <span className="unit-toggle-chip" role="group" aria-label="Energy input unit">
              <button type="button" className={draft.entryEnergyUnit === 'kcal' ? 'active' : ''} aria-pressed={draft.entryEnergyUnit === 'kcal'} onClick={() => setEntryEnergyUnit('kcal')}>Cal</button>
              <button type="button" className={draft.entryEnergyUnit === 'kj' ? 'active' : ''} aria-pressed={draft.entryEnergyUnit === 'kj'} onClick={() => setEntryEnergyUnit('kj')}>kJ</button>
            </span>
          </div>
          <div className="calorie-input-row entry-energy-row">
            <input ref={caloriesInputRef} id="entryCalories" aria-label={`${energyUnitLabel(draft.entryEnergyUnit)} ${basisText}`} inputMode="decimal" value={draft.calories} placeholder="0" onChange={event => update({ calories: event.target.value })} />
            <span className="energy-suffix" aria-hidden="true"><strong>{energyUnitLabel(draft.entryEnergyUnit)}</strong><small>{basisText}</small></span>
          </div>
          <div className="nutrition-grid">
            <Field label="Fat (g)"><input inputMode="decimal" value={draft.fat} onChange={event => update({ fat: event.target.value })} /></Field>
            <Field label="Carbs (g)"><input inputMode="decimal" value={draft.carbs} onChange={event => update({ carbs: event.target.value })} /></Field>
            <Field label="Protein (g)"><input inputMode="decimal" value={draft.protein} onChange={event => update({ protein: event.target.value })} /></Field>
          </div>
          <div className="amount-row">
            <label className="amount-label" htmlFor="entryPortion">
              <span>{per100g ? 'Amount eaten' : 'Servings eaten'}</span>
              {showServingCaption && <small>{servingCaption}</small>}
            </label>
            <div className="calorie-input-row amount-input-row">
              <input
                id="entryPortion"
                inputMode="decimal"
                value={draft.portion}
                onChange={event => update({ portion: event.target.value })}
                onFocus={event => {
                  const input = event.currentTarget;
                  // Selected so a new amount replaces the old one. After focus, or iOS clears it.
                  requestAnimationFrame(() => input.select());
                }}
              />
              <span aria-hidden="true">{per100g ? 'g' : draftPortion(draft) === 1 ? 'serving' : 'servings'}</span>
            </div>
          </div>
          {multiplier !== 1 && (
            <div className="meta-chips portion-preview" aria-live="polite">
              <span className="portion-preview-label">Logged total</span>
              <span className="meta-chip accent">{loggedText}</span>
              <MacroChips fat={total.fat} carbs={total.carbs} protein={total.protein} />
            </div>
          )}
          {draft.estimateSource && (
            <div className="estimate-review">
              <div className="meta-chips estimate-source-row">
                <span className="meta-chip source-chip">{estimateSourceLabel(draft.estimateSource)}</span>
                {draft.estimateDetails && <span className={`meta-chip confidence-chip confidence-${draft.estimateDetails.confidence}`}>{draft.estimateDetails.confidence[0].toUpperCase() + draft.estimateDetails.confidence.slice(1)} confidence</span>}
                <button type="button" className="link-btn" onClick={() => update({ estimateSource: null, estimateDetails: null })}>Not an estimate</button>
              </div>
              {/* The Estimated chip already says it's a guess; labels and menus need the specific check. */}
              {draft.estimateSource !== 'ai' && (
                <p className="hint estimate-hint">{draft.estimateSource === 'label'
                  ? 'Read from the label photo. Check it matches the pack and the amount you ate.'
                  : draft.estimateSource === 'rough'
                    ? 'A rough size for a meal that was hard to track. Change the number if you find out more.'
                    : 'Energy printed on the menu; macros are estimated.'}</p>
              )}
              {!!draft.estimateDetails?.assumptions.length && (
                <ul className="estimate-assumptions" aria-label="What Gemini assumed">
                  {draft.estimateDetails.assumptions.map(item => <li key={item}>{item}</li>)}
                </ul>
              )}
              {macroCheckFails && (
                <p className="estimate-warning">Calories and macros don’t quite add up: the macros come to about {energyTextForUnit(energyFromMacros(perUnit), draft.entryEnergyUnit)}. Worth a check, unless it contains alcohol.</p>
              )}
              {onRefine && (
                <div className="estimate-refine">
                  <input
                    aria-label="Correction for Gemini"
                    value={refineText}
                    disabled={refining}
                    placeholder="Something off? e.g. small bowl, no cheese"
                    onChange={event => { setRefineText(event.target.value); setRefineError(''); }}
                    onKeyDown={event => {
                      if (event.key !== 'Enter') return;
                      // Enter would otherwise submit Log Food.
                      event.preventDefault();
                      refine();
                    }}
                  />
                  <button type="button" className="secondary" disabled={!refineText.trim() || refining} onClick={refine}>{refining ? 'Refining…' : 'Refine'}</button>
                </div>
              )}
              {refineError && <p className="ai-quick-log-error">{refineError}</p>}
            </div>
          )}
        </div>

        <Field label="Meal" full><div className="meal-chip-row">{MEALS.map(meal => <button key={meal} type="button" className={`meal-chip ${draft.meal === meal ? 'active' : ''}`} onClick={() => update({ meal })}>{meal}</button>)}</div></Field>
        {!reviewing && nameField}
        {!reviewing && !draft.editingId && <SavedFoodPicker state={state} foods={foods} onChoose={chooseFood} onSaveDatabaseFood={onSaveDatabaseFood} compact />}
        <div className="photo-picker full">
          <button type="button" className="photo-picker-label" onClick={onPickPhoto}>
            <span className="photo-picker-icon" aria-hidden="true"><span className="empty-photo-icon" /></span><span><strong>{draft.photo ? 'Meal photo attached' : 'Add meal photo'}</strong><small>{draft.photo ? 'Tap to replace the photo' : 'Optional journal photo, compressed before saving'}</small></span>
          </button>
          {draft.photo && <div className="photo-picker-preview show"><img src={draft.photo} alt="Selected meal preview" /></div>}
        </div>

        <div className="entry-form-extras">
          <Field label="Notes" full><textarea value={draft.notes} onChange={event => update({ notes: event.target.value })} /></Field>
        </div>

        {/* What saving does, at the point of saving. ✕ and swipe down still close the sheet. */}
        <div className="actions full">
          {dayLine && <p className={`entry-day-impact ${remaining < 0 ? 'over' : ''}`}>{hasCalories && 'After this: '}<strong>{dayLine}</strong></p>}
          {favouriteNote && <p className={`entry-fav-note ${draft.favourite ? 'on' : ''}`}><Icon name="heart" size={14} filled={!!draft.favourite} />{favouriteNote}</p>}
          <SwipeConfirm label={swipeLabel} confirmLabel={draft.editingId ? 'Release to save' : 'Release to log'} className="entry-swipe" onConfirm={() => onSave(false)} />
          {!reviewing && !draft.editingId && <button className="secondary" type="button" onClick={() => onSave(true)}>Save and add another</button>}
        </div>
      </form>
    </Modal>
  );
}

function FoodModal({ food, open, energyUnit, onClose, onSave, onDelete }: { food: Food | null; open: boolean; energyUnit: EnergyUnit; onClose: () => void; onSave: (food: Food) => void; onDelete: (food: Food) => void }) {
  const [draft, setDraft] = useState<Food | null>(food);
  const foodEnergyUnit = energyUnitValue(energyUnit);
  const [calorieInput, setCalorieInput] = useState('');
  useEffect(() => {
    setDraft(food ? structuredClone(food) : null);
    setCalorieInput(food ? energyInputFromKcal(food.calories, foodEnergyUnit) : '');
  }, [food, foodEnergyUnit]);
  if (!draft) return <Modal open={open} title="Manage food" onClose={onClose} bottomSheet><div className="empty">Food not found.</div></Modal>;
  const patch = (next: Partial<Food>) => setDraft(current => current ? { ...current, ...next } : current);
  const setCalories = (value: string) => {
    setCalorieInput(value);
    patch({ calories: energyInputToKcal(value, foodEnergyUnit) });
  };
  const toggleFoodUnitMode = () => patch({ unitMode: entryUnitModeValue(draft.unitMode) === 'serving' ? '100g' : 'serving' });
  return (
    <Modal open={open} title="Manage food" onClose={onClose} bottomSheet>
      <form className="form" onSubmit={event => { event.preventDefault(); onSave({ ...draft, calories: energyInputToKcal(calorieInput, foodEnergyUnit) }); }}>
        <div className="field full name-field">
          <label className="field-caption" htmlFor="foodName">Name</label>
          <div className="name-row">
            <input id="foodName" value={draft.name} onChange={event => patch({ name: event.target.value })} />
            <FavouriteToggle on={draft.favourite} onToggle={() => patch({ favourite: !draft.favourite })} />
          </div>
        </div>
        <Field label="Calories">
          <div className="calorie-input-row food-calorie-input">
            <input inputMode="decimal" value={calorieInput} onChange={event => setCalories(event.target.value)} />
            <span>{energyUnitLabel(foodEnergyUnit)}</span>
          </div>
        </Field>
        <Field label="Fat">
          <div className="calorie-input-row macro-input-row">
            <input inputMode="decimal" value={draft.fat} onChange={event => patch({ fat: n(event.target.value) })} />
            <span>g</span>
          </div>
        </Field>
        <Field label="Carbs">
          <div className="calorie-input-row macro-input-row">
            <input inputMode="decimal" value={draft.carbs} onChange={event => patch({ carbs: n(event.target.value) })} />
            <span>g</span>
          </div>
        </Field>
        <Field label="Protein">
          <div className="calorie-input-row macro-input-row">
            <input inputMode="decimal" value={draft.protein} onChange={event => patch({ protein: n(event.target.value) })} />
            <span>g</span>
          </div>
        </Field>
        <Field label="Nutrition values" full>
          <span className="unit-toggle-chip food-basis-toggle" role="group" aria-label="Saved food nutrition basis">
            <button type="button" className={entryUnitModeValue(draft.unitMode) === 'serving' ? 'active' : ''} onClick={toggleFoodUnitMode}>Per serving</button>
            <button type="button" className={entryUnitModeValue(draft.unitMode) === '100g' ? 'active' : ''} onClick={toggleFoodUnitMode}>Per 100g</button>
          </span>
        </Field>
        {draft.estimateSource && (
          <div className="meta-chips estimate-source-row full">
            <span className="meta-chip source-chip">{estimateSourceLabel(draft.estimateSource)}</span>
            <button type="button" className="link-btn" onClick={() => patch({ estimateSource: null })}>Not an estimate</button>
          </div>
        )}
        <div className="actions full"><button className="primary" type="submit">Save food</button><button className="secondary danger" type="button" onClick={() => onDelete(draft)}>Delete</button></div>
      </form>
    </Modal>
  );
}

function LibraryView({ state, sub, setSub, query, setQuery, onPrefill, onToggleFavourite, onManage }: { state: AppState; sub: string; setSub: (sub: string) => void; query: string; setQuery: (q: string) => void; onPrefill: (food: Food) => void; onToggleFavourite: (food: Food) => void; onManage: (food: Food) => void }) {
  // Un-hearting on Favourites leaves the row in place until you switch lists, so a slip is one tap to undo.
  const [unhearted, setUnhearted] = useState<string[]>([]);
  useEffect(() => setUnhearted([]), [sub]);
  const foods = state.foods.filter(food => !query || food.name.toLowerCase().includes(query.toLowerCase())).sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
  const shown = sub === 'favourites' ? foods.filter(food => food.favourite || unhearted.includes(food.id)) : foods;
  const toggleFavourite = (food: Food) => {
    if (sub === 'favourites' && food.favourite) setUnhearted(ids => [...ids, food.id]);
    onToggleFavourite(food);
  };
  const emptyCopy =
    sub === 'favourites'
      ? { title: 'No favourites yet.', body: 'Tap the heart on a food you eat often. Favourites show here and first when you search on Today.' }
      : query.trim()
        ? { title: 'No matches yet.', body: 'Try a different food name.' }
        : { title: 'Nothing here yet.', body: 'Your usual foods will appear here as you reuse them.' };
  return (
    <>
      <header className="page-header has-helper">
        <h1 className="page-title">Foods</h1>
        <p className="hint page-subtitle library-hint">Tap + to log a food again. Heart the ones you eat often.</p>
      </header>
      <div className="page-controls">
        <div className="seg" role="tablist" aria-label="Saved foods">
          <button className={sub === 'history' ? 'active' : ''} onClick={() => setSub('history')} type="button" role="tab" aria-selected={sub === 'history'}>
            Recent
          </button>
          <button className={sub === 'favourites' ? 'active' : ''} onClick={() => setSub('favourites')} type="button" role="tab" aria-selected={sub === 'favourites'}>
            Favourites
          </button>
        </div>
        <input className="search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search your usual foods" />
      </div>
      <section className={shown.length ? 'list-card' : 'card'}>
        {shown.length ? (
          shown.map(food => <FoodRow key={food.id} state={state} food={food} showUsage={sub !== 'favourites'} onPrefill={onPrefill} onToggleFavourite={toggleFavourite} onManage={onManage} />)
        ) : (
          <div className="empty">
            <strong>{emptyCopy.title}</strong>
            <div>{emptyCopy.body}</div>
          </div>
        )}
      </section>
    </>
  );
}

function FoodRow({ state, food, showUsage, onPrefill, onToggleFavourite, onManage }: { state: AppState; food: Food; showUsage: boolean; onPrefill: (food: Food) => void; onToggleFavourite: (food: Food) => void; onManage: (food: Food) => void }) {
  const sub = [foodUnitText(food), showUsage && food.usageCount ? `logged ${fmt(food.usageCount)}×` : '', `P ${fmt(food.protein)} · C ${fmt(food.carbs)} · F ${fmt(food.fat)}g`].filter(Boolean).join(' · ');
  return (
    <div className="food-row" data-swipe-lock>
      <FavouriteToggle on={food.favourite} onToggle={() => onToggleFavourite(food)} label={`Favourite ${food.name}`} size={20} />
      <div className="body">
        <strong>{food.name}</strong>
        <div className="food-sub">{sub}</div>
      </div>
      <div className="food-cal">{food.estimateSource && <><span aria-hidden="true">≈</span><span className="sr-only">About </span></>}{fmt(energyValue(state, food.calories))}<small>{energyLabel(state)}</small></div>
      <button className="food-log-btn" type="button" onClick={() => onPrefill(food)} aria-label={`Log ${food.name}`}><Icon name="plus" size={20} /></button>
      <button className="food-manage-btn" type="button" onClick={() => onManage(food)} aria-label={`Manage ${food.name}`}><span aria-hidden="true" /></button>
    </div>
  );
}

function shuffleEntries<T extends { id: string }>(items: T[], seed: number) {
  const list = [...items];
  if (!seed) return list;
  let next = seed >>> 0;
  for (let i = list.length - 1; i > 0; i -= 1) {
    next = (next * 1664525 + 1013904223) >>> 0;
    const j = next % (i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Stable preview order for journal month tiles (same day keeps the same thumbnails until entries change). */
function journalMonthPreviewEntries(photos: Entry[]): Entry[] {
  if (!photos.length) return [];
  return [...photos].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 4);
}

function JournalView({
  state,
  journalMonth,
  setJournalMonth,
  journalDay,
  setJournalDay,
  dayViewMode,
  setDayViewMode,
  labelMode,
  setLabelMode,
  shuffleSeed,
  onShuffle,
  onPhoto,
  mealGroups,
  onOpenMealCard,
  onOpenDay
}: {
  state: AppState;
  journalMonth: Date;
  setJournalMonth: (date: Date) => void;
  journalDay: string | null;
  setJournalDay: (day: string | null) => void;
  dayViewMode: JournalDayViewMode;
  setDayViewMode: (mode: JournalDayViewMode) => void;
  labelMode: JournalLabelMode;
  setLabelMode: (mode: JournalLabelMode) => void;
  shuffleSeed: number;
  onShuffle: () => void;
  onPhoto: (entry: Entry) => void;
  mealGroups: MealGroup[];
  onOpenMealCard: (group: MealGroup) => void;
  onOpenDay: (date: string) => void;
}) {
  const year = journalMonth.getFullYear();
  const month = journalMonth.getMonth();
  const settleRef = useSettleAnimation(journalDay || `${year}-${month}`);
  if (journalDay) {
    const entries = dayEntries(state, journalDay);
    const photos = entries.filter(entry => entry.photo);
    const dayTotals = sum(entries);
    const dayGroups = mealGroups.filter(group => group.date === journalDay);
    const setDay = (key: string) => {
      setJournalDay(key);
      setJournalMonth(new Date(`${key}T00:00:00`));
    };
    const returnToMonth = () => {
      setJournalMonth(new Date(`${journalDay}T00:00:00`));
      setJournalDay(null);
    };
    const labelOrder: JournalLabelMode[] = ['photo', 'calories', 'nameCalories'];
    const labelTitle = labelMode === 'photo' ? 'Photo' : labelMode === 'calories' ? 'Calories' : 'Name + Cal';
    const shuffledPhotos = shuffleEntries(photos, shuffleSeed);
    const featureOffset = shuffledPhotos.length ? Math.abs(shuffleSeed || 0) % Math.min(5, shuffledPhotos.length) : 0;
    const labelText = (entry: Entry) => {
      const calories = energyText(state, entryTotals(entry).calories);
      if (labelMode === 'photo') return null;
      if (labelMode === 'calories') return <span className="journal-photo-caption calories-only">{calories}</span>;
      return <span className="journal-photo-caption"><strong>{entry.name}</strong><span>{calories}</span></span>;
    };
    return (
      <div className="screen-swipe-zone view-transition" ref={settleRef}>
        <header className="page-header">
          <div className="page-kicker">{new Date(`${journalDay}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1 className="page-title">{readable(journalDay)}</h1>
        </header>
        <div className="journal-day-nav">
          <DayNav value={journalDay} onChange={setDay} />
          <button className="journal-month-btn" type="button" onClick={returnToMonth}>
            <span className="month-ico" aria-hidden="true" />
            <span className="month-label">Month</span>
          </button>
        </div>
        <div className="journal-day-toolbar">
          <div className="seg journal-toggle" role="group" aria-label="Journal day view">
            <button type="button" className={dayViewMode === 'list' ? 'active' : ''} onClick={() => setDayViewMode(dayViewMode === 'list' ? 'collage' : 'list')}>List</button>
            <button type="button" className={dayViewMode === 'collage' ? 'active' : ''} onClick={() => setDayViewMode(dayViewMode === 'list' ? 'collage' : 'list')}>Collage</button>
          </div>
          {dayViewMode === 'collage' && photos.length > 0 && (
            <button className="journal-label-toggle" type="button" onClick={onShuffle}>
              Shuffle
            </button>
          )}
          {photos.length > 0 && (
            <button
              className="journal-label-toggle active"
              type="button"
              onClick={() => setLabelMode(labelOrder[(labelOrder.indexOf(labelMode) + 1) % labelOrder.length])}
            >
              {labelTitle}
            </button>
          )}
        </div>
        {dayViewMode === 'collage'
          ? shuffledPhotos.length ? <div className={`journal-collage-grid label-${labelMode}`}>{shuffledPhotos.map((entry, index) => {
            const featured = index === featureOffset || ((index + featureOffset) % 7 === 0 && index < photos.length - 1);
            return <button className={`journal-photo-card ${featured ? 'featured' : ''}`} key={entry.id} type="button" onClick={() => onPhoto(entry)}><img src={entry.photo || ''} alt="" />{labelText(entry)}</button>;
          })}</div> : <div className="empty"><strong>No photos yet.</strong><div>Add a meal photo while logging to build your journal.</div></div>
          : entries.length ? <div className={`journal-day-list label-${labelMode}`}>{entries.map(entry => {
            const totals = entryTotals(entry);
            const hideTitleOnThumb = entry.photo && labelMode === 'nameCalories';
            const hideCalChipOnThumb = entry.photo && (labelMode === 'calories' || labelMode === 'nameCalories');
            return (
              <button key={entry.id} className={`journal-entry-card ${entry.photo ? '' : 'no-photo'}`} data-swipe-lock type="button" onClick={() => entry.photo && onPhoto(entry)}>
                {entry.photo ? (
                  <span className="journal-entry-photo-wrap">
                    <img className="journal-entry-photo" src={entry.photo} alt="" />
                    {labelText(entry)}
                  </span>
                ) : null}
                <div>
                  {!hideTitleOnThumb && <div className="journal-entry-title">{entry.name}</div>}
                  <div className="meta-chips journal-meta-chips">
                    <span className="meta-chip neutral">{entry.meal || 'Snack'}</span>
                    {entry.estimateSource && <span className="meta-chip source-chip">{estimateSourceLabel(entry.estimateSource)}</span>}
                    {!hideCalChipOnThumb && <span className="meta-chip accent">{energyText(state, totals.calories)}</span>}
                    <MacroChips fat={totals.fat} carbs={totals.carbs} protein={totals.protein} />
                  </div>
                  {entry.notes && <div className="journal-entry-note">{entry.notes}</div>}
                </div>
              </button>
            );
          })}</div> : <div className="empty"><strong>Nothing logged yet.</strong><div>Log something when you&apos;re ready.</div></div>}
        {dayGroups.length > 0 && (
          <section className="journal-cards" aria-label="Meal cards">
            <div className="section">Meal cards</div>
            <p className="hint journal-cards-hint">Share a meal as a simple summary card.</p>
            <div className="journal-card-list">
              {dayGroups.map(group => (
                <button key={group.id} className="journal-card-row" type="button" data-swipe-lock onClick={() => onOpenMealCard(group)}>
                  <span className={`meal-card-thumb count-${Math.min(group.photos.length, 4)}`} aria-hidden="true">
                    {group.photos.length ? group.photos.slice(0, 4).map((src, index) => <img key={`${group.id}-${index}`} src={src} alt="" />) : <span className="empty-photo-icon" />}
                  </span>
                  <span className="journal-card-row-body">
                    <strong>{group.meal}</strong>
                    <small>{group.items.length} item{group.items.length === 1 ? '' : 's'} · {energyText(state, group.totals.calories)}</small>
                  </span>
                  <span className="journal-card-row-action">Card</span>
                </button>
              ))}
            </div>
          </section>
        )}
        <button className="secondary journal-open-track" type="button" onClick={() => onOpenDay(journalDay)}>
          {entries.length ? 'Open this day' : 'Log food for this day'}
        </button>
        <div className="journal-day-summary-bar" data-swipe-lock aria-label="Journal day totals">
          <div className="journal-day-summary-main">
            <span>Total</span>
            <strong>{energyText(state, dayTotals.calories)}</strong>
          </div>
          <div className="meta-chips journal-day-summary-macros">
            <MacroChips fat={dayTotals.fat} carbs={dayTotals.carbs} protein={dayTotals.protein} />
          </div>
        </div>
      </div>
    );
  }
  const first = new Date(year, month, 1);
  // Weeks start on Monday, matching the Week tab and the weekly bank.
  const offset = (first.getDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, i) => new Date(year, month, i - offset + 1));
  return (
    <div className="screen-swipe-zone view-transition" ref={settleRef}>
      <header className="page-header has-helper">
        <h1 className="page-title">Journal</h1>
        <p className="hint page-subtitle">A visual memory of what you ate, organised by day.</p>
      </header>
      <MonthNav value={journalMonth} onChange={setJournalMonth} />
      <div className="calendar journal-month-surface">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <div key={`${d}${i}`} className="dow">
            {d}
          </div>
        ))}
        {days.map(day => {
          const key = toKey(day);
          const entries = dayEntries(state, key);
          const photos = entries.filter(entry => entry.photo);
          const preview = journalMonthPreviewEntries(photos);
          const inMonth = day.getMonth() === month;
          const isPhotoDay = preview.length > 0;
          const count = Math.min(preview.length, 4) as 1 | 2 | 3 | 4;
          return (
            <button
              key={key}
              className={`daybox ${inMonth ? '' : 'mutedday'} ${key === todayKey() ? 'today' : ''} ${isPhotoDay ? 'daybox-photo' : 'daybox-quiet'}`}
              type="button"
              onClick={() => setJournalDay(key)}
              aria-label={`Open journal for ${readable(key)}`}
            >
              {isPhotoDay ? (
                <>
                  <span className={`journal-month-collage jmc-${count}`} aria-hidden="true">
                    {preview.map(entry => (
                      <span key={entry.id} className="journal-month-thumb">
                        <img src={entry.photo || ''} alt="" loading="lazy" decoding="async" />
                      </span>
                    ))}
                  </span>
                  <span className="daynum daynum-overlay">{day.getDate()}</span>
                </>
              ) : (
                <span className="daynum daynum-quiet">{day.getDate()}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function getMealGroups(state: AppState): MealGroup[] {
  const map = new Map<string, MealGroup>();
  state.entries.forEach(entry => {
    if (!entry.date) return;
    const meal = MEALS.includes(entry.meal || 'Snack') ? entry.meal || 'Snack' : 'Snack';
    const id = mealGroupId(entry.date, meal);
    if (!map.has(id)) map.set(id, { id, date: entry.date, meal, items: [], totals: { calories: 0, protein: 0, carbs: 0, fat: 0 }, photos: [] });
    map.get(id)?.items.push(entry);
  });
  return [...map.values()].map(group => ({ ...group, items: group.items.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)), totals: sum(group.items), photos: group.items.filter(entry => entry.photo).map(entry => entry.photo as string) })).sort((a, b) => b.date.localeCompare(a.date) || MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal));
}

function MealCardModal({ state, group, open, onClose, onShare }: { state: AppState; group: MealGroup | null; open: boolean; onClose: () => void; onShare: () => void }) {
  const [format, setFormat] = useState<'photo' | 'summary'>('photo');
  const tapStart = useRef<{ x: number; y: number; time: number } | null>(null);
  useEffect(() => {
    if (open) setFormat(group?.photos.length ? 'photo' : 'summary');
  }, [open, group?.id]);
  if (!group) return <Modal open={open} title="Meal Card" onClose={onClose} wide><div className="empty">Meal card not found.</div></Modal>;
  const photoMode = format === 'photo' && group.photos.length > 0;
  const toggleFormat = () => setFormat(current => current === 'photo' ? 'summary' : group.photos.length ? 'photo' : 'summary');
  const handleCardPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = tapStart.current;
    tapStart.current = null;
    if (!start) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    const elapsed = Date.now() - start.time;
    if (moved <= 8 && elapsed < 500) toggleFormat();
  };
  return (
    <Modal open={open} title="Meal Card" onClose={onClose} wide>
      <p className="hint meal-card-modal-hint">Tap the card to switch formats. On iPhone, Save / Share PNG opens the native share sheet.</p>
      <div
        className={`share-card ${photoMode ? 'photo-mode' : 'summary-mode'}`}
        onPointerDown={event => {
          tapStart.current = { x: event.clientX, y: event.clientY, time: Date.now() };
        }}
        onPointerUp={handleCardPointerUp}
        onPointerCancel={() => {
          tapStart.current = null;
        }}
      >
        <div className="share-card-kicker">Meal Summary</div>
        <div className="share-card-head"><h3>{group.meal}</h3><span>{shortDate(group.date)}</span></div>
        {photoMode && <img className="share-card-photo" src={group.photos[0]} alt="" />}
        <div className="share-card-calories">
          <strong>{fmt(energyValueForUnit(group.totals.calories, state.settings.energyUnit))}</strong>
          <span>{energyLabel(state)}</span>
          <small>{photoMode ? `${group.items.length} items` : 'Total meal calories'}</small>
        </div>
        <div className="share-card-macros">
          {!photoMode && <div><span>Items</span><strong>{group.items.length}</strong></div>}
          <div><span>Protein</span><strong>{fmt(group.totals.protein)}g</strong></div>
          <div><span>Carbs</span><strong>{fmt(group.totals.carbs)}g</strong></div>
          <div><span>Fat</span><strong>{fmt(group.totals.fat)}g</strong></div>
        </div>
        <div className="share-card-breakdown">
          <span>{photoMode ? 'Food items' : 'Breakdown'}</span>
          {group.items.map(item => <div key={item.id}><strong>{item.name}</strong><small>{energyText(state, entryTotals(item).calories)}</small></div>)}
        </div>
      </div>
      <div className="card-dots" aria-hidden="true"><span className={format === 'photo' ? 'active' : ''} /><span className={format === 'summary' ? 'active' : ''} /></div>
      <p className="hint">Tap card to compare formats</p>
      <div className="actions vertical"><button className="primary" type="button" onClick={onShare}>Save / Share PNG</button><button className="secondary" type="button" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

async function shareMealCard(group: MealGroup, energyUnit: EnergyUnit, notify: (text: string) => void) {
  try {
    const canvas = await renderMealCardCanvas(group, energyUnit);
    const blob = await canvasToPngBlob(canvas);
    await sharePhotoBlob(blob, `simple-calories-ledger-${group.date}-${group.meal.toLowerCase()}.png`, 'Meal Summary', notify);
  } catch (err) {
    console.warn(err);
    notify('Could not share PNG');
  }
}

async function sharePhoto(src: string, filename: string, notify: (text: string) => void) {
  const response = await fetch(src);
  const blob = await response.blob();
  await sharePhotoBlob(blob, filename, 'Meal Photo', notify);
}

async function sharePhotoBlob(blob: Blob, filename: string, title: string, notify: (text: string) => void) {
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    await navigator.share({ files: [file], title, text: title });
    notify('Share sheet opened');
  } else {
    downloadBlob(blob, filename);
    notify('Sharing unavailable. PNG downloaded instead');
  }
}

function EntryPhotoModal({ entry, open, onClose, onReplace, onRemove, onShare }: { entry: Entry | null; open: boolean; onClose: () => void; onReplace: () => void; onRemove: () => void; onShare: () => void }) {
  return <Modal open={open} title="Meal photo" onClose={onClose} className="lightbox" bottomSheet>{entry?.photo ? <><div className="photo-preview-shell"><img className="photo-preview-large" src={entry.photo} alt="" /></div><p className="hint">{entry.name} | {readable(entry.date)}</p><div className="actions vertical"><button className="primary" type="button" onClick={onReplace}>Replace</button><button className="primary" type="button" onClick={onShare}>Save / Share PNG</button><button className="secondary danger" type="button" onClick={onRemove}>Remove</button></div></> : <div className="empty">No photo yet.</div>}</Modal>;
}

type CalorieDayStatus = 'open' | 'good' | 'under' | 'over';

function getCalorieBand(goal: DailyGoalSnapshot) {
  const target = Math.max(goal.calories, 1);
  if (goal.trackingMode === 'Bulking') return { lower: target, target, upper: target + 300 };
  if (goal.trackingMode === 'Maintaining') return { lower: target - 150, target, upper: target + 150 };
  return { lower: 0, target, upper: target };
}

function classifyCalorieDay(intake: number | null, goal: DailyGoalSnapshot): CalorieDayStatus {
  if (intake == null) return 'open';
  const band = getCalorieBand(goal);
  if (goal.trackingMode === 'Cutting') return intake <= band.target ? 'good' : 'over';
  if (intake < band.lower) return 'under';
  return intake <= band.upper ? 'good' : 'over';
}

function statsRuleText(goal: DailyGoalSnapshot, unit: EnergyUnit) {
  if (goal.trackingMode === 'Bulking') return `On track = counted days from ${energyTextForUnit(goal.calories, unit)} to ${energyTextForUnit(goal.calories + 300, unit)}.`;
  if (goal.trackingMode === 'Maintaining') return `On track = counted days within ${energyTextForUnit(goal.calories - 150, unit)}-${energyTextForUnit(goal.calories + 150, unit)}.`;
  return `On track = counted days at or under ${energyTextForUnit(goal.calories, unit)}.`;
}

/** Dot and pill colour for a day in the week. */
type DayTone = 'good' | 'review' | 'check' | 'today' | 'none' | 'open';

function dayTone(day: BankDay): DayTone {
  if (day.intake != null) return classifyCalorieDay(day.intake, day.goal) === 'good' ? 'good' : 'review';
  if (day.status === 'light') return 'check';
  if (day.status === 'today') return 'today';
  if (day.status === 'untracked') return 'none';
  return 'open';
}

const DAY_TONE_LABEL: Record<DayTone, string> = { good: 'On track', review: 'Review', check: 'Check', today: 'Today', none: 'No log', open: 'Later' };

function signedEnergyText(state: AppState, kcal: number) {
  return `${kcal > 0 ? '+' : ''}${energyText(state, kcal)}`;
}

function signedEnergyValue(state: AppState, kcal: number) {
  const value = energyValueForUnit(kcal, state.settings.energyUnit);
  return `${value > 0 ? '+' : ''}${fmt(value)}`;
}

/** A planning number, rounded to the nearest 10 so it doesn't look more exact than it is. */
function aboutEnergyText(state: AppState, kcal: number) {
  return `${fmt(Math.round(energyValue(state, kcal) / 10) * 10)} ${energyLabel(state)}`;
}

const weekdayName = (date: string, style: 'long' | 'short' = 'long') => new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: style });

type MetricTone = 'good' | 'warn' | '';

/** Whether a gap from target (target minus eaten) is good news depends on the goal. */
function gapTone(mode: TrackingMode | null, gap: number, tolerance: number): MetricTone {
  if (mode === 'Maintaining') return Math.abs(gap) <= tolerance ? 'good' : 'warn';
  if (mode === 'Bulking') return gap <= 0 ? 'good' : 'warn';
  return gap >= 0 ? 'good' : 'warn';
}

/** The plain answer to "how much can I eat for the rest of the week?". */
function bankAnswer(state: AppState, week: WeekBank) {
  const { remaining, perDay, overAtFloor, banked } = week;
  if (!remaining.length) {
    if (banked > 0) return `Finished ${energyText(state, banked)} under target.`;
    if (banked < 0) return `Finished ${energyText(state, -banked)} over target.`;
    return 'Finished right on target.';
  }
  const amount = aboutEnergyText(state, perDay);
  const includesToday = remaining[0].date === todayKey();
  const single = remaining.length === 1;
  if (overAtFloor > 0) {
    const when = single ? (includesToday ? 'today' : `on ${weekdayName(remaining[0].date)}`) : 'a day';
    return `Aim for about ${amount} ${when}. The week will still finish about ${aboutEnergyText(state, overAtFloor)} over, and the bank resets Monday.`;
  }
  if (single) return includesToday ? `Today can be about ${amount} in total.` : `${weekdayName(remaining[0].date)} can be about ${amount}.`;
  return `The ${remaining.length} days left${includesToday ? ', including today,' : ''} can average about ${amount} each.`;
}

function RichStatsView({ state, selectedDate, bankingWeekStart, setBankingWeekStart, onBankHelp, onAdherenceHelp, onOpenDay }: { state: AppState; selectedDate: string; bankingWeekStart: string; setBankingWeekStart: (start: string) => void; onBankHelp: () => void; onAdherenceHelp: () => void; onOpenDay: (date: string) => void }) {
  const prevBankingWeekRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevBankingWeekRef.current !== null && prevBankingWeekRef.current !== bankingWeekStart) {
      requestAnimationFrame(() => {
        try {
          window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        } catch {
          window.scrollTo(0, 0);
        }
      });
    }
    prevBankingWeekRef.current = bankingWeekStart;
  }, [bankingWeekStart]);

  const settleRef = useSettleAnimation(bankingWeekStart);
  const week = weekBank(state, bankingWeekStart);
  const last7 = Array.from({ length: 7 }, (_, i) => bankDay(state, addDays(selectedDate, i - 6)));
  const last7Counted = last7.filter(day => day.intake != null);
  return (
    <div className="screen-swipe-zone view-transition" ref={settleRef}>
      <div className="sticky-screen-top">
        <header className="page-header has-helper">
          <h1 className="page-title">Week</h1>
        </header>
        <WeekRangeControl start={bankingWeekStart} setStart={setBankingWeekStart} />
      </div>
      <RichBanking state={state} week={week} onHelp={onBankHelp} onOpenDay={onOpenDay} />

      <RichAdherence state={state} week={week} onHelp={onAdherenceHelp} onOpenDay={onOpenDay} />

      <section className="card stats-card">
        <div className="card-head"><h2>Patterns</h2></div>
        {last7Counted.length ? (
          <>
            <div className="stat"><span>Average on counted days (past 7)</span><strong>{energyText(state, last7Counted.reduce((acc, day) => acc + (day.intake || 0), 0) / last7Counted.length)}</strong></div>
            <div className="stat"><span>Counted days (past 7)</span><strong>{last7Counted.length} / 7</strong></div>
          </>
        ) : <div className="empty">Nothing counted in the past 7 days yet.</div>}
        <ConsumptionBars state={state} days={last7} />
      </section>
    </div>
  );
}

function ConsumptionBars({ state, days }: { state: AppState; days: BankDay[] }) {
  const bands = days.map(day => getCalorieBand(day.goal));
  const shown = days.map(day => day.intake ?? day.totals.calories);
  const maxTotal = Math.max(...bands.map(band => band.upper), ...shown, 1);
  return (
    <div className="consumption-chart" aria-label="Calories over the last 7 days">
      {days.map((day, index) => {
        const total = shown[index];
        const band = bands[index];
        const height = total ? Math.max(8, total / maxTotal * 100) : 3;
        const targetBottom = Math.max(0, Math.min(1, band.target / maxTotal)) * 100;
        const lowerBottom = Math.max(0, Math.min(1, band.lower / maxTotal)) * 100;
        const upperBottom = Math.max(0, Math.min(1, band.upper / maxTotal)) * 100;
        return (
          <div className="consumption-col" key={day.date}>
            <div className="consumption-value">{total ? `${day.status === 'estimated' ? '≈' : ''}${fmt(energyValueForUnit(total, state.settings.energyUnit))}` : '—'}</div>
            <div className="consumption-track">
              {day.goal.trackingMode === 'Maintaining' && <span className="consumption-range" style={{ bottom: `${lowerBottom}%`, height: `${Math.max(2, upperBottom - lowerBottom)}%` }} />}
              <span className="consumption-goal" style={{ bottom: `${targetBottom}%` }} />
              <div className={`consumption-fill ${classifyCalorieDay(day.intake, day.goal)}`} style={{ height: `${height}%` }} />
            </div>
            <div className="consumption-day">{weekdayName(day.date, 'short').slice(0, 3)}</div>
          </div>
        );
      })}
    </div>
  );
}

function WeekRangeControl({ start, setStart }: { start: string; setStart: (start: string) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const currentWeek = weekStartMonday(todayKey());
  const isCurrentWeek = start === currentWeek;
  return (
    <div className="date-row">
      <button className="date-btn prev" type="button" aria-label="Previous week" onClick={() => setStart(addDays(start, -7))} />
      <button className={`date-pill ${isCurrentWeek ? 'current' : 'can-reset'}`} type="button" onClick={() => !isCurrentWeek && setStart(currentWeek)}>
        <span>{isCurrentWeek ? 'This week' : 'Return to this week'}</span>
        <small>{`${shortDate(days[0])} - ${shortDate(days[6])}`}</small>
      </button>
      <button className="date-btn next" type="button" aria-label="Next week" onClick={() => setStart(addDays(start, 7))} />
    </div>
  );
}

const BANK_STATUS_TEXT: Record<DayBankStatus, string> = {
  counted: '',
  estimated: 'rough guess',
  light: 'looks light, check it',
  untracked: 'nothing logged, counts as on target',
  today: 'today, still in progress',
  upcoming: 'coming up'
};

function BankBars({ state, days, onOpenDay }: { state: AppState; days: BankDay[]; onOpenDay: (date: string) => void }) {
  const maxGoal = Math.max(...days.map(day => day.goal.calories), 1);
  return (
    <div className="bank-chart">
      {days.map(day => {
        const counts = day.intake != null;
        const rough = day.status === 'estimated';
        const barHeight = counts ? Math.min(46, Math.max(8, Math.abs(day.delta) / maxGoal * 54)) : 6;
        const tone = counts ? gapTone(day.goal.trackingMode, day.delta, 150) : '';
        const label = counts
          ? `${rough ? '≈' : ''}${signedEnergyValue(state, day.delta)}`
          : day.status === 'light' ? 'Check' : day.status === 'today' ? 'Today' : day.status === 'untracked' ? '—' : ' ';
        const spoken = counts ? `${rough ? 'rough guess, ' : ''}${signedEnergyText(state, day.delta)}` : BANK_STATUS_TEXT[day.status];
        return (
          <button className={`bank-col ${day.status}`} key={day.date} type="button" onClick={() => onOpenDay(day.date)} aria-label={`${readable(day.date)}: ${spoken}. Open this day.`}>
            <span className={`bank-delta ${day.status === 'light' ? 'check' : tone}`}>{label}</span>
            <span className="bank-track">
              <span className="bank-midline" />
              {counts
                ? <span className={`bank-fill ${tone === 'good' ? 'good-fill' : 'warn-fill'} ${day.delta >= 0 ? 'up' : 'down'} ${rough ? 'rough' : ''}`} style={{ height: barHeight }} />
                : <span className={`bank-open-mark ${day.status}`} />}
            </span>
            <span className="bank-day">{weekdayName(day.date, 'short').slice(0, 3)}</span>
          </button>
        );
      })}
    </div>
  );
}

function RichBanking({ state, week, onHelp, onOpenDay }: { state: AppState; week: WeekBank; onHelp: () => void; onOpenDay: (date: string) => void }) {
  const { days, counted, remaining, banked, toCheck } = week;
  const started = days[0].date <= todayKey();
  const finished = !remaining.length;
  const firstMode = (counted[0] || days[0]).goal.trackingMode;
  const mode = counted.every(day => day.goal.trackingMode === firstMode) ? firstMode : null;
  const cutting = !mode || mode === 'Cutting';
  const eaten = counted.reduce((acc, day) => acc + (day.intake || 0), 0);
  const countedTarget = counted.reduce((acc, day) => acc + day.goal.calories, 0);
  const average = counted.length ? eaten / counted.length : 0;
  const logged = counted.filter(day => day.status === 'counted');
  const roughCount = counted.length - logged.length;
  const untrackedCount = days.filter(day => day.status === 'untracked').length;
  const heroValue = cutting
    ? signedEnergyText(state, banked)
    : banked === 0 ? 'On target' : `${energyText(state, Math.abs(banked))} ${banked > 0 ? 'under' : 'over'}`;
  const checkNames = toCheck.length === 1
    ? weekdayName(toCheck[0].date)
    : toCheck.map(day => weekdayName(day.date, 'short')).join(', ').replace(/, ([^,]*)$/, ' and $1');
  if (!started || (finished && !counted.length)) {
    return (
      <section className="card stats-card">
        <div className="card-head"><h2>Weekly calorie bank</h2><button className="help-btn" type="button" onClick={onHelp}>?</button></div>
        <div className="empty">{started ? 'Nothing was logged this week.' : `This week hasn’t started yet. Its budget is ${energyText(state, week.budget)}.`}</div>
      </section>
    );
  }
  return (
    <section className="card stats-card">
      <div className="card-head"><h2>Weekly calorie bank</h2><button className="help-btn" type="button" onClick={onHelp}>?</button></div>
      <div className="bank-hero">
        <div className="label">{finished ? 'Week result' : cutting ? 'Banked so far' : 'So far this week'}</div>
        <div className={`value ${gapTone(mode, banked, 150 * Math.max(1, counted.length))}`}>{heroValue}</div>
        <p className="bank-answer">{bankAnswer(state, week)}</p>
        <div className="bank-note">
          {`Based on ${counted.length} counted day${counted.length === 1 ? '' : 's'}${roughCount ? `, ${roughCount} of them rough guesses` : ''}.`}
          {untrackedCount ? ' Days with nothing logged count as on target.' : ''}
        </div>
      </div>
      {toCheck.length > 0 && (
        <button type="button" className="bank-check" onClick={() => onOpenDay(toCheck[0].date)}>
          <span className="bank-check-text">
            <strong>{checkNames} look{toCheck.length === 1 ? 's' : ''} light</strong>
            <small>
              {toCheck.length === 1 ? `${energyText(state, toCheck[0].totals.calories)} of ${energyText(state, toCheck[0].goal.calories)} logged. ` : ''}
              Check {toCheck.length === 1 ? 'it' : 'them'} so a missed meal doesn’t count as savings.
            </small>
          </span>
          <Icon name="chevron" size={18} />
        </button>
      )}
      <div className="bank-stats">
        {finished
          ? <div><span>Weekly budget</span><strong>{energyText(state, week.budget)}</strong></div>
          : <div><span>Left this week</span><strong className={week.left < 0 ? 'warn' : ''}>{energyText(state, week.left)}</strong></div>}
        <div><span>Daily average</span><strong className={counted.length ? gapTone(mode, countedTarget / counted.length - average, 150) : ''}>{counted.length ? energyText(state, average) : '—'}</strong></div>
        <div><span>Days counted</span><strong>{counted.length} of 7</strong></div>
      </div>
      <BankBars state={state} days={days} onOpenDay={onOpenDay} />
      <p className="hint bank-legend">≈ rough guess · — nothing logged · Tap a day to open it.</p>
      <details className="extra-info bank-details">
        <summary>More details</summary>
        <div className="extra-info-body">
          {!finished && <div className="stat"><span>Weekly budget</span><strong>{energyText(state, week.budget)}</strong></div>}
          <div className="stat"><span>Eaten on counted days</span><strong>{energyText(state, eaten)}</strong></div>
          <div className="stat"><span>Target for counted days</span><strong>{energyText(state, countedTarget)}</strong></div>
          <div className="stat"><span>At your counted-day pace</span><strong>{counted.length ? energyText(state, average * 7) : '—'}</strong></div>
          {logged.length > 0 && <div className="stat"><span>Average protein</span><strong>{fmt(logged.reduce((acc, day) => acc + day.totals.protein, 0) / logged.length)}g / {fmt(logged.reduce((acc, day) => acc + day.goal.protein, 0) / logged.length)}g</strong></div>}
          <p className="hint">Days count automatically once they’re over. A day logged under {Math.round(LIGHT_DAY_SHARE * 100)}% of target waits for a check, and a day with nothing logged counts as on target.</p>
        </div>
      </details>
    </section>
  );
}

function RichAdherence({ state, week, onHelp, onOpenDay }: { state: AppState; week: WeekBank; onHelp: () => void; onOpenDay: (date: string) => void }) {
  const scored = week.counted;
  const success = scored.filter(day => classifyCalorieDay(day.intake, day.goal) === 'good');
  const score = scored.length ? Math.round(success.length / scored.length * 100) : 0;
  const firstGoal = scored[0]?.goal || goalForDate(state, todayKey());
  const oneRule = scored.every(day => day.goal.trackingMode === firstGoal.trackingMode && day.goal.calories === firstGoal.calories);
  const ruleText = oneRule ? statsRuleText(firstGoal, state.settings.energyUnit) : 'On track = each counted day against its saved goal.';
  return (
    <section className="card stats-card">
      <div className="card-head"><h2>Consistency this week</h2><button className="help-btn" type="button" onClick={onHelp}>?</button></div>
      {scored.length ? (
        <div className="adherence-hero">
          <div className="label">On-track counted days</div>
          <div className={`score ${score >= 70 ? 'good' : ''}`}>{success.length}<span className="unit">/{scored.length}</span></div>
          <div className="bank-note">{ruleText}</div>
        </div>
      ) : (
        <div className="empty">No counted days in this week yet.</div>
      )}
      <div className="consistency-week" aria-label="Consistency by day">
        {week.days.map(day => {
          const tone = dayTone(day);
          const label = DAY_TONE_LABEL[tone];
          return (
            <button key={day.date} className="consistency-day" type="button" onClick={() => onOpenDay(day.date)} aria-label={`${readable(day.date)}: ${label}${day.intake != null ? `, ${energyText(state, day.intake)}` : ''}. Open this day.`}>
              <span className="consistency-label">{weekdayName(day.date, 'short').slice(0, 3)}</span>
              <span className={`consistency-pill ${tone === 'none' ? 'open' : tone}`}>
                <span className="dot" aria-hidden="true" />
                <span className="pill-text">{label}</span>
              </span>
              <span className="consistency-value">{day.intake != null ? `${day.status === 'estimated' ? '≈' : ''}${fmt(energyValueForUnit(day.intake, state.settings.energyUnit))}` : '—'}</span>
            </button>
          );
        })}
      </div>
      <p className="hint consistency-hint">Tap a day to open it.</p>
    </section>
  );
}

/** Setup feedback for the Gemini card: model choice is dynamic, so show the pick. */
function GeminiKeyStatus({ hasKey, check }: { hasKey: boolean; check: GeminiCheck }) {
  if (check.state === 'testing') return <p className="hint gemini-status">Checking the key with Google...</p>;
  if (check.state === 'ok') {
    return (
      <p className="hint gemini-status is-ready">
        Ready — Dawni will use <strong>{check.modelId}</strong>.
        {check.modelCount ? ` ${fmt(check.modelCount)} model${check.modelCount === 1 ? '' : 's'} available to this key.` : ''}
      </p>
    );
  }
  if (check.state === 'error') {
    return (
      <div className="gemini-status is-error">
        <p className="hint">{check.message}</p>
        {check.detail ? <details className="extra-info"><summary>Details from Google</summary><div className="extra-info-body"><p className="hint selectable">{check.detail}</p></div></details> : null}
      </div>
    );
  }
  if (!hasKey) return <p className="hint gemini-status">Not set up. Add a key to use Estimate with Gemini and Help me pick from a menu.</p>;
  return <p className="hint gemini-status">Key saved. Tap Test key to confirm Gemini can reach it and see which model Dawni will use.</p>;
}

function SettingsView(props: {
  state: AppState;
  focus: 'gemini' | null;
  onFocusHandled: () => void;
  goalsEditing: boolean;
  goalDraft: Settings;
  setGoalDraft: (settings: Settings) => void;
  setGoalsEditing: (on: boolean) => void;
  onSaveGoals: () => void;
  onAccent: (color: string) => void;
  onTheme: (theme: ThemePreference) => void;
  onEnergyUnit: (unit: 'kcal' | 'kj') => void;
  onBackupDays: (days: number) => void;
  onSpreadWeeklyBank: (enabled: boolean) => void;
  onRefreshFoodDatabase: () => Promise<void>;
  onImportCustomDatabase: () => void;
  onToggleCustomDatabase: (id: string, enabled: boolean) => Promise<void>;
  onDeleteCustomDatabase: (id: string) => void;
  onCustomDatabaseHelp: () => void;
  onGeminiApiKey: (key: string) => Promise<void> | void;
  onAiPreferences: (text: string) => Promise<void> | void;
  onGeminiApiKeyHelp: () => void;
  onCopyAiPrompt: () => Promise<void>;
  onAiPromptHelp: () => void;
  onExport: () => void;
  onImport: () => void;
  onCheckUpdates: () => void;
  onClear: () => void;
}) {
  const [foodDatabaseUpdating, setFoodDatabaseUpdating] = useState(false);
  const [geminiEditing, setGeminiEditing] = useState(false);
  const [geminiDraft, setGeminiDraft] = useState(() => props.state.settings.geminiApiKey);
  const [geminiCheck, setGeminiCheck] = useState<GeminiCheck>({ state: 'idle' });
  const [preferencesDraft, setPreferencesDraft] = useState(() => props.state.settings.aiPreferences);
  const preferencesChanged = preferencesDraft.trim() !== props.state.settings.aiPreferences.trim();
  const counts = backupCounts(props.state);
  const goalUnit = energyUnitValue(props.state.settings.energyUnit);
  const visibleSettings = { ...props.state.settings, calories: energyValueForUnit(props.state.settings.calories, goalUnit) };
  const draft = props.goalsEditing ? props.goalDraft : visibleSettings;
  const patchGoal = (patch: Partial<Settings>) => props.setGoalDraft({ ...props.goalDraft, ...patch });
  const toggleEnergyUnit = () => props.onEnergyUnit(goalUnit === 'kcal' ? 'kj' : 'kcal');

  useEffect(() => {
    if (!geminiEditing) setGeminiDraft(props.state.settings.geminiApiKey);
  }, [props.state.settings.geminiApiKey, geminiEditing]);

  // Arriving from "Set up Gemini" opens the key field ready to paste into.
  useEffect(() => {
    if (props.focus !== 'gemini') return;
    setGeminiDraft(props.state.settings.geminiApiKey);
    setGeminiEditing(true);
    props.onFocusHandled();
  }, [props.focus]);

  // A changed key invalidates whatever the last check told us.
  useEffect(() => {
    setGeminiCheck({ state: 'idle' });
  }, [props.state.settings.geminiApiKey]);

  const toggleGeminiEdit = () => {
    if (geminiEditing) {
      void Promise.resolve(props.onGeminiApiKey(geminiDraft)).then(() => setGeminiEditing(false));
    } else {
      setGeminiDraft(props.state.settings.geminiApiKey);
      setGeminiEditing(true);
    }
  };

  const testGeminiKey = async () => {
    const key = (geminiEditing ? geminiDraft : props.state.settings.geminiApiKey).trim();
    if (!key) return setGeminiCheck({ state: 'error', message: 'Add a key first.' });
    setGeminiCheck({ state: 'testing' });
    try {
      const result = await probeGeminiKey(key);
      setGeminiCheck({ state: 'ok', modelId: result.modelId, modelCount: result.modelCount });
    } catch (err) {
      const error = err as GeminiError;
      setGeminiCheck({ state: 'error', message: error.message || 'Could not reach Gemini.', detail: error.detail });
    }
  };

  return (
    <>
      <header className="page-header has-helper">
        <h1 className="page-title">Settings</h1>
      </header>
      <section className="card"><div className="card-head"><h2>Goals</h2><button className="small-btn" type="button" onClick={() => props.goalsEditing ? props.onSaveGoals() : (props.setGoalDraft({ ...props.state.settings, calories: energyValueForUnit(props.state.settings.calories, goalUnit) }), props.setGoalsEditing(true))}>{props.goalsEditing ? 'Save goals' : 'Edit'}</button></div><div className="form"><Field label="Mode" full><select disabled={!props.goalsEditing} value={draft.trackingMode} onChange={event => patchGoal({ trackingMode: event.target.value as Settings['trackingMode'] })}><option>Cutting</option><option>Maintaining</option><option>Bulking</option></select></Field><Field label={`Calories (${energyUnitLabel(goalUnit)})`}><input disabled={!props.goalsEditing} inputMode="decimal" value={props.goalsEditing ? String(draft.calories || '') : fmt(draft.calories)} onChange={event => patchGoal({ calories: n(event.target.value) })} /></Field><Field label="Fat"><input disabled={!props.goalsEditing} value={draft.fat} onChange={event => patchGoal({ fat: n(event.target.value) })} /></Field><Field label="Carbs"><input disabled={!props.goalsEditing} value={draft.carbs} onChange={event => patchGoal({ carbs: n(event.target.value) })} /></Field><Field label="Protein"><input disabled={!props.goalsEditing} value={draft.protein} onChange={event => patchGoal({ protein: n(event.target.value) })} /></Field></div></section>
      <section className="card">
        <h2>Weekly banking</h2>
        <p className="hint">Days count toward your week bank on their own once they’re over.</p>
        <label className="check-pill full">
          <input type="checkbox" checked={props.state.settings.spreadWeeklyBank} onChange={event => props.onSpreadWeeklyBank(event.target.checked)} />
          <span>Spread banked calories across remaining days</span>
        </label>
        <p className="hint">When on, what you’ve banked or gone over is shared evenly across the days left, from today to Sunday. Going over never takes a day below 80% of its target; the rest stays in that week’s result.</p>
      </section>
      <section className="card"><h2>Display</h2><div className="field full"><span>Theme</span><div className="smooth-toggle theme-toggle" role="group" aria-label="Theme">{(['system', 'dark', 'light'] as ThemePreference[]).map(theme => <button key={theme} type="button" className={(props.state.settings.theme || DEFAULT.settings.theme) === theme ? 'active' : ''} onClick={() => props.onTheme(theme)}>{theme[0].toUpperCase() + theme.slice(1)}</button>)}</div></div><div className="field full"><span>Energy unit</span><div className="smooth-toggle" role="group" aria-label="Energy unit"><button type="button" className={goalUnit === 'kcal' ? 'active' : ''} onClick={toggleEnergyUnit}>Cal</button><button type="button" className={goalUnit === 'kj' ? 'active' : ''} onClick={toggleEnergyUnit}>kJ</button></div></div><div className="section spaced">Accent</div><div className="preset-row">{['#c9dc86', '#a8c9d8', '#dec77f', '#dc9b8e', '#c6b3df'].map(color => <button key={color} className="preset" style={{ '--c': color } as React.CSSProperties} type="button" onClick={() => props.onAccent(color)} aria-label={`Accent ${color}`} />)}</div><input type="color" value={props.state.settings.accent} onChange={event => props.onAccent(event.target.value)} /></section>
      <section className="card" id="backupSection"><h2>Backup</h2><p className="hint">{props.state.settings.lastBackupAt ? `Last backup: ${new Date(props.state.settings.lastBackupAt).toLocaleString()}.` : 'No backup exported yet.'} Dawni keeps your data on this device; export a backup to protect your logs and journal photos. Current data: {counts.entries} entries, {counts.foods} saved foods, {counts.photos} photos, {counts.customFoodDatabases || 0} custom databases.</p><Field label="Reminder" full><select value={props.state.settings.backupReminderDays} onChange={event => props.onBackupDays(n(event.target.value))}><option value="3">Every 3 days</option><option value="7">Every 7 days</option><option value="14">Every 14 days</option></select></Field><div className="actions"><button className="primary" type="button" onClick={props.onExport}>Export backup</button><button className="secondary" type="button" onClick={props.onImport}>Import backup</button></div></section>
      <section className="card gemini-settings-card" id="geminiSection">
        <div className="card-head">
          <h2>Gemini</h2>
          <div className="card-head-trailing">
            <button className="small-btn" type="button" onClick={toggleGeminiEdit}>{geminiEditing ? 'Save' : 'Edit'}</button>
            <button className="help-btn" type="button" onClick={props.onGeminiApiKeyHelp}>?</button>
          </div>
        </div>
        <p className="hint">Use your own Gemini API key for Estimate with Gemini and Help me pick from a menu. The key stays on this device and is included in backups.</p>
        <Field label="Gemini API key" full>
          <input
            type="password"
            disabled={!geminiEditing}
            value={geminiEditing ? geminiDraft : props.state.settings.geminiApiKey}
            placeholder={geminiEditing ? 'Paste API key' : 'Tap Edit to add or change your key'}
            autoComplete="off"
            onChange={event => setGeminiDraft(event.target.value)}
          />
        </Field>
        <GeminiKeyStatus
          hasKey={!!(geminiEditing ? geminiDraft : props.state.settings.geminiApiKey).trim()}
          check={geminiCheck}
        />
        <div className="actions">
          <button className="secondary" type="button" disabled={geminiCheck.state === 'testing'} onClick={testGeminiKey}>
            {geminiCheck.state === 'testing' ? 'Checking key...' : 'Test key'}
          </button>
        </div>
      </section>
      <section className="card ai-preferences-card">
        <h2>About you, for AI</h2>
        <p className="hint">Sent with every Gemini estimate and menu pick, and added to the copied chatbot prompt. Keep it short. It stays on this phone.</p>
        <Field label="What Gemini should always know" full>
          <textarea
            value={preferencesDraft}
            maxLength={500}
            onChange={event => setPreferencesDraft(event.target.value)}
            placeholder="e.g. Melbourne. Vegetarian on weekdays, no seafood. I usually cook with olive oil spray."
          />
        </Field>
        <div className="actions">
          <button className="secondary" type="button" disabled={!preferencesChanged} onClick={() => props.onAiPreferences(preferencesDraft)}>Save</button>
        </div>
      </section>
      <section className="card ai-prompt-card"><div className="card-head"><h2>AI estimate helper</h2><button className="help-btn" type="button" onClick={props.onAiPromptHelp}>?</button></div><p className="hint">Use this prompt with your AI chatbot, then review the estimate before saving it. Dawni treats AI output as editable, not guaranteed.</p><details className="extra-info ai-prompt-details"><summary>Show prompt</summary><textarea className="ai-prompt-textarea" readOnly value={AI_QUICK_LOG_PROMPT} /></details><div className="actions"><button className="secondary" type="button" onClick={props.onCopyAiPrompt}>Copy prompt</button></div><p className="hint ai-prompt-disclaimer">{AI_ESTIMATE_DISCLAIMER}</p></section>
      <section className="card"><h2>Food estimates</h2><p className="hint">Refreshes Dawni&apos;s local estimate list. Estimates stay editable and won&apos;t change your saved foods or logs.</p><div className="actions"><button className="secondary" type="button" disabled={foodDatabaseUpdating} onClick={() => { setFoodDatabaseUpdating(true); props.onRefreshFoodDatabase().finally(() => setFoodDatabaseUpdating(false)); }}>{foodDatabaseUpdating ? 'Updating estimates...' : 'Update local food estimates'}</button></div></section>
      <section className="card custom-db-card"><div className="card-head"><h2>Custom food databases</h2><button className="help-btn" type="button" onClick={props.onCustomDatabaseHelp}>?</button></div><p className="hint">Import your own JSON estimate list. Enabled databases appear in food search and remain stored on this device.</p><div className="actions"><button className="primary" type="button" onClick={props.onImportCustomDatabase}>Import JSON</button></div>{props.state.customFoodDatabases.length ? <div className="custom-db-list">{props.state.customFoodDatabases.map(database => <div className="custom-db-row" key={database.id}><div className="custom-db-main"><strong>{database.name}</strong><span>{fmt(database.itemCount)} foods · Imported {new Date(database.importedAt).toLocaleDateString()} · {database.enabled ? 'Enabled' : 'Disabled'}</span></div><label className="toggle-line"><input type="checkbox" checked={database.enabled} onChange={event => props.onToggleCustomDatabase(database.id, event.target.checked)} /><span>{database.enabled ? 'On' : 'Off'}</span></label><button className="small-btn danger" type="button" onClick={() => props.onDeleteCustomDatabase(database.id)}>Delete</button></div>)}</div> : <div className="empty custom-db-empty">No custom databases imported yet.</div>}</section>
      <section className="card"><h2>App</h2><p className="hint"><strong>Dawni</strong><br /><span className="project-note">Weekly Calorie Tracker</span><br />Version {APP_VERSION}</p><div className="actions"><button className="secondary" type="button" onClick={props.onCheckUpdates}>Check for updates</button><button className="secondary danger" type="button" onClick={props.onClear}>Clear local data</button></div></section>
    </>
  );
}
