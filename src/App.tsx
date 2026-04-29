import { CSSProperties, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { APP_VERSION } from './version';
import type { AppState, EnergyUnit, Entry, Food, Meal, Settings } from './types';
import { DEFAULT, normalizeEntry, normalizeFood, normalizeStateShape } from './state';
import { readState, saveState } from './storage';
import { compressImage, downloadBlob } from './image';
import { backupCounts, exportBackup, parseBackup } from './backup';
import { applyAppUpdate, checkForAppUpdate, registerServiceWorker, type UpdateInfo } from './pwa';
import { canvasToPngBlob, MealGroup, renderMealCardCanvas } from './canvas';
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
  isDayComplete,
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
type ModalName = 'entry' | 'food' | 'photo' | 'entryPhoto' | 'mealCard' | 'bankHelp' | 'adherenceHelp' | 'version' | 'backupReminder' | null;
type EntryOpenMode = 'manual' | 'prefill' | 'edit';
type JournalDayViewMode = 'list' | 'collage';
type JournalLabelMode = 'photo' | 'calories' | 'nameCalories';

type EntryDraft = {
  editingId: string;
  sourceFoodId: string;
  name: string;
  meal: Meal;
  unitMode: 'serving' | '100g';
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

const draftNumberText = (value: unknown) => String(Number.isFinite(Number(value)) ? Number(value) : 0);
const draftEnergyText = (kcal: number, unit: EnergyUnit) => energyInputFromKcal(kcal, unit) || '0';

type Toast = { id: number; text: string } | null;
type MacroChipKey = 'fat' | 'carbs' | 'protein';

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

function Modal({ open, title, children, onClose, wide = false }: { open: boolean; title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section className={`modal-panel ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="close" type="button" onClick={onClose} aria-label="Close"><span aria-hidden="true" /></button>
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
  const tabs: [Tab, string][] = [
    ['tracking', 'Track'],
    ['journal', 'Journal'],
    ['library', 'Library'],
    ['cards', 'Cards'],
    ['stats', 'Stats'],
    ['settings', 'Settings']
  ];
  return (
    <>
      <main className="app">{children}</main>
      <nav className="nav" aria-label="Main tabs">
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
  const [adherenceWeekStart, setAdherenceWeekStart] = useState(() => weekStartMonday(todayKey()));
  const [goalsEditing, setGoalsEditing] = useState(false);
  const [goalDraft, setGoalDraft] = useState<Settings>(DEFAULT.settings);
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const entryPhotoInputRef = useRef<HTMLInputElement>(null);

  const notify = (text: string) => {
    const id = Date.now();
    setToast({ id, text });
    window.setTimeout(() => setToast(current => current?.id === id ? null : current), 1800);
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
      document.documentElement.style.setProperty('--accent', next.settings.accent || '#9be7c4');
    });
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', state.settings.accent || '#9be7c4');
  }, [state.settings.accent]);

  useEffect(() => {
    if (!loaded) return;
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
    if (next === 'tracking' && tab === 'tracking') setSelectedDate(todayKey());
    if (next === 'journal' && tab === 'journal') {
      setJournalDay(null);
      setJournalMonth(new Date());
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

  const openEntry = (meal: Meal = 'Snack', date = selectedDate) => {
    if (isDayComplete(state, date)) return notify('Reopen the day before changing food logs');
    setEntryDraft(blankEntryDraft(meal, energyUnitValue(state.settings.energyUnit)));
    setEntryOpenMode('manual');
    setModal('entry');
  };

  const editEntry = (entry: Entry) => {
    setEntryDraft({
      editingId: entry.id,
      sourceFoodId: entry.sourceFoodId || '',
      name: entry.name,
      meal: entry.meal || 'Snack',
      unitMode: entryUnitModeValue(entry.unitMode),
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
    const base = {
      unitMode: entryUnitModeValue(entry.unitMode),
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
    else setModal(null);
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
      ...blankEntryDraft('Snack', entryEnergyUnit),
      sourceFoodId: food.id,
      name: food.name,
      unitMode: entryUnitModeValue(food.unitMode),
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

  const activeFood = state.foods.find(food => food.id === activeFoodId) || null;
  const activePhotoEntry = state.entries.find(entry => entry.id === activePhotoEntryId) || null;

  if (!loaded) {
    return <main className="app loading"><h1>Nathan&apos;s Calories Ledger</h1><p className="hint">Loading your local tracker...</p></main>;
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
          adherenceWeekStart={adherenceWeekStart}
          setAdherenceWeekStart={setAdherenceWeekStart}
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
            draft.settings = { ...draft.settings, ...goalDraft, calories: energyInputToKcal(goalDraft.calories, state.settings.energyUnit) };
          }).then(() => {
            setGoalsEditing(false);
            notify('Goals saved');
          })}
          onAccent={color => updateState(draft => {
            draft.settings.accent = color;
          })}
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
      />
      <FoodModal
        food={activeFood}
        open={modal === 'food'}
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
      <Modal open={modal === 'photo'} title="Meal photo" onClose={() => setModal(null)} wide>
        <div className="photo-preview-shell">{photoPreview ? <img className="photo-preview-large" src={photoPreview} alt="Meal" /> : <div className="empty">No photo available.</div>}</div>
      </Modal>
      <Modal open={modal === 'bankHelp'} title="Calorie banking" onClose={() => setModal(null)}>
        <p className="hint">Completed days count toward weekly balance. Open days stay out of the total until you lock them.</p>
        <div className="help-callout">Cutting rewards calories saved, bulking tracks catch-up or surplus progress, and maintaining tracks distance from your weekly range.</div>
      </Modal>
      <Modal open={modal === 'adherenceHelp'} title="Weekly adherence" onClose={() => setModal(null)}>
        <p className="hint">Adherence scores only completed days. Cutting succeeds at or under target, bulking succeeds from target to target +300, and maintaining succeeds within +/-150.</p>
      </Modal>
      <Modal open={modal === 'version'} title="Version update available" onClose={() => setModal(null)}>
        <div className="version-badge">Version {availableUpdate?.version || APP_VERSION}</div>
        <p className="hint">{availableUpdate?.source === 'service-worker' ? 'A newer offline version is ready to install.' : `Installed version ${APP_VERSION}. Update to version ${availableUpdate?.version || APP_VERSION}.`}</p>
        <ul className="update-list">{(availableUpdate?.notes?.length ? availableUpdate.notes : ['Update available.']).map(item => <li key={item}>{item}</li>)}</ul>
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
      {toast && <div className="toast">{toast.text}</div>}
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
}) {
  const goal = props.state.settings.calories || 1;
  const remaining = goal - props.totals.calories;
  const deg = Math.min(360, Math.max(0, props.totals.calories) / goal * 360);
  return (
    <>
      <header className="head">
        <div className="kicker">Nathan&apos;s Calories Ledger</div>
        <h1>Today&apos;s tracker</h1>
      </header>
      <DayNav value={props.selectedDate} onChange={props.setSelectedDate} />
      <section className="hero">
        <div className="ring" style={{ '--deg': `${deg}deg` } as React.CSSProperties}><div><strong>{fmt(props.totals.calories)}</strong><span>Intake</span></div></div>
        <div className="remaining">
          <div className="label">{props.state.settings.trackingMode === 'Bulking' ? 'Target remaining' : 'Budget remaining'}</div>
          <div className="value">{fmt(remaining)} <small>{energyLabel(props.state)}</small></div>
          <div className="hint">Goal: {energyText(props.state, props.state.settings.calories)}</div>
        </div>
      </section>
      <div className="macro-grid">
        <Macro name="FAT" value={props.totals.fat} goal={props.state.settings.fat} color="--fat" />
        <Macro name="CARBS" value={props.totals.carbs} goal={props.state.settings.carbs} color="--carbs" />
        <Macro name="PROTEIN" value={props.totals.protein} goal={props.state.settings.protein} color="--protein" />
      </div>
      {!props.complete && (
        <details className="card quick-picks">
          <summary className="quick-picks-summary">
            <div>
              <h2>Quick picks</h2>
            </div>
          </summary>
          <SavedFoodPicker foods={props.state.foods} onChoose={props.onPrefillFood} compact />
        </details>
      )}
      {!props.complete && <button className="log-btn" type="button" onClick={() => props.onOpenEntry()}>+ Log Food</button>}
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
    </>
  );
}

function Macro({ name, value, goal, color }: { name: string; value: number; goal: number; color: string }) {
  return <div className="macro"><div className="name">{name}</div><div className="bar"><div style={{ background: `var(${color})`, width: `${Math.min(100, value / (goal || 1) * 100)}%` }} /></div><div className="num">{fmt(value)}g <span>/ {fmt(goal)}g</span></div></div>;
}

function GroupedEntries(props: Parameters<typeof TrackingView>[0]) {
  return (
    <div>
      {MEALS.map(meal => {
        const items = props.entries.filter(entry => (entry.meal || 'Snack') === meal);
        return (
          <div className="meal-group" key={meal}>
            <div className="meal-group-head"><div className="meal-group-title">{meal}</div><div className="meal-group-total">{energyText(props.state, sum(items).calories)}</div></div>
            <div className="meal-group-body">
              {items.length ? <EntryList state={props.state} entries={items} complete={props.complete} onPhoto={props.onPhotoEntry} onEdit={props.onEditEntry} onRepeat={props.onRepeatEntry} onDelete={props.onDeleteEntry} /> : <div className="meal-empty">No food logged here yet.</div>}
              {!props.complete && <button className="meal-log-btn" type="button" onClick={() => props.onOpenEntry(meal)}>+ Log Food</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EntryList({ state, entries, complete, onPhoto, onEdit, onRepeat, onDelete }: { state: AppState; entries: Entry[]; complete: boolean; onPhoto: (entry: Entry) => void; onEdit: (entry: Entry) => void; onRepeat: (entry: Entry) => void; onDelete: (id: string) => void }) {
  if (!entries.length) return <div className="empty">No food logged for this day yet.</div>;
  return <>{entries.map(entry => <EntryRow key={entry.id} state={state} entry={entry} complete={complete} onPhoto={onPhoto} onEdit={onEdit} onRepeat={onRepeat} onDelete={onDelete} />)}</>;
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
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !menuButtonRef.current?.contains(target)) setMenuOpen(false);
    };
    const closeOnScroll = () => setMenuOpen(false);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    positionMenu();
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [menuOpen]);
  return (
    <div className="entry">
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
      <div className="entry-menu-wrap"><button ref={menuButtonRef} className="entry-menu-btn" type="button" aria-label="Entry actions" onClick={() => setMenuOpen(open => !open)}><span aria-hidden="true" /></button>{menuOpen && <div ref={menuRef} className="entry-menu" style={menuStyle}><button type="button" onClick={() => { setMenuOpen(false); onRepeat(entry); }}>Repeat</button>{!complete && <button type="button" onClick={() => { setMenuOpen(false); onEdit(entry); }}>Edit</button>}{!complete && <button type="button" className="danger-text" onClick={() => { setMenuOpen(false); onDelete(entry.id); }}>Delete</button>}</div>}</div>
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

function SavedFoodPicker({ foods, onChoose, compact = false }: { foods: Food[]; onChoose: (food: Food) => void; compact?: boolean }) {
  const [query, setQuery] = useState('');
  const [favouritesOpen, setFavouritesOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const recentFoods = [...foods].sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
  const favourites = recentFoods.filter(food => food.favourite).slice(0, 12);
  const recent = recentFoods.slice(0, 14);
  const results = query.trim()
    ? recentFoods.filter(food => food.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 24)
    : [];
  const chips = (items: Food[], empty: string) => (
    <div className="chips quick-search-results">
      {items.length ? items.map(food => (
        <button key={food.id} type="button" className={`chip ${food.favourite ? 'star' : ''}`} onClick={() => onChoose(food)}>
          {food.favourite && <span className="star-icon" aria-hidden="true" />}{food.name}
        </button>
      )) : <span className="hint">{empty}</span>}
    </div>
  );
  return (
    <section className={`quick-picker ${compact ? 'compact' : ''}`}>
      <input type="search" placeholder="Search saved foods" value={query} onChange={event => setQuery(event.target.value)} />
      {query.trim() ? chips(results, 'No matching saved foods.') : (
        <>
          <details open={favouritesOpen} onToggle={event => setFavouritesOpen(event.currentTarget.open)}>
            <summary>Favourites</summary>
            {chips(favourites, 'No favourites yet.')}
          </details>
          <details open={recentOpen} onToggle={event => setRecentOpen(event.currentTarget.open)}>
            <summary>Recent foods</summary>
            {chips(recent, 'Recent foods appear after saving entries.')}
          </details>
        </>
      )}
    </section>
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
  onPickPhoto
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
}) {
  const [additionalOpen, setAdditionalOpen] = useState(false);
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
      sourceFoodId: food.id,
      name: food.name,
      unitMode: entryUnitModeValue(food.unitMode),
      calories: draftEnergyText(food.calories, unit),
      protein: draftNumberText(food.protein),
      carbs: draftNumberText(food.carbs),
      fat: draftNumberText(food.fat),
      portion: entryUnitModeValue(food.unitMode) === '100g' ? '100' : '1',
      favourite: !!food.favourite
    }));
    setAdditionalOpen(false);
    scrollCaloriesPanel();
  };

  useEffect(() => {
    if (!open) return;
    setAdditionalOpen(false);
    scrollCaloriesPanel('auto');
    if (openMode === 'manual') focusCaloriesInput();
  }, [open, openMode]);

  return (
    <Modal open={open} title={draft.editingId ? 'Edit entry' : `Log ${draft.meal.toLowerCase()}`} onClose={onClose} wide>
      <form className="form entry-form" onSubmit={(event: FormEvent) => { event.preventDefault(); onSave(false); }}>
        <SavedFoodPicker foods={foods} onChoose={chooseFood} compact />
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

        <details className="extra-info" open={additionalOpen} onToggle={event => setAdditionalOpen(event.currentTarget.open)}>
          <summary>Additional Information</summary>
          <div className="extra-info-body">
            <Field label="Food name" full><input value={draft.name} placeholder={`${draft.meal} entry`} onChange={event => update({ name: event.target.value })} /></Field>
            <Field label={draft.unitMode === '100g' ? 'Amount eaten (g)' : 'Servings eaten'} full><input inputMode="decimal" value={draft.portion} onChange={event => update({ portion: event.target.value })} /></Field>
            <div className="portion-help full">{draft.unitMode === '100g' ? 'Logged calories and macros = per 100g values x grams eaten / 100.' : 'Logged calories and macros = per-serving values x servings eaten.'}</div>
            <Field label="Notes" full><textarea value={draft.notes} onChange={event => update({ notes: event.target.value })} /></Field>
            <label className="check-pill full"><input type="checkbox" checked={draft.favourite} onChange={event => update({ favourite: event.target.checked })} /><span>Save to favourites</span></label>
          </div>
        </details>

        <div className="actions full">
          <SwipeConfirm label={draft.editingId ? 'Swipe to save entry' : 'Swipe to log food'} confirmLabel={draft.editingId ? 'Release to save' : 'Release to log'} className="entry-swipe" onConfirm={() => onSave(false)} />
          {!draft.editingId && <button className="secondary" type="button" onClick={() => onSave(true)}>Save and add another</button>}
          <button className="secondary" type="button" onClick={onClose}>Close</button>
        </div>
      </form>
    </Modal>
  );
}

function FoodModal({ food, open, onClose, onSave, onDelete }: { food: Food | null; open: boolean; onClose: () => void; onSave: (food: Food) => void; onDelete: (food: Food) => void }) {
  const [draft, setDraft] = useState<Food | null>(food);
  useEffect(() => setDraft(food ? structuredClone(food) : null), [food]);
  if (!draft) return <Modal open={open} title="Manage food" onClose={onClose}><div className="empty">Food not found.</div></Modal>;
  const patch = (next: Partial<Food>) => setDraft(current => current ? { ...current, ...next } : current);
  return (
    <Modal open={open} title="Manage food" onClose={onClose}>
      <form className="form" onSubmit={event => { event.preventDefault(); onSave(draft); }}>
        <Field label="Name" full><input value={draft.name} onChange={event => patch({ name: event.target.value })} /></Field>
        <Field label="Calories"><input inputMode="decimal" value={draft.calories} onChange={event => patch({ calories: n(event.target.value) })} /></Field>
        <Field label="Fat"><input inputMode="decimal" value={draft.fat} onChange={event => patch({ fat: n(event.target.value) })} /></Field>
        <Field label="Carbs"><input inputMode="decimal" value={draft.carbs} onChange={event => patch({ carbs: n(event.target.value) })} /></Field>
        <Field label="Protein"><input inputMode="decimal" value={draft.protein} onChange={event => patch({ protein: n(event.target.value) })} /></Field>
        <label className="check-pill full"><input type="checkbox" checked={draft.favourite} onChange={event => patch({ favourite: event.target.checked })} /><span>Favourite</span></label>
        <div className="actions full"><button className="primary" type="submit">Save food</button><button className="secondary danger" type="button" onClick={() => onDelete(draft)}>Delete</button></div>
      </form>
    </Modal>
  );
}

function LibraryView({ state, sub, setSub, query, setQuery, onPrefill, onManage }: { state: AppState; sub: string; setSub: (sub: string) => void; query: string; setQuery: (q: string) => void; onPrefill: (food: Food) => void; onManage: (food: Food) => void }) {
  const foods = state.foods.filter(food => !query || food.name.toLowerCase().includes(query.toLowerCase())).sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
  const shown = sub === 'favourites' ? foods.filter(food => food.favourite) : foods;
  const toggleSub = () => setSub(sub === 'history' ? 'favourites' : 'history');
  return (
    <>
      <header className="head"><div className="kicker">Saved foods</div><h1>Library</h1></header>
      <div className="seg"><button className={sub === 'history' ? 'active' : ''} onClick={toggleSub} type="button">History</button><button className={sub === 'favourites' ? 'active' : ''} onClick={toggleSub} type="button">Favourites</button></div>
      <input className="search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search saved foods" />
      <section className="card">{shown.length ? shown.map(food => <FoodRow key={food.id} state={state} food={food} showUsage={sub !== 'favourites'} onPrefill={onPrefill} onManage={onManage} />) : <div className="empty">No matching foods.</div>}</section>
    </>
  );
}

function FoodRow({ state, food, showUsage, onPrefill, onManage }: { state: AppState; food: Food; showUsage: boolean; onPrefill: (food: Food) => void; onManage: (food: Food) => void }) {
  return (
    <div className="food-row">
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
  if (journalDay) {
    const entries = dayEntries(state, journalDay);
    const photos = entries.filter(entry => entry.photo);
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
      <>
        <header className="head"><div className="kicker">Journal</div><h1>{readable(journalDay)}</h1></header>
        <div className="journal-day-nav">
          <DayNav value={journalDay} onChange={setDay} />
          <button className="journal-month-btn" type="button" aria-label="Return to month view" onClick={returnToMonth}><span aria-hidden="true" /></button>
        </div>
        <div className="journal-day-toolbar">
          <div className="seg journal-toggle" role="group" aria-label="Journal day view">
            <button type="button" className={dayViewMode === 'list' ? 'active' : ''} onClick={() => setDayViewMode(dayViewMode === 'list' ? 'collage' : 'list')}>List</button>
            <button type="button" className={dayViewMode === 'collage' ? 'active' : ''} onClick={() => setDayViewMode(dayViewMode === 'list' ? 'collage' : 'list')}>Collage</button>
          </div>
          {dayViewMode === 'collage' && (
            <div className="journal-collage-actions">
              <button className="journal-label-toggle" type="button" onClick={onShuffle}>Shuffle</button>
              <button className="journal-label-toggle active" type="button" onClick={() => setLabelMode(labelOrder[(labelOrder.indexOf(labelMode) + 1) % labelOrder.length])}>{labelTitle}</button>
            </div>
          )}
        </div>
        {dayViewMode === 'collage'
          ? shuffledPhotos.length ? <div className={`journal-collage-grid label-${labelMode}`}>{shuffledPhotos.map((entry, index) => {
            const featured = index === featureOffset || ((index + featureOffset) % 7 === 0 && index < photos.length - 1);
            return <button className={`journal-photo-card ${featured ? 'featured' : ''}`} key={entry.id} type="button" onClick={() => onPhoto(entry)}><img src={entry.photo || ''} alt="" />{labelText(entry)}</button>;
          })}</div> : <div className="empty">No photos for this day.</div>
          : entries.length ? <div className="journal-day-list">{entries.map(entry => {
            const totals = entryTotals(entry);
            return (
              <button key={entry.id} className={`journal-entry-card ${entry.photo ? '' : 'no-photo'}`} type="button" onClick={() => entry.photo && onPhoto(entry)}>
                {entry.photo && <img className="journal-entry-photo" src={entry.photo} alt="" />}
                <div>
                  <div className="journal-entry-title">{entry.name}</div>
                  <div className="meta-chips journal-meta-chips">
                    <span className="meta-chip neutral">{entry.meal || 'Snack'}</span>
                    <span className="meta-chip accent">{energyText(state, totals.calories)}</span>
                    <MacroChips fat={totals.fat} carbs={totals.carbs} protein={totals.protein} />
                  </div>
                  {entry.notes && <div className="journal-entry-note">{entry.notes}</div>}
                </div>
              </button>
            );
          })}</div> : <div className="empty">No food logged for this day.</div>}
      </>
    );
  }
  const year = journalMonth.getFullYear();
  const month = journalMonth.getMonth();
  const first = new Date(year, month, 1);
  const offset = first.getDay();
  const days = Array.from({ length: 42 }, (_, i) => new Date(year, month, i - offset + 1));
  return (
    <>
      <header className="head"><div className="kicker">Photo Journal</div><h1>Journal</h1></header>
      <MonthNav value={journalMonth} onChange={setJournalMonth} />
      <div className="calendar">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={`${d}${i}`} className="dow">{d}</div>)}{days.map(day => {
        const key = toKey(day);
        const entries = dayEntries(state, key);
        const photos = entries.filter(entry => entry.photo);
        return <button key={key} className={`daybox ${day.getMonth() !== month ? 'mutedday' : ''} ${key === todayKey() ? 'today' : ''}`} type="button" onClick={() => setJournalDay(key)}><span className="daynum">{day.getDate()}</span><span className="photo-stack">{photos.slice(0, 2).map(entry => <img key={entry.id} src={entry.photo || ''} alt="" />)}</span>{photos.length > 0 && <span className="photo-count">{photos.length} photo{photos.length === 1 ? '' : 's'}</span>}</button>;
      })}</div>
    </>
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
  return (
    <>
      <header className="head"><div className="kicker">Cards</div><h1>Meal cards</h1></header>
      <DayNav value={selectedDate} onChange={setSelectedDate} />
      <section className="card meal-card-intro"><p className="hint">Pick a logged meal group and open a simple screenshot-ready meal summary card.</p></section>
      {datedGroups.length ? <div className="cards-list">{datedGroups.map(group => {
        const names = group.items.map(item => item.name).join(', ');
        const photo = group.photos[0];
        const photoCount = Math.min(group.photos.length, 4);
        return (
          <article key={group.id} className="meal-card-row">
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
      })}</div> : <div className="empty">No meal cards for this date.<br /><button className="empty-action" type="button" onClick={onStartLog}>Log food</button></div>}
    </>
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
  return <Modal open={open} title="Meal photo" onClose={onClose}>{entry?.photo ? <><div className="photo-preview-shell"><img className="photo-preview-large" src={entry.photo} alt="" /></div><p className="hint">{entry.name} | {readable(entry.date)}</p><div className="actions vertical"><button className="primary" type="button" onClick={onReplace}>Replace</button><button className="primary" type="button" onClick={onShare}>Save / Share PNG</button><button className="secondary danger" type="button" onClick={onRemove}>Remove</button></div></> : <div className="empty">No photo yet.</div>}</Modal>;
}

function StatsView({ state, selectedDate, bankingWeekStart, setBankingWeekStart, adherenceWeekStart, setAdherenceWeekStart, onBankHelp, onAdherenceHelp }: { state: AppState; selectedDate: string; bankingWeekStart: string; setBankingWeekStart: (start: string) => void; adherenceWeekStart: string; setAdherenceWeekStart: (start: string) => void; onBankHelp: () => void; onAdherenceHelp: () => void }) {
  return <RichStatsView state={state} selectedDate={selectedDate} bankingWeekStart={bankingWeekStart} setBankingWeekStart={setBankingWeekStart} adherenceWeekStart={adherenceWeekStart} setAdherenceWeekStart={setAdherenceWeekStart} onBankHelp={onBankHelp} onAdherenceHelp={onAdherenceHelp} />;
}

type CalorieDayStatus = 'open' | 'good' | 'under' | 'over';

function getCalorieBand(settings: Settings) {
  const target = Math.max(settings.calories, 1);
  if (settings.trackingMode === 'Bulking') return { lower: target, target, upper: target + 300 };
  if (settings.trackingMode === 'Maintaining') return { lower: target - 150, target, upper: target + 150 };
  return { lower: 0, target, upper: target };
}

function classifyCalorieDay(total: number, complete: boolean, settings: Settings): CalorieDayStatus {
  if (!complete) return 'open';
  const band = getCalorieBand(settings);
  if (settings.trackingMode === 'Cutting') return total <= band.target ? 'good' : 'over';
  if (settings.trackingMode === 'Bulking') {
    if (total < band.lower) return 'under';
    return total <= band.upper ? 'good' : 'over';
  }
  if (total < band.lower) return 'under';
  return total <= band.upper ? 'good' : 'over';
}

function statsRuleText(settings: Settings) {
  if (settings.trackingMode === 'Bulking') return `Success = completed days from ${energyTextForUnit(settings.calories, settings.energyUnit)} to ${energyTextForUnit(settings.calories + 300, settings.energyUnit)}.`;
  if (settings.trackingMode === 'Maintaining') return `Success = completed days within ${energyTextForUnit(settings.calories - 150, settings.energyUnit)}-${energyTextForUnit(settings.calories + 150, settings.energyUnit)}.`;
  return `Success = completed days at or under ${energyTextForUnit(settings.calories, settings.energyUnit)}.`;
}

function statusLabel(status: CalorieDayStatus) {
  if (status === 'good') return 'OK';
  if (status === 'under') return 'Under';
  if (status === 'over') return 'Over';
  return 'Open';
}

function signedEnergyText(state: AppState, kcal: number) {
  return `${kcal > 0 ? '+' : ''}${energyText(state, kcal)}`;
}

function signedEnergyValue(state: AppState, kcal: number) {
  const value = energyValueForUnit(kcal, state.settings.energyUnit);
  return `${value > 0 ? '+' : ''}${fmt(value)}`;
}

function isGoodWeeklyTotal(settings: Settings, total: number) {
  const target = Math.max(settings.calories, 1) * 7;
  if (settings.trackingMode === 'Cutting') return total <= target;
  if (settings.trackingMode === 'Bulking') return total >= target && total <= target + 300 * 7;
  return total >= target - 150 * 7 && total <= target + 150 * 7;
}

function RichStatsView({ state, selectedDate, bankingWeekStart, setBankingWeekStart, adherenceWeekStart, setAdherenceWeekStart, onBankHelp, onAdherenceHelp }: { state: AppState; selectedDate: string; bankingWeekStart: string; setBankingWeekStart: (start: string) => void; adherenceWeekStart: string; setAdherenceWeekStart: (start: string) => void; onBankHelp: () => void; onAdherenceHelp: () => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(selectedDate, i - 6));
  const rows = days.map(date => ({ date, totals: sum(dayEntries(state, date)), complete: isDayComplete(state, date) }));
  const loggedRows = rows.filter(row => row.totals.calories > 0);
  const completed = rows.filter(row => row.complete);
  const completedAvgCalories = completed.reduce((acc, row) => acc + row.totals.calories, 0) / (completed.length || 1);
  const completedAvgProtein = completed.reduce((acc, row) => acc + row.totals.protein, 0) / (completed.length || 1);
  return (
    <>
      <header className="head"><div className="kicker">Trends</div><h1>Stats</h1></header>
      <RichBanking state={state} start={bankingWeekStart} setStart={setBankingWeekStart} onHelp={onBankHelp} />
      <RichAdherence state={state} start={adherenceWeekStart} setStart={setAdherenceWeekStart} onHelp={onAdherenceHelp} />
      <section className="card stats-card">
        <div className="card-head"><h2>Last 7 days</h2></div>
        {completed.length ? (
          <>
            <div className="stat"><span>Avg calories (completed)</span><strong>{energyText(state, completedAvgCalories)} / {energyText(state, state.settings.calories)}</strong></div>
            <div className="stat"><span>Avg protein (completed)</span><strong>{fmt(completedAvgProtein)}g / {fmt(state.settings.protein)}g</strong></div>
            <div className="stat"><span>Completed days</span><strong>{completed.length} / 7</strong></div>
          </>
        ) : <div className="empty">{loggedRows.length ? 'Lock a day in this window to calculate completed averages.' : 'No logged days in this window yet.'}</div>}
        <ConsumptionBars state={state} rows={rows.map(row => ({ date: row.date, total: row.totals.calories, complete: row.complete }))} />
      </section>
    </>
  );
}

function ConsumptionBars({ state, rows }: { state: AppState; rows: { date: string; total: number; complete: boolean }[] }) {
  const band = getCalorieBand(state.settings);
  const maxTotal = Math.max(band.upper, ...rows.map(row => row.total), 1);
  const trackHeight = 96;
  const trackBottom = 32;
  const targetBottom = trackBottom + Math.max(0, Math.min(1, band.target / maxTotal)) * trackHeight;
  const lowerBottom = trackBottom + Math.max(0, Math.min(1, band.lower / maxTotal)) * trackHeight;
  const upperBottom = trackBottom + Math.max(0, Math.min(1, band.upper / maxTotal)) * trackHeight;
  return (
    <div className="consumption-chart" aria-label="Consumed calories over the last 7 days">
      {state.settings.trackingMode === 'Maintaining' && <div className="consumption-range" style={{ bottom: lowerBottom, height: Math.max(2, upperBottom - lowerBottom) }} />}
      <div className="consumption-goal" style={{ bottom: targetBottom }} />
      {rows.map(row => {
        const height = row.total ? Math.max(8, row.total / maxTotal * 100) : 3;
        const weekday = new Date(`${row.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3);
        const status = classifyCalorieDay(row.total, row.complete, state.settings);
        return (
          <div className="consumption-col" key={row.date}>
            <div className="consumption-value">{row.total ? fmt(energyValueForUnit(row.total, state.settings.energyUnit)) : 'Open'}</div>
            <div className="consumption-track"><div className={`consumption-fill ${status}`} style={{ height: `${height}%` }} /></div>
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

function BankBars({ state, rows }: { state: AppState; rows: { date: string; total: number; complete: boolean; delta: number; status: CalorieDayStatus }[] }) {
  const goal = Math.max(state.settings.calories, 1);
  return (
    <div className="bank-chart">
      {rows.map(row => {
        const delta = row.complete ? row.delta : 0;
        const barHeight = row.complete ? Math.min(46, Math.max(8, Math.abs(delta) / goal * 54)) : 6;
        const weekday = new Date(`${row.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3);
        const direction = delta >= 0 ? 'up' : 'down';
        const tone = row.status === 'good' ? 'good-fill' : 'warn-fill';
        return (
          <div className="bank-col" key={row.date}>
            <div className="bank-delta">{row.complete ? signedEnergyValue(state, delta) : 'Open'}</div>
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
    return { date, total, complete, delta: complete ? state.settings.calories - total : 0, status: classifyCalorieDay(total, complete, state.settings) };
  });
  const completed = rows.filter(row => row.complete);
  const banked = completed.reduce((acc, row) => acc + row.delta, 0);
  const completedEaten = completed.reduce((acc, row) => acc + row.total, 0);
  const weekBudget = state.settings.calories * 7;
  const completedAverage = completedEaten / (completed.length || 1);
  const projected = completed.length ? completedAverage * 7 : 0;
  const completedExpected = completed.length * state.settings.calories;
  const completedBalanceGood = state.settings.trackingMode === 'Cutting'
    ? banked >= 0
    : state.settings.trackingMode === 'Bulking'
      ? banked <= 0 && completedEaten <= completedExpected + 300 * completed.length
      : Math.abs(banked) <= 150 * completed.length;
  const bankLabel = state.settings.trackingMode === 'Bulking'
    ? banked > 0 ? 'Calories to catch up' : 'Weekly surplus progress'
    : state.settings.trackingMode === 'Maintaining' ? 'Weekly balance' : 'Banked from completed days';
  const bankValue = state.settings.trackingMode === 'Bulking' && banked < 0 ? -banked : banked;
  const bankHeroText = state.settings.trackingMode === 'Bulking' && banked > 0 ? energyText(state, bankValue) : signedEnergyText(state, bankValue);
  return (
    <section className="card stats-card">
      <div className="card-head"><h2>Calories Bank</h2><button className="help-btn" type="button" onClick={onHelp}>?</button></div>
      <WeekRangeControl start={start} setStart={setStart} />
      {completed.length ? (
        <>
          <div className="bank-hero"><div className="label">{bankLabel}</div><div className={`value ${completedBalanceGood ? 'good' : 'warn'}`}>{bankHeroText}</div><div className="bank-note">{completed.length} completed day{completed.length === 1 ? '' : 's'} - Open days do not count yet</div></div>
          <div className="stat"><span>Weekly budget</span><strong>{energyText(state, weekBudget)}</strong></div>
          <div className="stat"><span>Eaten from completed days</span><strong>{energyText(state, completedEaten)}</strong></div>
          <div className="stat"><span>Remaining this week</span><strong className={weekBudget - completedEaten >= 0 ? 'good' : 'warn'}>{energyText(state, weekBudget - completedEaten)}</strong></div>
          <div className="stat"><span>Completed-day average</span><strong className={classifyCalorieDay(completedAverage, true, state.settings) === 'good' ? 'good' : 'warn'}>{energyText(state, completedAverage)}/day</strong></div>
          <div className="stat"><span>Projected week</span><strong className={projected && isGoodWeeklyTotal(state.settings, projected) ? 'good' : 'warn'}>{energyText(state, projected)}</strong></div>
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
    const status = classifyCalorieDay(total, complete, state.settings);
    return { date, total, complete, status, success: status === 'good' };
  });
  const completed = rows.filter(row => row.complete);
  const success = rows.filter(row => row.success);
  const score = completed.length ? Math.round(success.length / completed.length * 100) : 0;
  return (
    <section className="card stats-card">
      <div className="card-head"><h2>Weekly adherence</h2><button className="help-btn" type="button" onClick={onHelp}>?</button></div>
      <WeekRangeControl start={start} setStart={setStart} />
      {completed.length ? <div className="adherence-hero"><div className="label">Weekly adherence</div><div className={`score ${score >= 70 ? 'good' : 'warn'}`}>{fmt(score)}%</div><div className="bank-note">{success.length} of {completed.length} completed days on track - {statsRuleText(state.settings)}</div></div> : <div className="empty">Complete a day in this week to calculate adherence.</div>}
      <div className="adherence-week">{rows.map(row => <div key={row.date} className={`adh-day ${row.status}`}><div className="adh-label">{new Date(`${row.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3)}</div><div className="adh-icon">{statusLabel(row.status)}</div><div className="adh-value">{row.complete ? fmt(energyValueForUnit(row.total, state.settings.energyUnit)) : 'Open'}</div></div>)}</div>
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
  onEnergyUnit: (unit: 'kcal' | 'kj') => void;
  onBackupDays: (days: number) => void;
  onExport: () => void;
  onImport: () => void;
  onCheckUpdates: () => void;
  onClear: () => void;
}) {
  const counts = backupCounts(props.state);
  const goalUnit = energyUnitValue(props.state.settings.energyUnit);
  const visibleSettings = { ...props.state.settings, calories: energyValueForUnit(props.state.settings.calories, goalUnit) };
  const draft = props.goalsEditing ? props.goalDraft : visibleSettings;
  const patchGoal = (patch: Partial<Settings>) => props.setGoalDraft({ ...props.goalDraft, ...patch });
  const toggleEnergyUnit = () => props.onEnergyUnit(goalUnit === 'kcal' ? 'kj' : 'kcal');
  return (
    <>
      <header className="head"><div className="kicker">Preferences</div><h1>Settings</h1></header>
      <section className="card"><div className="card-head"><h2>Goals</h2><button className="small-btn" type="button" onClick={() => props.goalsEditing ? props.onSaveGoals() : (props.setGoalDraft({ ...props.state.settings, calories: energyValueForUnit(props.state.settings.calories, goalUnit) }), props.setGoalsEditing(true))}>{props.goalsEditing ? 'Save goals' : 'Edit'}</button></div><div className="form"><Field label="Mode" full><select disabled={!props.goalsEditing} value={draft.trackingMode} onChange={event => patchGoal({ trackingMode: event.target.value as Settings['trackingMode'] })}><option>Cutting</option><option>Maintaining</option><option>Bulking</option></select></Field><Field label={`Calories (${energyUnitLabel(goalUnit)})`}><input disabled={!props.goalsEditing} inputMode="decimal" value={props.goalsEditing ? String(draft.calories || '') : fmt(draft.calories)} onChange={event => patchGoal({ calories: n(event.target.value) })} /></Field><Field label="Fat"><input disabled={!props.goalsEditing} value={draft.fat} onChange={event => patchGoal({ fat: n(event.target.value) })} /></Field><Field label="Carbs"><input disabled={!props.goalsEditing} value={draft.carbs} onChange={event => patchGoal({ carbs: n(event.target.value) })} /></Field><Field label="Protein"><input disabled={!props.goalsEditing} value={draft.protein} onChange={event => patchGoal({ protein: n(event.target.value) })} /></Field></div></section>
      <section className="card"><h2>Display</h2><div className="field full"><span>Energy unit</span><div className="smooth-toggle" role="group" aria-label="Energy unit"><button type="button" className={goalUnit === 'kcal' ? 'active' : ''} onClick={toggleEnergyUnit}>kCal</button><button type="button" className={goalUnit === 'kj' ? 'active' : ''} onClick={toggleEnergyUnit}>kJ</button></div></div><div className="section spaced">Accent</div><div className="preset-row">{['#9be7c4', '#a8d8ff', '#f5dd9d', '#ffb3ba', '#d8c3ff'].map(color => <button key={color} className="preset" style={{ '--c': color } as React.CSSProperties} type="button" onClick={() => props.onAccent(color)} aria-label={`Accent ${color}`} />)}</div><input type="color" value={props.state.settings.accent} onChange={event => props.onAccent(event.target.value)} /></section>
      <section className="card" id="backupSection"><h2>Backup</h2><p className="hint">{props.state.settings.lastBackupAt ? `Last backup exported: ${new Date(props.state.settings.lastBackupAt).toLocaleString()}` : 'No backup exported yet.'} Current data: {counts.entries} entries, {counts.foods} saved foods, {counts.photos} photos.</p><Field label="Reminder" full><select value={props.state.settings.backupReminderDays} onChange={event => props.onBackupDays(n(event.target.value))}><option value="3">Every 3 days</option><option value="7">Every 7 days</option><option value="14">Every 14 days</option></select></Field><div className="actions"><button className="primary" type="button" onClick={props.onExport}>Export backup</button><button className="secondary" type="button" onClick={props.onImport}>Import backup</button></div></section>
      <section className="card"><h2>App</h2><p className="hint"><strong>Nathan&apos;s Calories Ledger</strong><br />Version {APP_VERSION}<br /><span className="project-note">A project by Nathan.</span></p><div className="actions"><button className="secondary" type="button" onClick={props.onCheckUpdates}>Check for updates</button><button className="secondary danger" type="button" onClick={props.onClear}>Clear local data</button></div></section>
    </>
  );
}
