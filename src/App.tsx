import { CSSProperties, FormEvent, ReactNode, PointerEvent as ReactPointerEvent, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { APP_VERSION } from './version';
import { createPortal, flushSync } from 'react-dom';
import type { AppState, DailyGoalSnapshot, EnergyUnit, Entry, Food, Meal, Settings, ThemePreference } from './types';
import { DEFAULT, normalizeEntry, normalizeFood, normalizeStateShape } from './state';
import { readState, saveState } from './storage';
import { compressImage, downloadBlob } from './image';
import { backupCounts, exportBackup, parseBackup } from './backup';
import { applyAppUpdate, checkForAppUpdate, registerServiceWorker, type UpdateInfo } from './pwa';
import { canvasToPngBlob, MealGroup, renderMealCardCanvas } from './canvas';
import { databaseItemToFood, loadFoodDatabaseWithStatus, refreshFoodEstimateDatabase, type FoodDatabaseItem } from './foodDatabase';
import { flattenEnabledCustomDatabaseItems, parseCustomFoodDatabaseText } from './customFoodDatabases';
import { normaliseSearchText, scoreFoodSearch } from './foodSearch';
import { AI_ESTIMATE_DISCLAIMER, AI_QUICK_LOG_PROMPT, amountPortionValue, parseAiQuickLog, type AiQuickLogEntry } from './aiQuickLog';
import { requestMealEstimate } from './geminiEstimate';
import {
  addDays,
  dayEntries,
  energyLabel,
  energyInputFromKcal,
  energyInputToKcal,
  energyTextForUnit,
  energyText,
  energyUnitLabel,
  energyUnitValue,
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
  lockPastGoals,
  MEALS,
  mealGroupId,
  macroBase,
  n,
  normalizeDateKey,
  readable,
  setDayComplete,
  shortDate,
  signed,
  sum,
  todayKey,
  toKey,
  uid,
  validBackupReminderDays,
  weekStartMonday
} from './utils';

type Tab = 'tracking' | 'journal' | 'library' | 'cards' | 'stats' | 'settings';
type ModalName = 'entry' | 'food' | 'photo' | 'entryPhoto' | 'mealCard' | 'bankHelp' | 'adherenceHelp' | 'version' | 'backupReminder' | 'aiQuickLog' | 'aiQuickLogHelp' | 'geminiApiKeyHelp' | 'geminiEstimate' | 'customDbHelp' | null;
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
  favourite: boolean;
  photo: string | null;
  entryEnergyUnit: EnergyUnit;
};

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
  favourite: false,
  photo: null,
  entryEnergyUnit
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

type Toast = { id: number; text: string } | null;
type MacroChipKey = 'fat' | 'carbs' | 'protein';
type EffectiveTheme = 'dark' | 'light';
type SafeSwipeNavigationOptions = {
  enabled?: boolean;
  threshold?: number;
  onPrevious: () => void;
  onNext: () => void;
};

const THEME_COLORS: Record<EffectiveTheme, string> = {
  dark: '#151713',
  light: '#f8f3e9'
};

type ModalScrollLockSnapshot = {
  scrollY: number;
  bodyOverflow: string;
  bodyPosition: string;
  bodyTop: string;
  bodyWidth: string;
  htmlOverflow: string;
};

const MODAL_SCROLL_LOCK_RELEASED_EVENT = 'modal-scroll-lock-released';
let modalScrollLockCount = 0;
let modalScrollLockSnapshot: ModalScrollLockSnapshot | null = null;

function acquireModalScrollLock() {
  if (modalScrollLockCount === 0) {
    const scrollY = window.scrollY;
    modalScrollLockSnapshot = {
      scrollY,
      bodyOverflow: document.body.style.overflow,
      bodyPosition: document.body.style.position,
      bodyTop: document.body.style.top,
      bodyWidth: document.body.style.width,
      htmlOverflow: document.documentElement.style.overflow
    };
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
  }

  modalScrollLockCount += 1;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    modalScrollLockCount = Math.max(0, modalScrollLockCount - 1);
    if (modalScrollLockCount > 0 || !modalScrollLockSnapshot) return;

    const previous = modalScrollLockSnapshot;
    modalScrollLockSnapshot = null;
    document.documentElement.style.overflow = previous.htmlOverflow;
    document.body.style.overflow = previous.bodyOverflow;
    document.body.style.position = previous.bodyPosition;
    document.body.style.top = previous.bodyTop;
    document.body.style.width = previous.bodyWidth;
    window.scrollTo(0, previous.scrollY);
    requestAnimationFrame(() => window.scrollTo(0, previous.scrollY));
    window.dispatchEvent(new Event(MODAL_SCROLL_LOCK_RELEASED_EVENT));
  };
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
}

const SAFE_SWIPE_LOCK_SELECTOR = [
  'input',
  'textarea',
  'select',
  'button',
  'a',
  '[role="button"]',
  '[data-swipe-lock]',
  '[data-interactive]',
  '.swipe-row',
  '.modal',
  '.modal-panel',
  '.modal-backdrop',
  '.bottom-sheet'
].join(',');

function isSafeSwipeTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  // Page-level date swipes ignore controls, modals, rows, meal blocks (incl. empty states), and swipe controls.
  return !target.closest(SAFE_SWIPE_LOCK_SELECTOR);
}

function useSafeSwipeNavigation({ enabled = true, threshold = 52, onPrevious, onNext }: SafeSwipeNavigationOptions) {
  const gesture = useRef({ pointerId: -1, startX: 0, startY: 0, active: false, cancelled: false });
  const reset = () => {
    gesture.current = { pointerId: -1, startX: 0, startY: 0, active: false, cancelled: false };
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0) || !isSafeSwipeTarget(event.target)) return;
    gesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: true, cancelled: false };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current.active || current.pointerId !== event.pointerId || current.cancelled) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (Math.abs(dy) > 32 && Math.abs(dy) > Math.abs(dx) * 0.8) current.cancelled = true;
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current.active || current.pointerId !== event.pointerId || current.cancelled) return reset();
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    reset();
    if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.35) return;
    if (dx < 0) onNext();
    else onPrevious();
  };
  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: reset
  };
}

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
    if (closingRef.current) return;
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
      <section className={panelClass} data-swipe-lock role="dialog" aria-modal="true" aria-label={title}>
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

