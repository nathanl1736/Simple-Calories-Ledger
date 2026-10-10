import { ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import type { AppState, Batch, DayPart, Entry, Meal } from '../types';
import { arcSlice, DAY_PART_BAND, DAY_PART_LABEL, dayPartGroups, miniArc, nextMealSlot, skyFor, sunArc, usualsForMeal } from '../tidelight';
import { estimateSourceLabel } from '../aiEstimate';
import { batchServe, batchServesLeft } from '../mealPrep';
import {
  addDays,
  bankDay,
  energyLabel,
  energyText,
  energyValue,
  entryUnitModeValue,
  fmt,
  fmtGram,
  fmtPortion,
  goalForDate,
  isDayComplete,
  LIGHT_DAY_SHARE,
  mightBeMissingFood,
  readable,
  resolveDayCalorieTarget,
  shortDate,
  sum,
  todayKey,
  weekBank,
  weekStartMonday,
  weeklyBankAdjustmentForDate,
  type BankDay
} from '../utils';
import { Icon } from '../ui/icons';
import { ServePips } from '../ui/controls';
import { useSettleAnimation } from '../ui/AppShell';
import { useSky, skyStyle } from '../ui/sky';
import { signedEnergyText, BANK_STATUS_TEXT } from './WeekView';
import { weekViewFor } from '../weekView';

type MacroView = 'left' | 'eaten';
const MACRO_VIEW_KEY = 'dawni-macro-view';
const storedMacroView = (): MacroView => {
  try {
    return localStorage.getItem(MACRO_VIEW_KEY) === 'eaten' ? 'eaten' : 'left';
  } catch {
    return 'left';
  }
};

const WEEKDAY_SHORT = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short' });

/** Re-renders each minute and on return to the app, so time-of-day pieces (the Now line, the sky, "Today") keep up. */
function useMinuteClock() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const tick = () => setTick(Date.now());
    const timer = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
}

/**
 * Swipe the Today date strip sideways to move a week back or forward. The strip follows the finger,
 * then slides out and the new week slides in. Forward stops at the current week, like Week's arrows.
 */
function useWeekSwipe(selectedDate: string, setSelectedDate: (date: string) => void) {
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; t: number; dx: number; active: boolean; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const latest = useRef({ selectedDate, setSelectedDate });
  latest.current = { selectedDate, setSelectedDate };
  const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canGoForward = () => weekStartMonday(latest.current.selectedDate) < weekStartMonday(todayKey());
  const settle = (el: HTMLElement, from: number) => {
    el.style.transform = '';
    el.style.opacity = '';
    if (from && !reduceMotion()) el.animate([{ transform: `translateX(${from}px)` }, { transform: 'translateX(0)' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
  };
  const shift = (el: HTMLElement, dir: 1 | -1, fromX: number) => {
    const { selectedDate: current, setSelectedDate: set } = latest.current;
    const today = todayKey();
    // Landing on the current week picks today; any other week keeps the same weekday.
    const target = addDays(current, dir * 7);
    const next = weekStartMonday(target) === weekStartMonday(today) ? today : target;
    const width = el.offsetWidth || 1;
    const apply = () => {
      flushSync(() => set(next));
      el.style.transform = '';
      el.style.opacity = '';
      if (!reduceMotion()) el.animate([{ transform: `translateX(${dir * width * 0.5}px)`, opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
    };
    if (reduceMotion()) return apply();
    const out = el.animate([{ transform: `translateX(${fromX}px)`, opacity: Number(el.style.opacity || 1) }, { transform: `translateX(${-dir * width * 0.5}px)`, opacity: 0 }], { duration: 130, easing: 'ease-in', fill: 'forwards' });
    out.finished.then(() => { apply(); out.cancel(); }).catch(() => apply());
  };
  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp, dx: 0, active: false, moved: false };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el || d.id !== event.pointerId) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (!d.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag.current = null; return; }
      if (Math.abs(dx) < 10) return;
      d.active = true;
      d.moved = true;
      el.setPointerCapture(event.pointerId);
    }
    // Past the current week the strip only gives a little, so it reads as the end.
    const blocked = dx < 0 && !canGoForward();
    d.dx = blocked ? dx / 4 : dx;
    el.style.transform = `translateX(${d.dx}px)`;
    el.style.opacity = blocked ? '' : String(1 - Math.min(Math.abs(dx) / (el.offsetWidth || 1), 1) * 0.5);
  };
  const end = (event: React.PointerEvent<HTMLElement>, cancelled = false) => {
    const d = drag.current;
    const el = ref.current;
    drag.current = null;
    if (!d || !el || d.id !== event.pointerId) return;
    if (d.moved) {
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
    }
    if (!d.active) return;
    const dx = event.clientX - d.x;
    const speed = Math.abs(dx) / Math.max(1, event.timeStamp - d.t);
    const dir: 1 | -1 = dx < 0 ? 1 : -1;
    const far = Math.abs(dx) > Math.min(80, (el.offsetWidth || 300) * 0.2) || (speed > 0.45 && Math.abs(dx) > 24);
    if (!cancelled && far && (dir === -1 || canGoForward())) shift(el, dir, d.dx);
    else settle(el, d.dx);
  };
  return {
    ref,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: React.PointerEvent<HTMLElement>) => end(event),
      onPointerCancel: (event: React.PointerEvent<HTMLElement>) => end(event, true),
      // A swipe that ends over a day shouldn't also pick that day.
      onClickCapture: (event: React.MouseEvent<HTMLElement>) => {
        if (!suppressClick.current) return;
        event.preventDefault();
        event.stopPropagation();
      }
    }
  };
}

