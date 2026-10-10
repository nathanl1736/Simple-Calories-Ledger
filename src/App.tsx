import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { APP_VERSION } from './version';
import { flushSync } from 'react-dom';
import type { AppState, Batch, DayPart, EnergyUnit, Entry, Food, Meal, Settings, ThemePreference } from './types';
import { DEFAULT, normalizeEntry, normalizeFood, normalizeStateShape } from './state';
import { readState, saveState } from './storage';
import { compressImage, recompressDataUrl } from './image';
import { backupAgeDays, backupCounts, exportBackup, parseBackup } from './backup';
import { applyAppUpdate, checkForAppUpdate, clearUpdateReloadMarkers, dismissUpdatePrompt, registerServiceWorker, watchForUpdatesOnResume, type UpdateInfo } from './pwa';
import { MealGroup } from './canvas';
import { databaseItemToFood, refreshFoodEstimateDatabase, type FoodDatabaseItem } from './foodDatabase';
import { parseCustomFoodDatabaseText } from './customFoodDatabases';
import { pruneOneOffEstimates, recordFoodUse, type FavouriteChange } from './favourites';
import { dayPartAt, entryDayPart, mealDayPart, usualsForMeal } from './tidelight';
import { AI_QUICK_LOG_PROMPT, amountPortionValue, parseAiQuickLog, type AiQuickLogEntry } from './aiQuickLog';
import { buildEstimateRequest, estimateNotes, estimateSourceValue, parseGeminiEstimate, type GeminiEstimate } from './aiEstimate';
import { isGeminiAbort, isGeminiTimeout, requestBatchEstimate, requestMealEstimate } from './geminiEstimate';
import { usualChips, type UsualChip } from './logUsuals';
import { removeEntry, restoreEntry, revertFoodUse, type RemovedEntry } from './undo';
import { estimatingLabel, logSheetTitle } from './estimateJob';
import { activeBatches, batchServe, batchServesLeft, buildBatchRequest, parseBatchEstimate, pruneBatches } from './mealPrep';
import { type MenuPickItem } from './menuPick';
import {
  applyDayCalorieOverride,
  dayEntries,
  energyInputFromKcal,
  energyInputToKcal,
  energyText,
  energyUnitLabel,
  energyUnitValue,
  entryUnitModeValue,
  fmt,
  fmtPortion,
  goalForDate,
  goalSnapshotFromSettings,
  lockPastGoals,
  macroBase,
  n,
  normalizeDateKey,
  readable,
  resolveDayCalorieTarget,
  setDayComplete,
  setDayEstimate,
  sum,
  todayKey,
  uid,
  validBackupReminderDays,
  weekBank,
  weekStartMonday
} from './utils';
import { type Tab, type EntryOpenMode, type JournalDayViewMode, type JournalLabelMode, type EntryDraft, type BatchInput, type BatchSheetRequest, type EstimateJob, type LogDraft } from './appTypes';
import { modalScrollLockCount, holdKeyboard, afterModalScrollLock, Modal } from './ui/Modal';
import { OpenSettingsContext } from './ui/SettingsButton';
import { TABS, AppShell } from './ui/AppShell';
import { defaultMealForCurrentTime, accentInk } from './ui/format';
import { TrackingView } from './views/TodayView';
import { weekRange, RichStatsView, WeekDetails } from './views/WeekView';
import { JournalView, getMealGroups, MealCardModal, shareMealCard, sharePhoto, EntryPhotoModal } from './views/JournalView';
import { LibraryView } from './views/LibraryView';
import { SettingsView } from './views/SettingsView';
import { draftNumberText, draftEnergyText, draftPortion, EntryModal } from './sheets/EntryModal';
import { FoodSearch } from './sheets/FoodSearch';
import { LogSheet } from './sheets/LogSheet';
import { GeminiKeyHelp } from './sheets/ConnectGemini';
import { BatchSheet } from './sheets/BatchSheet';
import { MenuPickModal } from './sheets/MenuPickModal';
import { AiQuickLogModal } from './sheets/AiQuickLogModal';
import { FoodModal } from './sheets/FoodModal';
import { RoughMealPanel } from './sheets/RoughMeal';
import { DayCalorieGoalPanel } from './sheets/DayTarget';

type ModalName = 'entry' | 'food' | 'photo' | 'entryPhoto' | 'mealCard' | 'weekDetails' | 'version' | 'backupReminder' | 'aiQuickLog' | 'aiQuickLogHelp' | 'geminiApiKeyHelp' | 'menuPick' | 'customDbHelp' | 'log' | 'dayTarget' | 'roughMeal' | 'foodSearch' | 'batch' | null;
type SetTabOptions = { date?: string; resetScroll?: boolean };

function storedTab(value: string | null): Tab {
  // Cards used to be its own tab; meal cards now live in Journal's day view.
  if (value === 'cards') return 'journal';
  // Settings is visited from a tab, not somewhere the app opens.
  if (value === 'settings') return 'tracking';
  return TABS.some(([id]) => id === value) ? value as Tab : 'tracking';
}

/** The last Gemini estimate request, kept so Refine can send a correction with the same photos. */
type EstimateSession = { description: string; photos: string[]; meal: Meal; reply: string };

function dayPartNow(): DayPart {
  const now = new Date();
  return dayPartAt(now.getHours() * 60 + now.getMinutes());
}

