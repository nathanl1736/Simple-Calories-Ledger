// The Week view model (3.0): one place that turns the week bank into the numbers and words Week and Today show.
// Every number is converted to the reader's unit and rounded once here; screens print these and never round again.
// Pure apart from weekViewFor's default `today`, so tests load it straight into Node.
import type { AppState, DailyGoalSnapshot, EnergyUnit, TrackingMode } from './types';
import { fmt, SPREAD_FLOOR_SHARE, todayKey, type BankDay, type DayBankStatus, type WeekBank } from './utils';

const MINUS = '−';
const KJ_PER_KCAL = 4.184;

/**
 * How the week stands, for the goal:
 * - finished: the week is over (or its last day is counted)
 * - overForWeek: even the 80% floor can't bring it back, or the last day has run past the week's budget
 * - recoverable: behind by 100 Cal or more, and the days left can make it up
 * - ahead: 100 Cal or more in hand
 * - onPace: within 100 Cal
 * Bulking swaps ahead and recoverable (eating over is the aim); Maintaining is recoverable either side of ±100.
 */
export type WeekStatus = 'finished' | 'overForWeek' | 'recoverable' | 'ahead' | 'onPace';

export type WeekViewInput = {
  week: WeekBank;
  /** Today's date key; the week may be past, current or still to come. */
  today: string;
  mode: TrackingMode;
  unit: EnergyUnit;
};

export type DeltaCell = {
  text: string;
  /** Today in progress splits its cell so a long amount can wrap above its word. */
  amount?: string;
  word?: string;
  tone: '' | 'today' | 'over' | 'plan';
};

export type WeekViewDay = {
  date: string;
  status: DayBankStatus;
  /** Base target in display units. The bank always uses this, never a custom or spread target. */
  base: number;
  /** What was logged (display units), whether or not the day counts. */
  logged: number;
  /** What the bank counts as eaten (display units), or null while the day doesn't count. */
  eaten: number | null;
  /** base − eaten for a day that counts; null otherwise. */
  delta: number | null;
  /** The planned allowance for a day after today, when it differs from base by a rounding step or more. */
  plan: number | null;
  /** The same plan in kcal, for drawing the tile's plan line. */
  planKcal: number | null;
  cell: DeltaCell;
  /** Spoken after the day's name on its tile. */
  aria: string;
  /** The details sheet row. */
  table: { eaten: string; vs: string; balance: string };
};

export type Stat = { label: string; value: string; note?: string };

export type WeekView = {
  unitLabel: 'Cal' | 'kJ';
  mode: TrackingMode;
  started: boolean;
  /** Finished with nothing counted or held. */
  empty: boolean;
  finished: boolean;
  todayState: 'inProgress' | 'counted' | 'none';
  /** Σ of the per-day deltas for counted days before today. */
  bankedBefore: number;
  /** Today's delta: its counted delta, or base − eaten while in progress, or null when today isn't in this week. */
  todayDelta: number | null;
  /** While today is in progress, only what it is over by counts. */
  todayExtra: number;
  /** The balance that drives the next decision: bankedBefore plus today (its overage while in progress). */
  net: number;
  /** Dates after today in this week. */
  daysAfter: string[];
  baseAfter: number;
  even: number | null;
  floor: number | null;
  /** "about N": max(even, floor) to the nearest 10 Cal (50 kJ), the only rounding to a step. */
  allowance: number | null;
  /** round(net / days after), for the working "(1,450 − 163)". */
  perDayAdjust: number | null;
  /** How far over the week finishes when the days after eat the floor; 0 when the floor isn't binding. */
  overAtFloor: number;
  /** Budget less everything eaten, counting today's unspent target as still available. */
  leftInBudget: number;
  budget: number;
  status: WeekStatus;
  headline: { value: string; label: string };
  /** "Before today +567 · today −730", or null when there's nothing before today to show. */
  working: string | null;
  answer: string;
  /** Today's "This week" row, right column. */
  row: { net: string; pace: string };
  /** Week's two-column stats block. */
  stats: Stat[];
  /** The details sheet's stats under the table. */
  detailStats: Stat[];
  /** "target 1,450": the corner label on the tiles, and its number alone. */
  targetLabel: string;
  target: string;
  days: WeekViewDay[];
  /** One line for an AI prompt, e.g. "Week so far: net −163 Cal, 1 day left after today, plan about 1,290 Cal a day". */
  promptLine: string;
};

