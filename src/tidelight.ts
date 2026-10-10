// Tidelight (2.7): the sky that follows the clock, the sun arc that follows what's eaten,
// and the week maths the new Today and Week screens put into words. Pure functions only,
// so tests can load this file straight into Node.
import type { DayPart, Entry, Meal } from './types';

export type SkyBand = 'dawn' | 'day' | 'dusk' | 'night';

export type Sky = {
  band: SkyBand;
  dark: boolean;
  /** Top of the screen to the horizon. */
  stops: [string, string, string, string];
  /** Where stops 2 and 3 sit, as a share of the sky's height. */
  at: [number, number];
  /** Travelled arc, and the ring around the sun. */
  arc: string;
};

/** Fixed clock bands, so the sky never depends on location: 05:00 dawn, 10:00 day, 16:00 dusk, 20:00 night. */
export function skyBand(hour: number): SkyBand {
  if (hour >= 5 && hour < 10) return 'dawn';
  if (hour >= 10 && hour < 16) return 'day';
  if (hour >= 16 && hour < 20) return 'dusk';
  return 'night';
}

const SKIES: Record<SkyBand, Record<'light' | 'dark', Omit<Sky, 'band' | 'dark'>>> = {
  dawn: {
    light: { stops: ['#B7D6DD', '#D3E7E3', '#EFE4CD', '#F5D3B0'], at: [0.38, 0.72], arc: '#B4601F' },
    dark: { stops: ['#0A1D27', '#14303A', '#33393A', '#563F2E'], at: [0.38, 0.72], arc: '#F0A15C' }
  },
  day: {
    light: { stops: ['#8BC5D2', '#ADD7DD', '#D2E9E5', '#E7F1EE'], at: [0.4, 0.75], arc: '#94661A' },
    dark: { stops: ['#0B2836', '#113747', '#164450', '#1C4B53'], at: [0.4, 0.75], arc: '#F2C467' }
  },
  dusk: {
    light: { stops: ['#9BB6C3', '#D0CBBA', '#EBC79B', '#EFAE86'], at: [0.38, 0.7], arc: '#A04E1E' },
    dark: { stops: ['#0C202C', '#1D323D', '#463B33', '#62412F'], at: [0.38, 0.7], arc: '#EE8D55' }
  },
  night: {
    light: { stops: ['#C2CFDA', '#D3DDE2', '#E1E8E8', '#EAF0EE'], at: [0.4, 0.75], arc: '#5F7A8B' },
    dark: { stops: ['#06151C', '#0C2530', '#15333F', '#21404A'], at: [0.38, 0.72], arc: '#D8C48F' }
  }
};

/** The body follows the appearance setting; the sky only follows the clock. Each band has a light and a dark version. */
export function skyFor(band: SkyBand, dark: boolean): Sky {
  return { band, dark, ...SKIES[band][dark ? 'dark' : 'light'] };
}

/** The sky as a background, top of the screen to the horizon at the bottom of the box. */
export function skyBackground(sky: Sky) {
  const [a, b, c, d] = sky.stops;
  return `linear-gradient(180deg, ${a} 0%, ${b} ${Math.round(sky.at[0] * 100)}%, ${c} ${Math.round(sky.at[1] * 100)}%, ${d} 100%)`;
}

const r1 = (value: number) => Math.round(value * 10) / 10;

export type ArcGeometry = { cx: number; cy: number; r: number };

/** The hero arc on a 390-wide canvas: feet at (37, 348) and (353, 348), apex at y 190. */
export const HERO_ARC: ArcGeometry = { cx: 195, cy: 348, r: 158 };

function arcAngle(cal: number, target: number) {
  const t = Math.max(1, target);
  return Math.PI * (1 - Math.min(Math.max(cal, 0), t) / t);
}

function arcPoint(theta: number, g: ArcGeometry) {
  return { x: r1(g.cx + g.r * Math.cos(theta)), y: r1(g.cy - g.r * Math.sin(theta)) };
}

function arcPath(from: { x: number; y: number }, to: { x: number; y: number }, r: number) {
  return `M${from.x} ${from.y} A${r} ${r} 0 0 1 ${to.x} ${to.y}`;
}

export type SunArc = {
  /** One lit piece per entry, in the order eaten, with a small gap between them. */
  segments: string[];
  sun: { x: number; y: number };
  /** The dotted rest of the day, or null once the target is reached. */
  remainder: string | null;
  over: number;
  fraction: number;
};

