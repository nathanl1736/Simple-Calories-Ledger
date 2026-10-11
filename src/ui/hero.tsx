// The moving parts of Today (3.0): the sun and its arc, the big number, the macro figures and bars.
// Each is a small leaf that owns its own springs, so when an entry is added, edited, deleted or undone
// only that leaf re-renders as it moves, never the whole screen. They start at their targets, so
// opening Today is still. Under prefers-reduced-motion they land at once.
import { useId } from 'react';
import { sunArc } from '../tidelight';
import { useSpringValue, useSpringValues } from '../motion';
import { fmt } from '../utils';

/**
 * The hero's arc. One spring per entry (by place in the day, so adding one grows a new piece, deleting
 * one shrinks it away, and changing the day morphs one day's pieces into the next) plus one for the
 * target. The sun, the lit pieces, the dotted rest and the afterglow are all worked out each frame from
 * those, so they can never disagree with one another.
 */
export function HeroArc({ calories, target }: { calories: number[]; target: number }) {
  const glowId = useId();
  const coreId = useId();
  const afterglowId = useId();
  const [shownTarget = target, ...shown] = useSpringValues([target, ...calories]);
  const arc = sunArc(shown, shownTarget);
  const glow = 30 + 50 * Math.min(arc.over, 600) / 600;
  return (
    <svg className="tl-arc" viewBox="0 150 390 198" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <defs>
        <radialGradient id={glowId}><stop offset="0%" stopColor="#F7B547" stopOpacity="0.42" /><stop offset="50%" stopColor="#F7B547" stopOpacity="0.16" /><stop offset="100%" stopColor="#F7B547" stopOpacity="0" /></radialGradient>
        <radialGradient id={coreId} cx="40%" cy="35%"><stop offset="0%" stopColor="#FFF4D6" /><stop offset="55%" stopColor="#F7B547" /><stop offset="100%" stopColor="#EB8A2F" /></radialGradient>
        <radialGradient id={afterglowId}><stop offset="0%" stopColor="#9E7426" stopOpacity="0.45" /><stop offset="100%" stopColor="#9E7426" stopOpacity="0" /></radialGradient>
      </defs>
      {arc.remainder && <path className="tl-arc-rest" d={arc.remainder} />}
      {arc.segments.map((d, index) => <path key={index} className="tl-arc-lit" d={d} />)}
      {/* Fades in over the first few Cal over, so the glow grows out of the sun rather than popping. */}
      {arc.over > 0 && <ellipse cx="353" cy="348" rx={glow} ry={glow * 0.45} opacity={Math.min(1, arc.over / 4)} fill={`url(#${afterglowId})`} />}
      <circle cx={arc.sun.x} cy={arc.sun.y} r="36" fill={`url(#${glowId})`} />
      <circle className="tl-sun" cx={arc.sun.x} cy={arc.sun.y} r="11" fill={`url(#${coreId})`} />
    </svg>
  );
}

/**
 * What the big number says. A number counts to its new value (rounded each frame; `unit` gets the live
 * value, so "left" turns into "over" at the moment it crosses zero) and text such as "—" just appears.
 */
export type HeroReading =
  | { kind: 'number'; value: number; prefix?: string; unit: string | ((shown: number) => string) }
  | { kind: 'text'; number: string; unit: string };

/**
 * The big number and its unit. What a screen reader gets is the final value, in a hidden line that
 * never changes mid-count (and in the hero's label); the counting text is hidden from it.
 */
export function HeroText({ reading, finalNumber, finalUnit }: { reading: HeroReading; finalNumber: string; finalUnit: string }) {
  const numeric = reading.kind === 'number';
  const [shown = 0] = useSpringValues([numeric ? reading.value : 0], { snapKey: reading.kind });
  const number = numeric ? `${reading.prefix ?? ''}${fmt(Math.abs(shown))}` : reading.number;
  const unit = typeof reading.unit === 'function' ? reading.unit(shown) : reading.unit;
  const size = number.length <= 3 ? 'size-3' : number.length <= 5 ? 'size-5' : 'size-6';
  return (
    <>
      <div className="tl-hero-text" aria-hidden="true">
        <p className={`tl-hero-number ${size}`}>{number}</p>
        <p className="tl-hero-unit">{unit}</p>
      </div>
      <p className="sr-only">{finalNumber} {finalUnit}</p>
    </>
  );
}

/** The words around a macro's figure: a lead before it ("goal met ·"), the figure, and a tail after it ("to go"). */
export type MacroReading = { lead?: string; big: string; tail?: string };

/**
 * A macro's figure, counting to its new value. `describe` turns the live number into its words, so
 * "to go" can become "goal met" at the moment it crosses. Changing `snapKey` (left ↔ eaten) lands at once.
 */
export function MacroValue({ value, snapKey, describe }: { value: number; snapKey: string; describe: (shown: number) => MacroReading }) {
  const shown = useSpringValue(value, { snapKey });
  const { lead, big, tail } = describe(shown);
  return (
    <span className="tl-macro-value">
      {lead && <span className="lead">{lead}</span>}
      <strong>{big}</strong>
      {tail && <span>{tail}</span>}
    </span>
  );
}

/** The protein bar: each entry's share of the goal, laid end to end, growing and shrinking as the entries do. */
export function ProteinBar({ grams, goal }: { grams: number[]; goal: number }) {
  const [shownGoal = goal, ...shown] = useSpringValues([Math.max(1, goal), ...grams]);
  let sofar = 0;
  const segments = shown.map((value, index) => {
    const start = sofar / Math.max(1, shownGoal) * 100;
    sofar += Math.max(0, value);
    const end = Math.min(100, sofar / Math.max(1, shownGoal) * 100);
    return { index, left: start, width: Math.max(0, end - start) };
  }).filter(segment => segment.width > 0.3 && segment.left < 100);
  return <span className="tl-macro-bar">{segments.map(segment => <i key={segment.index} style={{ left: `${segment.left}%`, width: `${segment.width}%` }} />)}</span>;
}

/** A carbs or fat bar, filling to its share of the target. */
export function MinorBar({ value, target, over }: { value: number; target: number; over: boolean }) {
  const share = useSpringValue(Math.min(100, value / Math.max(1, target) * 100));
  return <span className={`tl-macro-bar minor ${over ? 'over' : ''}`}><i style={{ width: `${Math.max(0, Math.min(100, share))}%` }} /></span>;
}
