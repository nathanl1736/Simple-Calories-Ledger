// Motion (3.0): the spring that moves the hero, the numbers and the bars. npm test (Node 22.6+).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const m = await import('../src/motion.ts');

const FRAME = 1 / 60;

/** Runs the spring at 60 Hz and records every step. */
function run(position, velocity, target, seconds, options) {
  const steps = [{ t: 0, position, velocity }];
  for (let i = 1; i <= Math.round(seconds / FRAME); i += 1) {
    ({ position, velocity } = m.springStep(position, velocity, target, FRAME, options));
    steps.push({ t: i * FRAME, position, velocity });
  }
  return steps;
}

test('a spring converges on its target', () => {
  const steps = run(0, 0, 100, 3);
  assert.ok(Math.abs(steps.at(-1).position - 100) < 1e-3);
  assert.ok(Math.abs(steps.at(-1).velocity) < 1e-2);
});

test('critically damped never overshoots and only ever moves forward', () => {
  for (const [from, to] of [[0, 100], [100, 0], [-40, 250], [1234, 1200]]) {
    const steps = run(from, 0, to, 3, { response: 0.45, damping: 1 });
    const sign = Math.sign(to - from);
    steps.forEach((step, i) => {
      assert.ok((to - step.position) * sign >= -1e-9, `overshot ${from} to ${to} at ${step.t.toFixed(2)}s`);
      if (i) assert.ok((step.position - steps[i - 1].position) * sign >= -1e-9, 'went backwards');
    });
  }
});

test('a retarget in flight carries the speed it already had', () => {
  const before = run(0, 0, 100, 0.12, { response: 0.45 }).at(-1);
  assert.ok(before.velocity > 100, 'moving by now');
  // The new target is further on: it keeps going at the same speed and eases toward the new place.
  const next = m.springStep(before.position, before.velocity, 200, FRAME, { response: 0.45 });
  const restart = m.springStep(before.position, 0, 200, FRAME, { response: 0.45 });
  assert.ok(next.position - before.position > restart.position - before.position, 'a restart from rest would lose the speed');
  assert.ok(next.position - before.position >= before.velocity * FRAME * 0.8, 'about the same step as the frame before');
  // Turned right around: it can't stop dead. The position stays continuous and the speed bleeds off.
  const turned = run(before.position, before.velocity, 0, 1, { response: 0.45 });
  assert.ok(turned[1].position > before.position, 'carries on forward for a moment');
  assert.ok(Math.abs(turned[1].position - before.position) < 5, 'no jump');
  assert.ok(Math.abs(turned.at(-1).position) < 1, 'then comes back');
  const peak = Math.max(...turned.map(step => step.position));
  assert.ok(peak < 100 + 20, 'and does not fling past by much');
});

test('response 0.45 settles in about half a second', () => {
  const steps = run(0, 0, 1000, 3, { response: 0.45, damping: 1 });
  const within = (distance) => steps.find(step => Math.abs(1000 - step.position) <= distance).t;
  const visible = within(0.5); // a number rounds to its final value
  assert.ok(visible > 0.3 && visible < 1.0, `rounds to the final value at ${visible.toFixed(2)}s`);
  const resting = steps.find(step => m.springAtRest(step.position, step.velocity, 1000, 0.05)).t;
  assert.ok(resting > 0.4 && resting < 1.4, `at rest at ${resting.toFixed(2)}s`);
  // Snappier response, sooner.
  const quick = run(0, 0, 1000, 3, { response: 0.25 }).find(step => Math.abs(1000 - step.position) <= 0.5).t;
  assert.ok(quick < visible);
});

test('the closed form does not care how the time is sliced', () => {
  const whole = m.springStep(0, 0, 100, 0.5, { response: 0.45, damping: 1 });
  const sliced = run(0, 0, 100, 0.5, { response: 0.45, damping: 1 }).at(-1);
  assert.ok(Math.abs(whole.position - sliced.position) < 1e-6);
  assert.ok(Math.abs(whole.velocity - sliced.velocity) < 1e-6);
  for (const damping of [0.6, 1, 1.8]) {
    const a = m.springStep(10, 50, 0, 0.4, { response: 0.45, damping });
    let b = { position: 10, velocity: 50 };
    for (let i = 0; i < 40; i += 1) b = m.springStep(b.position, b.velocity, 0, 0.01, { response: 0.45, damping });
    assert.ok(Math.abs(a.position - b.position) < 1e-6, `damping ${damping}`);
  }
});

test('under 1 it bounces once or twice and settles; over 1 it creeps in without crossing', () => {
  const bouncy = run(0, 0, 100, 4, { response: 0.45, damping: 0.6 });
  assert.ok(Math.max(...bouncy.map(step => step.position)) > 100, 'overshoots');
  assert.ok(Math.abs(bouncy.at(-1).position - 100) < 1e-2, 'and settles');
  const slow = run(0, 0, 100, 4, { response: 0.45, damping: 2 });
  assert.ok(Math.max(...slow.map(step => step.position)) <= 100 + 1e-9, 'never crosses');
  assert.ok(Math.abs(slow.at(-1).position - 100) < 1e-2, 'and still arrives');
  assert.ok(slow.find(step => step.position >= 99).t > run(0, 0, 100, 4, { response: 0.45, damping: 1 }).find(step => step.position >= 99).t, 'later than critical');
});