export function TrackingView(props: {
  state: AppState;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  entries: Entry[];
  totals: ReturnType<typeof sum>;
  /** Opens Log food, for the meal given or the clock's. */
  onOpenLog: (meal?: Meal) => void;
  onEditEntry: (entry: Entry) => void;
  onRepeatEntry: (entry: Entry) => void;
  onDeleteEntry: (id: string) => void;
  onPhotoEntry: (entry: Entry) => void;
  onConfirmDay: (on: boolean) => void;
  onSetEstimate: (kcal: number | null) => void;
  onUseLog: () => void;
  onRoughMeal: () => void;
  /** Logs a usual from the Now line straight away, with Undo. */
  onLogUsual: (entry: Entry, meal: Meal) => void;
  /** Meal prep with serves left, cooked by the day shown. */
  batches: Batch[];
  /** Logs one serve straight away, with Undo. */
  onLogBatch: (batch: Batch) => void;
  onOpenTarget: () => void;
  onOpenWeek: () => void;
  onOpenSettings: () => void;
}) {
  const { state } = props;
  useMinuteClock();
  const sky = useSky();
  const today = todayKey();
  const isToday = props.selectedDate === today;
  const isPast = props.selectedDate < today;
  const baseDayGoal = goalForDate(state, props.selectedDate);
  const bankAdjustment = weeklyBankAdjustmentForDate(state, props.selectedDate);
  const calorieTarget = resolveDayCalorieTarget(state, props.selectedDate);
  const goal = calorieTarget.effective || 1;
  const eaten = props.totals.calories;
  const remaining = goal - eaten;
  const overTarget = remaining < 0;
  const bulking = baseDayGoal.trackingMode === 'Bulking';
  const unit = energyLabel(state);
  const day = bankDay(state, props.selectedDate);
  const dayWord = isToday ? ' today' : '';
  let heroNumber = fmt(energyValue(state, Math.abs(remaining)));
  let heroUnit = overTarget ? `${unit} over${dayWord}` : bulking ? `${unit} to go${dayWord}` : `${unit} left${dayWord}`;
  // A finished day says how it ended, the way the week bank counts it.
  if (isPast) {
    if (day.status === 'untracked') {
      heroNumber = '—';
      heroUnit = 'Nothing logged';
    } else if (day.status === 'light') {
      heroNumber = fmt(energyValue(state, eaten));
      heroUnit = `${unit} logged · held at target`;
    } else {
      heroNumber = `${day.status === 'estimated' ? '≈' : ''}${fmt(energyValue(state, Math.abs(day.delta)))}`;
      heroUnit = `${unit} ${day.delta < 0 ? 'over' : 'under'}${day.status === 'estimated' ? ' · rough guess' : ''}`;
    }
  }
  const heroSize = heroNumber.length <= 3 ? 'size-3' : heroNumber.length <= 5 ? 'size-5' : 'size-6';
  // In the order eaten, by part of the day rather than the clock: breakfast logged at 1pm still sits in the morning.
  const parts = dayPartGroups(props.entries);
  const ordered = parts.flatMap(group => group.entries);
  const arc = sunArc(ordered.map(entry => entry.calories), goal);
  const glowId = useId();
  const coreId = useId();
  const afterglowId = useId();
  // A custom target plans this day; the week bank stays on the usual target, and the button says so.
  const bankTarget = fmt(energyValue(state, baseDayGoal.calories));
  const targetNote = calorieTarget.hasOverride ? ' · custom' : bankAdjustment !== 0 ? ' · with bank' : '';
  const settleRef = useSettleAnimation(props.selectedDate);
  const weekSwipe = useWeekSwipe(props.selectedDate, props.setSelectedDate);

  const weekStart = weekStartMonday(props.selectedDate);
  const week = weekBank(state, weekStart);
  const stripDays = week.days;

  const [macroView, setMacroView] = useState<MacroView>(storedMacroView);
  const toggleMacroView = () => {
    const next: MacroView = macroView === 'left' ? 'eaten' : 'left';
    setMacroView(next);
    try { localStorage.setItem(MACRO_VIEW_KEY, next); } catch { /* private mode */ }
  };

  const goalMacros = baseDayGoal;
  const proteinLeft = Math.round(goalMacros.protein - props.totals.protein);
  // Suggesting protein that would cost more than the energy left reads as "eat more" after the day is spent,
  // so it says "left" like carbs and fat instead of "to go".
  const proteinReachable = proteinLeft > 0 && proteinLeft * 4 <= Math.max(0, remaining);
  // A finished day shows what was eaten, not what's "left".
  const showEaten = macroView === 'eaten' || isPast;
  // Past the protein goal is good news, so it reads "goal met · +19g" rather than as an overrun.
  const proteinPast = !showEaten && proteinLeft < 0;
  const proteinBig = proteinPast ? `+${fmt(-proteinLeft)}g` : `${fmt(showEaten ? props.totals.protein : Math.abs(proteinLeft))}g`;
  const proteinTail = showEaten
    ? proteinLeft <= 0 ? '· goal met' : 'eaten'
    : proteinPast ? 'goal met ·' : proteinLeft === 0 ? '· goal met' : proteinReachable ? 'to go' : 'left';
  let proteinSoFar = 0;
  const proteinSegments = ordered.map((entry, index) => {
    const start = proteinSoFar / Math.max(1, goalMacros.protein) * 100;
    proteinSoFar += entry.protein;
    const end = Math.min(100, proteinSoFar / Math.max(1, goalMacros.protein) * 100);
    return { key: entry.id, left: start, width: Math.max(0, end - start), first: index === 0 };
  }).filter(segment => segment.width > 0.3 && segment.left < 100);
  const minorMacros: [string, number, number][] = [['Carbs', props.totals.carbs, goalMacros.carbs], ['Fat', props.totals.fat, goalMacros.fat]];

  // The week's balance and plan, from the same model as Week, so both screens show the same numbers.
  const weekModel = weekViewFor(state, week, today);
  const weekTitle = weekStart === weekStartMonday(today) ? 'This week' : `Week of ${shortDate(weekStart)}`;
  const checkNames = week.toCheck.map(checkDay => WEEKDAY_SHORT(checkDay.date));
  const weekNote = checkNames.length === 1 ? `${checkNames[0]} to check` : checkNames.length ? `${checkNames.length} days to check` : `${week.counted.length} of 7 counted`;

  // Usuals for the next meal still to log, while there's room for one.
  const nowMinutes = (() => { const now = new Date(); return now.getHours() * 60 + now.getMinutes(); })();
  const nextMeal = isToday && remaining >= 150 ? nextMealSlot(nowMinutes, props.entries.map(entry => entry.meal || 'Snack')) : null;
  const usuals = nextMeal ? usualsForMeal(state.entries, nextMeal, today, new Set(state.foods.map(food => food.id))) : [];

  let calSoFar = 0;
  const sections = parts.map(group => ({
    part: group.part,
    calories: group.entries.reduce((acc, entry) => acc + entry.calories, 0),
    rows: group.entries.map(entry => {
      const before = calSoFar;
      calSoFar += entry.calories;
      return { entry, before, after: calSoFar };
    })
  }));
  const lastEntryId = ordered[ordered.length - 1]?.id;
  // Nothing logged ever and no Gemini key: Today says how to start instead of a bare line.
  const firstRun = !state.entries.length && !state.settings.geminiApiKey.trim();

  return (
    <div className="tl-screen today-screen view-transition" ref={settleRef}>
      <div className="tl-sky" style={skyStyle(sky)}>
        <header className="tl-head">
          <h1 className="tl-title">{isToday ? 'Today' : weekStart === weekStartMonday(today) ? new Date(`${props.selectedDate}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long' }) : readable(props.selectedDate)}</h1>
          <div className="tl-tools">
            {!isToday && <button className="tl-glass tl-pill" type="button" onClick={() => props.setSelectedDate(today)}>Today</button>}
            <div className="tl-glass tl-toolbar">
              <label className="tl-tool" aria-label="Choose a day">
                <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="4" /><path d="M3.5 10h17M8 3v4M16 3v4" /></g></svg>
                <input type="date" value={props.selectedDate} onChange={event => { const value = event.target.value; if (value) props.setSelectedDate(value); event.currentTarget.blur(); }} />
              </label>
              <button className="tl-tool" type="button" aria-label="Settings" onClick={props.onOpenSettings}><Icon name="settings" size={22} /></button>
            </div>
          </div>
        </header>

        <nav ref={weekSwipe.ref} className="tl-strip" aria-label="Days this week. Swipe sideways for another week." style={{ touchAction: 'pan-y' }} {...weekSwipe.handlers}>
          {stripDays.map(stripDay => {
            const selected = stripDay.date === props.selectedDate;
            const dayGoal = Math.max(1, stripDay.goal.calories);
            const isTodayCell = stripDay.date === today;
            const counts = stripDay.intake != null;
            const fill = stripDay.status === 'today' ? stripDay.totals.calories / dayGoal : counts ? (stripDay.intake || 0) / dayGoal : 0;
            const mini = miniArc(fill);
            const overDay = (counts && (stripDay.intake || 0) > dayGoal) || (stripDay.status === 'today' && stripDay.totals.calories > dayGoal);
            const tone = stripDay.status === 'today' ? 'live' : stripDay.status === 'upcoming' ? 'upcoming' : stripDay.status === 'light' ? 'check' : counts ? 'counted' : 'none';
            const label = new Date(`${stripDay.date}T00:00:00`);
            return (
              <button
                key={stripDay.date}
                type="button"
                className={`tl-day ${selected ? 'selected' : ''} ${isTodayCell ? 'is-today' : ''} ${tone}`}
                aria-current={selected ? 'date' : undefined}
                aria-label={`${readable(stripDay.date)}${BANK_STATUS_TEXT[stripDay.status] ? `, ${BANK_STATUS_TEXT[stripDay.status]}` : ''}`}
                onClick={() => props.setSelectedDate(stripDay.date)}
              >
                <span className="tl-day-letter">{label.toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
                <span className="tl-day-date">{label.getDate()}</span>
                <svg className="tl-mini" width="50" height="20" viewBox="0 0 50 20" aria-hidden="true">
                  <path className="tl-mini-track" d="M18 17 A7 7 0 0 1 32 17" />
                  {mini.d && <path className="tl-mini-fill" d={mini.d} />}
                  {tone === 'check' && <circle className="tl-mini-ring" cx="25" cy="13" r="3" />}
                  {(tone === 'live' || overDay) && <circle className={`tl-mini-dot ${tone === 'live' ? 'live' : ''}`} cx={mini.end.x} cy={mini.end.y} r="2.5" />}
                </svg>
              </button>
            );
          })}
        </nav>

        <section className="tl-hero" aria-label={`${heroNumber} ${heroUnit}. ${fmt(energyValue(state, eaten))} eaten of ${fmt(energyValue(state, goal))}.`}>
          <svg className="tl-arc" viewBox="0 150 390 198" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
            <defs>
              <radialGradient id={glowId}><stop offset="0%" stopColor="#F7B547" stopOpacity="0.42" /><stop offset="50%" stopColor="#F7B547" stopOpacity="0.16" /><stop offset="100%" stopColor="#F7B547" stopOpacity="0" /></radialGradient>
              <radialGradient id={coreId} cx="40%" cy="35%"><stop offset="0%" stopColor="#FFF4D6" /><stop offset="55%" stopColor="#F7B547" /><stop offset="100%" stopColor="#EB8A2F" /></radialGradient>
              <radialGradient id={afterglowId}><stop offset="0%" stopColor="#9E7426" stopOpacity="0.45" /><stop offset="100%" stopColor="#9E7426" stopOpacity="0" /></radialGradient>
            </defs>
            {arc.remainder && <path className="tl-arc-rest" d={arc.remainder} />}
            {arc.segments.map((d, index) => <path key={index} className="tl-arc-lit" d={d} />)}
            {arc.over > 0 && <ellipse cx="353" cy="348" rx={30 + 50 * Math.min(arc.over, 600) / 600} ry={(30 + 50 * Math.min(arc.over, 600) / 600) * 0.45} fill={`url(#${afterglowId})`} />}
            <circle cx={arc.sun.x} cy={arc.sun.y} r="36" fill={`url(#${glowId})`} />
            <circle className="tl-sun" cx={arc.sun.x} cy={arc.sun.y} r="11" fill={`url(#${coreId})`} />
          </svg>
          <div className="tl-hero-text">
            <p className={`tl-hero-number ${heroSize}`}>{heroNumber}</p>
            <p className="tl-hero-unit">{heroUnit}</p>
          </div>
        </section>
      </div>

      <div className="tl-feet">
        <span>{fmt(energyValue(state, eaten))} eaten</span>
        <button type="button" onClick={props.onOpenTarget} disabled={isPast} aria-label={`Target ${energyText(state, goal)}${calorieTarget.hasOverride ? `, custom. The week bank uses ${energyText(state, baseDayGoal.calories)}` : ''}${isPast ? '' : '. Change this day’s target'}`}>
          Target {fmt(energyValue(state, goal))}{targetNote}
          {calorieTarget.hasOverride && <span className="tl-feet-bank"> (week bank uses {bankTarget})</span>}
        </button>
      </div>

      {/* Search and typing it in live in Log food (the sparkle), so the day's own log sits higher. First run says how to start. */}
      {firstRun && isToday && (
        <section className="tl-first-run" aria-label="Log your first meal">
          <p><strong>Log your first meal.</strong> Describe it or snap a photo and Gemini estimates it, or type the numbers in.</p>
          <button type="button" className="primary" onClick={() => props.onOpenLog()}>Log food</button>
        </section>
      )}

      {/* Meal prep on the go: one tap logs a serve, with Undo in the toast. */}
      {props.selectedDate <= today && props.batches.length > 0 && (
        <div className="tl-prep" role="group" aria-label="Meal prep">
          {props.batches.map(batch => {
            const left = batchServesLeft(batch, state.entries);
            const each = batchServe(batch);
            return (
              <button
                key={batch.id}
                type="button"
                className="tl-prep-row"
                onClick={() => props.onLogBatch(batch)}
                aria-label={`Log a serve of ${batch.name}, ${energyText(state, each.calories)}. ${fmtPortion(left)} of ${fmt(batch.servings)} serves left.`}
              >
                <span className="tl-manual-icon" aria-hidden="true"><Icon name="prep" size={20} /></span>
                <span className="tl-manual-text" aria-hidden="true">
                  <strong>{batch.name}</strong>
                  <span><ServePips left={left} servings={batch.servings} />{fmtPortion(left)} left · {fmt(energyValue(state, each.calories))} {unit} each</span>
                </span>
                <span className="tl-prep-add" aria-hidden="true"><Icon name="plus" size={18} /></span>
              </button>
            );
          })}
        </div>
      )}

      <button type="button" className="tl-week-row" onClick={props.onOpenWeek} aria-label={`${weekTitle}: ${weekModel.row.net}. ${weekNote}. ${weekModel.row.pace}. Opens Week.`}>
        <span className="tl-week-left">
          <strong>{weekTitle}</strong>
          <span className={checkNames.length ? 'has-check' : ''}>{checkNames.length > 0 && <i aria-hidden="true" />}{weekNote}</span>
        </span>
        <span className="tl-week-right">
          <strong>{weekModel.row.net}</strong>
          <span>{weekModel.row.pace}</span>
        </span>
        <Icon name="chevron" size={16} />
      </button>

      <button
        type="button"
        className="tl-macros"
        onClick={toggleMacroView}
        aria-label={`Protein ${fmt(props.totals.protein)} of ${fmt(goalMacros.protein)} grams. Carbs ${fmt(props.totals.carbs)} of ${fmt(goalMacros.carbs)}. Fat ${fmt(props.totals.fat)} of ${fmt(goalMacros.fat)}.${isPast ? '' : ` Tap to show ${macroView === 'left' ? 'eaten' : 'grams left'}.`}`}
      >
        <span className="tl-macro protein" aria-hidden="true">
          <span className="tl-macro-label"><b>Protein</b> of {fmt(goalMacros.protein)}g</span>
          <span className="tl-macro-value">{proteinPast ? <><span className="lead">{proteinTail}</span><strong>{proteinBig}</strong></> : <><strong>{proteinBig}</strong><span>{proteinTail}</span></>}</span>
          <span className="tl-macro-bar">{proteinSegments.map(segment => <i key={segment.key} style={{ left: `${segment.left}%`, width: `${segment.width}%` }} />)}</span>
        </span>
        {minorMacros.map(([name, value, target]) => {
          const left = Math.round(target - value);
          return (
            <span className="tl-macro" key={name} aria-hidden="true">
              <span className="tl-macro-label"><b>{name}</b> of {fmt(target)}g</span>
              <span className="tl-macro-value">
                {showEaten ? <><strong>{fmt(value)}g</strong><span>eaten</span></> : <><strong>{fmt(Math.abs(left))}g</strong><span>{left >= 0 ? 'left' : 'over'}</span></>}
              </span>
              <span className={`tl-macro-bar minor ${left < 0 ? 'over' : ''}`}><i style={{ width: `${Math.min(100, value / Math.max(1, target) * 100)}%` }} /></span>
            </span>
          );
        })}
      </button>

      <section className="tl-dayline" aria-label="Day line">
        {sections.map(section => (
          <div key={section.part} className="tl-part">
            <h2 className="tl-part-head">
              <PartSun part={section.part} dark={sky.dark} />
              <span className="tl-part-name">{DAY_PART_LABEL[section.part]}</span>
              <span className="tl-part-cal">{fmt(energyValue(state, section.calories))} {unit}</span>
            </h2>
            {section.rows.map(row => (
              <DayLineRow
                key={row.entry.id}
                state={state}
                entry={row.entry}
                before={row.before}
                after={row.after}
                target={goal}
                part={section.part}
                dark={sky.dark}
                toEnd={row.entry.id === lastEntryId && !usuals.length}
                onEdit={props.onEditEntry}
                onRepeat={props.onRepeatEntry}
                onDelete={props.onDeleteEntry}
                onPhoto={props.onPhotoEntry}
              />
            ))}
          </div>
        ))}
        {!ordered.length && !usuals.length && !(firstRun && isToday) && (
          <p className="tl-empty">{isToday ? <>Nothing logged yet. Tap <Icon name="sparkle" size={15} filled /> to log food.</> : isPast ? 'Nothing logged on this day.' : 'This day hasn’t started yet.'}</p>
        )}
        {usuals.length > 0 && nextMeal && (
          <div className="tl-now">
            <span className="tl-node now" aria-hidden="true" />
            <button type="button" className="tl-now-label" onClick={() => props.onOpenLog(nextMeal)} aria-label={`Log ${nextMeal.toLowerCase()}`}>Now</button>
            {/* One tap logs a usual, with Undo; Now opens Log food for anything else. */}
            <div className="tl-chips" role="group" aria-label={`${nextMeal} usuals`}>
              {usuals.map(usual => (
                <button key={usual.key} type="button" className="tl-chip" onClick={() => props.onLogUsual(usual.latest, nextMeal)} aria-label={`Log ${usual.name} for ${nextMeal.toLowerCase()}, ${energyText(state, usual.latest.calories)}`}>
                  <Icon name="plus" size={14} /><b>{usual.name}</b><span>{fmt(energyValue(state, usual.latest.calories))}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className={`tl-end ${isToday ? 'midnight' : ''}`}>
          <span className="tl-node end" aria-hidden="true" />
          <DayStatusCard
            key={props.selectedDate}
            state={state}
            day={day}
            quiet={isToday && nowMinutes < 17 * 60 && eaten < goal * 0.9}
            onConfirmDay={props.onConfirmDay}
            onSetEstimate={props.onSetEstimate}
            onUseLog={props.onUseLog}
            onRoughMeal={props.onRoughMeal}
          />
        </div>
      </section>
    </div>
  );
}

/** Where the sun sits over each part's heading: low in the east for morning, high for afternoon, low in the west for evening. */
const PART_SUN: Record<DayPart, { x: number; y: number }> = { morning: { x: 5.3, y: 10 }, afternoon: { x: 14, y: 5 }, evening: { x: 22.7, y: 10 } };

/** A part of the day's mark on the day line: the sun on its path, in that part's sky colour. */
function PartSun({ part, dark }: { part: DayPart; dark: boolean }) {
  const sun = PART_SUN[part];
  return (
    <span className="tl-part-sun" aria-hidden="true">
      <svg width="28" height="18" viewBox="0 0 28 18">
        <path className="tl-part-path" d="M4 15 A10 10 0 0 1 24 15" />
        <circle cx={sun.x} cy={sun.y} r="3.2" fill="#F7B547" stroke={skyFor(DAY_PART_BAND[part], dark).arc} strokeWidth="1.2" />
      </svg>
    </span>
  );
}

/** One entry on the day line: its own slice of the day's arc, what it was and its protein. Tap to edit; touch and hold (or right-click) for more. */
function DayLineRow({ state, entry, before, after, target, part, dark, toEnd, onEdit, onRepeat, onDelete, onPhoto }: {
  state: AppState;
  entry: Entry;
  before: number;
  after: number;
  target: number;
  part: DayPart;
  dark: boolean;
  toEnd: boolean;
  onEdit: (entry: Entry) => void;
  onRepeat: (entry: Entry) => void;
  onDelete: (id: string) => void;
  onPhoto: (entry: Entry) => void;
}) {
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  // A menu opened by a press can't be tapped until that press ends, so lifting the finger never picks an item.
  const [armed, setArmed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLButtonElement>(null);
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const slice = arcSlice(before, after, target);
  const arcColour = skyFor(DAY_PART_BAND[part], dark).arc;
  const rough = entry.estimateSource === 'rough';
  const portion = entryUnitModeValue(entry.unitMode) === '100g'
    ? `${fmtGram(entry.portion)}g`
    : entry.portion && entry.portion !== 1 ? `${fmtPortion(entry.portion)} servings` : '';
  const estimate = entry.estimateSource && !rough ? estimateSourceLabel(entry.estimateSource) : '';
  const openMenu = (x: number, y: number, fromPress: boolean) => {
    const width = 196;
    const height = 200;
    const below = y + 16;
    // Never over the finger: below the press point if it fits above the tab bar, otherwise above it.
    const top = below + height <= window.innerHeight - 100 ? below : Math.max(10, y - height - 16);
    setArmed(!fromPress);
    setMenu({ left: Math.min(window.innerWidth - width - 10, Math.max(10, x - width / 2)), top });
  };
  const closeMenu = (refocus: boolean) => {
    setMenu(null);
    if (refocus) rowRef.current?.focus();
  };
  useEffect(() => {
    if (!menu) return;
    const first = menuRef.current?.querySelector<HTMLButtonElement>('button');
    first?.focus({ preventScroll: true });
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { closeMenu(true); return; }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') || [])];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
      next?.focus();
      event.preventDefault();
    };
    const closeOnScroll = () => setMenu(null);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [menu]);
  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
  };
  const endPress = () => {
    cancelPress();
    if (press.current?.fired) window.setTimeout(() => setArmed(true), 0);
  };
  const act = (fn: () => void) => {
    if (!armed) return;
    setMenu(null);
    fn();
  };
  return (
    <>
      <button
        ref={rowRef}
        type="button"
        className={`tl-row ${toEnd ? 'to-end' : ''}`}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        aria-label={`${entry.name}, ${entry.meal || 'Snack'}, ${rough ? 'about ' : ''}${energyText(state, entry.calories)}, ${fmt(entry.protein)} grams protein. Touch and hold for more.`}
        onPointerDown={event => {
          const x = event.clientX;
          const y = event.clientY;
          cancelPress();
          press.current = { x, y, fired: false, timer: window.setTimeout(() => { if (press.current) press.current.fired = true; openMenu(x, y, true); }, 450) };
        }}
        onPointerMove={event => {
          if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10) cancelPress();
        }}
        onPointerUp={endPress}
        onPointerCancel={endPress}
        onPointerLeave={cancelPress}
        onContextMenu={event => {
          event.preventDefault();
          const box = event.currentTarget.getBoundingClientRect();
          // A keyboard's menu key reports 0, 0: open from the row instead.
          openMenu(event.clientX || box.left + box.width / 2, event.clientY || box.bottom - 8, false);
        }}
        onKeyDown={event => {
          if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
            event.preventDefault();
            const box = event.currentTarget.getBoundingClientRect();
            openMenu(box.left + box.width / 2, box.bottom - 8, false);
          }
        }}
        onClick={() => {
          if (press.current?.fired) { press.current = null; return; }
          onEdit(entry);
        }}
      >
        <span className="tl-glyph" aria-hidden="true">
          {entry.photo
            ? <img src={entry.photo} alt="" />
            : (
              <svg width="28" height="18" viewBox="0 0 28 18">
                <path className="tl-glyph-track" d="M4 15 A10 10 0 0 1 24 15" />
                {slice.d && <path d={slice.d} stroke={arcColour} className="tl-glyph-lit" />}
                {slice.over && <circle className="tl-glyph-over" cx="24" cy="15" r="2.2" />}
              </svg>
            )}
        </span>
        <span className="tl-row-main">
          <span className="tl-row-name">{entry.name}</span>
          <span className="tl-row-sub">
            {[entry.meal || 'Snack', portion, rough ? 'Rough guess' : estimate].filter(Boolean).join(' · ')}
            {!rough && <> · <b>{fmt(entry.protein)}g</b> protein</>}
          </span>
        </span>
        <span className="tl-row-cal">
          <span>{rough ? '≈' : ''}{fmt(energyValue(state, entry.calories))}</span>
          {/* The unit sits on the detail line under its number, so names keep their width. */}
          <small>{energyLabel(state)}</small>
        </span>
      </button>
      {menu && createPortal(
        <div ref={menuRef} className="entry-menu tl-menu" role="menu" aria-label={entry.name} style={{ ...menu, pointerEvents: armed ? 'auto' : 'none' }}>
          <button type="button" role="menuitem" onClick={() => act(() => onEdit(entry))}>Edit</button>
          <button type="button" role="menuitem" onClick={() => act(() => onRepeat(entry))}>Log again today</button>
          <button type="button" role="menuitem" onClick={() => act(() => onPhoto(entry))}>{entry.photo ? 'View photo' : 'Add photo'}</button>
          <button type="button" role="menuitem" className="danger-text" onClick={() => act(() => onDelete(entry.id))}>Delete</button>
        </div>,
        document.body
      )}
    </>
  );
}

const ROUGH_DAY_OPTIONS: { kcal: number; label: string }[] = [
  { kcal: 0, label: 'About on target' },
  { kcal: 500, label: 'A bit over' },
  { kcal: 1000, label: 'Big day' }
];

/** Where a day stands in the week bank, and the one or two things worth doing about it. Replaces the old swipe to complete. */
function DayStatusCard({ state, day, quiet = false, onConfirmDay, onSetEstimate, onUseLog, onRoughMeal }: {
  state: AppState;
  day: BankDay;
  /** Earlier in the day there's nothing to decide yet, so today shows a footnote instead of actions. */
  quiet?: boolean;
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
  } else if (day.status === 'today' && quiet) {
    title = 'Into your week at midnight';
    body = 'Whatever you log joins your week on its own at midnight.';
  } else if (day.status === 'today') {
    title = 'Into your week at midnight';
    body = eaten > 0
      ? 'Finished eating? Done for today counts it now.'
      : 'Whatever you log joins your week on its own at midnight.';
    actions = (
      <>
        {eaten > 0 && <button className="primary" type="button" onClick={() => (light ? setCheckingDone(true) : onConfirmDay(true))}>Done for today</button>}
        {roughMeal}
        {roughDay}
      </>
    );
  } else if (day.status === 'counted') {
    const short = mightBeMissingFood(day);
    tone = 'counted';
    title = isToday ? 'Done for today' : 'Counted';
    body = isToday
      ? `${result}, and it’s in your week bank.`
      : short ? `${result}. Missed something? Log it here, or add a rough meal.` : `${result}.`;
    actions = (
      <>
        {short && roughMeal}
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