/**
 * The meal and part of the day just logged. Logging a day's food in one go, the next thing usually
 * belongs with the last, so for a few minutes Log food starts there instead of guessing from the clock.
 */
let lastLogged: { meal: Meal; part: DayPart; at: number } | null = null;
const RECENT_LOG_MS = 10 * 60 * 1000;
const recentLog = () => lastLogged && Date.now() - lastLogged.at < RECENT_LOG_MS ? lastLogged : null;

/** The meal Log food starts on: the one just logged, while logging several things in a row, or else the clock's guess. */
function defaultMealForLogging(): Meal {
  return recentLog()?.meal || defaultMealForCurrentTime();
}

const blankEntryDraft = (meal: Meal = 'Snack', entryEnergyUnit: EnergyUnit = 'kcal'): EntryDraft => ({
  editingId: '',
  sourceFoodId: '',
  name: '',
  meal,
  part: mealDayPart(meal) ?? recentLog()?.part ?? dayPartNow(),
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
  estimateDetails: null,
  batchId: ''
});

/** " yesterday", " on Tue, Oct 6", or nothing for today: which day something went to, for its toast. */
function dayNote(date: string) {
  if (date === todayKey()) return '';
  const day = readable(date);
  return day === 'Yesterday' || day === 'Tomorrow' ? ` ${day.toLowerCase()}` : ` on ${day}`;
}

/** A toast can offer one action, like Undo after a one-tap log. */
type ToastAction = { label: string; run: () => void };
type Toast = { id: number; text: string; action?: ToastAction } | null;

