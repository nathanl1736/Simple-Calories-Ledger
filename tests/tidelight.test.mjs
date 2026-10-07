// Tidelight helpers (2.7): sky bands, the sun arc, usuals and the week plan. npm test (Node 22.6+).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const t = await import('../src/tidelight.ts');

test('sky bands change at 5am, 10am, 4pm and 8pm', () => {
  assert.equal(t.skyBand(4.99), 'night');
  assert.equal(t.skyBand(5), 'dawn');
  assert.equal(t.skyBand(7.8), 'dawn');
  assert.equal(t.skyBand(10), 'day');
  assert.equal(t.skyBand(13.5), 'day');
  assert.equal(t.skyBand(16), 'dusk');
  assert.equal(t.skyBand(19.99), 'dusk');
  assert.equal(t.skyBand(20), 'night');
  assert.equal(t.skyBand(0), 'night');
});

test('each band has a light and a dark sky', () => {
  for (const band of ['dawn', 'day', 'dusk', 'night']) {
    const light = t.skyFor(band, false);
    const dark = t.skyFor(band, true);
    assert.equal(light.dark, false);
    assert.equal(dark.dark, true);
    assert.notEqual(light.stops[0], dark.stops[0]);
  }
  assert.equal(t.skyBackground(t.skyFor('day', false)), 'linear-gradient(180deg, #8BC5D2 0%, #ADD7DD 40%, #D2E9E5 75%, #E7F1EE 100%)');
});

test('the sun sits where eating has reached, one lit piece per entry', () => {
  const arc = t.sunArc([380, 120, 690], 1800);
  assert.equal(arc.segments.length, 3);
  assert.equal(arc.segments[0].startsWith('M37 348 A158 158 0 0 1'), true);
  // 1,190 of 1,800 is 61° from the right foot.
  assert.deepEqual(arc.sun, { x: 271.6, y: 209.8 });
  assert.ok(arc.remainder && arc.remainder.endsWith('353 348'));
  assert.equal(arc.over, 0);
});

test('going over sets the sun on the right horizon and drops the dotted remainder', () => {
  const arc = t.sunArc([380, 120, 690, 580, 180], 1800);
  assert.deepEqual(arc.sun, { x: 353, y: 348 });
  assert.equal(arc.remainder, null);
  assert.equal(arc.over, 150);
  assert.equal(arc.fraction, 1);
  // The snack that crossed the line still lights the last sliver; nothing is drawn past the target.
  assert.equal(arc.segments.length, 5);
});

test('an empty day is a sun on the left horizon and the whole arc still to go', () => {
  const arc = t.sunArc([], 1800);
  assert.deepEqual(arc.sun, { x: 37, y: 348 });
  assert.equal(arc.segments.length, 0);
  assert.ok(arc.remainder);
});

test('a row slice covers only its own share of the arc', () => {
  assert.ok(t.arcSlice(0, 380, 1800).d);
  assert.equal(t.arcSlice(1900, 2000, 1800).d, null);
  assert.equal(t.arcSlice(1770, 1950, 1800).over, true);
});

test('usual meals are suggested for the next meal not yet logged', () => {
  assert.equal(t.nextMealSlot(7 * 60 + 50, []), 'Breakfast');
  assert.equal(t.nextMealSlot(7 * 60 + 50, ['Breakfast']), 'Lunch');
  assert.equal(t.nextMealSlot(13 * 60 + 30, ['Breakfast', 'Lunch']), 'Dinner');
  assert.equal(t.nextMealSlot(19 * 60 + 15, ['Dinner']), null);
  assert.equal(t.nextMealSlot(22 * 60, []), null);
});

test('usuals rank by how often, then how recently, over the past four weeks', () => {
  const e = (date, name, createdAt, extra = {}) => ({ id: name + date, sourceFoodId: null, date, name, meal: 'Dinner', calories: 500, protein: 0, carbs: 0, fat: 0, createdAt, updatedAt: createdAt, ...extra });
  const entries = [
    e('2026-10-01', 'Salmon, rice & greens', 1),
    e('2026-10-08', 'Salmon, rice & greens', 5),
    e('2026-10-07', 'Chicken stir-fry', 4),
    e('2026-10-06', 'Lamb souvlaki', 6),
    e('2026-08-01', 'Old favourite', 0),
    e('2026-10-08', 'Dinner (big)', 7, { estimateSource: 'rough' }),
    e('2026-10-09', 'Today counts later', 8)
  ];
  const usuals = t.usualsForMeal(entries, 'Dinner', '2026-10-09');
  assert.deepEqual(usuals.map(u => u.name), ['Salmon, rice & greens', 'Lamb souvlaki', 'Chicken stir-fry']);
  assert.equal(usuals[0].count, 2);
  assert.equal(usuals[0].latest.createdAt, 5);
});

const goal = { calories: 1800 };
const day = (date, status, eaten, intake = status === 'counted' ? eaten : null) => ({ date, status, goal, totals: { calories: eaten }, intake, delta: intake == null ? 0 : 1800 - intake });
// Mon 5 to Sun 11 October 2026, at 1:30pm on Friday.
const WEEK = [
  day('2026-10-05', 'counted', 1640),
  day('2026-10-06', 'counted', 2280),
  day('2026-10-07', 'light', 920),
  day('2026-10-08', 'counted', 1460),
  day('2026-10-09', 'today', 1190),
  day('2026-10-10', 'upcoming', 0),
  day('2026-10-11', 'upcoming', 0)
];

test('the weekend plan treats today as using at least its target', () => {
  const plan = t.restOfWeekPlan(WEEK, 20, '2026-10-09');
  assert.equal(plan.days.length, 2);
  assert.equal(plan.perDay, 1810);
  assert.equal(plan.todayExtra, 0);
});

test('going over today comes off the days after it', () => {
  const night = WEEK.map(d => (d.date === '2026-10-09' ? day('2026-10-09', 'today', 1950) : d));
  const plan = t.restOfWeekPlan(night, 20, '2026-10-09');
  assert.equal(plan.todayExtra, 150);
  assert.equal(plan.perDay, 1735);
  assert.equal(plan.overAtFloor, 0);
});

test('the plan never asks a day to go below 80% of its target', () => {
  const plan = t.restOfWeekPlan(WEEK, -2000, '2026-10-09');
  assert.equal(plan.perDay, 1440);
  assert.ok(plan.overAtFloor > 0);
});

test('no plan when today is already counted or is the last day', () => {
  assert.equal(t.restOfWeekPlan(WEEK, 20, '2026-10-11'), null);
  const done = WEEK.map(d => (d.date === '2026-10-09' ? day('2026-10-09', 'counted', 1190) : d));
  assert.equal(t.restOfWeekPlan(done, 630, '2026-10-09'), null);
});

test('the story is told only once a later day makes up the dip', () => {
  assert.deepEqual(t.weekStory(WEEK), { lowDate: '2026-10-06', low: -320, backDate: '2026-10-08' });
  assert.equal(t.weekStory(WEEK.slice(0, 3)), null);
  assert.equal(t.weekStory([day('2026-10-05', 'counted', 1850), day('2026-10-06', 'counted', 1700)]), null);
});

test('the tide line follows finished days, holding flat on a light day', () => {
  const points = t.tideBalance(WEEK, '2026-10-09');
  assert.deepEqual(points.map(p => [p.balance, p.held]), [[160, false], [-320, false], [-320, true], [20, false]]);
});
