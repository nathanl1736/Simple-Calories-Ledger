import { type InputHTMLAttributes, ReactNode, useState } from 'react';
import { parseTypedNumber } from '../numberInput';
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

/**
 * A number field that keeps what was typed while it is being typed ("1." on its way to "1.5") and
 * hands the number it means to `onValue` as it changes, so saving without leaving the field still
 * saves what is on screen. When the field is left, or the number is changed from outside, it shows
 * `display(value)` again.
 */
export function NumberInput({ value, onValue, display = String, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & { value: number; onValue: (value: number) => void; display?: (value: number) => string }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text !== null && parseTypedNumber(text) === value ? text : display(value);
  return (
    <input
      inputMode="decimal"
      {...rest}
      value={shown}
      onChange={event => {
        setText(event.target.value);
        onValue(parseTypedNumber(event.target.value));
      }}
      onBlur={event => {
        setText(null);
        rest.onBlur?.(event);
      }}
    />
  );
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
