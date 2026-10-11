// Motion (3.0): one small spring, no dependency. A value that follows a target the way a heavy,
// well-oiled thing would: it starts from wherever it is now, carries the speed it already has,
// and settles without bouncing. Pure maths first (so tests can load this file straight into
// Node), then the frame loop, then the React hooks the screens use.
import { useLayoutEffect, useRef, useState } from 'react';

export type SpringOptions = {
  /** Seconds one full swing of the undamped spring would take. Lower is snappier. Not a duration: the settle time follows from it. */
  response?: number;
  /** 1 is critically damped (no overshoot). Below 1 it overshoots and rings; above 1 it creeps in. */
  damping?: number;
  /** How close to the target, in the value's own units, counts as arrived. */
  precision?: number;
};

export const SPRING_RESPONSE = 0.45;
export const SPRING_DAMPING = 1;
export const SPRING_PRECISION = 0.05;

export type SpringState = { position: number; velocity: number };

/**
 * Advances a spring by `dt` seconds toward `target`. Closed form rather than stepping, so a long
 * frame (a tab coming back, a slow device) lands exactly where a hundred short ones would have.
 * `response` and `damping` are the two numbers Apple's springs are described by: the stiffness is
 * (2π / response)² and the damping ratio is `damping`.
 */
export function springStep(position: number, velocity: number, target: number, dt: number, options: SpringOptions = {}): SpringState {
  if (!(dt > 0)) return { position, velocity };
  const response = Math.max(0.01, options.response ?? SPRING_RESPONSE);
  const zeta = Math.max(0.05, options.damping ?? SPRING_DAMPING);
  const w = (2 * Math.PI) / response;
  const x0 = position - target;
  const v0 = velocity;
  let x: number;
  let v: number;
  if (Math.abs(zeta - 1) < 1e-4) {
    const e = Math.exp(-w * dt);
    const b = v0 + w * x0;
    x = (x0 + b * dt) * e;
    v = (v0 - w * b * dt) * e;
  } else if (zeta < 1) {
    const wd = w * Math.sqrt(1 - zeta * zeta);
    const e = Math.exp(-zeta * w * dt);
    const c = Math.cos(wd * dt);
    const s = Math.sin(wd * dt);
    x = e * (x0 * c + ((v0 + zeta * w * x0) / wd) * s);
    v = e * (v0 * c - ((zeta * w * v0 + w * w * x0) / wd) * s);
  } else {
    const root = Math.sqrt(zeta * zeta - 1);
    const r1 = -w * (zeta - root);
    const r2 = -w * (zeta + root);
    const c2 = (v0 - r1 * x0) / (r2 - r1);
    const c1 = x0 - c2;
    const e1 = Math.exp(r1 * dt);
    const e2 = Math.exp(r2 * dt);
    x = c1 * e1 + c2 * e2;
    v = c1 * r1 * e1 + c2 * r2 * e2;
  }
  return { position: target + x, velocity: v };
}

/** True once the spring is close enough, and slow enough, that no one could see it still moving. */
export function springAtRest(position: number, velocity: number, target: number, precision: number = SPRING_PRECISION) {
  return Math.abs(position - target) <= precision && Math.abs(velocity) <= precision * 8;
}

/* ------------------------------------------------------------------ reduced motion */

let reduced: boolean | null = null;

/** Springs snap and sheets cross-fade when the person asks for less motion. Read live, and kept up to date if they change it. */
export function prefersReducedMotion() {
  if (reduced !== null) return reduced;
  if (typeof matchMedia !== 'function') return false;
  const query = matchMedia('(prefers-reduced-motion: reduce)');
  reduced = query.matches;
  query.addEventListener?.('change', event => {
    reduced = event.matches;
    // Switching it on mid-flight: whatever is moving lands where it was going.
    if (reduced) [...running].forEach(motion => motion.finish());
  });
  return reduced;
}

/* ------------------------------------------------------------------ the frame loop */

const running = new Set<SpringMotion>();
let frameId = 0;
let lastFrame = 0;
let frameCount = 0;

function tick(now: number) {
  frameId = 0;
  frameCount += 1;
  // A frame that comes back after a long gap (hidden tab) moves things a little, not all the way.
  const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  [...running].forEach(motion => motion.advance(dt));
  if (running.size && !frameId) frameId = requestAnimationFrame(tick);
}

function begin(motion: SpringMotion) {
  running.add(motion);
  if (frameId) return;
  lastFrame = performance.now();
  frameId = requestAnimationFrame(tick);
}