function AppShell({ tab, setTab, children }: { tab: Tab; setTab: (tab: Tab) => void; children: ReactNode }) {
  const [navHidden, setNavHidden] = useState(false);
  const [navResetKey, setNavResetKey] = useState(0);
  const tabs: [Tab, string][] = [
    ['tracking', 'Track'],
    ['stats', 'Week'],
    ['journal', 'Journal'],
    ['library', 'Foods'],
    ['cards', 'Cards'],
    ['settings', 'Settings']
  ];

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
    const onModalScrollLockReleased = () => {
      setNavHidden(false);
      setNavResetKey(key => key + 1);
      requestAnimationFrame(refresh);
    };
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
      <main className="app">{children}</main>
      <nav key={navResetKey} className={`nav ${navHidden ? 'hidden' : ''}`} aria-label="Main tabs" aria-hidden={navHidden}>
        <div className="nav-inner">
          {tabs.map(([id, label]) => (
            <button key={id} className={`tab ${tab === id ? 'active' : ''}`} type="button" onClick={() => setTab(id)}>
              <span className="ico" aria-hidden="true" />
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
  const [tab, setTabState] = useState<Tab>(() => (localStorage.getItem('calorie-tracker-active-tab') as Tab) || 'tracking');
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [cardsDate, setCardsDate] = useState(todayKey());
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
  const [goalsEditing, setGoalsEditing] = useState(false);
  const [goalDraft, setGoalDraft] = useState<Settings>(DEFAULT.settings);
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);
  const [aiQuickLogMeal, setAiQuickLogMeal] = useState<Meal>('Snack');
  const [aiQuickLogSeedText, setAiQuickLogSeedText] = useState('');
  const [reuseSearchCollapseNonce, setReuseSearchCollapseNonce] = useState(0);
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
    document.documentElement.style.setProperty('--accent', state.settings.accent || '#c9dc86');
  }, [state.settings.accent]);

  useEffect(() => {
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
  }, [state.settings.theme]);

  useEffect(() => {
    if (!loaded) return;
    console.info(`[Dawni] v${APP_VERSION}`);
    registerServiceWorker(update => {
      setAvailableUpdate(update);
      setModal('version');
    }).catch(console.warn);
    checkForAppUpdate(update => {
      setAvailableUpdate(update);
      setModal('version');
    }).catch(console.warn);
  }, [loaded]);

  useEffect(() => {
    if (!loaded || modal) return;
    const hasData = state.entries.length || state.foods.length;
    if (!hasData) return;
    const baseTimes = [
      state.settings.lastBackupAt ? Date.parse(state.settings.lastBackupAt) : NaN,
      ...state.entries.map(entry => n(entry.updatedAt || entry.createdAt))
    ].filter(Number.isFinite);
    const base = baseTimes.length ? Math.min(...baseTimes) : Date.now();
    const age = Math.floor((Date.now() - base) / 86400000);
    const due = validBackupReminderDays(state.settings.backupReminderDays);
    if (age >= due && normalizeDateKey(state.settings.lastBackupReminderShownAt) !== todayKey()) {
      setModal('backupReminder');
      persist({ ...state, settings: { ...state.settings, lastBackupReminderShownAt: todayKey() } }).catch(console.warn);
    }
  }, [loaded, modal]);

  const setTab = (next: Tab) => {
    if (next === 'tracking') {
      setSelectedDate(todayKey());
      requestAnimationFrame(() => {
        try {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch {
          window.scrollTo(0, 0);
        }
      });
    }
    if (next === 'journal' && tab === 'journal') {
      setJournalDay(null);
      setJournalMonth(new Date());
    }
    if (next === 'cards' && tab === 'cards') setCardsDate(todayKey());
    if (next === 'stats' && tab === 'stats') {
      setSelectedDate(todayKey());
      setBankingWeekStart(weekStartMonday(todayKey()));
    }
    setTabState(next);
    localStorage.setItem('calorie-tracker-active-tab', next);
  };

  const updateState = (recipe: (state: AppState) => AppState | void) => {
    const draft = structuredClone(state);
    const result = recipe(draft) || draft;
    return persist(result);
  };

  const entries = useMemo(() => dayEntries(state, selectedDate), [state, selectedDate]);
  const totals = useMemo(() => sum(entries), [entries]);
  const complete = isDayComplete(state, selectedDate);
  const mealGroups = useMemo(() => getMealGroups(state), [state]);

  const openEntry = (meal: Meal = defaultMealForCurrentTime(), date = selectedDate) => {
    if (isDayComplete(state, date)) return notify('Reopen the day before changing food logs');
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
      favourite: !!(entry.sourceFoodId && state.foods.find(food => food.id === entry.sourceFoodId)?.favourite),
      photo: entry.photo || null
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
      portion: n(entryDraft.portion) || 1,
      calories: energyInputToKcal(entryDraft.calories, entryDraft.entryEnergyUnit),
      protein: n(entryDraft.protein),
      carbs: n(entryDraft.carbs),
      fat: n(entryDraft.fat),
      meal: entryDraft.meal,
      notes: entryDraft.notes.trim(),
      photo: entryDraft.photo,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  };

  const touchFoodAfterLog = (draftState: AppState, entry: Entry) => {
    if (entry.autoNamed) return;
    const isDatabaseFood = entryDraft.source === 'foodEstimateDatabase' || entryDraft.source === 'customFoodDatabase';
    const base = {
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
      fat: macroBase(entry, 'fat')
    };
    const source = entry.sourceFoodId ? draftState.foods.find(food => food.id === entry.sourceFoodId) : null;
    if (source) {
      source.usageCount = (source.usageCount || 0) + 1;
      source.lastUsedAt = Date.now();
      if (entryDraft.favourite) Object.assign(source, { name: entry.name, ...base, favourite: true, updatedAt: Date.now() });
      return;
    }
    if (isDatabaseFood && !entryDraft.favourite) return;
    const existing = draftState.foods.find(food => food.name.toLowerCase().trim() === entry.name.toLowerCase().trim());
    if (existing) {
      existing.usageCount = (existing.usageCount || 0) + 1;
      existing.lastUsedAt = Date.now();
      if (entryDraft.favourite || !existing.favourite) Object.assign(existing, { name: entry.name, ...base, favourite: existing.favourite || entryDraft.favourite, updatedAt: Date.now() });
    } else {
      draftState.foods.push(normalizeFood({ id: uid(), name: entry.name, ...base, favourite: entryDraft.favourite, usageCount: 1, lastUsedAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now() }));
    }
  };

  const saveEntry = async (keepOpen = false) => {
    if (!entryDraft.calories) return notify(`${energyUnitLabel(entryDraft.entryEnergyUnit)} required`);
    const entry = formEntry();
    await updateState(draft => {
      const idx = draft.entries.findIndex(item => item.id === entry.id);
      if (idx >= 0) {
        entry.createdAt = draft.entries[idx].createdAt;
        draft.entries[idx] = entry;
      } else {
        draft.entries.push(entry);
      }
      touchFoodAfterLog(draft, entry);
    });
    notify(entryDraft.editingId ? 'Entry updated' : 'Entry saved');
    if (keepOpen) setEntryDraft(blankEntryDraft(entryDraft.meal, energyUnitValue(state.settings.energyUnit)));
    else {
      setModal(null);
      setReuseSearchCollapseNonce(n => n + 1);
    }
  };

  const repeatEntry = async (entry: Entry) => {
    const destination = todayKey();
    if (isDayComplete(state, destination)) return notify('Reopen today before repeating food logs');
    await updateState(draft => {
      const { photo: _photo, ...entryWithoutPhoto } = entry;
      const copy = normalizeEntry({ ...entryWithoutPhoto, id: uid(), date: destination, photo: null, createdAt: Date.now(), updatedAt: Date.now() });
      draft.entries.push(copy);
    });
    notify('Entry repeated to today');
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
      favourite: !!food.favourite
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
        notes: entry.notes
      });
      setEntryOpenMode('prefill');
      setModal('entry');
    });
  };

  const pasteAiQuickLogFromClipboard = async () => {
    if (isDayComplete(state, selectedDate)) return notify('Reopen the day before changing food logs');
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
    if (isDayComplete(state, selectedDate)) return notify('Reopen the day before changing food logs');
    if (!state.settings.geminiApiKey.trim()) return notify('Add a Gemini API key in Settings first');
    setModal('geminiEstimate');
  };

  const estimateWithGemini = async (userText: string, imageDataUrl?: string | null) => {
    notify('Estimating… You can close this and navigate again once the result is back.', 6000);
    const raw = await requestMealEstimate({
      apiKey: state.settings.geminiApiKey,
      userText,
      imageDataUrl
    });
    const parsed = parseAiQuickLog(raw, defaultMealForCurrentTime());
    if (parsed) {
      setAiQuickLogSeedText('');
      prefillAiQuickLog(parsed);
      return;
    }
    notify('Gemini returned text Dawni could not read. You can fix it below.');
    setAiQuickLogMeal(defaultMealForCurrentTime());
    setAiQuickLogSeedText(raw);
    setModal('aiQuickLog');
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
  const copyAiPrompt = () => navigator.clipboard
    ? navigator.clipboard.writeText(AI_QUICK_LOG_PROMPT).then(() => notify('Prompt copied')).catch(() => notify('Could not copy prompt'))
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
    return <main className="app loading"><h1>Dawni</h1><p className="hint">Loading your local tracker...</p></main>;
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
          complete={complete}
          dayLogView={dayLogView}
          setDayLogView={setDayLogView}
          onOpenEntry={openEntry}
          onEditEntry={editEntry}
          onRepeatEntry={repeatEntry}
          onDeleteEntry={deleteEntry}
          onPhotoEntry={entry => {
            if (complete) {
              if (entry.photo) {
                setPhotoPreview(entry.photo);
                setModal('photo');
              }
              return;
            }
            if (entry.photo) {
              setActivePhotoEntryId(entry.id);
              setModal('entryPhoto');
            } else {
              setActivePhotoEntryId(entry.id);
              entryPhotoInputRef.current?.click();
            }
          }}
          onToggleComplete={() => updateState(draft => setDayComplete(draft, selectedDate, !complete)).then(() => notify(complete ? 'Day reopened' : 'Day completed'))}
          onPrefillFood={prefillFood}
          onSaveDatabaseFood={saveDatabaseFood}
          onPasteAiQuickLog={pasteAiQuickLogFromClipboard}
          onOpenGeminiEstimate={openGeminiEstimate}
          onCopyAiPrompt={copyAiPrompt}
          reuseSearchCollapseNonce={reuseSearchCollapseNonce}
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
          onManage={food => {
            setActiveFoodId(food.id);
            setModal('food');
          }}
        />
      )}
      {tab === 'cards' && (
        <CardsView state={state} groups={mealGroups} selectedDate={cardsDate} setSelectedDate={setCardsDate} onOpen={group => {
          setActiveMealCard(group);
          setModal('mealCard');
        }} onStartLog={() => {
          setSelectedDate(cardsDate);
          setTab('tracking');
          openEntry('Snack', cardsDate);
        }} />
      )}
      {tab === 'stats' && (
        <RichStatsView
          state={state}
          selectedDate={selectedDate}
          bankingWeekStart={bankingWeekStart}
          setBankingWeekStart={setBankingWeekStart}
          onBankHelp={() => setModal('bankHelp')}
          onAdherenceHelp={() => setModal('adherenceHelp')}
        />
      )}
      {tab === 'settings' && (
        <SettingsView
          state={state}
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
        onShare={() => activeMealCard && shareMealCard(activeMealCard, notify)}
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
      <Modal open={modal === 'aiQuickLogHelp'} title="AI estimate helper" onClose={() => setModal(null)}>
        <ol className="update-list ai-help-list">
          <li>Copy the prompt.</li>
          <li>Paste it into your AI chatbot.</li>
          <li>Tell it your ingredients, amounts, sauces, oils, and cooking method.</li>
          <li>Copy the returned JSON (it must include unitMode: per serving or per 100g, with calories matching that choice so nothing double-counts).</li>
          <li>Tap Paste AI estimate on Track.</li>
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
          <li>Create or copy an API key for a Google project where Gemini API access is enabled.</li>
          <li>Paste the key into Dawni&apos;s Gemini API key field in Settings.</li>
          <li>Manage billing, budgets, and quota limits in Google Cloud. Dawni only uses the key when you tap Estimate with Gemini.</li>
          <li>The key is stored locally in this browser and is included in exported backups.</li>
        </ol>
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
        <p className="hint">Completed days count toward your weekly balance. Open days stay out of the total until you mark them complete.</p>
        <div className="help-callout">Cutting shows calories saved, bulking shows catch-up or surplus progress, and maintaining shows distance from your weekly range.</div>
      </Modal>
      <Modal open={modal === 'adherenceHelp'} title="Consistency this week" onClose={() => setModal(null)}>
        <p className="hint">Consistency is based only on completed days. “On track” uses your saved targets for each day. Open days stay open.</p>
      </Modal>
      <Modal open={modal === 'version'} title="Update available" onClose={() => setModal(null)}>
        <div className="version-badge">Version {availableUpdate?.version || APP_VERSION}</div>
        <p className="hint">
          {availableUpdate?.source === 'service-worker'
            ? 'A newer build is already downloaded and waiting. Tap Update now to reload Dawni with the latest changes. Your journal, foods, and settings stay on this device.'
            : `You are on version ${APP_VERSION}. Version ${availableUpdate?.version || APP_VERSION} is available on the server. Tap Update now to refresh the page and load it.`}
        </p>
        <p className="page-kicker update-notes-heading">What&apos;s new</p>
        <ul className="update-list">{updateNotes.map(item => <li key={item}>{item}</li>)}</ul>
        <div className="actions vertical">
          <button className="primary" type="button" onClick={() => applyAppUpdate(availableUpdate)}>Update now</button>
          <button className="secondary" type="button" onClick={() => setModal(null)}>Later</button>
        </div>
      </Modal>
      <Modal open={modal === 'backupReminder'} title="Backup reminder" onClose={() => setModal(null)}>
        <p className="hint">Your local tracker data is worth protecting. Backups include compressed journal photos, goals, saved foods, and completed days.</p>
        <div className="actions vertical">
          <button className="primary" type="button" onClick={() => {
            setModal(null);
            setTab('settings');
            setTimeout(() => document.getElementById('backupSection')?.scrollIntoView({ behavior: 'smooth' }), 80);
          }}>Open Backup</button>
          <button className="secondary" type="button" onClick={() => setModal(null)}>Later today</button>
        </div>
      </Modal>
      {toast && <div key={toast.id} className="toast">{toast.text}</div>}
    </AppShell>
  );
}