type EffectiveTheme = 'dark' | 'light';
const THEME_COLORS: Record<EffectiveTheme, string> = {
  dark: '#0A1B1E',
  light: '#EEF4F3'
};

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
  const [estimateSession, setEstimateSession] = useState<EstimateSession | null>(null);
  const [batchSheet, setBatchSheet] = useState<BatchSheetRequest>({ mode: 'new', batchId: null, opened: 0 });
  /** The Log sheet's composer, kept here so closing the sheet (or a failed estimate) loses nothing. */
  const [logDraft, setLogDraft] = useState<LogDraft>({ text: '', photos: [] });
  /** The meal the Log sheet's usuals are for and log to. */
  const [logMeal, setLogMeal] = useState<Meal>('Snack');
  const [estimateJob, setEstimateJob] = useState<EstimateJob | null>(null);
  /** The meal prep sheet is waiting on Gemini, for the pill while it's closed. */
  const [batchBusy, setBatchBusy] = useState(false);
  /** The state as last saved, for work that finishes after the render that started it, like Undo. */
  const latestState = useRef(state);
  const tabScrollRef = useRef<Partial<Record<Tab, number>>>({});
  const settingsReturnTab = useRef<Tab>('tracking');
  const nextTabScrollRef = useRef(0);
  const importRef = useRef<HTMLInputElement>(null);
  const customDatabaseImportRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const entryPhotoInputRef = useRef<HTMLInputElement>(null);
  const toastSeq = useRef(0);
  /** The sheet showing now, for work that finishes later: an estimate goes to review if its sheet is still up. */
  const modalRef = useRef<ModalName>(null);
  modalRef.current = modal;
  const estimateJobRef = useRef(estimateJob);
  estimateJobRef.current = estimateJob;
  const estimateAbort = useRef<AbortController | null>(null);
  /** Bumped by each estimate and by Cancel, so a reply to an older one is ignored. */
  const estimateSeq = useRef(0);

  const notify = (text: string, durationMs: number = 1800, action?: ToastAction) => {
    const id = ++toastSeq.current;
    setToast({ id, text, action });
    window.setTimeout(() => setToast(current => current?.id === id ? null : current), durationMs);
  };

  const persist = async (next: AppState) => {
    const normalized = normalizeStateShape(next);
    latestState.current = normalized;
    setState(normalized);
    await saveState(normalized);
  };

  /** Like updateState, but on the latest saved state rather than this render's, so a late Undo can't undo anything else. */
  const updateLatest = (recipe: (state: AppState) => void) => {
    const draft = structuredClone(latestState.current);
    recipe(draft);
    return persist(draft);
  };

  useEffect(() => {
    readState().then(saved => {
      // One-off AI estimates leave Recent a month after they were logged.
      const foods = pruneOneOffEstimates(saved.foods, Date.now());
      const next = foods.length < saved.foods.length ? { ...saved, foods } : saved;
      if (next !== saved) saveState(next).catch(console.warn);
      latestState.current = next;
      setState(next);
      setGoalDraft(next.settings);
      setLoaded(true);
      document.documentElement.style.setProperty('--accent', next.settings.accent || DEFAULT.settings.accent);
      applyThemePreference(next.settings.theme || DEFAULT.settings.theme);
    });
  }, []);

  useEffect(() => {
    // Until the saved settings load, keep what index.html applied rather than flashing the defaults.
    if (!loaded) return;
    const accent = state.settings.accent || DEFAULT.settings.accent;
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--color-accent-ink', accentInk(accent));
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
  /** Settings from any tab. Done goes back to that tab, and to the day Today was showing. */
  const openSettings = (from: Tab = tab) => {
    if (from !== 'settings') settingsReturnTab.current = from;
    setTab('settings', { resetScroll: true });
  };
  const closeSettings = () => {
    const back = settingsReturnTab.current;
    setTab(back, back === 'tracking' ? { date: selectedDate } : {});
  };
  const openSettingsSection = (sectionId: 'backupSection') => {
    setModal(null);
    openSettings();
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

  /**
   * Log food, over whichever tab is showing: the sparkle, the Now line, the first-run card and Journal
   * open it. It logs to the day shown on Today, and its title names that day when it isn't today.
   */
  const openLogSheet = (meal: Meal = defaultMealForLogging()) => {
    setLogMeal(meal);
    setModal('log');
  };

  /** Log food for typing a food in. `name` comes from a search that found nothing. */
  const openEntry = (meal: Meal = defaultMealForLogging(), name = '') => {
    // Now, in the tap: Log food's calories box doesn't exist yet and iOS only opens the keyboard for focus during a tap.
    holdKeyboard('decimal');
    setEntryDraft({ ...blankEntryDraft(meal, energyUnitValue(state.settings.energyUnit)), name });
    setEntryOpenMode('manual');
    setModal('entry');
  };

  const openFoodSearch = () => {
    // In the tap, as with +: the search box doesn't exist yet.
    holdKeyboard('search');
    setModal('foodSearch');
  };

  const editEntry = (entry: Entry) => {
    const sourceFood = entry.sourceFoodId ? state.foods.find(food => food.id === entry.sourceFoodId) : null;
    setEntryDraft({
      editingId: entry.id,
      sourceFoodId: entry.sourceFoodId || '',
      name: entry.name,
      meal: entry.meal || 'Snack',
      part: entryDayPart(entry),
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
      estimateDetails: null,
      batchId: entry.batchId || ''
    });
    setEntryOpenMode('edit');
    setModal('entry');
  };

  const formEntry = (draft: EntryDraft) => {
    const id = draft.editingId || uid();
    const rawName = draft.name.trim();
    const autoNamed = !rawName;
    return normalizeEntry({
      id,
      sourceFoodId: draft.sourceFoodId || null,
      date: selectedDate,
      name: rawName || `${draft.meal} entry`,
      autoNamed,
      unitMode: draft.unitMode,
      baseCalories: energyInputToKcal(draft.calories, draft.entryEnergyUnit),
      baseProtein: n(draft.protein),
      baseCarbs: n(draft.carbs),
      baseFat: n(draft.fat),
      portion: draftPortion(draft),
      calories: energyInputToKcal(draft.calories, draft.entryEnergyUnit),
      protein: n(draft.protein),
      carbs: n(draft.carbs),
      fat: n(draft.fat),
      meal: draft.meal,
      part: mealDayPart(draft.meal) ? undefined : draft.part,
      estimateSource: draft.estimateSource,
      batchId: draft.batchId || undefined,
      notes: draft.notes.trim(),
      photo: draft.photo,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  };

  const touchFoodAfterLog = (draftState: AppState, entry: Entry, draft: EntryDraft): FavouriteChange => {
    // Meal prep runs out, so its serves stay out of saved foods and Recent.
    if (entry.autoNamed || entry.batchId) return null;
    const isDatabaseFood = draft.source === 'foodEstimateDatabase' || draft.source === 'customFoodDatabase';
    return recordFoodUse(draftState.foods, {
      sourceFoodId: entry.sourceFoodId,
      favourite: draft.favourite,
      fromDatabase: isDatabaseFood,
      now: Date.now(),
      newId: uid,
      snapshot: {
        name: entry.name,
        unitMode: entryUnitModeValue(entry.unitMode),
        brand: draft.brand.trim() || undefined,
        servingLabel: draft.servingLabel.trim() || undefined,
        servingGrams: n(draft.servingGrams) || undefined,
        source: isDatabaseFood ? undefined : draft.source.trim() || undefined,
        sourceId: draft.sourceId.trim() || undefined,
        category: draft.category.trim() || undefined,
        tags: draft.tags.length ? draft.tags : undefined,
        calories: macroBase(entry, 'calories'),
        protein: macroBase(entry, 'protein'),
        carbs: macroBase(entry, 'carbs'),
        fat: macroBase(entry, 'fat'),
        estimateSource: entry.estimateSource || undefined
      }
    });
  };

  /**
   * Saves a Log food draft to the day shown on Today and says so, with Undo: a new entry goes again
   * (with what it did to saved foods), an edit goes back to how it was. One tap, nothing to confirm.
   */
  const commitEntry = async (draft: EntryDraft) => {
    const entry = formEntry(draft);
    const editing = !!draft.editingId;
    const previous = editing ? latestState.current.entries.find(item => item.id === entry.id) || null : null;
    const foodsBefore = latestState.current.foods;
    let favouriteChange = null as FavouriteChange;
    await updateLatest(next => {
      const idx = next.entries.findIndex(item => item.id === entry.id);
      if (idx >= 0) {
        entry.createdAt = next.entries[idx].createdAt;
        next.entries[idx] = entry;
      } else {
        next.entries.push(entry);
      }
      favouriteChange = touchFoodAfterLog(next, entry, draft);
    });
    const foodsAfter = latestState.current.foods;
    if (!editing) lastLogged = { meal: entry.meal || 'Snack', part: entryDayPart(entry), at: Date.now() };
    const favourite = favouriteChange ? ` · ${favouriteChange === 'added' ? 'added to' : 'removed from'} favourites` : '';
    const text = editing
      ? `Entry updated${favourite}`
      : `Logged ${energyText(state, entry.calories)} · ${(entry.meal || 'Snack').toLowerCase()}${dayNote(entry.date)}${favourite}`;
    notify(text, 5000, {
      label: 'Undo',
      run: () => updateLatest(next => {
        next.entries = previous
          ? next.entries.map(item => (item.id === entry.id ? previous : item))
          : next.entries.filter(item => item.id !== entry.id);
        next.foods = revertFoodUse(next.foods, foodsBefore, foodsAfter);
      }).then(() => notify('Undone'))
    });
  };

  const saveEntry = async (keepOpen = false) => {
    if (!entryDraft.calories) return notify(`${energyUnitLabel(entryDraft.entryEnergyUnit)} required`);
    if (entryDraft.favourite && !entryDraft.name.trim()) {
      document.getElementById('entryName')?.focus();
      return notify('Name this food to save it as a favourite');
    }
    const draft = entryDraft;
    await commitEntry(draft);
    if (keepOpen) setEntryDraft({ ...blankEntryDraft(draft.meal, energyUnitValue(state.settings.energyUnit)), part: draft.part });
    else setModal(null);
  };

  const repeatEntry = async (entry: Entry) => {
    const destination = todayKey();
    await updateState(draft => {
      const { photo: _photo, ...entryWithoutPhoto } = entry;
      // A snack or drink keeps the part of the day it showed in, even one saved before parts were asked.
      const part = mealDayPart(entry.meal) ? undefined : entryDayPart(entry);
      const copy = normalizeEntry({ ...entryWithoutPhoto, id: uid(), date: destination, part, photo: null, createdAt: Date.now(), updatedAt: Date.now() });
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
    await updateLatest(draft => {
      draft.entries.push(entry);
    });
    setModal(null);
    notify(`Rough ${meal.toLowerCase()} logged: ${energyText(state, kcal)}`, 5000, {
      label: 'Undo',
      run: () => updateLatest(draft => {
        draft.entries = draft.entries.filter(item => item.id !== entry.id);
      }).then(() => notify('Undone'))
    });
  };

  /** One tap with Undo, like logging, rather than a confirm box. */
  const deleteEntry = async (id: string) => {
    let removed = null as RemovedEntry | null;
    await updateLatest(draft => {
      const result = removeEntry(draft.entries, id);
      draft.entries = result.entries;
      removed = result.removed;
    });
    const gone = removed;
    if (!gone) return;
    notify('Entry deleted', 5000, {
      label: 'Undo',
      run: () => updateLatest(draft => {
        draft.entries = restoreEntry(draft.entries, gone);
      }).then(() => notify('Undone'))
    });
  };

  /** A saved food as a Log food draft: one serving, or 100 g. */
  const foodDraft = (food: Food, meal: Meal): EntryDraft => {
    const entryEnergyUnit = energyUnitValue(state.settings.energyUnit);
    return {
      ...blankEntryDraft(meal, entryEnergyUnit),
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
    };
  };

  const prefillFood = (food: Food) => {
    setEntryDraft(foodDraft(food, defaultMealForLogging()));
    setEntryOpenMode('prefill');
    setModal('entry');
  };

  /** A usual as a Log food draft: exactly what was logged last time, for `meal`. */
  const usualDraft = (entry: Entry, meal: Meal): EntryDraft => {
    const entryEnergyUnit = energyUnitValue(state.settings.energyUnit);
    const sourceFood = entry.sourceFoodId ? state.foods.find(food => food.id === entry.sourceFoodId) : null;
    return {
      ...blankEntryDraft(meal, entryEnergyUnit),
      sourceFoodId: sourceFood ? sourceFood.id : '',
      name: entry.name,
      unitMode: entryUnitModeValue(entry.unitMode),
      brand: sourceFood?.brand || '',
      servingLabel: sourceFood?.servingLabel || '',
      servingGrams: sourceFood?.servingGrams ? String(sourceFood.servingGrams) : '',
      source: sourceFood?.source || '',
      sourceId: sourceFood?.sourceId || '',
      category: sourceFood?.category || '',
      tags: sourceFood?.tags || [],
      calories: draftEnergyText(macroBase(entry, 'calories'), entryEnergyUnit),
      protein: draftNumberText(macroBase(entry, 'protein')),
      carbs: draftNumberText(macroBase(entry, 'carbs')),
      fat: draftNumberText(macroBase(entry, 'fat')),
      portion: fmtPortion(entry.portion),
      estimateSource: estimateSourceValue(entry.estimateSource)
    };
  };

  /** A usual from the Now line or the Log sheet: logged at once, with Undo. */
  const logUsualNow = (entry: Entry, meal: Meal) => commitEntry(usualDraft(entry, meal));

  /** A serve of meal prep as a Log food draft, for checking before logging. */
  const serveDraft = (batch: Batch, meal: Meal): EntryDraft => {
    const serve = batchServe(batch);
    const left = batchServesLeft(batch, latestState.current.entries);
    return {
      ...blankEntryDraft(meal, energyUnitValue(state.settings.energyUnit)),
      name: batch.name,
      calories: draftEnergyText(Math.round(serve.calories), energyUnitValue(state.settings.energyUnit)),
      protein: draftNumberText(Math.round(serve.protein * 10) / 10),
      carbs: draftNumberText(Math.round(serve.carbs * 10) / 10),
      fat: draftNumberText(Math.round(serve.fat * 10) / 10),
      portion: fmtPortion(Math.max(0, Math.min(1, left)) || 1),
      notes: `Meal prep: a serve of a batch of ${fmt(batch.servings)}.`,
      estimateSource: batch.estimateSource,
      batchId: batch.id
    };
  };

  /** A chip in the Log sheet's usuals row: a tap logs it to the sheet's meal, with Undo. */
  const logChip = (chip: UsualChip) => {
    setModal(null);
    if (chip.kind === 'prep') return logBatchServe(chip.batch, selectedDate, logMeal);
    return commitEntry(chip.kind === 'usual' ? usualDraft(chip.entry, logMeal) : foodDraft(chip.food, logMeal));
  };
  /** Touch and hold (or More): the review sheet, filled in, instead of logging straight away. */
  const reviewChip = (chip: UsualChip) => {
    setEntryDraft(chip.kind === 'usual' ? usualDraft(chip.entry, logMeal) : chip.kind === 'favourite' ? foodDraft(chip.food, logMeal) : serveDraft(chip.batch, logMeal));
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
      const parsed = parseAiQuickLog(trimmed, defaultMealForLogging());
      if (parsed) {
        setAiQuickLogSeedText('');
        prefillAiQuickLog(parsed);
        return;
      }
      notify('Couldn\u2019t read that format. You can fix it below.');
      setAiQuickLogMeal(defaultMealForLogging());
      setAiQuickLogSeedText(raw);
      setModal('aiQuickLog');
    } catch {
      notify('Could not read from clipboard.');
    }
  };

  /** Suggest, for now the menu helper. With no key the Log sheet connects one first. */
  const openMenuPick = () => setModal('menuPick');

  /** Saves a key connected from a Connect card. */
  const saveGeminiKey = (key: string) => updateLatest(draft => {
    draft.settings.geminiApiKey = key.trim();
  });

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

  /**
   * With `keepChoices` (a refine), Gemini's new numbers replace the old ones but the meal, photo and
   * favourite picked while reviewing stay. `photo` is the journal photo to start with.
   */
  const prefillGeminiEstimate = (estimate: GeminiEstimate, keepChoices = false, photo: string | null = null) => {
    const entryEnergyUnit = energyUnitValue(state.settings.energyUnit);
    const fromLabel = estimate.source === 'label';
    flushSync(() => {
      setEntryDraft(current => {
        const next: EntryDraft = {
          ...blankEntryDraft(estimate.meal, entryEnergyUnit),
          name: estimate.name,
          unitMode: estimate.unitMode,
          servingLabel: estimate.servingLabel,
          servingGrams: estimate.servingGrams ? String(estimate.servingGrams) : '',
          calories: draftEnergyText(estimate.base.calories, entryEnergyUnit),
          protein: draftNumberText(Math.round(estimate.base.protein * 10) / 10),
          carbs: draftNumberText(Math.round(estimate.base.carbs * 10) / 10),
          fat: draftNumberText(Math.round(estimate.base.fat * 10) / 10),
          portion: String(estimate.portion),
          notes: estimateNotes(fromLabel ? 'Read from the nutrition label.' : estimate.notes, estimate.assumptions, estimate.confidence),
          estimateSource: fromLabel ? 'label' : 'ai',
          estimateDetails: { confidence: estimate.confidence, assumptions: estimate.assumptions },
          photo
        };
        return keepChoices ? { ...next, meal: current.meal, part: current.part, photo: current.photo, favourite: current.favourite } : next;
      });
      setEntryOpenMode('prefill');
      setModal('entry');
    });
  };

  /** Asks Gemini; with `correction`, refines the last estimate using the same photos. */
  const runGeminiEstimate = async (description: string, photos: string[], correction?: string, forMeal?: Meal, signal?: AbortSignal) => {
    const meal = correction && estimateSession ? estimateSession.meal : forMeal || defaultMealForLogging();
    // The latest settings: a key connected a moment ago from the Log sheet is already in use.
    const { settings } = latestState.current;
    const raw = await requestMealEstimate({
      apiKey: settings.geminiApiKey,
      userText: buildEstimateRequest({
        description,
        photoCount: photos.length,
        meal,
        preferences: settings.aiPreferences,
        previous: correction ? estimateSession?.reply : undefined,
        correction
      }),
      imageDataUrls: photos,
      accept: text => !!parseGeminiEstimate(text, meal),
      signal
    });
    return { raw, meal, parsed: parseGeminiEstimate(raw, meal) };
  };

  /**
   * An estimate's result into the review sheet, with the first photo as the journal photo (never a
   * label's). A reply Gemini garbled goes to the paste helper instead, so it can be fixed by hand.
   */
  const reviewEstimate = async (job: Pick<EstimateJob, 'description' | 'photos' | 'meal'>, result: { raw: string; parsed: GeminiEstimate | null }) => {
    const { parsed, raw } = result;
    if (!parsed) {
      setEstimateJob(null);
      notify('Gemini returned text Dawni could not read. You can fix it below.');
      setAiQuickLogMeal(job.meal);
      setAiQuickLogSeedText(raw);
      setModal('aiQuickLog');
      return;
    }
    // At the journal's size and quality, not the sharp copy Gemini read.
    const photo = parsed.source !== 'label' && job.photos[0] ? await recompressDataUrl(job.photos[0]).catch(() => null) : null;
    setEstimateSession({ description: job.description, photos: job.photos, meal: job.meal, reply: raw });
    setAiQuickLogSeedText('');
    setEstimateJob(null);
    setLogDraft({ text: '', photos: [] });
    prefillGeminiEstimate(parsed, false, photo);
  };

  /** Review for an estimate that finished while its sheet was closed (the toast's Review, or the sheet's). */
  const reviewJob = (id: number) => {
    const job = estimateJobRef.current;
    if (job?.id === id && job.status === 'ready' && job.result) void reviewEstimate(job, job.result);
  };

  /**
   * Estimate from the Log sheet. Closing the sheet doesn't stop it: the pill above the tab bar says
   * it's running, and when it lands the review sheet replaces the Log sheet if that's still up, or a
   * toast offers Review (Try again if it failed). Gives up after 45 s; Cancel stops it at once.
   */
  const startEstimate = async () => {
    const description = logDraft.text.trim();
    const photos = logDraft.photos;
    if (!description && !photos.length) return;
    estimateAbort.current?.abort();
    const controller = new AbortController();
    estimateAbort.current = controller;
    const id = ++estimateSeq.current;
    const meal = logMeal;
    setEstimateJob({ id, status: 'running', description, photos, meal, startedAt: performance.now() });
    try {
      const { raw, parsed } = await runGeminiEstimate(description, photos, undefined, meal, controller.signal);
      if (estimateSeq.current !== id) return;
      estimateAbort.current = null;
      if (modalRef.current === 'log') return reviewEstimate({ description, photos, meal }, { raw, parsed });
      setEstimateJob(current => (current?.id === id ? { ...current, status: 'ready', result: { raw, parsed } } : current));
      notify('Your estimate is ready', 8000, { label: 'Review', run: () => reviewJob(id) });
    } catch (err) {
      if (estimateSeq.current !== id) return;
      estimateAbort.current = null;
      if (isGeminiAbort(err)) {
        setEstimateJob(null);
        return;
      }
      const error = err instanceof Error && err.message ? err.message : 'Gemini could not estimate this meal.';
      setEstimateJob(current => (current?.id === id ? { ...current, status: 'failed', error, timedOut: isGeminiTimeout(err) } : current));
      if (modalRef.current !== 'log') notify(error, 8000, { label: 'Try again', run: () => openLogSheet(meal) });
    }
  };

  /** Cancel on the estimating card: stops the request, and the composer comes back as it was. */
  const cancelEstimate = () => {
    estimateSeq.current += 1;
    estimateAbort.current?.abort();
    estimateAbort.current = null;
    setEstimateJob(null);
  };

  const refineGeminiEstimate = async (correction: string) => {
    if (!estimateSession) throw new Error('Start a new estimate to refine it.');
    const { raw, parsed } = await runGeminiEstimate(estimateSession.description, estimateSession.photos, correction);
    if (!parsed) throw new Error('Gemini replied in a format Dawni couldn’t read. Try again.');
    setEstimateSession({ ...estimateSession, reply: raw, description: `${estimateSession.description}\n(Correction: ${correction.trim()})`.trim() });
    prefillGeminiEstimate(parsed, true);
  };

  /**
   * Meal prep: one tap logs a serve of a batch straight away, to the meal the clock suggests,
   * with Undo in the toast. Tapping the entry afterwards changes the meal or the amount.
   */
  const logBatchServe = async (batch: Batch, date: string, meal: Meal = defaultMealForLogging()) => {
    const left = batchServesLeft(batch, latestState.current.entries);
    if (left <= 0) return notify(`No serves of ${batch.name} left`);
    const serve = batchServe(batch);
    // The last half serve is logged as a half, so the batch ends at exactly none.
    const portion = Math.min(1, left);
    const now = Date.now();
    const entry = normalizeEntry({
      id: uid(),
      sourceFoodId: null,
      date,
      name: batch.name,
      unitMode: 'serving',
      portion,
      // Whole Cal and tenths of a gram, as Log food shows them.
      baseCalories: Math.round(serve.calories),
      baseProtein: Math.round(serve.protein * 10) / 10,
      baseCarbs: Math.round(serve.carbs * 10) / 10,
      baseFat: Math.round(serve.fat * 10) / 10,
      meal,
      part: mealDayPart(meal) ? undefined : recentLog()?.part ?? dayPartNow(),
      estimateSource: batch.estimateSource,
      batchId: batch.id,
      notes: `Meal prep: a serve of a batch of ${fmt(batch.servings)}.`,
      createdAt: now,
      updatedAt: now
    });
    await updateLatest(draft => {
      draft.entries.push(entry);
    });
    lastLogged = { meal, part: entryDayPart(entry), at: now };
    const leftAfter = Math.round((left - portion) * 100) / 100;
    notify(`Logged ${energyText(state, entry.calories)} · ${meal.toLowerCase()}${dayNote(date)} · ${leftAfter > 0 ? `${fmtPortion(leftAfter)} left` : 'last serve'}`, 5000, {
      label: 'Undo',
      run: () => updateLatest(draft => {
        draft.entries = draft.entries.filter(item => item.id !== entry.id);
      }).then(() => notify('Undone'))
    });
  };

  const openBatchSheet = (mode: BatchSheetRequest['mode'], batchId: string | null = null) => {
    setBatchSheet({ mode, batchId, opened: Date.now() });
    setModal('batch');
  };

  const estimateBatch = async (recipe: string, servings: number, previous?: string, correction?: string, signal?: AbortSignal) => {
    const { settings } = latestState.current;
    const raw = await requestBatchEstimate({
      apiKey: settings.geminiApiKey,
      userText: buildBatchRequest({ recipe, servings, preferences: settings.aiPreferences, previous, correction }),
      accept: text => !!parseBatchEstimate(text),
      signal
    });
    const estimate = parseBatchEstimate(raw);
    if (!estimate) throw new Error('Gemini replied in a format Dawni couldn’t read. Try again.');
    return { raw, estimate };
  };

  const saveBatch = async (input: BatchInput, logNow: boolean) => {
    const now = Date.now();
    const today = todayKey();
    const editing = batchSheet.mode === 'edit' && batchSheet.batchId;
    let saved = null as Batch | null;
    await updateLatest(draft => {
      if (editing) {
        const target = draft.batches.find(batch => batch.id === batchSheet.batchId);
        if (target) saved = Object.assign(target, input, { updatedAt: now });
        return;
      }
      saved = { ...input, id: uid(), cookedOn: today, finishedAt: null, createdAt: now, updatedAt: now };
      draft.batches = pruneBatches([...draft.batches, saved], draft.entries, today);
    });
    setModal(null);
    if (!saved) return;
    if (logNow) return logBatchServe(saved, today);
    notify(editing ? 'Batch updated' : `Saved · ${fmt(input.servings)} serves`);
  };

  const finishBatch = async (batch: Batch) => {
    await updateLatest(draft => {
      const target = draft.batches.find(item => item.id === batch.id);
      if (target) target.finishedAt = Date.now();
    });
    setModal(null);
    notify(`${batch.name} finished`, 5000, {
      label: 'Undo',
      run: () => updateLatest(draft => {
        const target = draft.batches.find(item => item.id === batch.id);
        if (target) target.finishedAt = null;
      }).then(() => notify('Undone'))
    });
  };

  const removeBatch = async (batch: Batch) => {
    await updateLatest(draft => {
      draft.batches = draft.batches.filter(item => item.id !== batch.id);
    });
    notify('Removed from Cook again', 5000, {
      label: 'Undo',
      run: () => updateLatest(draft => {
        if (!draft.batches.some(item => item.id === batch.id)) draft.batches.push(batch);
      }).then(() => notify('Undone'))
    });
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
  // Meal prep with serves left that was cooked by the day shown on Today.
  const batchesForDay = activeBatches(state.batches, state.entries, todayKey()).filter(batch => batch.cookedOn <= selectedDate);
  const activePhotoEntry = state.entries.find(entry => entry.id === activePhotoEntryId) || null;
  // The Log sheet's usuals row: this meal's usuals, meal prep with serves left, then favourites.
  const logChips = modal === 'log'
    ? usualChips({
      usuals: usualsForMeal(state.entries, logMeal, todayKey(), new Set(state.foods.map(food => food.id)), 28, 8),
      batches: batchesForDay.map(batch => {
        const left = batchServesLeft(batch, state.entries);
        return { batch, left, calories: Math.round(batchServe(batch).calories) * Math.min(1, left) };
      }),
      foods: state.foods
    })
    : [];
  // While Gemini works on something whose sheet was closed: a slim pill above the tab bar, on every tab.
  const estimating = estimateJob?.status === 'running' && modal !== 'log';
  const pillLabel = estimating && estimateJob ? estimatingLabel(estimateJob.meal) : batchBusy && modal !== 'batch' ? 'Estimating the batch…' : '';
  const pill = pillLabel ? (
    <div className="log-pill-wrap" role="status">
      <button type="button" className="log-pill" aria-label={`${pillLabel} Open to see it.`} onClick={() => setModal(estimating ? 'log' : 'batch')}>
        <span className="log-spinner" aria-hidden="true" />
        <span>{pillLabel}</span>
      </button>
    </div>
  ) : null;
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

  const openSettingsHere = () => openSettings();

  if (!loaded) {
    // A blank screen in the right colour: the read takes a few milliseconds, so text here only flickers.
    return <main className="app loading" aria-busy="true" />;
  }

  return (
    <OpenSettingsContext.Provider value={openSettingsHere}>
    <AppShell tab={tab} setTab={setTab} onLogFood={() => openLogSheet()} pill={pill}>
      {tab === 'tracking' && (
        <TrackingView
          state={state}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          entries={entries}
          totals={totals}
          onOpenLog={openLogSheet}
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
          onLogUsual={logUsualNow}
          batches={batchesForDay}
          onLogBatch={batch => logBatchServe(batch, selectedDate)}
          onOpenTarget={() => setModal('dayTarget')}
          onOpenWeek={() => openWeek(selectedDate)}
          onOpenSettings={() => openSettings('tracking')}
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
          onLogForDay={date => {
            setSelectedDate(date);
            openLogSheet();
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
          onToggleFavourite={toggleFavourite}
          onManage={food => {
            setActiveFoodId(food.id);
            setModal('food');
          }}
          mealPrep={{
            onNew: () => openBatchSheet('new'),
            onLog: batch => logBatchServe(batch, todayKey()),
            onManage: batch => openBatchSheet('edit', batch.id),
            onCookAgain: batch => openBatchSheet('again', batch.id),
            onRemove: removeBatch
          }}
        />
      )}
      {tab === 'stats' && (
        <RichStatsView
          state={state}
          bankingWeekStart={bankingWeekStart}
          setBankingWeekStart={setBankingWeekStart}
          onDetails={() => setModal('weekDetails')}
          onOpenDay={openDayInTrack}
        />
      )}
      {tab === 'settings' && (
        <SettingsView
          state={state}
          onDone={closeSettings}
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

      {/* Before the sheets it hands over to, so each of them opens above it as it slides away. */}
      <LogSheet
        open={modal === 'log'}
        title={logSheetTitle(selectedDate, todayKey())}
        state={state}
        meal={logMeal}
        draft={logDraft}
        setDraft={setLogDraft}
        job={estimateJob}
        chips={logChips}
        // Its own close only: Estimate, a chip or another way may already have opened the next sheet.
        onClose={() => setModal(current => (current === 'log' ? null : current))}
        onEstimate={startEstimate}
        onCancelEstimate={cancelEstimate}
        onReview={() => estimateJob && reviewJob(estimateJob.id)}
        onDismissJob={() => setEstimateJob(current => (current?.status === 'running' ? current : null))}
        onLogChip={logChip}
        onReviewChip={reviewChip}
        onTypeIn={() => openEntry(logMeal)}
        onSearch={openFoodSearch}
        onRoughMeal={() => setModal('roughMeal')}
        onBatch={() => openBatchSheet('new')}
        onSuggest={openMenuPick}
        onPasteEstimate={pasteAiQuickLogFromClipboard}
        onSaveKey={saveGeminiKey}
      />
      <EntryModal
        open={modal === 'entry'}
        openMode={entryOpenMode}
        state={state}
        foods={state.foods}
        draft={entryDraft}
        setDraft={setEntryDraft}
        onClose={() => setModal(current => (current === 'entry' ? null : current))}
        onSave={saveEntry}
        onPickPhoto={() => photoInputRef.current?.click()}
        onSaveDatabaseFood={saveDatabaseFood}
        onRefine={estimateSession && entryDraft.estimateDetails && !entryDraft.editingId ? refineGeminiEstimate : undefined}
        onRoughMeal={() => setModal('roughMeal')}
        onRepeat={id => {
          const entry = state.entries.find(item => item.id === id);
          if (!entry) return;
          setModal(null);
          repeatEntry(entry);
        }}
        onDelete={id => {
          setModal(null);
          deleteEntry(id);
        }}
        day={entryDay}
      />
      <FoodSearch
        open={modal === 'foodSearch'}
        state={state}
        onClose={() => setModal(current => (current === 'foodSearch' ? null : current))}
        onChoose={prefillFood}
        onSaveDatabaseFood={saveDatabaseFood}
        onLogNew={name => openEntry(defaultMealForLogging(), name)}
        batches={batchesForDay}
        onLogBatch={batch => {
          setModal(null);
          logBatchServe(batch, selectedDate);
        }}
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
      <BatchSheet
        open={modal === 'batch'}
        request={batchSheet}
        batch={batchSheet.batchId ? state.batches.find(batch => batch.id === batchSheet.batchId) || null : null}
        state={state}
        onEstimate={estimateBatch}
        onSaveKey={saveGeminiKey}
        onBusyChange={setBatchBusy}
        onBackground={outcome => (outcome.ok
          ? notify('Your batch estimate is ready', 8000, { label: 'Review', run: () => setModal('batch') })
          : notify(outcome.message, 8000, { label: 'Try again', run: () => setModal('batch') }))}
        onSave={saveBatch}
        onFinish={finishBatch}
        // Save hands over to a toast, so only close what is still this one.
        onClose={() => setModal(current => (current === 'batch' ? null : current))}
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
          defaultMeal={selectedDate === todayKey() ? defaultMealForLogging() : 'Dinner'}
          onLog={logRoughMeal}
        />
      </Modal>
      <Modal open={modal === 'aiQuickLogHelp'} title="AI estimate helper" onClose={() => setModal(null)}>
        <ol className="update-list ai-help-list">
          <li>Copy the prompt.</li>
          <li>Paste it into your AI chatbot.</li>
          <li>Tell it your ingredients, amounts, sauces, oils, and cooking method.</li>
          <li>Copy the returned JSON (it must include unitMode: per serving or per 100g, with calories matching that choice so nothing double-counts).</li>
          <li>Tap the sparkle button beside the tabs, then Paste an estimate from another chatbot.</li>
          <li>Review the Log Food form, then save normally.</li>
        </ol>
      </Modal>
      <Modal open={modal === 'geminiApiKeyHelp'} title="Gemini API key" onClose={() => setModal(null)}>
        <GeminiKeyHelp />
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
      <Modal open={modal === 'weekDetails'} title={bankingWeekStart === weekStartMonday(todayKey()) ? 'This week' : weekRange(bankingWeekStart)} onClose={() => setModal(null)} bottomSheet>
        <WeekDetails state={state} week={weekBank(state, bankingWeekStart)} />
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
      {toast && (
        <div key={toast.id} className={`toast ${toast.action ? 'has-action' : ''} ${pill ? 'above-pill' : ''}`} role="status">
          <span>{toast.text}</span>
          {toast.action && (
            <button type="button" className="toast-action" onClick={() => { const action = toast.action; setToast(null); action?.run(); }}>{toast.action.label}</button>
          )}
        </div>
      )}
    </AppShell>
    </OpenSettingsContext.Provider>
  );
}