test('a zero or negative dt changes nothing', () => {
  assert.deepEqual(m.springStep(3, 4, 10, 0), { position: 3, velocity: 4 });
  assert.deepEqual(m.springStep(3, 4, 10, -1), { position: 3, velocity: 4 });
});

test('at rest means close and slow', () => {
  assert.equal(m.springAtRest(100, 0, 100), true);
  assert.equal(m.springAtRest(100.02, 0.1, 100), true);
  assert.equal(m.springAtRest(100.2, 0, 100), false);
  assert.equal(m.springAtRest(100, 5, 100), false);
});

/* The frame loop, driven by hand: a fake requestAnimationFrame the test steps. */
function fakeFrames() {
  const queue = [];
  let id = 0;
  globalThis.requestAnimationFrame = callback => { queue.push([++id, callback]); return id; };
  globalThis.cancelAnimationFrame = () => {};
  let now = performance.now();
  return {
    pending: () => queue.length,
    step(frames = 1) {
      for (let i = 0; i < frames && queue.length; i += 1) {
        now += 1000 / 60;
        queue.splice(0).forEach(([, callback]) => callback(now));
      }
    },
    drain(limit = 600) {
      let n = 0;
      while (queue.length && n < limit) { this.step(); n += 1; }
      return n;
    }
  };
}

test('the loop runs while a spring moves, lands exactly, and then stops asking for frames', () => {
  const frames = fakeFrames();
  const seen = [];
  const motion = new m.SpringMotion([0, 10], { response: 0.45 }, values => seen.push([...values]));
  assert.equal(m.motionStats().running, 0);
  motion.retarget([100, 10]);
  assert.equal(m.motionStats().running, 1);
  assert.equal(frames.pending(), 1);
  const used = frames.drain();
  assert.ok(used > 20 && used < 90, `settled in ${used} frames`);
  assert.deepEqual(seen.at(-1), [100, 10], 'lands exactly on the targets');
  assert.ok(seen.slice(0, -1).every(values => values[0] < 100), 'never past it on the way');
  assert.equal(frames.pending(), 0, 'no frame requested once settled');
  assert.deepEqual(m.motionStats(), { running: 0, frames: m.motionStats().frames, scheduled: false });
  // Settled means silent: retargeting to where it already is draws nothing.
  const count = seen.length;
  motion.retarget([100, 10]);
  assert.equal(seen.length, count);
  assert.equal(frames.pending(), 0);
});

test('retargeting mid-flight starts from where it is, not from the last target', () => {
  const frames = fakeFrames();
  let last = [];
  const motion = new m.SpringMotion([0], { response: 0.45 }, values => { last = [...values]; });
  motion.retarget([100]);
  frames.step(8);
  const mid = last[0];
  assert.ok(mid > 5 && mid < 95, `mid-flight at ${mid.toFixed(1)}`);
  motion.retarget([50]);
  frames.step(1);
  assert.ok(Math.abs(last[0] - mid) < 12, 'no jump to either target');
  frames.drain();
  assert.deepEqual(last, [50]);
});

test('slots that go away spring to nothing and are dropped; new ones grow from nothing', () => {
  const frames = fakeFrames();
  let last = [];
  const motion = new m.SpringMotion([500, 300], {}, values => { last = [...values]; });
  motion.retarget([500]);
  frames.step(3);
  assert.equal(last.length, 2, 'still shrinking');
  assert.ok(last[1] > 0 && last[1] < 300);
  frames.drain();
  assert.deepEqual(last, [500]);
  motion.retarget([500, 200]);
  frames.step(1);
  assert.ok(last[1] > 0 && last[1] < 100, 'grows from nothing, not from the old slot');
  frames.drain();
  assert.deepEqual(last, [500, 200]);
});

test('jumpTo lands at once with no speed, and a jump stops the loop', () => {
  const frames = fakeFrames();
  let last = [];
  const motion = new m.SpringMotion([0], {}, values => { last = [...values]; });
  motion.retarget([100]);
  frames.step(3);
  motion.jumpTo([40]);
  assert.deepEqual(last, [40]);
  assert.equal(m.motionStats().running, 0);
  frames.drain();
  assert.deepEqual(last, [40]);
});

test('a long gap between frames moves it a little, not all the way', () => {
  const queue = [];
  globalThis.requestAnimationFrame = callback => { queue.push(callback); return queue.length; };
  let last = [];
  const motion = new m.SpringMotion([0], { response: 0.45 }, values => { last = [...values]; });
  motion.retarget([1000]);
  const start = performance.now();
  queue.splice(0).forEach(callback => callback(start + 60_000));
  assert.ok(last[0] > 0 && last[0] < 1000, `after a minute away: ${last[0].toFixed(0)}`);
  motion.stop();
});