function TrackingView(props: {
  state: AppState;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  entries: Entry[];
  totals: ReturnType<typeof sum>;
  complete: boolean;
  dayLogView: 'group' | 'list';
  setDayLogView: (view: 'group' | 'list') => void;
  onOpenEntry: (meal?: Meal) => void;
  onEditEntry: (entry: Entry) => void;
  onRepeatEntry: (entry: Entry) => void;
  onDeleteEntry: (id: string) => void;
  onPhotoEntry: (entry: Entry) => void;
  onToggleComplete: () => void;
  onPrefillFood: (food: Food) => void;
  onSaveDatabaseFood: (item: FoodDatabaseItem) => Promise<void> | void;
  onPasteAiQuickLog: () => Promise<void>;
  onOpenGeminiEstimate: () => void;
  onCopyAiPrompt: () => Promise<void>;
  reuseSearchCollapseNonce: number;
}) {
  const baseDayGoal = goalForDate(props.state, props.selectedDate);
  const bankAdjustment = weeklyBankAdjustmentForDate(props.state, props.selectedDate);
  const adjustedCalories = Math.max(1, baseDayGoal.calories + bankAdjustment);
  const effectiveBankAdjustment = adjustedCalories - baseDayGoal.calories;
  const dayGoal = effectiveBankAdjustment ? { ...baseDayGoal, calories: adjustedCalories } : baseDayGoal;
  const goal = dayGoal.calories || 1;
  const remaining = goal - props.totals.calories;
  const overTarget = remaining < 0;
  const displayedRemaining = overTarget ? Math.abs(remaining) : remaining;
  const deg = Math.min(360, Math.max(0, props.totals.calories) / goal * 360);
  const weekSummary = homeWeekSummary(props.state, props.selectedDate);
  const weekCalorieBudget = weekSummary.rows.reduce((acc, row) => acc + row.goal.calories, 0);
  const bankStatTone = weekSummary.completed.length ? budgetDeltaTone(weekSummary.banked) : '';
  const projectedStatTone = weekSummary.completed.length ? upperBudgetTone(weekSummary.projected, weekCalorieBudget) : '';
  const remainingLabel = overTarget ? (dayGoal.trackingMode === 'Bulking' ? 'Above target by' : 'Over today by') : dayGoal.trackingMode === 'Bulking' ? 'Left to target' : 'Today remaining';
  const trackingTitle = props.selectedDate === todayKey() ? 'Today in your week' : 'This day in your week';
  const swipeNavigation = useSafeSwipeNavigation({
    onPrevious: () => props.setSelectedDate(addDays(props.selectedDate, -1)),
    onNext: () => props.setSelectedDate(addDays(props.selectedDate, 1))
  });
  return (
    <div className="screen-swipe-zone view-transition" key={props.selectedDate} {...swipeNavigation}>
      <header className="page-header">
        <div className="page-kicker">Dawni</div>
        <h1 className="page-title">{trackingTitle}</h1>
      </header>
      <DayNav value={props.selectedDate} onChange={props.setSelectedDate} />
      <section className={`hero today-card ${overTarget ? 'over-target' : ''}`}>
        <div className="remaining">
          <div className="label">{remainingLabel}</div>
          <div className="value">{fmt(displayedRemaining)} <small>{energyLabel(props.state)}</small></div>
          <div className="today-context">
            <span className="today-context-chip">Daily target {energyText(props.state, dayGoal.calories)}</span>
            {effectiveBankAdjustment !== 0 && <span className="today-context-chip">Includes {signedEnergyText(props.state, effectiveBankAdjustment)}/day bank</span>}
            {overTarget && <span className="today-context-chip today-context-chip--balance">Week can still balance</span>}
          </div>
        </div>
        <div className="ring" style={{ '--deg': `${deg}deg` } as React.CSSProperties}><div><strong>{fmt(props.totals.calories)}</strong><span>Logged</span></div></div>
      </section>
      <section className="home-week-strip" aria-label="This week at a glance">
        <div className="home-week-heading">
          <span>Week at a glance</span>
          <strong>{shortDate(weekSummary.days[0])} - {shortDate(weekSummary.days[6])}</strong>
        </div>
        <div className={`home-week-stat home-week-stat--bank${bankStatTone ? ` tone-${bankStatTone}` : ''}`}>
          <span>Week bank</span>
          <strong className="home-week-stat-value">{weekSummary.completed.length ? weekSummary.bankText : 'Start with today'}</strong>
        </div>
        <div className="home-week-stat">
          <span>Completed</span>
          <strong className="home-week-stat-value">{weekSummary.completed.length}/7 days</strong>
        </div>
        <div className={`home-week-stat home-week-stat--projected${projectedStatTone ? ` tone-${projectedStatTone}` : ''}`}>
          <span>Projected</span>
          <strong className="home-week-stat-value">{weekSummary.completed.length ? energyText(props.state, weekSummary.projected) : 'Open'}</strong>
        </div>
      </section>
      <div className="macro-grid macro-summary">
        <Macro name="Protein" value={props.totals.protein} goal={dayGoal.protein} color="--protein" featured />
        <Macro name="Carbs" value={props.totals.carbs} goal={dayGoal.carbs} color="--carbs" />
        <Macro name="Fat" value={props.totals.fat} goal={dayGoal.fat} color="--fat" />
      </div>
      {!props.complete && (
        <section className="reuse-panel" aria-label="Reuse or search foods">
          <div className="section">Reuse or search foods</div>
          <SavedFoodPicker state={props.state} foods={props.state.foods} onChoose={props.onPrefillFood} onSaveDatabaseFood={props.onSaveDatabaseFood} compact browseToggle collapseSignal={props.reuseSearchCollapseNonce} />
        </section>
      )}
      {!props.complete && <button className="log-btn" type="button" onClick={() => props.onOpenEntry()}>+ Log Food</button>}
      {!props.complete && (
        <div className="tracking-ai-stack">
          <div className="tracking-ai-actions">
            <div className="tracking-ai-paste-col">
              <button className="ai-quick-log-btn" type="button" onClick={() => props.onPasteAiQuickLog()}>Paste AI estimate</button>
              <p className="tracking-ai-disclaimer">{AI_ESTIMATE_DISCLAIMER}</p>
            </div>
            <button className="secondary ai-copy-prompt-btn" type="button" onClick={() => props.onCopyAiPrompt()}>Copy prompt</button>
          </div>
          <button className="log-btn gemini-estimate-btn" type="button" onClick={props.onOpenGeminiEstimate}>Estimate with Gemini</button>
        </div>
      )}
      <section className="card">
        <div className="card-head">
          <h2>Food log</h2>
          <button className="small-btn" type="button" onClick={() => props.setDayLogView(props.dayLogView === 'group' ? 'list' : 'group')}>{props.dayLogView === 'group' ? 'List view' : 'Group by meal'}</button>
        </div>
        {props.dayLogView === 'group'
          ? <GroupedEntries {...props} />
          : <EntryList state={props.state} entries={props.entries} complete={props.complete} onPhoto={props.onPhotoEntry} onEdit={props.onEditEntry} onRepeat={props.onRepeatEntry} onDelete={props.onDeleteEntry} />}
        <SwipeConfirm
          label={props.complete ? 'Swipe to reopen day' : 'Swipe to complete day'}
          confirmLabel={props.complete ? 'Release to reopen' : 'Release to complete'}
          className={`complete-day-btn ${props.complete ? 'reopen' : ''}`}
          onConfirm={props.onToggleComplete}
        />
      </section>
    </div>
  );
}

function Macro({ name, value, goal, color, featured = false }: { name: string; value: number; goal: number; color: string; featured?: boolean }) {
  return <div className={`macro ${featured ? 'featured' : ''}`}><div className="name">{name}</div><div className="bar"><div style={{ background: `var(${color})`, width: `${Math.min(100, value / (goal || 1) * 100)}%` }} /></div><div className="num">{fmt(value)}g <span>/ {fmt(goal)}g</span></div></div>;
}