/** Math.round on the signed value, with −0 folded into 0. */
export function roundOnce(value: number) {
  const rounded = Math.round(value);
  return rounded === 0 ? 0 : rounded;
}

/** "+304", "−38" (a true minus), or "0". */
export function signedNumber(value: number) {
  if (value > 0) return `+${fmt(value)}`;
  if (value < 0) return `${MINUS}${fmt(-value)}`;
  return '0';
}

const weekday = (date: string, style: 'long' | 'short') => new Date(`${date}T00:00:00`).toLocaleDateString('en-AU', { weekday: style });

/** "Sun", "Sat & Sun", or "Thu–Sun". */
function daysShort(dates: string[]) {
  if (dates.length === 1) return weekday(dates[0], 'short');
  if (dates.length === 2) return `${weekday(dates[0], 'short')} & ${weekday(dates[1], 'short')}`;
  return `${weekday(dates[0], 'short')}–${weekday(dates[dates.length - 1], 'short')}`;
}

/** "Sunday", or the short form for two or more days. */
const daysWho = (dates: string[]) => (dates.length === 1 ? weekday(dates[0], 'long') : daysShort(dates));

/** The week's goal: the mode its counted days share, or Cutting when they differ. */
export function weekMode(week: WeekBank): TrackingMode {
  const first = (week.counted[0] || week.days[0]).goal.trackingMode;
  return week.counted.every(day => day.goal.trackingMode === first) ? first : 'Cutting';
}

/** Whether a counted day sat in its goal's band (cutting: at or under; maintaining: ±150; bulking: target to +300). */
function withinTarget(intake: number, goal: DailyGoalSnapshot) {
  const target = Math.max(goal.calories, 1);
  if (goal.trackingMode === 'Bulking') return intake >= target && intake <= target + 300;
  if (goal.trackingMode === 'Maintaining') return intake >= target - 150 && intake <= target + 150;
  return intake <= target;
}

