import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { APP_VERSION } from './version';
import { flushSync } from 'react-dom';
import type { AppState, Batch, DayPart, EnergyUnit, Entry, Food, Meal, Settings, ThemePreference } from './types';
import { DEFAULT, normalizeEntry, normalizeFood, normalizeStateShape } from './state';
import { readState, saveState } from './storage';
import { compressImage } from './image';
import { backupAgeDays, backupCounts, exportBackup, parseBackup } from './backup';
import { applyAppUpdate, checkForAppUpdate, clearUpdateReloadMarkers, dismissUpdatePrompt, registerServiceWorker, watchForUpdatesOnResume, type UpdateInfo } from './pwa';
import { MealGroup } from './canvas';
import { databaseItemToFood, refreshFoodEstimateDatabase, type FoodDatabaseItem } from './foodDatabase';
import { parseCustomFoodDatabaseText } from './customFoodDatabases';
import { pruneOneOffEstimates, recordFoodUse, type FavouriteChange } from './favourites';
import { dayPartAt, entryDayPart, mealDayPart } from './tidelight';
import { AI_ESTIMATE_DISCLAIMER, AI_QUICK_LOG_PROMPT, amountPortionValue, parseAiQuickLog, type AiQuickLogEntry } from './aiQuickLog';
import { buildEstimateRequest, estimateNotes, estimateSourceValue, parseGeminiEstimate, type GeminiEstimate } from './aiEstimate';
import { requestBatchEstimate, requestMealEstimate } from './geminiEstimate';
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
import { type Tab, type EntryOpenMode, type JournalDayViewMode, type JournalLabelMode, type EntryDraft, type BatchInput, type BatchSheetRequest } from './appTypes';
import { modalScrollLockCount, holdKeyboard, afterModalScrollLock, Modal } from './ui/Modal';
import { Icon } from './ui/icons';
import { TABS, AppShell } from './ui/AppShell';
import { defaultMealForCurrentTime, accentInk } from './ui/format';
import { TrackingView } from './views/TodayView';
import { weekRange, RichStatsView, WeekDetails } from './views/WeekView';
import { JournalView, getMealGroups, MealCardModal, shareMealCard, sharePhoto, EntryPhotoModal } from './views/JournalView';
import { LibraryView } from './views/LibraryView';
import { SettingsView } from './views/SettingsView';
import { draftNumberText, draftEnergyText, draftPortion, EntryModal } from './sheets/EntryModal';
import { FoodSearch } from './sheets/FoodSearch';
import { GeminiEstimateModal } from './sheets/GeminiEstimateModal';
import { BatchSheet } from './sheets/BatchSheet';
import { MenuPickModal } from './sheets/MenuPickModal';
import { AiQuickLogModal } from './sheets/AiQuickLogModal';
import { FoodModal } from './sheets/FoodModal';
import { RoughMealPanel } from './sheets/RoughMeal';
import { DayCalorieGoalPanel } from './sheets/DayTarget';

type ModalName = 'entry' | 'food' | 'photo' | 'entryPhoto' | 'mealCard' | 'weekDetails' | 'version' | 'backupReminder' | 'aiQuickLog' | 'aiQuickLogHelp' | 'geminiApiKeyHelp' | 'geminiEstimate' | 'geminiSetup' | 'menuPick' | 'customDbHelp' | 'addFood' | 'dayTarget' | 'roughMeal' | 'foodSearch' | 'batch' | null;
type SetTabOptions = { date?: string; resetScroll?: boolean };