function GroupedEntries(props: Parameters<typeof TrackingView>[0]) {
  return (
    <div>
      {MEALS.map(meal => {
        const items = props.entries.filter(entry => (entry.meal || 'Snack') === meal);
        return (
          <div className="meal-group" key={meal} data-swipe-lock>
            <div className="meal-group-head"><div className="meal-group-title">{meal}</div><div className="meal-group-total">{energyText(props.state, sum(items).calories)}</div></div>
            <div className="meal-group-body">
              {items.length ? <EntryList state={props.state} entries={items} complete={props.complete} onPhoto={props.onPhotoEntry} onEdit={props.onEditEntry} onRepeat={props.onRepeatEntry} onDelete={props.onDeleteEntry} /> : <div className="meal-empty">Nothing logged yet.</div>}
              {!props.complete && <button className="meal-log-btn" type="button" onClick={() => props.onOpenEntry(meal)}>Add {meal.toLowerCase()}</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EntryList({ state, entries, complete, onPhoto, onEdit, onRepeat, onDelete }: { state: AppState; entries: Entry[]; complete: boolean; onPhoto: (entry: Entry) => void; onEdit: (entry: Entry) => void; onRepeat: (entry: Entry) => void; onDelete: (id: string) => void }) {
  if (!entries.length) return <div className="empty" data-swipe-lock>Nothing logged yet.</div>;
  return (
    <div data-swipe-lock className="entry-list-stack">
      {entries.map(entry => <EntryRow key={entry.id} state={state} entry={entry} complete={complete} onPhoto={onPhoto} onEdit={onEdit} onRepeat={onRepeat} onDelete={onDelete} />)}
    </div>
  );
}

function EntryRow({ state, entry, complete, onPhoto, onEdit, onRepeat, onDelete }: { state: AppState; entry: Entry; complete: boolean; onPhoto: (entry: Entry) => void; onEdit: (entry: Entry) => void; onRepeat: (entry: Entry) => void; onDelete: (id: string) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const totals = entryTotals(entry);
  const portion = entryUnitModeValue(entry.unitMode) === '100g'
    ? <span className="portion-badge">{fmtGram(entry.portion)}g</span>
    : entry.portion && entry.portion !== 1 ? <span className="portion-badge">{fmtPortion(entry.portion)} servings</span> : null;
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
        <div className="entry-title"><div className="entry-name">{entry.name}</div>{portion}</div>
        <div className="meta-chips">
          <MacroChips fat={totals.fat} carbs={totals.carbs} protein={totals.protein} />
        </div>
      </div>
      <div className="entry-cal">{energyText(state, totals.calories)}</div>
      <div className="entry-menu-wrap">
        <button ref={menuButtonRef} className="entry-menu-btn" type="button" aria-label="Entry actions" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}><span aria-hidden="true" /></button>
        {menuOpen && createPortal(
          <div ref={menuRef} className="entry-menu" data-swipe-lock style={menuStyle}>
            <button type="button" onClick={() => { setMenuOpen(false); onRepeat(entry); }}>Repeat</button>
            {!complete && <button type="button" onClick={() => { setMenuOpen(false); onEdit(entry); }}>Edit</button>}
            {!complete && <button type="button" className="danger-text" onClick={() => { setMenuOpen(false); onDelete(entry.id); }}>Delete</button>}
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
      aria-label={confirmLabel || label}
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
  return (
    <button className={`quick-food-result ${databaseSuggestion ? 'database' : 'user-food'}`} type="button" onClick={() => onChoose(food)}>
      <span className={`quick-food-icon ${food.favourite ? 'fav' : ''}`}>{food.favourite ? <span className="star-icon" aria-hidden="true" /> : databaseSuggestion ? 'DB' : ''}</span>
      <span className="quick-food-main">
        <strong>{food.name}</strong>
        <small>{meta || foodUnitText(food)}</small>
        <span className="quick-food-macros">
          {sourceChip && <span className="meta-chip source-chip">{sourceChip}</span>}
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

function SavedFoodPicker({ state, foods, onChoose, onSaveDatabaseFood, compact = false, browseToggle = false, collapseSignal }: { state: AppState; foods: Food[]; onChoose: (food: Food) => void; onSaveDatabaseFood: (item: FoodDatabaseItem) => Promise<void> | void; compact?: boolean; browseToggle?: boolean; collapseSignal?: number }) {
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
        <div className="quick-search-row">
          <input type="search" aria-label="Search foods" placeholder="Search foods" value={query} onChange={event => setQuery(event.target.value)} autoCapitalize="none" autoCorrect="off" enterKeyHint="search" />
          <button className={`quick-browse-toggle ${browseOpen ? 'open' : ''}`} type="button" aria-label={browseOpen ? 'Hide favourites and recent foods' : 'Show favourites and recent foods'} aria-expanded={browseOpen} onClick={() => setBrowseOpen(open => !open)}><span aria-hidden="true" /></button>
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

function GeminiEstimateModal({ open, onClose, onEstimate }: { open: boolean; onClose: () => void; onEstimate: (userText: string, imageDataUrl?: string | null) => Promise<void> }) {
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setText('');
      setPhoto(null);
      setLoading(false);
      setError('');
    }
  }, [open]);

  const attachPhoto = async (file?: File | null) => {
    if (!file) return;
    try {
      setError('');
      setPhoto(await compressImage(file));
    } catch {
      setError('Could not attach that photo.');
    } finally {
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  };

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed && !photo) {
      setError('Add a short description or attach a photo.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await onEstimate(trimmed, photo);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gemini could not estimate this meal.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} title="Estimate with Gemini" onClose={onClose} bottomSheet closeDisabled={loading}>
      <form className="gemini-estimate-modal" onSubmit={(event: FormEvent) => { event.preventDefault(); submit(); }}>
        <p className="hint">Add a short description, attach a photo, or both—then review the estimate before saving.</p>
        <p className="hint gemini-estimate-tip">Tip: listing the ingredients and amounts you actually used in cooking gives more accurate estimates.</p>
        <Field label="What did you eat? (optional with a photo)" full>
          <textarea disabled={loading} value={text} onChange={event => { setText(event.target.value); setError(''); }} placeholder="Example: 2 large black milk teas with mini taro balls, little sugar, little ice. Leave blank if you are sending a photo only." />
        </Field>
        <input ref={photoInputRef} hidden type="file" accept="image/*" onChange={event => attachPhoto(event.target.files?.[0])} />
        <div className="photo-picker full">
          <button type="button" className="photo-picker-label" disabled={loading} onClick={() => photoInputRef.current?.click()}>
            <span className="photo-picker-icon" aria-hidden="true"><span className="empty-photo-icon" /></span><span><strong>{photo ? 'Photo attached' : 'Add photo'}</strong><small>{photo ? 'Tap to replace the photo' : 'Optional with text, or use a photo alone—compressed before sending'}</small></span>
          </button>
          {photo && <div className="photo-picker-preview show"><img src={photo} alt="Selected meal preview" /></div>}
        </div>
        {error && <p className="ai-quick-log-error">{error}</p>}
        <div className="actions vertical">
          <button className="primary" type="submit" disabled={loading || (!text.trim() && !photo)}>{loading ? 'Estimating...' : 'Estimate food'}</button>
          <button className="secondary" type="button" disabled={loading} onClick={onClose}>Cancel</button>
        </div>
      </form>
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
  onSaveDatabaseFood
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
}) {
  const caloriesPanelRef = useRef<HTMLDivElement>(null);
  const caloriesInputRef = useRef<HTMLInputElement>(null);
  const update = (patch: Partial<EntryDraft>) => setDraft(current => ({ ...current, ...patch }));
  const baseCalories = energyInputToKcal(draft.calories, draft.entryEnergyUnit);
  const multiplier = draft.unitMode === '100g' ? (n(draft.portion) || 100) / 100 : n(draft.portion) || 1;
  const total = { calories: baseCalories * multiplier, fat: n(draft.fat) * multiplier, carbs: n(draft.carbs) * multiplier, protein: n(draft.protein) * multiplier };
  const scrollCaloriesPanel = (behavior: ScrollBehavior = 'smooth') => {
    requestAnimationFrame(() => {
      caloriesPanelRef.current?.scrollIntoView({ block: 'start', behavior });
    });
  };
  const focusCaloriesInput = () => {
    requestAnimationFrame(() => {
      caloriesInputRef.current?.focus({ preventScroll: true });
      caloriesInputRef.current?.select();
    });
  };
  const setEntryEnergyUnit = (nextUnit: EnergyUnit) => {
    const currentKcal = energyInputToKcal(draft.calories, draft.entryEnergyUnit);
    update({ entryEnergyUnit: nextUnit, calories: energyInputFromKcal(currentKcal, nextUnit) });
  };
  const toggleEntryEnergyUnit = () => setEntryEnergyUnit(draft.entryEnergyUnit === 'kcal' ? 'kj' : 'kcal');
  const toggleUnitMode = () => {
    const nextUnitMode = draft.unitMode === 'serving' ? '100g' : 'serving';
    update({
      unitMode: nextUnitMode,
      portion: nextUnitMode === '100g' && draft.portion === '1' ? '100' : nextUnitMode === 'serving' && draft.portion === '100' ? '1' : draft.portion
    });
  };
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
      favourite: !!food.favourite
    }));
    scrollCaloriesPanel();
  };

  useEffect(() => {
    if (!open) return;
    scrollCaloriesPanel('auto');
    if (openMode === 'manual') focusCaloriesInput();
  }, [open, openMode]);

  return (
    <Modal open={open} title={draft.editingId ? 'Edit entry' : `Log ${draft.meal.toLowerCase()}`} onClose={onClose} wide bottomSheet>
      <form className="form entry-form" onSubmit={(event: FormEvent) => { event.preventDefault(); onSave(false); }}>
        <SavedFoodPicker state={state} foods={foods} onChoose={chooseFood} onSaveDatabaseFood={onSaveDatabaseFood} compact />
        <div ref={caloriesPanelRef} className="calories-priority full">
          <label>
            <span>Calories & Macros</span>
            <span className="unit-toggle-chip" role="group" aria-label="Energy input unit">
              <button type="button" className={draft.entryEnergyUnit === 'kcal' ? 'active' : ''} onClick={toggleEntryEnergyUnit}>kCal</button>
              <button type="button" className={draft.entryEnergyUnit === 'kj' ? 'active' : ''} onClick={toggleEntryEnergyUnit}>kJ</button>
            </span>
          </label>
          <div className="calorie-input-row">
            <input ref={caloriesInputRef} id="entryCalories" inputMode="decimal" value={draft.calories} placeholder="0" onChange={event => update({ calories: event.target.value })} />
            <span>{energyUnitLabel(draft.entryEnergyUnit)}</span>
          </div>
          <div className="nutrition-grid">
            <Field label="Fat (g)"><input inputMode="decimal" value={draft.fat} onChange={event => update({ fat: event.target.value })} /></Field>
            <Field label="Carbs (g)"><input inputMode="decimal" value={draft.carbs} onChange={event => update({ carbs: event.target.value })} /></Field>
            <Field label="Protein (g)"><input inputMode="decimal" value={draft.protein} onChange={event => update({ protein: event.target.value })} /></Field>
          </div>
          <div className="unit-basis-row">
            <span>Nutrition values</span>
            <span className="unit-toggle-chip" role="group" aria-label="Nutrition values basis">
              <button type="button" className={draft.unitMode === 'serving' ? 'active' : ''} onClick={toggleUnitMode}>Per serving</button>
              <button type="button" className={draft.unitMode === '100g' ? 'active' : ''} onClick={toggleUnitMode}>Per 100g</button>
            </span>
          </div>
          {multiplier !== 1 && (
            <div className="meta-chips portion-preview">
              <span className="meta-chip neutral">Logged total</span>
              <span className="meta-chip accent">{energyTextForUnit(total.calories, state.settings.energyUnit)}</span>
              <MacroChips fat={total.fat} carbs={total.carbs} protein={total.protein} />
            </div>
          )}
        </div>

        <Field label="Meal" full><div className="meal-chip-row">{MEALS.map(meal => <button key={meal} type="button" className={`meal-chip ${draft.meal === meal ? 'active' : ''}`} onClick={() => update({ meal })}>{meal}</button>)}</div></Field>
        <div className="photo-picker full">
          <button type="button" className="photo-picker-label" onClick={onPickPhoto}>
            <span className="photo-picker-icon" aria-hidden="true"><span className="empty-photo-icon" /></span><span><strong>{draft.photo ? 'Meal photo attached' : 'Add meal photo'}</strong><small>{draft.photo ? 'Tap to replace the photo' : 'Optional journal photo, compressed before saving'}</small></span>
          </button>
          {draft.photo && <div className="photo-picker-preview show"><img src={draft.photo} alt="Selected meal preview" /></div>}
        </div>

        <div className="entry-form-extras">
          <Field label="Food name" full><input value={draft.name} placeholder={`${draft.meal} entry`} onChange={event => update({ name: event.target.value })} /></Field>
          <Field label={draft.unitMode === '100g' ? 'Amount eaten (g)' : 'Servings eaten'} full><input inputMode="decimal" value={draft.portion} onChange={event => update({ portion: event.target.value })} /></Field>
          <div className="portion-help full">{draft.unitMode === '100g' ? 'Logged calories and macros = per 100g values x grams eaten / 100.' : 'Logged calories and macros = per-serving values x servings eaten.'}</div>
          <Field label="Notes" full><textarea value={draft.notes} onChange={event => update({ notes: event.target.value })} /></Field>
          <label className="check-pill full"><input type="checkbox" checked={draft.favourite} onChange={event => update({ favourite: event.target.checked })} /><span>Save to favourites</span></label>
        </div>

        <div className="actions full">
          <SwipeConfirm label={draft.editingId ? 'Swipe to save entry' : 'Swipe to log food'} confirmLabel={draft.editingId ? 'Release to save' : 'Release to log'} className="entry-swipe" onConfirm={() => onSave(false)} />
          {!draft.editingId && <button className="secondary" type="button" onClick={() => onSave(true)}>Save and add another</button>}
          <button className="secondary" type="button" onClick={onClose}>Close</button>
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
        <Field label="Name" full><input value={draft.name} onChange={event => patch({ name: event.target.value })} /></Field>
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
        <label className="check-pill full"><input type="checkbox" checked={draft.favourite} onChange={event => patch({ favourite: event.target.checked })} /><span>Favourite</span></label>
        <div className="actions full"><button className="primary" type="submit">Save food</button><button className="secondary danger" type="button" onClick={() => onDelete(draft)}>Delete</button></div>
      </form>
    </Modal>
  );
}

function LibraryView({ state, sub, setSub, query, setQuery, onPrefill, onManage }: { state: AppState; sub: string; setSub: (sub: string) => void; query: string; setQuery: (q: string) => void; onPrefill: (food: Food) => void; onManage: (food: Food) => void }) {
  const foods = state.foods.filter(food => !query || food.name.toLowerCase().includes(query.toLowerCase())).sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
  const shown = sub === 'favourites' ? foods.filter(food => food.favourite) : foods;
  const emptyCopy =
    sub === 'favourites'
      ? { title: 'No favourites yet.', body: 'Favourite foods you use often to make logging faster.' }
      : query.trim()
        ? { title: 'No matches yet.', body: 'Try a different food name.' }
        : { title: 'Nothing here yet.', body: 'Your usual foods will appear here as you reuse them.' };
  return (
    <>
      <header className="page-header has-helper">
        <div className="page-kicker">Reuse</div>
        <h1 className="page-title">Your usual foods</h1>
        <p className="hint page-subtitle library-hint">Recent foods are for speed. Favourites are your dependable routines.</p>
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
      <section className="card">
        {shown.length ? (
          shown.map(food => <FoodRow key={food.id} state={state} food={food} showUsage={sub !== 'favourites'} onPrefill={onPrefill} onManage={onManage} />)
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

function FoodRow({ state, food, showUsage, onPrefill, onManage }: { state: AppState; food: Food; showUsage: boolean; onPrefill: (food: Food) => void; onManage: (food: Food) => void }) {
  return (
    <div className="food-row" data-swipe-lock>
      <div className={`emoji ${food.favourite ? 'fav' : ''}`}>{food.favourite && <span className="star-icon" aria-hidden="true" />}</div>
      <div className="body">
        <strong>{food.name}</strong>
        <div className="food-meta">
          <span className="food-cal">{energyText(state, food.calories)}</span>
          <span>{foodUnitText(food)}</span>
          {showUsage && <span className="food-usage">{fmt(food.usageCount)}x</span>}
        </div>
      </div>
      <button className="small-btn food-log-btn" type="button" onClick={() => onPrefill(food)}>Log</button>
      <button className="food-manage-btn" type="button" onClick={() => onManage(food)} aria-label={`Manage ${food.name}`}><span aria-hidden="true" /></button>
      <div className="meta-chips food-macros" aria-label={`Fat ${fmt(food.fat)}g, carbs ${fmt(food.carbs)}g, protein ${fmt(food.protein)}g`}>
        <MacroChips fat={food.fat} carbs={food.carbs} protein={food.protein} />
      </div>
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
  onPhoto
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
}) {
  const year = journalMonth.getFullYear();
  const month = journalMonth.getMonth();
  const journalDaySwipeNavigation = useSafeSwipeNavigation({
    enabled: !!journalDay,
    onPrevious: () => {
      if (!journalDay) return;
      const key = addDays(journalDay, -1);
      setJournalDay(key);
      setJournalMonth(new Date(`${key}T00:00:00`));
    },
    onNext: () => {
      if (!journalDay) return;
      const key = addDays(journalDay, 1);
      setJournalDay(key);
      setJournalMonth(new Date(`${key}T00:00:00`));
    }
  });
  const journalMonthSwipeNavigation = useSafeSwipeNavigation({
    enabled: !journalDay,
    onPrevious: () => setJournalMonth(new Date(year, month - 1, 1)),
    onNext: () => setJournalMonth(new Date(year, month + 1, 1))
  });
  if (journalDay) {
    const entries = dayEntries(state, journalDay);
    const photos = entries.filter(entry => entry.photo);
    const dayTotals = sum(entries);
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
      <div className="screen-swipe-zone view-transition" key={journalDay} {...journalDaySwipeNavigation}>
        <header className="page-header">
          <div className="page-kicker">Food journal</div>
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
                    {!hideCalChipOnThumb && <span className="meta-chip accent">{energyText(state, totals.calories)}</span>}
                    <MacroChips fat={totals.fat} carbs={totals.carbs} protein={totals.protein} />
                  </div>
                  {entry.notes && <div className="journal-entry-note">{entry.notes}</div>}
                </div>
              </button>
            );
          })}</div> : <div className="empty"><strong>Nothing logged yet.</strong><div>Log something when you&apos;re ready.</div></div>}
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
  const offset = first.getDay();
  const days = Array.from({ length: 42 }, (_, i) => new Date(year, month, i - offset + 1));
  return (
    <div className="screen-swipe-zone view-transition" key={`${year}-${month}`} {...journalMonthSwipeNavigation}>
      <header className="page-header has-helper">
        <div className="page-kicker">Food journal</div>
        <h1 className="page-title">Journal</h1>
        <p className="hint page-subtitle">A visual memory of what you ate, organised by day.</p>
      </header>
      <MonthNav value={journalMonth} onChange={setJournalMonth} />
      <div className="calendar journal-month-surface">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
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

function CardsView({
  state,
  groups,
  selectedDate,
  setSelectedDate,
  onOpen,
  onStartLog
}: {
  state: AppState;
  groups: MealGroup[];
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  onOpen: (group: MealGroup) => void;
  onStartLog: () => void;
}) {
  const datedGroups = groups.filter(group => group.date === selectedDate);
  const prevCardsDateRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevCardsDateRef.current !== null && prevCardsDateRef.current !== selectedDate) {
      requestAnimationFrame(() => {
        try {
          window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        } catch {
          window.scrollTo(0, 0);
        }
      });
    }
    prevCardsDateRef.current = selectedDate;
  }, [selectedDate]);

  const cardsSwipe = useSafeSwipeNavigation({
    onPrevious: () => setSelectedDate(addDays(selectedDate, -1)),
    onNext: () => setSelectedDate(addDays(selectedDate, 1))
  });
  return (
    <div className="screen-swipe-zone view-transition" key={selectedDate} {...cardsSwipe}>
      <header className="page-header has-helper">
        <div className="page-kicker">Reflect</div>
        <h1 className="page-title">Cards</h1>
        <p className="hint page-subtitle">Create simple meal snapshots.</p>
      </header>
      <DayNav value={selectedDate} onChange={setSelectedDate} />
      <section className="card meal-card-intro"><p className="hint">Pick a logged meal group and open a simple screenshot-ready meal summary card.</p></section>
      {datedGroups.length ? <div className="cards-list">{datedGroups.map(group => {
        const names = group.items.map(item => item.name).join(', ');
        const photo = group.photos[0];
        const photoCount = Math.min(group.photos.length, 4);
        return (
          <article key={group.id} className="meal-card-row" data-swipe-lock>
            <div className={`meal-card-thumb count-${photoCount || 0}`}>
              {photo ? group.photos.slice(0, 4).map((src, index) => <img key={`${src}${index}`} src={src} alt="" />) : <span className="empty-photo-icon" aria-hidden="true" />}
            </div>
            <div className="meal-card-row-body">
              <strong>{group.meal}</strong>
              <small>{shortDate(group.date)}</small>
              <div className="meta-chips meal-card-row-meta">
                <span className="meta-chip neutral">{group.items.length} item{group.items.length === 1 ? '' : 's'}</span>
                <span className="meta-chip accent">{energyText(state, group.totals.calories)}</span>
                <MacroChips protein={group.totals.protein} show={['protein']} />
              </div>
              <p>{names}</p>
            </div>
            <button className="secondary show-card-btn" type="button" onClick={() => onOpen(group)}>Show card</button>
          </article>
        );
      })}</div> : <div className="empty" data-swipe-lock><strong>No meal cards yet.</strong><div>Log a meal to make a simple share card.</div><button className="empty-action" type="button" onClick={onStartLog}>Log food</button></div>}
    </div>
  );
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

async function shareMealCard(group: MealGroup, notify: (text: string) => void) {
  try {
    const canvas = await renderMealCardCanvas(group);
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

function StatsView({ state, selectedDate, bankingWeekStart, setBankingWeekStart, onBankHelp, onAdherenceHelp }: { state: AppState; selectedDate: string; bankingWeekStart: string; setBankingWeekStart: (start: string) => void; onBankHelp: () => void; onAdherenceHelp: () => void }) {
  return <RichStatsView state={state} selectedDate={selectedDate} bankingWeekStart={bankingWeekStart} setBankingWeekStart={setBankingWeekStart} onBankHelp={onBankHelp} onAdherenceHelp={onAdherenceHelp} />;
}

type CalorieDayStatus = 'open' | 'good' | 'under' | 'over';

function getCalorieBand(goal: DailyGoalSnapshot) {
  const target = Math.max(goal.calories, 1);
  if (goal.trackingMode === 'Bulking') return { lower: target, target, upper: target + 300 };
  if (goal.trackingMode === 'Maintaining') return { lower: target - 150, target, upper: target + 150 };
  return { lower: 0, target, upper: target };
}

function classifyCalorieDay(total: number, complete: boolean, goal: DailyGoalSnapshot): CalorieDayStatus {
  if (!complete) return 'open';
  const band = getCalorieBand(goal);
  if (goal.trackingMode === 'Cutting') return total <= band.target ? 'good' : 'over';
  if (goal.trackingMode === 'Bulking') {
    if (total < band.lower) return 'under';
    return total <= band.upper ? 'good' : 'over';
  }
  if (total < band.lower) return 'under';
  return total <= band.upper ? 'good' : 'over';
}

function statsRuleText(goal: DailyGoalSnapshot, unit: EnergyUnit) {
  if (goal.trackingMode === 'Bulking') return `On track = completed days from ${energyTextForUnit(goal.calories, unit)} to ${energyTextForUnit(goal.calories + 300, unit)}.`;
  if (goal.trackingMode === 'Maintaining') return `On track = completed days within ${energyTextForUnit(goal.calories - 150, unit)}-${energyTextForUnit(goal.calories + 150, unit)}.`;
  return `On track = completed days at or under ${energyTextForUnit(goal.calories, unit)}.`;
}

function dayToneLabel(status: CalorieDayStatus, complete: boolean) {
  if (!complete) return { label: 'Open', className: 'open' as const };
  if (status === 'good') return { label: 'On track', className: 'good' as const };
  return { label: 'Review', className: 'review' as const };
}

function signedEnergyText(state: AppState, kcal: number) {
  return `${kcal > 0 ? '+' : ''}${energyText(state, kcal)}`;
}

function signedEnergyValue(state: AppState, kcal: number) {
  const value = energyValueForUnit(kcal, state.settings.energyUnit);
  return `${value > 0 ? '+' : ''}${fmt(value)}`;
}

function weeklyBankAdjustmentForDate(state: AppState, key: string) {
  if (!state.settings.spreadWeeklyBank) return 0;
  const date = normalizeDateKey(key);
  const today = todayKey();
  if (!date || date < today || isDayComplete(state, date)) return 0;

  const start = weekStartMonday(date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const completedBank = days
    .filter(day => isDayComplete(state, day))
    .reduce((acc, day) => acc + goalForDate(state, day).calories - sum(dayEntries(state, day)).calories, 0);
  if (completedBank === 0) return 0;

  const remainingDays = days.filter(day => day >= today && !isDayComplete(state, day));
  if (!remainingDays.includes(date) || !remainingDays.length) return 0;
  return completedBank / remainingDays.length;
}

function homeWeekSummary(state: AppState, selectedDate: string) {
  const start = weekStartMonday(selectedDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const rows = days.map(date => {
    const total = sum(dayEntries(state, date)).calories;
    const complete = isDayComplete(state, date);
    const goal = goalForDate(state, date);
    return { date, total, complete, goal, delta: complete ? goal.calories - total : 0, status: classifyCalorieDay(total, complete, goal) };
  });
  const completed = rows.filter(row => row.complete);
  const banked = completed.reduce((acc, row) => acc + row.delta, 0);
  const completedEaten = completed.reduce((acc, row) => acc + row.total, 0);
  const completedAverage = completedEaten / (completed.length || 1);
  const projected = completed.length ? completedAverage * 7 : 0;
  return {
    days,
    rows,
    completed,
    banked,
    projected,
    bankText: signedEnergyText(state, banked)
  };
}

type MetricTone = 'good' | 'warn' | '';

function budgetDeltaTone(delta: number): MetricTone {
  if (delta > 0) return 'good';
  if (delta < 0) return 'warn';
  return '';
}

function upperBudgetTone(value: number, budget: number): MetricTone {
  return value <= budget ? 'good' : 'warn';
}

function RichStatsView({ state, selectedDate, bankingWeekStart, setBankingWeekStart, onBankHelp, onAdherenceHelp }: { state: AppState; selectedDate: string; bankingWeekStart: string; setBankingWeekStart: (start: string) => void; onBankHelp: () => void; onAdherenceHelp: () => void }) {
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

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(bankingWeekStart, i));
  const weekRows = weekDays.map(date => {
    const totals = sum(dayEntries(state, date));
    const complete = isDayComplete(state, date);
    const goal = goalForDate(state, date);
    const delta = complete ? goal.calories - totals.calories : 0;
    return { date, totals, complete, goal, delta, status: classifyCalorieDay(totals.calories, complete, goal) };
  });
  const weekCompleted = weekRows.filter(row => row.complete);
  const weekCompletedEaten = weekCompleted.reduce((acc, row) => acc + row.totals.calories, 0);
  const weekCompletedGoal = weekCompleted.reduce((acc, row) => acc + row.goal.calories, 0);
  const weekCompletedAvgCalories = weekCompletedEaten / (weekCompleted.length || 1);
  const weekCompletedAvgProtein = weekCompleted.reduce((acc, row) => acc + row.totals.protein, 0) / (weekCompleted.length || 1);
  const weekCompletedAvgCalorieGoal = weekCompletedGoal / (weekCompleted.length || 1);
  const weekCompletedAvgProteinGoal = weekCompleted.reduce((acc, row) => acc + row.goal.protein, 0) / (weekCompleted.length || 1);
  const projectedWeek = weekCompleted.length ? weekCompletedAvgCalories * 7 : 0;

  const last7Days = Array.from({ length: 7 }, (_, i) => addDays(selectedDate, i - 6));
  const last7Rows = last7Days.map(date => ({ date, totals: sum(dayEntries(state, date)), complete: isDayComplete(state, date), goal: goalForDate(state, date) }));
  const last7Logged = last7Rows.filter(row => row.totals.calories > 0);
  const last7Completed = last7Rows.filter(row => row.complete);
  const swipeNavigation = useSafeSwipeNavigation({
    onPrevious: () => setBankingWeekStart(addDays(bankingWeekStart, -7)),
    onNext: () => setBankingWeekStart(addDays(bankingWeekStart, 7))
  });
  return (
    <div className="screen-swipe-zone view-transition" key={bankingWeekStart} {...swipeNavigation}>
      <header className="page-header has-helper">
        <div className="page-kicker">This week</div>
        <h1 className="page-title">Week</h1>
        <p className="hint page-subtitle">Check whether your week is still manageable.</p>
      </header>
      <RichBanking state={state} start={bankingWeekStart} setStart={setBankingWeekStart} onHelp={onBankHelp} />

      <section className="card stats-card week-summary-card" aria-label="Week summary">
        <div className="card-head"><h2>Week summary</h2></div>
        {weekCompleted.length ? (
          <>
            <div className="week-summary-grid" role="list">
              <div className="week-summary-item" role="listitem">
                <div className="label">Projected week</div>
                <div className="value">{energyText(state, projectedWeek)}</div>
                <div className="note">At your current pace. Open days stay open.</div>
              </div>
              <div className="week-summary-item" role="listitem">
                <div className="label">Completed-day average</div>
                <div className="value">{energyText(state, weekCompletedAvgCalories)}<span className="unit">/day</span></div>
                <div className="note">Only days you mark complete are used here.</div>
              </div>
              <div className="week-summary-item" role="listitem">
                <div className="label">Completed days</div>
                <div className="value">{weekCompleted.length}<span className="unit">/7</span></div>
                <div className="note">Open days aren’t treated as failed days.</div>
              </div>
            </div>
            <details className="extra-info" style={{ marginTop: 10 }}>
              <summary>Week details</summary>
              <div className="extra-info-body">
                <div>
                  <div className="section" style={{ marginBottom: 6 }}>Calories</div>
                  <div className="stat"><span>Avg calories (completed)</span><strong>{energyText(state, weekCompletedAvgCalories)} / {energyText(state, weekCompletedAvgCalorieGoal)}</strong></div>
                  <div className="stat"><span>Total calories (completed)</span><strong>{energyText(state, weekCompletedEaten)}</strong></div>
                  <div className="stat"><span>Goal total (completed)</span><strong>{energyText(state, weekCompletedGoal)}</strong></div>
                </div>
                <div>
                  <div className="section" style={{ marginBottom: 6 }}>Protein</div>
                  <div className="stat"><span>Avg protein (completed)</span><strong>{fmt(weekCompletedAvgProtein)}g / {fmt(weekCompletedAvgProteinGoal)}g</strong></div>
                </div>
              </div>
            </details>
          </>
        ) : (
          <div className="empty">
            <strong>Nothing to average yet.</strong>
            <div>Mark one day complete this week to see projections and averages. Open days stay open.</div>
          </div>
        )}
      </section>

      <RichAdherence state={state} start={bankingWeekStart} setStart={setBankingWeekStart} onHelp={onAdherenceHelp} />

      <section className="card stats-card">
        <div className="card-head"><h2>Patterns</h2></div>
        {last7Completed.length ? (
          <>
            <div className="stat"><span>Completed-day average (past 7)</span><strong>{energyText(state, last7Completed.reduce((acc, row) => acc + row.totals.calories, 0) / (last7Completed.length || 1))}</strong></div>
            <div className="stat"><span>Completed days (past 7)</span><strong>{last7Completed.length} / 7</strong></div>
          </>
        ) : <div className="empty">{last7Logged.length ? 'Mark a day complete to see completed-day patterns.' : 'No logged days in this window yet.'}</div>}
        <ConsumptionBars state={state} rows={last7Rows.map(row => ({ date: row.date, total: row.totals.calories, complete: row.complete, goal: row.goal }))} />
      </section>
    </div>
  );
}

function ConsumptionBars({ state, rows }: { state: AppState; rows: { date: string; total: number; complete: boolean; goal: DailyGoalSnapshot }[] }) {
  const bands = rows.map(row => getCalorieBand(row.goal));
  const maxTotal = Math.max(...bands.map(band => band.upper), ...rows.map(row => row.total), 1);
  return (
    <div className="consumption-chart" aria-label="Consumed calories over the last 7 days">
      {rows.map((row, index) => {
        const band = bands[index];
        const height = row.total ? Math.max(8, row.total / maxTotal * 100) : 3;
        const targetBottom = Math.max(0, Math.min(1, band.target / maxTotal)) * 100;
        const lowerBottom = Math.max(0, Math.min(1, band.lower / maxTotal)) * 100;
        const upperBottom = Math.max(0, Math.min(1, band.upper / maxTotal)) * 100;
        const weekday = new Date(`${row.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3);
        const status = classifyCalorieDay(row.total, row.complete, row.goal);
        return (
          <div className="consumption-col" key={row.date}>
            <div className="consumption-value">{row.total ? fmt(energyValueForUnit(row.total, state.settings.energyUnit)) : 'Open'}</div>
            <div className="consumption-track">
              {row.goal.trackingMode === 'Maintaining' && <span className="consumption-range" style={{ bottom: `${lowerBottom}%`, height: `${Math.max(2, upperBottom - lowerBottom)}%` }} />}
              <span className="consumption-goal" style={{ bottom: `${targetBottom}%` }} />
              <div className={`consumption-fill ${status}`} style={{ height: `${height}%` }} />
            </div>
            <div className="consumption-day">{weekday}</div>
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
    <div className="week-tools">
      <button className="week-nav prev" type="button" aria-label="Previous week" onClick={() => setStart(addDays(start, -7))} />
      <button className={`week-title ${isCurrentWeek ? 'current' : 'can-reset'}`} type="button" onClick={() => !isCurrentWeek && setStart(currentWeek)}>
        <span>{isCurrentWeek ? 'This week' : 'Return to this week'}</span>
        <strong>{shortDate(days[0])} - {shortDate(days[6])}</strong>
      </button>
      <button className="week-nav next" type="button" aria-label="Next week" onClick={() => setStart(addDays(start, 7))} />
    </div>
  );
}

function BankBars({ state, rows }: { state: AppState; rows: { date: string; total: number; complete: boolean; delta: number; status: CalorieDayStatus; goal: DailyGoalSnapshot }[] }) {
  const maxGoal = Math.max(...rows.map(row => row.goal.calories), 1);
  return (
    <div className="bank-chart">
      {rows.map(row => {
        const delta = row.complete ? row.delta : 0;
        const barHeight = row.complete ? Math.min(46, Math.max(8, Math.abs(delta) / maxGoal * 54)) : 6;
        const weekday = new Date(`${row.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3);
        const direction = delta >= 0 ? 'up' : 'down';
        const tone = delta >= 0 ? 'good-fill' : 'warn-fill';
        const deltaTone = row.complete ? budgetDeltaTone(delta) : '';
        return (
          <div className="bank-col" key={row.date}>
            <div className={`bank-delta ${deltaTone}`}>{row.complete ? signedEnergyValue(state, delta) : 'Open'}</div>
            <div className="bank-track"><span className="bank-midline" />{row.complete ? <div className={`bank-fill ${tone} ${direction}`} style={{ height: barHeight }} /> : <div className="bank-open-mark" />}</div>
            <div className="bank-day">{weekday}</div>
          </div>
        );
      })}
    </div>
  );
}

function RichBanking({ state, start, setStart, onHelp }: { state: AppState; start: string; setStart: (start: string) => void; onHelp: () => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const rows = days.map(date => {
    const total = sum(dayEntries(state, date)).calories;
    const complete = isDayComplete(state, date);
    const goal = goalForDate(state, date);
    return { date, total, complete, goal, delta: complete ? goal.calories - total : 0, status: classifyCalorieDay(total, complete, goal) };
  });
  const completed = rows.filter(row => row.complete);
  const banked = completed.reduce((acc, row) => acc + row.delta, 0);
  const completedEaten = completed.reduce((acc, row) => acc + row.total, 0);
  const weekBudget = rows.reduce((acc, row) => acc + row.goal.calories, 0);
  const completedAverage = completedEaten / (completed.length || 1);
  const projected = completed.length ? completedAverage * 7 : 0;
  const completedExpected = completed.reduce((acc, row) => acc + row.goal.calories, 0);
  const completedDailyGoal = completedExpected / (completed.length || 1);
  const remainingWeek = weekBudget - completedEaten;
  const bankTone = budgetDeltaTone(banked);
  const remainingTone = budgetDeltaTone(remainingWeek);
  const completedAverageTone = upperBudgetTone(completedAverage, completedDailyGoal);
  const projectedTone = upperBudgetTone(projected, weekBudget);
  const firstCompletedMode = completed[0]?.goal.trackingMode;
  const bankMode = firstCompletedMode && completed.every(row => row.goal.trackingMode === firstCompletedMode) ? firstCompletedMode : null;
  const bankLabel = bankMode === 'Bulking'
    ? banked > 0 ? 'Calories to catch up' : 'Weekly surplus progress'
    : bankMode === 'Maintaining' ? 'Weekly balance' : bankMode === 'Cutting' ? 'Banked from completed days' : 'Weekly goal balance';
  const bankValue = bankMode === 'Bulking' && banked < 0 ? -banked : banked;
  const bankHeroText = bankMode === 'Bulking' && banked > 0 ? energyText(state, bankValue) : signedEnergyText(state, bankValue);
  return (
    <section className="card stats-card">
      <div className="card-head"><h2>Weekly calorie bank</h2><button className="help-btn" type="button" onClick={onHelp}>?</button></div>
      <WeekRangeControl start={start} setStart={setStart} />
      {completed.length ? (
        <>
          <div className="bank-hero"><div className="label">{bankLabel}</div><div className={`value ${bankTone}`}>{bankHeroText}</div><div className="bank-note">Based on {completed.length} completed day{completed.length === 1 ? '' : 's'}. Open days don’t count yet.</div></div>
          <div className="stat"><span>Weekly budget</span><strong>{energyText(state, weekBudget)}</strong></div>
          <div className="stat"><span>Eaten from completed days</span><strong>{energyText(state, completedEaten)}</strong></div>
          <div className="stat"><span>Remaining this week</span><strong className={remainingTone}>{energyText(state, remainingWeek)}</strong></div>
          <div className="stat"><span>Completed goal total</span><strong>{energyText(state, completedExpected)}</strong></div>
          <div className="stat"><span>Completed-day average</span><strong className={completedAverageTone}>{energyText(state, completedAverage)}/day</strong></div>
          <div className="stat"><span>Projected week</span><strong className={projectedTone}>{energyText(state, projected)}</strong></div>
          <BankBars state={state} rows={rows} />
        </>
      ) : <div className="empty">Complete a day in this week to calculate banking.</div>}
    </section>
  );
}

function RichAdherence({ state, start, setStart, onHelp }: { state: AppState; start: string; setStart: (start: string) => void; onHelp: () => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const rows = days.map(date => {
    const total = sum(dayEntries(state, date)).calories;
    const complete = isDayComplete(state, date);
    const goal = goalForDate(state, date);
    const status = classifyCalorieDay(total, complete, goal);
    return { date, total, complete, goal, status, success: status === 'good' };
  });
  const completed = rows.filter(row => row.complete);
  const success = rows.filter(row => row.success);
  const score = completed.length ? Math.round(success.length / completed.length * 100) : 0;
  const firstGoal = completed[0]?.goal || goalForDate(state, todayKey());
  const oneRule = completed.every(row => row.goal.trackingMode === firstGoal.trackingMode && row.goal.calories === firstGoal.calories);
  const ruleText = oneRule ? statsRuleText(firstGoal, state.settings.energyUnit) : 'On track = each completed day against its saved goal.';
  return (
    <section className="card stats-card">
      <div className="card-head"><h2>Consistency this week</h2><button className="help-btn" type="button" onClick={onHelp}>?</button></div>
      <WeekRangeControl start={start} setStart={setStart} />
      {completed.length ? (
        <div className="adherence-hero">
          <div className="label">On-track completed days</div>
          <div className={`score ${score >= 70 ? 'good' : ''}`}>{success.length}<span className="unit">/{completed.length}</span></div>
          <div className="bank-note">{ruleText} Open days stay open.</div>
        </div>
      ) : (
        <div className="empty">Complete a day in this week to see consistency.</div>
      )}
      <div className="consistency-week" aria-label="Consistency by day">
        {rows.map(row => {
          const weekday = new Date(`${row.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3);
          const tone = dayToneLabel(row.status, row.complete);
          return (
            <div key={row.date} className="consistency-day">
              <div className="consistency-label">{weekday}</div>
              <div className={`consistency-pill ${tone.className}`} aria-label={tone.label}>
                <span className="dot" aria-hidden="true" />
                <span className="pill-text">{tone.label}</span>
              </div>
              <div className="consistency-value">{row.complete ? fmt(energyValueForUnit(row.total, state.settings.energyUnit)) : '—'}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
function SettingsView(props: {
  state: AppState;
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
  const counts = backupCounts(props.state);
  const goalUnit = energyUnitValue(props.state.settings.energyUnit);
  const visibleSettings = { ...props.state.settings, calories: energyValueForUnit(props.state.settings.calories, goalUnit) };
  const draft = props.goalsEditing ? props.goalDraft : visibleSettings;
  const patchGoal = (patch: Partial<Settings>) => props.setGoalDraft({ ...props.goalDraft, ...patch });
  const toggleEnergyUnit = () => props.onEnergyUnit(goalUnit === 'kcal' ? 'kj' : 'kcal');

  useEffect(() => {
    if (!geminiEditing) setGeminiDraft(props.state.settings.geminiApiKey);
  }, [props.state.settings.geminiApiKey, geminiEditing]);

  const toggleGeminiEdit = () => {
    if (geminiEditing) {
      void Promise.resolve(props.onGeminiApiKey(geminiDraft)).then(() => setGeminiEditing(false));
    } else {
      setGeminiDraft(props.state.settings.geminiApiKey);
      setGeminiEditing(true);
    }
  };

  return (
    <>
      <header className="page-header has-helper">
        <div className="page-kicker">Dawni</div>
        <h1 className="page-title">Settings</h1>
        <p className="hint page-subtitle">Goals, calm display, and local-first backup.</p>
      </header>
      <section className="card"><div className="card-head"><h2>Goals</h2><button className="small-btn" type="button" onClick={() => props.goalsEditing ? props.onSaveGoals() : (props.setGoalDraft({ ...props.state.settings, calories: energyValueForUnit(props.state.settings.calories, goalUnit) }), props.setGoalsEditing(true))}>{props.goalsEditing ? 'Save goals' : 'Edit'}</button></div><div className="form"><Field label="Mode" full><select disabled={!props.goalsEditing} value={draft.trackingMode} onChange={event => patchGoal({ trackingMode: event.target.value as Settings['trackingMode'] })}><option>Cutting</option><option>Maintaining</option><option>Bulking</option></select></Field><Field label={`Calories (${energyUnitLabel(goalUnit)})`}><input disabled={!props.goalsEditing} inputMode="decimal" value={props.goalsEditing ? String(draft.calories || '') : fmt(draft.calories)} onChange={event => patchGoal({ calories: n(event.target.value) })} /></Field><Field label="Fat"><input disabled={!props.goalsEditing} value={draft.fat} onChange={event => patchGoal({ fat: n(event.target.value) })} /></Field><Field label="Carbs"><input disabled={!props.goalsEditing} value={draft.carbs} onChange={event => patchGoal({ carbs: n(event.target.value) })} /></Field><Field label="Protein"><input disabled={!props.goalsEditing} value={draft.protein} onChange={event => patchGoal({ protein: n(event.target.value) })} /></Field></div></section>
      <section className="card">
        <h2>Weekly banking</h2>
        <p className="hint">Use completed days to make the rest of the week easier to plan.</p>
        <label className="check-pill full">
          <input type="checkbox" checked={props.state.settings.spreadWeeklyBank} onChange={event => props.onSpreadWeeklyBank(event.target.checked)} />
          <span>Spread banked calories across remaining days</span>
        </label>
        <p className="hint">When enabled, saved or overrun calories from completed days are spread evenly across open days from today through Sunday.</p>
      </section>
      <section className="card"><h2>Display</h2><div className="field full"><span>Theme</span><div className="smooth-toggle theme-toggle" role="group" aria-label="Theme">{(['system', 'dark', 'light'] as ThemePreference[]).map(theme => <button key={theme} type="button" className={(props.state.settings.theme || DEFAULT.settings.theme) === theme ? 'active' : ''} onClick={() => props.onTheme(theme)}>{theme[0].toUpperCase() + theme.slice(1)}</button>)}</div></div><div className="field full"><span>Energy unit</span><div className="smooth-toggle" role="group" aria-label="Energy unit"><button type="button" className={goalUnit === 'kcal' ? 'active' : ''} onClick={toggleEnergyUnit}>kCal</button><button type="button" className={goalUnit === 'kj' ? 'active' : ''} onClick={toggleEnergyUnit}>kJ</button></div></div><div className="section spaced">Accent</div><div className="preset-row">{['#c9dc86', '#a8c9d8', '#dec77f', '#dc9b8e', '#c6b3df'].map(color => <button key={color} className="preset" style={{ '--c': color } as React.CSSProperties} type="button" onClick={() => props.onAccent(color)} aria-label={`Accent ${color}`} />)}</div><input type="color" value={props.state.settings.accent} onChange={event => props.onAccent(event.target.value)} /></section>
      <section className="card"><h2>Food estimates</h2><p className="hint">Refreshes Dawni&apos;s local estimate list. Estimates stay editable and won&apos;t change your saved foods or logs.</p><div className="actions"><button className="secondary" type="button" disabled={foodDatabaseUpdating} onClick={() => { setFoodDatabaseUpdating(true); props.onRefreshFoodDatabase().finally(() => setFoodDatabaseUpdating(false)); }}>{foodDatabaseUpdating ? 'Updating estimates...' : 'Update local food estimates'}</button></div></section>
      <section className="card custom-db-card"><div className="card-head"><h2>Custom food databases</h2><button className="help-btn" type="button" onClick={props.onCustomDatabaseHelp}>?</button></div><p className="hint">Import your own JSON estimate list. Enabled databases appear in food search and remain stored on this device.</p><div className="actions"><button className="primary" type="button" onClick={props.onImportCustomDatabase}>Import JSON</button></div>{props.state.customFoodDatabases.length ? <div className="custom-db-list">{props.state.customFoodDatabases.map(database => <div className="custom-db-row" key={database.id}><div className="custom-db-main"><strong>{database.name}</strong><span>{fmt(database.itemCount)} foods · Imported {new Date(database.importedAt).toLocaleDateString()} · {database.enabled ? 'Enabled' : 'Disabled'}</span></div><label className="toggle-line"><input type="checkbox" checked={database.enabled} onChange={event => props.onToggleCustomDatabase(database.id, event.target.checked)} /><span>{database.enabled ? 'On' : 'Off'}</span></label><button className="small-btn danger" type="button" onClick={() => props.onDeleteCustomDatabase(database.id)}>Delete</button></div>)}</div> : <div className="empty custom-db-empty">No custom databases imported yet.</div>}</section>
      <section className="card gemini-settings-card">
        <div className="card-head">
          <h2>Gemini</h2>
          <div className="card-head-trailing">
            <button className="small-btn" type="button" onClick={toggleGeminiEdit}>{geminiEditing ? 'Save' : 'Edit'}</button>
            <button className="help-btn" type="button" onClick={props.onGeminiApiKeyHelp}>?</button>
          </div>
        </div>
        <p className="hint">Use your own Gemini API key for in-app food estimates. The key stays on this device and is included in backups.</p>
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
      </section>
      <section className="card ai-prompt-card"><div className="card-head"><h2>AI estimate helper</h2><button className="help-btn" type="button" onClick={props.onAiPromptHelp}>?</button></div><p className="hint">Use this prompt with your AI chatbot, then review the estimate before saving it. Dawni treats AI output as editable, not guaranteed.</p><textarea className="ai-prompt-textarea" readOnly value={AI_QUICK_LOG_PROMPT} /><div className="actions"><button className="secondary" type="button" onClick={props.onCopyAiPrompt}>Copy prompt</button></div><p className="hint ai-prompt-disclaimer">{AI_ESTIMATE_DISCLAIMER}</p></section>
      <section className="card" id="backupSection"><h2>Backup</h2><p className="hint">{props.state.settings.lastBackupAt ? `Last backup: ${new Date(props.state.settings.lastBackupAt).toLocaleString()}.` : 'No backup exported yet.'} Dawni keeps your data on this device; export a backup to protect your logs and journal photos. Current data: {counts.entries} entries, {counts.foods} saved foods, {counts.photos} photos, {counts.customFoodDatabases || 0} custom databases.</p><Field label="Reminder" full><select value={props.state.settings.backupReminderDays} onChange={event => props.onBackupDays(n(event.target.value))}><option value="3">Every 3 days</option><option value="7">Every 7 days</option><option value="14">Every 14 days</option></select></Field><div className="actions"><button className="primary" type="button" onClick={props.onExport}>Export backup</button><button className="secondary" type="button" onClick={props.onImport}>Import backup</button></div></section>
      <section className="card"><h2>App</h2><p className="hint"><strong>Dawni</strong><br /><span className="project-note">Weekly Calorie Tracker</span><br />Version {APP_VERSION}</p><div className="actions"><button className="secondary" type="button" onClick={props.onCheckUpdates}>Check for updates</button><button className="secondary danger" type="button" onClick={props.onClear}>Clear local data</button></div></section>
    </>
  );
}
