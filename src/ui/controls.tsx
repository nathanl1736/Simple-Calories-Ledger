import { ReactNode, useState } from 'react';
import { fmt } from '../utils';
import { Icon } from './icons';

/** Heart for a saved food: outlined, or filled once it's a favourite. What a tap changes is up to the caller. */
export function FavouriteToggle({ on, onToggle, label = 'Favourite', size = 22 }: { on: boolean; onToggle: () => void; label?: string; size?: number }) {
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

type MacroChipKey = 'fat' | 'carbs' | 'protein';

export function MacroChips({ fat = 0, carbs = 0, protein = 0, show = ['fat', 'carbs', 'protein'] }: { fat?: number; carbs?: number; protein?: number; show?: MacroChipKey[] }) {
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

/**
 * Chip rows are one line that scrolls sideways; this keeps the chosen chip (`.active`) in view,
 * centred where it can be. Only the row scrolls, never the sheet around it.
 */
export function scrollChipIntoView(row: HTMLElement | null, smooth: boolean) {
  const active = row?.querySelector<HTMLElement>('.active');
  if (!row || !active || row.scrollWidth <= row.clientWidth) return;
  const rowBox = row.getBoundingClientRect();
  const chipBox = active.getBoundingClientRect();
  const left = row.scrollLeft + chipBox.left - rowBox.left - (row.clientWidth - chipBox.width) / 2;
  row.scrollTo({ left: Math.max(0, left), behavior: smooth ? 'smooth' : 'auto' });
}

export function Field({ label, children, full = false }: { label: string; children: ReactNode; full?: boolean }) {
  return <label className={full ? 'field full' : 'field'}><span>{label}</span>{children}</label>;
}

/** One pip per serve, filled while it's left, so a batch reads as portions going down. Long batches skip them. */
export function ServePips({ left, servings }: { left: number; servings: number }) {
  if (servings > 12) return null;
  const whole = Math.floor(left);
  return (
    <span className="prep-pips" aria-hidden="true">
      {Array.from({ length: servings }, (_, index) => <i key={index} className={index < whole ? 'left' : index === whole && left > whole ? 'half' : ''} />)}
    </span>
  );
}