function storedTab(value: string | null): Tab {
  // Cards used to be its own tab; meal cards now live in Journal's day view.
  if (value === 'cards') return 'journal';
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
  const [settingsFocus, setSettingsFocus] = useState<'gemini' | null>(null);
  const [goalsEditing, setGoalsEditing] = useState(false);
  const [goalDraft, setGoalDraft] = useState<Settings>(DEFAULT.settings);
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);
  const [aiQuickLogMeal, setAiQuickLogMeal] = useState<Meal>('Snack');
  const [aiQuickLogSeedText, setAiQuickLogSeedText] = useState('');
  const [estimateSession, setEstimateSession] = useState<EstimateSession | null>(null);
  const [batchSheet, setBatchSheet] = useState<BatchSheetRequest>({ mode: 'new', batchId: null, opened: 0 });
  /** The state as last saved, for work that finishes after the render that started it, like Undo. */
  const latestState = useRef(state);
  const tabScrollRef = useRef<Partial<Record<Tab, number>>>({});
  const settingsReturnTab = useRef<Tab>('tracking');
  const nextTabScrollRef = useRef(0);
  const importRef = useRef<HTMLInputElement>(null);
  const customDatabaseImportRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const entryPhotoInputRef = useRef<HTMLInputElement>(null);
  const searchFieldRef = useRef<HTMLButtonElement>(null);

  const notify = (text: string, durationMs: number = 1800, action?: ToastAction) => {
    const id = Date.now();
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

  /** The sparkle beside the tab bar: Log with AI for the day shown on Today, or for today from any other tab. */
  const logWithAiFromTabBar = () => {
    if (tab !== 'tracking') setTab('tracking');
    setModal('addFood');
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
      part: mealDayPart(entryDraft.meal) ? undefined : entryDraft.part,
      estimateSource: entryDraft.estimateSource,
      batchId: entryDraft.batchId || undefined,
      notes: entryDraft.notes.trim(),
      photo: entryDraft.photo,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  };

  const touchFoodAfterLog = (draftState: AppState, entry: Entry): FavouriteChange => {
    // Meal prep runs out, so its serves stay out of saved foods and Recent.
    if (entry.autoNamed || entry.batchId) return null;
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
    if (!entryDraft.editingId) lastLogged = { meal: entry.meal || 'Snack', part: entryDayPart(entry), at: Date.now() };
    const saved = entryDraft.editingId ? 'Entry updated' : 'Entry saved';
    notify(favouriteChange ? `${saved} · ${favouriteChange === 'added' ? 'added to' : 'removed from'} favourites` : saved);
    if (keepOpen) setEntryDraft({ ...blankEntryDraft(entryDraft.meal, energyUnitValue(state.settings.energyUnit)), part: entryDraft.part });
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
      ...blankEntryDraft(defaultMealForLogging(), entryEnergyUnit),
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

  /** A usual from the Now line: Log food filled in with exactly what was logged last time, for the meal the Now line is suggesting. */
  const logUsual = (entry: Entry, meal: Meal) => {
    const entryEnergyUnit = energyUnitValue(state.settings.energyUnit);
    const sourceFood = entry.sourceFoodId ? state.foods.find(food => food.id === entry.sourceFoodId) : null;
    setEntryDraft({
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
          servingGrams: estimate.servingGrams ? String(estimate.servingGrams) : '',
          calories: draftEnergyText(estimate.base.calories, entryEnergyUnit),
          protein: draftNumberText(Math.round(estimate.base.protein * 10) / 10),
          carbs: draftNumberText(Math.round(estimate.base.carbs * 10) / 10),
          fat: draftNumberText(Math.round(estimate.base.fat * 10) / 10),
          portion: String(estimate.portion),
          notes: estimateNotes(fromLabel ? 'Read from the nutrition label.' : estimate.notes, estimate.assumptions, estimate.confidence),
          estimateSource: fromLabel ? 'label' : 'ai',
          estimateDetails: { confidence: estimate.confidence, assumptions: estimate.assumptions }
        };
        return keepChoices ? { ...next, meal: current.meal, part: current.part, photo: current.photo, favourite: current.favourite } : next;
      });
      setEntryOpenMode('prefill');
      setModal('entry');
    });
  };

  /** Asks Gemini; with `correction`, refines the last estimate using the same photos. */
  const runGeminiEstimate = async (description: string, photos: string[], correction?: string) => {
    const meal = correction && estimateSession ? estimateSession.meal : defaultMealForLogging();
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

  /**
   * Meal prep: one tap logs a serve of a batch straight away, to the meal the clock suggests,
   * with Undo in the toast. Tapping the entry afterwards changes the meal or the amount.
   */
  const logBatchServe = async (batch: Batch, date: string) => {
    const left = batchServesLeft(batch, latestState.current.entries);
    if (left <= 0) return notify(`No serves of ${batch.name} left`);
    const meal = defaultMealForLogging();
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
    const where = `${meal.toLowerCase()}${date === todayKey() ? '' : ` on ${readable(date)}`}`;
    notify(`Logged to ${where} · ${leftAfter > 0 ? `${fmtPortion(leftAfter)} left` : 'last serve'}`, 5000, {
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

  const estimateBatch = async (recipe: string, servings: number, previous?: string, correction?: string) => {
    const raw = await requestBatchEstimate({
      apiKey: state.settings.geminiApiKey,
      userText: buildBatchRequest({ recipe, servings, preferences: state.settings.aiPreferences, previous, correction }),
      accept: text => !!parseBatchEstimate(text)
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
    <AppShell tab={tab} setTab={setTab} onLogWithAi={logWithAiFromTabBar}>
      {tab === 'tracking' && (
        <TrackingView
          state={state}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          entries={entries}
          totals={totals}
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
          searchFieldRef={searchFieldRef}
          onOpenSearch={openFoodSearch}
          onLogUsual={logUsual}
          batches={batchesForDay}
          onLogBatch={batch => logBatchServe(batch, selectedDate)}
          onOpenTarget={() => setModal('dayTarget')}
          onOpenWeek={() => openWeek(selectedDate)}
          onOpenSettings={() => {
            settingsReturnTab.current = 'tracking';
            setTab('settings', { resetScroll: true });
          }}
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
          onDone={() => setTab(settingsReturnTab.current)}
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
          if (!confirm('Delete this entry?')) return;
          setModal(null);
          updateState(draft => {
            draft.entries = draft.entries.filter(entry => entry.id !== id);
          }).then(() => notify('Entry deleted'));
        }}
        day={entryDay}
      />
      <FoodSearch
        open={modal === 'foodSearch'}
        state={state}
        anchorRef={searchFieldRef}
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
      <GeminiEstimateModal
        open={modal === 'geminiEstimate'}
        // Modal runs a close animation then calls onClose; if we already opened Log Food, do not setModal(null).
        onClose={() => setModal(current => (current === 'geminiEstimate' ? null : current))}
        onEstimate={estimateWithGemini}
      />
      <BatchSheet
        open={modal === 'batch'}
        request={batchSheet}
        batch={batchSheet.batchId ? state.batches.find(batch => batch.id === batchSheet.batchId) || null : null}
        state={state}
        onEstimate={estimateBatch}
        onSetupGemini={() => setModal('geminiSetup')}
        onSave={saveBatch}
        onFinish={finishBatch}
        // Save hands over to a toast and Set up Gemini to another sheet, so only close what is still this one.
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
      <Modal open={modal === 'addFood'} title="Log with AI" onClose={() => setModal(current => (current === 'addFood' ? null : current))} bottomSheet>
        <div className="add-sheet">
          <div className="add-list">
            <button className="add-row" type="button" onClick={openGeminiEstimate}>
              <span className="add-icon"><Icon name="sparkle" /></span>
              <span className="add-text"><strong>Estimate with Gemini</strong><small>Describe it, or photograph the meal or nutrition label</small></span>
              <Icon name="chevron" size={18} />
            </button>
            <button className="add-row" type="button" onClick={() => openBatchSheet('new')}>
              <span className="add-icon"><Icon name="prep" /></span>
              <span className="add-text"><strong>Meal prep a batch</strong><small>List what you cooked and split it into serves to log through the week</small></span>
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
          defaultMeal={selectedDate === todayKey() ? defaultMealForLogging() : 'Dinner'}
          onLog={logRoughMeal}
        />
      </Modal>
      <Modal open={modal === 'geminiSetup'} title="Set up Gemini" onClose={() => setModal(null)}>
        <p className="hint">Estimate with Gemini, Meal prep a batch and Help me pick from a menu use your own Google Gemini API key. It takes a couple of minutes to set up, and the key stays on this device.</p>
        <ol className="update-list ai-help-list">
          <li>
            Create a key in Google AI Studio at{' '}
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">aistudio.google.com/app/apikey</a>.
            The free tier is enough, and no card is needed.
          </li>
          <li>Paste it into Settings → Gemini and tap Save.</li>
          <li>Dawni checks the key and shows which Gemini model it will use.</li>
        </ol>
        <div className="help-callout">No key? Tap the sparkle button beside the tabs, then Copy prompt and Paste estimate. That works with any AI chatbot.</div>
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
          <li>Tap the sparkle button beside the tabs, then Paste estimate.</li>
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
          <li>Tap Create API key. A new key starts on Google&apos;s free tier, with no card needed.</li>
          <li>Paste the key into Dawni&apos;s Gemini API key field in Settings, then tap Save. Dawni checks which models the key can actually use and shows the one it picked. Test key runs the check again.</li>
          <li>Free tier: Gemini Flash models with daily limits, which is plenty for logging meals. Pro models need a paid plan, where Google asks you to prepay credit (at least US$5).</li>
          <li>Once billing is linked to a key&apos;s Google project, every request on it is charged, even ones the free tier would have covered. To keep a free key, create it in a project without billing.</li>
          <li>The check is free on a free key. On a paid key it&apos;s one tiny request to the best model, a fraction of a cent.</li>
          <li>Dawni only uses the key when you tap Estimate with Gemini or Help me pick from a menu. The key is stored locally in this browser and is included in exported backups.</li>
        </ol>
        <div className="help-callout">Dawni picks the best model your key&apos;s plan allows, so it keeps working as Google releases new models. If one model is busy or not in your plan, it moves to the next. Upgraded to a paid plan? Tap Test key and Dawni switches to the better model straight away.</div>
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
        <div key={toast.id} className={`toast ${toast.action ? 'has-action' : ''}`} role="status">
          <span>{toast.text}</span>
          {toast.action && (
            <button type="button" className="toast-action" onClick={() => { const action = toast.action; setToast(null); action?.run(); }}>{toast.action.label}</button>
          )}
        </div>
      )}
    </AppShell>
  );
}