/** The day as the sun's path: each entry lights its share of the arc, and the sun sits where eating has reached. */
export function sunArc(calories: number[], target: number, g: ArcGeometry = HERO_ARC, gapPx = 4): SunArc {
  const t = Math.max(1, target);
  const cals = calories.map(value => Math.max(0, value || 0));
  const total = cals.reduce((acc, value) => acc + value, 0);
  const gap = gapPx / g.r;
  const segments: string[] = [];
  let before = 0;
  cals.forEach((value, i) => {
    const from = before;
    const to = before + value;
    before = to;
    if (!value || from >= t) return;
    let start = arcAngle(from, t);
    let end = arcAngle(to, t);
    if (from > 0) start -= gap;
    const last = to >= t || cals.slice(i + 1).every(rest => rest <= 0);
    if (!last) end += gap;
    if (start - end < 0.004) return;
    segments.push(arcPath(arcPoint(start, g), arcPoint(end, g), g.r));
  });
  const sun = arcPoint(arcAngle(total, t), g);
  return {
    segments,
    sun,
    remainder: total < t ? arcPath(sun, arcPoint(0, g), g.r) : null,
    over: Math.max(0, total - t),
    fraction: Math.min(1, total / t)
  };
}

/** A row's own slice of the day's arc, drawn in a 28 × 18 glyph centred on (14, 15) with radius 10. */
export function arcSlice(before: number, after: number, target: number) {
  const g = { cx: 14, cy: 15, r: 10 };
  const start = arcAngle(before, target);
  const end = arcAngle(after, target);
  const d = start - end > 0.01 ? arcPath(arcPoint(start, g), arcPoint(end, g), g.r) : null;
  return { d, over: after > Math.max(1, target) };
}

/** The small arc under a date in the week strip, in a 50 × 20 box centred on (25, 17) with radius 7. */
export function miniArc(fraction: number) {
  const g = { cx: 25, cy: 17, r: 7 };
  const end = arcPoint(Math.PI * (1 - Math.max(0, Math.min(1, fraction))), g);
  return { d: fraction > 0.01 ? arcPath({ x: 18, y: 17 }, end, g.r) : null, end };
}

/** The next meal worth suggesting usuals for: breakfast until 10:30, lunch until 3pm, dinner until 9pm, skipping any already logged. */
export function nextMealSlot(minutes: number, logged: Meal[]): Meal | null {
  const slots: [Meal, number][] = [['Breakfast', 10 * 60 + 30], ['Lunch', 15 * 60], ['Dinner', 21 * 60]];
  const open = slots.filter(([, until]) => minutes < until).map(([meal]) => meal);
  return open.find(meal => !logged.includes(meal)) || null;
}

function shiftKey(key: string, days: number) {
  const date = new Date(`${key}T12:00:00`);
  date.setDate(date.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export type Usual = { key: string; name: string; count: number; latest: Entry };

/**
 * What you usually have for a meal: the entries logged most often for it over the past few weeks, most recent
 * breaking ties. Rough guesses and unnamed entries don't count. Entries group by saved food when that food still
 * exists, otherwise by name, so the same meal logged both ways is one usual.
 */
export function usualsForMeal(entries: Entry[], meal: Meal, today: string, savedFoodIds: Set<string> = new Set(), days = 28, limit = 3): Usual[] {
  const since = shiftKey(today, -days);
  const groups = new Map<string, Usual>();
  entries.forEach(entry => {
    if ((entry.meal || 'Snack') !== meal || entry.estimateSource === 'rough' || entry.autoNamed) return;
    if (!(entry.date >= since && entry.date < today)) return;
    const name = entry.name.trim();
    if (!name) return;
    const key = entry.sourceFoodId && savedFoodIds.has(entry.sourceFoodId) ? entry.sourceFoodId : name.toLowerCase();
    const current = groups.get(key);
    if (!current) groups.set(key, { key, name, count: 1, latest: entry });
    else {
      current.count += 1;
      if ((entry.createdAt || 0) > (current.latest.createdAt || 0)) current.latest = entry;
    }
  });
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || (b.latest.createdAt || 0) - (a.latest.createdAt || 0))
    .slice(0, limit);
}

/** The parts of a week day the plan and story need; BankDay from utils fits. */
export type PlanDay = {
  date: string;
  status: 'counted' | 'estimated' | 'light' | 'untracked' | 'today' | 'upcoming';
  goal: { calories: number };
  totals: { calories: number };
  intake: number | null;
  delta: number;
};

/** Mirrors SPREAD_FLOOR_SHARE in utils: a planned day never drops below this share of its target. */
export const PLAN_FLOOR_SHARE = 0.8;

/**
 * How much each day after today can have, treating today as using at least the target Today shows (its custom
 * target, or its share of a spread bank) until midnight. That keeps Today's "left today" and Week's pace telling
 * the same story. Null when today isn't in progress or nothing comes after it, so callers word the last day apart.
 */
export function restOfWeekPlan(days: PlanDay[], banked: number, today: string, todayTarget?: number) {
  const todayDay = days.find(day => day.date === today && day.status === 'today');
  const after = days.filter(day => day.date > today);
  if (!todayDay || !after.length) return null;
  const target = todayTarget ?? todayDay.goal.calories;
  const eaten = todayDay.totals.calories;
  const todayExtra = Math.max(0, eaten - target);
  const afterTarget = after.reduce((acc, day) => acc + day.goal.calories, 0);
  const even = (afterTarget + banked + todayDay.goal.calories - Math.max(eaten, target)) / after.length;
  const floor = afterTarget * PLAN_FLOOR_SHARE / after.length;
  const perDay = Math.max(even, floor);
  return { days: after, perDay, todayExtra, overAtFloor: (perDay - even) * after.length };
}

/** "Tuesday took the week to −320. Thursday brought it back.": the week's lowest dip, told only once a later day has made it up. */
export function weekStory(days: PlanDay[]) {
  let balance = 0;
  let low = 0;
  let lowDate = '';
  let backDate = '';
  days.forEach(day => {
    if (day.intake == null) return;
    balance += day.delta;
    if (balance < low) {
      low = balance;
      lowDate = day.date;
      backDate = '';
    } else if (lowDate && !backDate && balance >= 0) {
      backDate = day.date;
    }
  });
  return lowDate && backDate && low <= -100 ? { lowDate, low, backDate } : null;
}

/** The running balance at the end of each day that's finished or already counted, for the tide line. Held (light) days keep the line flat and are drawn dotted. */
export function tideBalance(days: PlanDay[]) {
  let balance = 0;
  const points: { date: string; balance: number; held: boolean; counted: boolean }[] = [];
  for (const day of days) {
    if (day.status === 'upcoming' || day.status === 'today') break;
    if (day.intake != null) balance += day.delta;
    points.push({ date: day.date, balance, held: day.status === 'light', counted: day.intake != null });
  }
  return points;
}

export const DAY_PARTS: DayPart[] = ['morning', 'afternoon', 'evening'];
export const DAY_PART_LABEL: Record<DayPart, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };
/** Each part's sky, for the colour of its arc: dawn light in the morning, day after noon, dusk in the evening. */
export const DAY_PART_BAND: Record<DayPart, SkyBand> = { morning: 'dawn', afternoon: 'day', evening: 'dusk' };

