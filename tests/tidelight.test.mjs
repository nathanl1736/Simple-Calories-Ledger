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
  // A saved food id that no longer exists groups by name instead.
  const linked = [...entries, e('2026-10-05', 'Salmon, rice & greens', 9, { sourceFoodId: 'gone' })];
  assert.equal(t.usualsForMeal(linked, 'Dinner', '2026-10-09')[0].count, 3);
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
  const points = t.tideBalance(WEEK);
  assert.deepEqual(points.map(p => [p.balance, p.held, p.counted]), [[160, false, true], [-320, false, true], [-320, true, false], [20, false, true]]);
});

test('a today counted early joins the tide line', () => {
  const done = WEEK.map(d => (d.date === '2026-10-09' ? day('2026-10-09', 'counted', 1190) : d));
  assert.equal(t.tideBalance(done).at(-1).balance, 630);
});

test('the plan uses the target Today shows: a custom target or a spread bank', () => {
  // A custom 1,500 today leaves more for the weekend.
  assert.equal(t.restOfWeekPlan(WEEK, 0, '2026-10-09', 1500).perDay, 1950);
  // 600 behind, spread so today shows 1,600: finishing today at 1,600 leaves 1,600 each.
  assert.equal(t.restOfWeekPlan(WEEK, -600, '2026-10-09', 1600).perDay, 1600);
});

test('parts of the day: morning until noon, afternoon until 5pm, then evening', () => {
  assert.equal(t.dayPartAt(0), 'morning');
  assert.equal(t.dayPartAt(11 * 60 + 59), 'morning');
  assert.equal(t.dayPartAt(12 * 60), 'afternoon');
  assert.equal(t.dayPartAt(16 * 60 + 59), 'afternoon');
  assert.equal(t.dayPartAt(17 * 60), 'evening');
  assert.equal(t.dayPartAt(23 * 60 + 30), 'evening');
});

test('meals place themselves; logging time never moves breakfast, lunch or dinner', () => {
  // All logged at 1:05pm on the day.
  const at = new Date(2026, 9, 10, 13, 5).getTime();
  const date = '2026-10-10';
  assert.equal(t.entryDayPart({ createdAt: at, date, meal: 'Breakfast' }), 'morning');
  assert.equal(t.entryDayPart({ createdAt: at, date, meal: 'Lunch' }), 'afternoon');
  assert.equal(t.entryDayPart({ createdAt: at, date, meal: 'Dinner' }), 'evening');
  // A stray part on a meal is ignored: the meal says when.
  assert.equal(t.entryDayPart({ createdAt: at, date, meal: 'Dinner', part: 'morning' }), 'evening');
});

test('a snack or drink goes where it was picked, or for older entries, when it was logged', () => {
  const date = '2026-10-10';
  const lunchtime = new Date(2026, 9, 10, 13, 5).getTime();
  assert.equal(t.entryDayPart({ createdAt: lunchtime, date, meal: 'Drink', part: 'morning' }), 'morning');
  assert.equal(t.entryDayPart({ createdAt: lunchtime, date, meal: 'Snack', part: 'evening' }), 'evening');
  // Saved before parts existed: the time it was logged, when that was on its own day.
  assert.equal(t.entryDayPart({ createdAt: new Date(2026, 9, 10, 20, 30).getTime(), date, meal: 'Snack' }), 'evening');
  // Added to its day afterwards: drinks in the morning, snacks in the afternoon.
  const nextDay = new Date(2026, 9, 11, 9, 0).getTime();
  assert.equal(t.entryDayPart({ createdAt: nextDay, date, meal: 'Drink' }), 'morning');
  assert.equal(t.entryDayPart({ createdAt: nextDay, date, meal: 'Snack' }), 'afternoon');
  assert.equal(t.entryDayPart({ createdAt: nextDay, date, meal: 'Snack', part: 'noon' }), 'afternoon');
});

test('a day logged in one go reads in the order eaten, grouped by part', () => {
  const date = '2026-10-10';
  const at = minute => new Date(2026, 9, 10, 13, minute).getTime();
  const entries = [
    { id: 'wrap', createdAt: at(7), date, meal: 'Lunch' },
    { id: 'weetbix', createdAt: at(5), date, meal: 'Breakfast' },
    { id: 'apple', createdAt: at(8), date, meal: 'Snack', part: 'afternoon' },
    { id: 'coffee', createdAt: at(6), date, meal: 'Drink', part: 'morning' },
    { id: 'tea', createdAt: at(9), date, meal: 'Drink', part: 'evening' }
  ];
  assert.deepEqual(t.inDayOrder(entries).map(entry => entry.id), ['weetbix', 'coffee', 'wrap', 'apple', 'tea']);
  assert.deepEqual(t.dayPartGroups(entries).map(group => [group.part, group.entries.map(entry => entry.id)]), [
    ['morning', ['weetbix', 'coffee']],
    ['afternoon', ['wrap', 'apple']],
    ['evening', ['tea']]
  ]);
  assert.deepEqual(t.dayPartGroups([]), []);
});