/** For tests and for checking the loop stops: how many springs are moving, and how many frames the loop has run. */
export function motionStats() {
  return { running: running.size, frames: frameCount, scheduled: frameId !== 0 };
}

/**
 * Several springs that share one frame callback (the hero's sun, arc and number move together).
 * `retarget` starts from the current value *and* speed, so a new target in mid-flight bends the
 * motion instead of restarting it. Slots beyond the new targets spring to 0 and are dropped once there.
 */
export class SpringMotion {
  values: number[];
  private velocities: number[];
  private targets: number[];
  private length: number;
  private options: SpringOptions;
  private readonly onFrame: (values: readonly number[]) => void;

  constructor(initial: readonly number[], options: SpringOptions, onFrame: (values: readonly number[]) => void) {
    this.values = [...initial];
    this.velocities = initial.map(() => 0);
    this.targets = [...initial];
    this.length = initial.length;
    this.options = options;
    this.onFrame = onFrame;
  }

  get moving() {
    return running.has(this);
  }

  retarget(targets: readonly number[], options?: SpringOptions) {
    if (options) this.options = options;
    if (prefersReducedMotion()) return this.jumpTo(targets);
    this.length = targets.length;
    const size = Math.max(this.values.length, targets.length);
    while (this.values.length < size) {
      this.values.push(0);
      this.velocities.push(0);
    }
    this.targets = Array.from({ length: size }, (_, i) => targets[i] ?? 0);
    if (!this.atRest()) return begin(this);
    // Already there (a re-render with the same targets): nothing to draw unless it was a hair away or a slot is going.
    if (this.moving || this.values.length !== this.length || this.values.some((value, i) => value !== this.targets[i])) this.settle();
  }

  /** Lands at once, with no speed: for changes that aren't data moving (a toggle) and for reduced motion. */
  jumpTo(values: readonly number[]) {
    running.delete(this);
    this.length = values.length;
    this.values = [...values];
    this.velocities = values.map(() => 0);
    this.targets = [...values];
    this.onFrame(this.values);
  }

  /** Lands where it was going. */
  finish() {
    this.jumpTo(this.targets.slice(0, this.length));
  }

  stop() {
    running.delete(this);
  }

  advance(dt: number) {
    for (let i = 0; i < this.values.length; i += 1) {
      const next = springStep(this.values[i], this.velocities[i], this.targets[i], dt, this.options);
      this.values[i] = next.position;
      this.velocities[i] = next.velocity;
    }
    if (this.atRest()) this.settle();
    else this.onFrame(this.values);
  }

  private atRest() {
    const precision = this.options.precision ?? SPRING_PRECISION;
    return this.values.every((value, i) => springAtRest(value, this.velocities[i], this.targets[i], precision));
  }

  private settle() {
    running.delete(this);
    this.values = this.targets.slice(0, this.length);
    this.velocities = this.values.map(() => 0);
    this.targets = [...this.values];
    this.onFrame(this.values);
  }
}

/* ------------------------------------------------------------------ hooks */

/**
 * The live values of springs following `targets`. The component that calls this re-renders once a
 * frame while they move and not at all once they settle, so keep it to a small leaf (the hero's
 * arc, one number, one bar), never a whole screen. First render is already at the targets. Change
 * `snapKey` when a target changes for a reason that isn't data (a toggle) and it lands at once.
 * Under prefers-reduced-motion it always lands at once.
 */
export function useSpringValues(targets: readonly number[], options: SpringOptions & { snapKey?: string | number | boolean } = {}): number[] {
  const { snapKey, ...spring } = options;
  const [values, setValues] = useState<number[]>(() => [...targets]);
  const motion = useRef<SpringMotion | null>(null);
  const latest = useRef({ targets, spring });
  latest.current = { targets, spring };
  const lastSnapKey = useRef(snapKey);

  useLayoutEffect(() => {
    const created = new SpringMotion(latest.current.targets, latest.current.spring, next => setValues([...next]));
    motion.current = created;
    return () => {
      created.stop();
      motion.current = null;
    };
  }, []);

  const signature = targets.join(',');
  useLayoutEffect(() => {
    const current = motion.current;
    if (!current) return;
    if (lastSnapKey.current !== snapKey) {
      lastSnapKey.current = snapKey;
      current.jumpTo(latest.current.targets);
    } else {
      current.retarget(latest.current.targets, latest.current.spring);
    }
  }, [signature, snapKey]);

  return values;
}

/** One spring: the live value following `target`. Same rules as useSpringValues. */
export function useSpringValue(target: number, options: SpringOptions & { snapKey?: string | number | boolean } = {}): number {
  return useSpringValues([target], options)[0] ?? target;
}
