import { useEffect, useRef, useState } from 'react';
import type { AppState, EnergyUnit, Entry } from '../types';
import { downloadBlob } from '../image';
import { canvasToPngBlob, MealGroup, renderMealCardCanvas } from '../canvas';
import { estimateSourceLabel } from '../aiEstimate';
import {
  addDays,
  dayEntries,
  energyLabel,
  energyText,
  energyValueForUnit,
  entryTotals,
  fmt,
  MEALS,
  mealGroupId,
  readable,
  shortDate,
  sum,
  todayKey,
  toKey
} from '../utils';
import { type JournalDayViewMode, type JournalLabelMode } from '../appTypes';
import { Modal } from '../ui/Modal';
import { MacroChips } from '../ui/controls';
import { useSettleAnimation } from '../ui/AppShell';

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

export function JournalView({
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

export function getMealGroups(state: AppState): MealGroup[] {
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

export function MealCardModal({ state, group, open, onClose, onShare }: { state: AppState; group: MealGroup | null; open: boolean; onClose: () => void; onShare: () => void }) {
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

export async function shareMealCard(group: MealGroup, energyUnit: EnergyUnit, notify: (text: string) => void) {
  try {
    const canvas = await renderMealCardCanvas(group, energyUnit);
    const blob = await canvasToPngBlob(canvas);
    await sharePhotoBlob(blob, `simple-calories-ledger-${group.date}-${group.meal.toLowerCase()}.png`, 'Meal Summary', notify);
  } catch (err) {
    console.warn(err);
    notify('Could not share PNG');
  }
}

export async function sharePhoto(src: string, filename: string, notify: (text: string) => void) {
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

export function EntryPhotoModal({ entry, open, onClose, onReplace, onRemove, onShare }: { entry: Entry | null; open: boolean; onClose: () => void; onReplace: () => void; onRemove: () => void; onShare: () => void }) {
  return <Modal open={open} title="Meal photo" onClose={onClose} className="lightbox" bottomSheet>{entry?.photo ? <><div className="photo-preview-shell"><img className="photo-preview-large" src={entry.photo} alt="" /></div><p className="hint">{entry.name} | {readable(entry.date)}</p><div className="actions vertical"><button className="primary" type="button" onClick={onReplace}>Replace</button><button className="primary" type="button" onClick={onShare}>Save / Share PNG</button><button className="secondary danger" type="button" onClick={onRemove}>Remove</button></div></> : <div className="empty">No photo yet.</div>}</Modal>;
}