export function weekView({ week, today, mode, unit }: WeekViewInput): WeekView {
  const factor = unit === 'kj' ? KJ_PER_KCAL : 1;
  const step = unit === 'kj' ? 50 : 10;
  const L = unit === 'kj' ? 'kJ' : 'Cal';
  const toUnit = (kcal: number) => roundOnce(kcal * factor);
  const toStep = (value: number) => roundOnce(Math.round(value / step) * step);
  const threshold = 100 * factor;

  const { days } = week;
  const base = days.map(day => toUnit(day.goal.calories));
  const eaten = days.map(day => (day.intake == null ? null : toUnit(day.intake)));
  const dayDelta = days.map((_, i) => {
    const value = eaten[i];
    return value == null ? null : base[i] - value;
  });
  const todayIndex = days.findIndex(day => day.date === today);
  const todayDay: BankDay | undefined = days[todayIndex];
  const todayState: WeekView['todayState'] = !todayDay ? 'none' : todayDay.status === 'today' ? 'inProgress' : todayDay.intake != null ? 'counted' : 'none';
  const todayEaten = todayDay ? toUnit(todayDay.totals.calories) : 0;

  const bankedBefore = dayDelta.reduce<number>((acc, delta, i) => acc + (delta != null && i !== todayIndex ? delta : 0), 0);
  const todayDelta = todayState === 'counted' ? dayDelta[todayIndex] : todayState === 'inProgress' ? base[todayIndex] - todayEaten : null;
  const todayExtra = todayState === 'inProgress' && todayDelta != null ? Math.max(0, -todayDelta) : 0;
  const net = roundOnce(bankedBefore + (todayState === 'counted' && todayDelta != null ? todayDelta : -todayExtra));

  const afterIndexes = days.map((day, i) => (day.date > today ? i : -1)).filter(i => i >= 0);
  const daysAfter = afterIndexes.map(i => days[i].date);
  const n = daysAfter.length;
  const baseAfter = afterIndexes.reduce((acc, i) => acc + base[i], 0);
  const even = n ? (baseAfter + net) / n : null;
  const floor = n ? SPREAD_FLOOR_SHARE * baseAfter / n : null;
  const allowance = even != null && floor != null ? toStep(Math.max(even, floor)) : null;
  const perDayAdjust = n ? roundOnce(net / n) : null;
  const overAtFloor = allowance != null && even != null && floor != null && even < floor ? Math.max(0, roundOnce((allowance - even) * n)) : 0;
  const leftInBudget = roundOnce(bankedBefore + (todayDelta ?? 0) + baseAfter);
  const budget = base.reduce((acc, value) => acc + value, 0);

  const started = days[0].date <= today;
  const finished = !week.remaining.length;
  const empty = started && finished && !week.counted.length && !week.toCheck.length;
  const lastDay = n === 0 && todayState === 'inProgress';
  // A floor overrun smaller than a rounding step reads as evened out, so nothing says "about 3 over".
  const overWeek = overAtFloor >= step || (lastDay && leftInBudget < 0);
  let status: WeekStatus;
  if (finished) status = 'finished';
  else if (mode === 'Bulking') status = overWeek || net <= -threshold ? 'ahead' : net >= threshold ? 'recoverable' : 'onPace';
  else if (overWeek) status = 'overForWeek';
  else if (mode === 'Maintaining') status = Math.abs(net) >= threshold ? 'recoverable' : 'onPace';
  else status = net <= -threshold ? 'recoverable' : net >= threshold ? 'ahead' : 'onPace';

  // The headline: the balance including today, worded for the goal.
  const firstBase = base[afterIndexes[0] ?? 0] ?? base[0];
  let headline: WeekView['headline'];
  let rowNet: string;
  if (!started) {
    headline = { value: fmt(Math.max(...base)), label: `${L} a day` };
    rowNet = `${fmt(budget)} budget`;
  } else if (mode === 'Bulking') {
    headline = net < 0 ? { value: `+${fmt(-net)}`, label: `${L} ahead` } : net > 0 ? { value: fmt(net), label: `${L} behind` } : { value: '0', label: `${L} from target` };
    rowNet = net < 0 ? `+${fmt(-net)} ahead` : net > 0 ? `${fmt(net)} behind` : '0 from target';
  } else if (mode === 'Maintaining') {
    const overWord = status === 'overForWeek' ? 'over this week' : 'over';
    headline = net > 0 ? { value: fmt(net), label: `${L} under` } : net < 0 ? { value: fmt(-net), label: `${L} ${overWord}` } : { value: '0', label: `${L} from target` };
    rowNet = net > 0 ? `${fmt(net)} under` : net < 0 ? `${fmt(-net)} ${overWord}` : '0 from target';
  } else if (net >= 0) {
    headline = { value: signedNumber(net), label: `${L} banked` };
    rowNet = `${signedNumber(net)} banked`;
  } else {
    const word = finished ? 'over' : status === 'overForWeek' ? 'over this week' : 'to even out';
    headline = { value: fmt(-net), label: `${L} ${word}` };
    rowNet = word === 'to even out' ? `${signedNumber(net)} to even out` : `${fmt(-net)} ${word}`;
  }

  // The working: what came before today, and what today adds.
  const estimatedToday = todayDay?.status === 'estimated' ? '≈' : '';
  const working = todayState !== 'none' && todayIndex > 0
    ? `Before today ${signedNumber(bankedBefore)} · today ${todayState === 'counted' && todayDelta != null
      ? `${estimatedToday}${signedNumber(todayDelta)}`
      : todayExtra > 0 ? signedNumber(-todayExtra) : 'still going'}`
    : null;

  // The answer: what the days after today can have, with the working in brackets.
  const baseEach = n ? roundOnce(baseAfter / n) : 0;
  const who = daysWho(daysAfter);
  const each = n > 1 ? ' each' : '';
  const sumWorking = perDayAdjust && allowance != null && allowance !== toStep(baseEach)
    ? ` (${fmt(baseEach)} ${perDayAdjust < 0 ? MINUS : '+'} ${fmt(Math.abs(perDayAdjust))}${each})`
    : '';
  const plan = allowance != null ? `${who} can${each} have about ${fmt(allowance)}${sumWorking}.` : '';
  let answer: string;
  if (!started) answer = `This week hasn’t started yet. Its budget is ${fmt(budget)} ${L}.`;
  else if (empty) answer = 'Nothing was logged this week.';
  else if (finished) answer = net > 0 ? `Finished ${fmt(net)} under target.` : net < 0 ? `Finished ${fmt(-net)} over target.` : 'Finished right on target.';
  else if (lastDay) {
    if (mode === 'Bulking') answer = leftInBudget >= 0 ? `Last day. ${fmt(leftInBudget)} to go to reach the week’s target.` : `Last day. The week is ${fmt(-leftInBudget)} over target.`;
    else if (leftInBudget >= 0) answer = `Last day. ${fmt(leftInBudget)} left after what’s logged.`;
    // Today's unspent target still counts, so a week behind before today can finish less over than the headline.
    else answer = `Last day. It finishes ${todayExtra > 0 ? '' : 'at least '}${fmt(-leftInBudget)} over and resets Monday.`;
  } else if (status === 'overForWeek') {
    answer = `Over for the week. Aim for about ${fmt(allowance ?? 0)} ${n === 1 ? `on ${who}` : 'a day'}; it finishes about ${fmt(overAtFloor)} over and resets Monday.`;
  } else if (mode === 'Bulking') {
    if (status === 'ahead' && overAtFloor >= step) answer = `A little ahead. ${who} can${each} have about ${fmt(allowance ?? 0)}, and the week still finishes about ${fmt(overAtFloor)} over target.`;
    else answer = `${status === 'ahead' ? 'A little ahead.' : status === 'recoverable' ? 'A little behind.' : 'On pace.'} ${plan}`;
  } else {
    const lead = status === 'ahead' ? 'A little ahead.' : status === 'recoverable' ? (mode === 'Maintaining' ? 'Easy to even out.' : 'Recoverable.') : 'On pace.';
    answer = `${lead} ${plan}`;
  }

  let rowPace: string;
  if (!started) rowPace = `${fmt(firstBase)} a day`;
  else if (finished) rowPace = 'Week finished';
  else if (allowance != null) rowPace = `${daysShort(daysAfter)} about ${fmt(allowance)}${each}`;
  else rowPace = leftInBudget >= 0 ? `${fmt(leftInBudget)} ${mode === 'Bulking' ? 'to go' : 'left'} this week` : 'Resets Monday';

  // Per day: the deltas row, the tile's plan line and words, and the details row.
  let balance = 0;
  const viewDays: WeekViewDay[] = days.map((day, i) => {
    const delta = dayDelta[i];
    // A day in progress has no delta yet; its row shows the headline's net instead.
    if (delta != null) balance += delta;
    const upcomingPlan = day.status === 'upcoming' && allowance != null ? allowance : null;
    const planShown = upcomingPlan != null && Math.abs(upcomingPlan - base[i]) >= step ? upcomingPlan : null;
    let cell: DeltaCell;
    let aria: string;
    let table: WeekViewDay['table'];
    const loggedValue = toUnit(day.totals.calories);
    const logged = fmt(loggedValue);
    if (day.status === 'today') {
      const over = todayExtra > 0;
      const amount = fmt(over ? todayExtra : Math.max(0, todayDelta ?? 0));
      const word = over ? 'over' : mode === 'Bulking' ? 'to go' : 'left';
      cell = { text: `${amount} ${word}`, amount, word, tone: over ? 'over' : 'today' };
      aria = `${logged} ${L} so far`;
      table = { eaten: `${logged} so far`, vs: over ? signedNumber(-todayExtra) : 'today', balance: signedNumber(net) };
    } else if (day.status === 'upcoming') {
      cell = { text: planShown != null ? `~${fmt(planShown)}` : '', tone: planShown != null ? 'plan' : '' };
      aria = upcomingPlan != null ? `coming up, plan about ${fmt(upcomingPlan)} ${L}` : 'coming up';
      table = { eaten: upcomingPlan != null ? `~${fmt(upcomingPlan)}` : '—', vs: upcomingPlan != null ? 'plan' : '—', balance: '—' };
    } else if (day.status === 'light') {
      cell = { text: 'Check', tone: '' };
      aria = 'looks light, check it';
      table = { eaten: `${logged} logged`, vs: 'held', balance: signedNumber(balance) };
    } else if (day.status === 'untracked') {
      cell = { text: '—', tone: '' };
      aria = 'nothing logged, counts as on target';
      table = { eaten: '—', vs: '—', balance: signedNumber(balance) };
    } else {
      const rough = day.status === 'estimated' ? '≈' : '';
      const value = delta ?? 0;
      cell = { text: `${rough}${signedNumber(value)}`, tone: '' };
      const side = value > 0 ? `${fmt(value)} ${L} under target` : value < 0 ? `${fmt(-value)} ${L} over target` : 'right on target';
      aria = `${rough ? 'rough guess, about ' : ''}${fmt(eaten[i] ?? 0)} ${L}, ${side}`;
      table = { eaten: `${rough}${fmt(eaten[i] ?? 0)}`, vs: signedNumber(value), balance: signedNumber(balance) };
    }
    return {
      date: day.date,
      status: day.status,
      base: base[i],
      logged: loggedValue,
      eaten: eaten[i],
      delta,
      plan: planShown,
      planKcal: planShown != null ? planShown / factor : null,
      cell,
      aria,
      table
    };
  });

  // Stats: the block on Week and the list in the details sheet.
  const counted = week.counted;
  // Rounded once from what was eaten, not from the per-day figures.
  const average = counted.length ? toUnit(counted.reduce((acc, day) => acc + (day.intake ?? 0), 0) / counted.length) : null;
  const logged = counted.filter(day => day.status === 'counted');
  const protein = logged.length
    ? `${fmt(logged.reduce((acc, day) => acc + day.totals.protein, 0) / logged.length)}g / ${fmt(logged.reduce((acc, day) => acc + day.goal.protein, 0) / logged.length)}g`
    : null;
  const within = counted.filter(day => day.intake != null && withinTarget(day.intake, day.goal)).length;
  const leftLabel = finished
    ? leftInBudget > 0 ? 'Under budget' : leftInBudget < 0 ? 'Over budget' : 'On budget'
    : leftInBudget >= 0 ? 'Left in budget' : 'Over budget';
  const leftNote = todayState === 'inProgress' ? ((todayDelta ?? 0) > 0 ? 'counting today’s unspent' : 'counting today so far') : undefined;
  const held = week.toCheck.length ? ` (${week.toCheck.length} held)` : '';
  const stats: Stat[] = [
    { label: 'Weekly budget', value: fmt(budget) },
    { label: leftLabel, value: fmt(Math.abs(leftInBudget)), note: leftNote },
    { label: 'Counted', value: `${counted.length} of 7` },
    { label: 'Average', value: average != null ? fmt(average) : '—' }
  ];
  if (protein) stats.push({ label: 'Protein', value: `${protein} avg` });
  const detailStats: Stat[] = [
    { label: 'Weekly budget', value: `${fmt(budget)} ${L}` },
    { label: leftLabel, value: `${fmt(Math.abs(leftInBudget))} ${L}`, note: leftNote },
    { label: 'Counted days', value: `${counted.length} of 7${held}` }
  ];
  if (average != null) {
    detailStats.push({ label: 'Average on counted days', value: `${fmt(average)} ${L}` });
    detailStats.push({ label: 'At or within target', value: `${within} of ${counted.length} counted days` });
  }
  if (protein) detailStats.push({ label: 'Average protein', value: protein });

  const promptLine = !started
    ? `Week not started: budget ${fmt(budget)} ${L}`
    : finished
      ? `Week finished: net ${signedNumber(net)} ${L}`
      : allowance != null
        ? `Week so far: net ${signedNumber(net)} ${L}, ${n} day${n === 1 ? '' : 's'} left after today, plan about ${fmt(allowance)} ${L} a day`
        : `Week so far: net ${signedNumber(net)} ${L}, last day of the week, ${signedNumber(leftInBudget)} ${L} left in the week’s budget`;

  return {
    unitLabel: L,
    mode,
    started,
    empty,
    finished,
    todayState,
    bankedBefore,
    todayDelta,
    todayExtra,
    net,
    daysAfter,
    baseAfter,
    even,
    floor,
    allowance,
    perDayAdjust,
    overAtFloor,
    leftInBudget,
    budget,
    status,
    headline,
    working,
    answer,
    row: { net: rowNet, pace: rowPace },
    stats,
    detailStats,
    targetLabel: `target ${fmt(Math.max(...base))}`,
    target: fmt(Math.max(...base)),
    days: viewDays,
    promptLine
  };
}

/** The view model for a week as the app shows it: the reader's unit, the week's goal, and today's date. */
export function weekViewFor(state: AppState, week: WeekBank, today = todayKey()) {
  return weekView({ week, today, mode: weekMode(week), unit: state.settings.energyUnit });
}
