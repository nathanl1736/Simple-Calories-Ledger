import { ReactNode } from 'react';
import type { Meal } from '../types';
import { type Tab } from '../appTypes';

export type IconName = 'today' | 'week' | 'journal' | 'foods' | 'settings' | 'plus' | 'search' | 'sparkle' | 'menu' | 'chevron' | 'copy' | 'paste' | 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'drink' | 'edit' | 'heart' | 'recent' | 'database' | 'prep' | 'camera' | 'approx' | 'more';

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
  heart: <><path d="M12 19.5 5.5 13a4.6 4.6 0 0 1 6.5-6.5 4.6 4.6 0 0 1 6.5 6.5z" /></>,
  recent: <><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9" /><path d="M4.5 5.5V9H8" /><path d="M12 8.5V12l2.5 1.5" /></>,
  database: <><ellipse cx="12" cy="6" rx="7" ry="2.5" /><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6" /><path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" /></>,
  /** A meal prep container: lid, handle and two compartments. */
  prep: <><rect x="3.5" y="10" width="17" height="10" rx="2.5" /><path d="M2.5 10h19" /><path d="M9.5 7h5" /><path d="M10 10v10" /></>,
  camera: <><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.5-2h5.4l1.5 2h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" /><circle cx="12" cy="12.8" r="3.4" /></>,
  /** About equal: a rough size rather than a breakdown. */
  approx: <><path d="M5 9.5c2.3-2 4.7-2 7 0s4.7 2 7 0" /><path d="M5 15.5c2.3-2 4.7-2 7 0s4.7 2 7 0" /></>,
  more: <><circle cx="6" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="18" cy="12" r="1.2" fill="currentColor" /></>
};

export function Icon({ name, size = 22, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICON_PATHS[name]}
    </svg>
  );
}

const MEAL_ICON: Record<Meal, IconName> = { Breakfast: 'breakfast', Lunch: 'lunch', Dinner: 'dinner', Snack: 'snack', Drink: 'drink' };

/** Filled tab glyphs for the glass tab bar. */
export function TabGlyph({ tab }: { tab: Tab }) {
  if (tab === 'tracking') return <svg className="icon" width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16.5a6 6 0 0 1 12 0Z" fill="currentColor" /><path d="M2 17.5h20v2H2Z" fill="currentColor" /></svg>;
  if (tab === 'stats') return <svg className="icon" width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">{[[1.9, 10], [4.9, 14], [7.9, 8], [10.9, 12], [13.9, 9], [16.9, 6], [19.9, 6]].map(([x, h]) => <rect key={x} x={x} y={20 - h} width="2.2" height={h} rx="1.1" />)}</svg>;
  if (tab === 'journal') return <svg className="icon" width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h11a2 2 0 0 1 2 2v14a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2V4a1 1 0 0 1 1-1Z" fill="currentColor" /><path d="M8 3v17" fill="none" stroke="var(--tab-cut)" strokeWidth="1.6" /></svg>;
  return <svg className="icon" width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3v6a2 2 0 0 0 4 0V3M9 9v12" /><path d="M17 3c-2 2-2 7 0 9v9" /></g></svg>;
}