export function dayPartValue(value: unknown): DayPart | undefined {
  return DAY_PARTS.includes(value as DayPart) ? value as DayPart : undefined;
}

/** The part of the day a clock time falls in: morning until noon, afternoon until 5pm, then evening. */
export function dayPartAt(minutes: number): DayPart {
  if (minutes < 12 * 60) return 'morning';
  if (minutes < 17 * 60) return 'afternoon';
  return 'evening';
}

/** Breakfast, lunch and dinner say when they were eaten. Snacks and drinks don't, so they carry a part of their own. */
export function mealDayPart(meal: Meal | undefined): DayPart | null {
  if (meal === 'Breakfast') return 'morning';
  if (meal === 'Lunch') return 'afternoon';
  if (meal === 'Dinner') return 'evening';
  return null;
}

/**
 * Where an entry sits in its day: by its meal, or for a snack or drink, the part picked when logging it. A snack or
 * drink saved before parts existed goes by when it was logged, if that was on its own day, or else a typical part
 * (drinks in the morning, snacks in the afternoon).
 */
export function entryDayPart(entry: Pick<Entry, 'createdAt' | 'date' | 'meal' | 'part'>): DayPart {
  const fixed = mealDayPart(entry.meal);
  if (fixed) return fixed;
  const picked = dayPartValue(entry.part);
  if (picked) return picked;
  const at = new Date(entry.createdAt || 0);
  const pad = (value: number) => String(value).padStart(2, '0');
  const loggedOn = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  if (entry.createdAt && loggedOn === entry.date) return dayPartAt(at.getHours() * 60 + at.getMinutes());
  return entry.meal === 'Drink' ? 'morning' : 'afternoon';
}

/** A day's entries in the order eaten: morning, afternoon, then evening, and within each part the order they were logged. */
export function inDayOrder<T extends Pick<Entry, 'createdAt' | 'date' | 'meal' | 'part'>>(entries: T[]): T[] {
  return entries
    .map(entry => ({ entry, part: DAY_PARTS.indexOf(entryDayPart(entry)) }))
    .sort((a, b) => a.part - b.part || (a.entry.createdAt || 0) - (b.entry.createdAt || 0))
    .map(item => item.entry);
}

/** The day line's sections: each part that has something in it, in order. */
export function dayPartGroups<T extends Pick<Entry, 'createdAt' | 'date' | 'meal' | 'part'>>(entries: T[]) {
  const groups: { part: DayPart; entries: T[] }[] = [];
  inDayOrder(entries).forEach(entry => {
    const part = entryDayPart(entry);
    const last = groups[groups.length - 1];
    if (last?.part === part) last.entries.push(entry);
    else groups.push({ part, entries: [entry] });
  });
  return groups;
}
