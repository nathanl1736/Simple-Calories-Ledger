// Week bank maths, run straight from src/utils.ts: npm test (Node 22.6+).
import { test } from 'node:test';
import assert from 'node:assert/strict';

// utils.ts reads the clock through `new Date()`, so pin "now" before it loads.
const RealDate = Date;
let now = 0;
class FixedDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
globalThis.Date = FixedDate;
const setToday = key => { now = new RealDate(`${key}T12:00:00`).getTime(); };

const u = await import('../src/utils.ts');

// Monday 28 September to Sunday 4 October 2026 (Melbourne's clocks go forward that Sunday).
const WEEK = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
const [MON, , WED, , , SAT, SUN] = WEEK;
const TARGET = 1800;

/** eaten: kcal logged per day, Monday first (0 = nothing logged). */
function week(eaten, { confirmed = [], estimates = {}, spread = false, mode = 'Cutting' } = {}) {
  let state = {
    settings: { calories: TARGET, protein: 150, carbs: 90, fat: 50, trackingMode: mode, spreadWeeklyBank: spread, energyUnit: 'kcal' },
    entries: [],
    foods: [],
    completedDates: [],
    dayEstimates: {},
    dailyGoals: {},
    dayCalorieOverrides: {},
    customFoodDatabases: []
  };
  WEEK.forEach((date, i) => {
    if (eaten[i] > 0) state.entries.push({ id: `e${i}`, date, name: 'Food', calories: eaten[i], protein: 0, carbs: 0, fat: 0, portion: 1, unitMode: 'serving', createdAt: i });
  });
  // Written straight in, like data saved by an older version.
  state.completedDates = [...confirmed];
  state.dayEstimates = { ...estimates };
  return state;
}

const bank = state => u.weekBank(state, MON);
const statuses = state => bank(state).days.map(day => day.status).join(' ');

test('a steady week banks every finished day without any swipes', () => {
  setToday(SUN);
  const result = bank(week([1600, 1600, 1600, 1600, 1600, 1600, 0]));
  assert.equal(result.banked, 1200);
  assert.equal(result.counted.length, 6);
  assert.equal(result.left, 3000);
  assert.equal(result.perDay, 3000);
  assert.deepEqual(result.remaining.map(day => day.date), [SUN]);
});

test('a day with nothing logged counts as on target and is not spendable later', () => {
  setToday(SAT);
  const state = week([1600, 1600, 0, 1600, 1600, 0, 0]);
  const result = bank(state);
  assert.equal(statuses(state), 'counted counted untracked counted counted today upcoming');
  assert.equal(result.banked, 800);
  // Was 6,200 before 2.6: Wednesday's 1,800 counted as still available.
  assert.equal(result.left, 3600 + 800);
  assert.equal(result.perDay, 2200);
});

test('an empty day swiped complete before 2.6 no longer banks its whole target', () => {
  setToday(SAT);
  const result = bank(week([1600, 1600, 0, 1600, 1600, 0, 0], { confirmed: [WED] }));
  assert.equal(result.days[2].status, 'untracked');
  assert.equal(result.banked, 800);
});

test('a light day waits for a check instead of banking the missing meal', () => {
  setToday(SAT);
  const state = week([1600, 1600, 900, 1600, 1600, 0, 0]);
  let result = bank(state);
  assert.equal(result.days[2].status, 'light');
  assert.deepEqual(result.toCheck.map(day => day.date), [WED]);
  assert.equal(result.banked, 800);

  // "That's everything" counts it as logged.
  result = bank(u.setDayComplete(state, WED, true));
  assert.equal(result.days[2].status, 'counted');
  assert.equal(result.banked, 800 + 900);
  assert.equal(result.toCheck.length, 0);
});

test('a light day stops being light once a rough dinner takes it past 60%', () => {
  setToday(SAT);
  const state = week([1600, 1600, 900, 1600, 1600, 0, 0]);
  state.entries.push({ id: 'rough', date: WED, name: 'Dinner (big)', calories: 1200, protein: 0, carbs: 0, fat: 0, portion: 1, unitMode: 'serving', estimateSource: 'rough', createdAt: 9 });
  const result = bank(state);
  assert.equal(result.days[2].status, 'counted');
  assert.equal(result.days[2].delta, TARGET - 2100);
});

test('the light threshold is 60% of target', () => {
  setToday(SAT);
  assert.equal(bank(week([0, 0, 1079, 0, 0, 0, 0])).days[2].status, 'light');
  assert.equal(bank(week([0, 0, 1080, 0, 0, 0, 0])).days[2].status, 'counted');
});

test('a rough guess for the day replaces the log in the bank', () => {
  setToday(SAT);
  const ateOut = bank(week([1600, 1600, 900, 1600, 1600, 0, 0], { estimates: { [WED]: 500 } }));
  assert.equal(ateOut.days[2].status, 'estimated');
  assert.equal(ateOut.days[2].intake, TARGET + 500);
  assert.equal(ateOut.banked, 800 - 500);

  const aboutRight = bank(week([1600, 1600, 0, 1600, 1600, 0, 0], { estimates: { [WED]: 0 } }));
  assert.equal(aboutRight.days[2].status, 'estimated');
  assert.equal(aboutRight.banked, 800);
  assert.equal(aboutRight.counted.length, 5);
});

test("today's food comes off what's left, before the day is counted", () => {
  setToday(SAT);
  const result = bank(week([1600, 1600, 1600, 1600, 1600, 1500, 0]));
  assert.equal(result.days[5].status, 'today');
  assert.equal(result.banked, 1000);
  assert.equal(result.eatenToday, 1500);
  // Was 4,600 before 2.6.
  assert.equal(result.left, 3100);
  // Saturday and Sunday can each total 2,300.
  assert.equal(result.perDay, 2300);
});

test('Done for today counts today straight away', () => {
  setToday(SAT);
  const state = u.setDayComplete(week([1600, 1600, 1600, 1600, 1600, 1500, 0]), SAT, true);
  const result = bank(state);
  assert.equal(result.days[5].status, 'counted');
  assert.equal(result.banked, 1300);
  assert.deepEqual(result.remaining.map(day => day.date), [SUN]);
  assert.equal(result.left, 3100);
});

test('an empty today stays in progress even if confirmed', () => {
  setToday(SAT);
  const state = u.setDayComplete(week([1600, 1600, 1600, 1600, 1600, 0, 0]), SAT, true);
  assert.equal(bank(state).days[5].status, 'today');
});

test('future days cannot be completed or given a rough guess', () => {
  setToday(SAT);
  const state = week([1600, 1600, 1600, 1600, 1600, 0, 0]);
  assert.equal(u.setDayComplete(state, SUN, true), state);
  assert.equal(u.setDayEstimate(state, SUN, 500), state);
  // A future day completed by an older version is still just upcoming.
  assert.equal(bank(week([1600, 1600, 1600, 1600, 1600, 0, 0], { confirmed: [SUN] })).days[6].status, 'upcoming');
});

test('spreading a saving shares it across the days left', () => {
  setToday(SAT);
  const state = week([1600, 1600, 1600, 1600, 1600, 0, 0], { spread: true });
  assert.equal(u.weeklyBankAdjustmentForDate(state, SAT), 500);
  assert.equal(u.weeklyBankAdjustmentForDate(state, SUN), 500);
  assert.equal(u.weeklyBankAdjustmentForDate(state, WED), 0);
  assert.equal(u.suggestedTrackDayCalories(state, SUN), 2300);
});

test('spreading an overrun never takes a day below 80% of target', () => {
  setToday(SUN);
  const state = week([1800, 1800, 3500, 1800, 2600, 2200, 0], { spread: true });
  const result = bank(state);
  assert.equal(result.banked, -2900);
  // Was 1 Cal before 2.6.
  assert.equal(u.suggestedTrackDayCalories(state, SUN), 1440);
  assert.equal(result.perDay, 1440);
  assert.equal(result.overAtFloor, 1440 - (TARGET - 2900));
});

test('spreading is off by default', () => {
  setToday(SAT);
  assert.equal(u.weeklyBankAdjustmentForDate(week([1600, 1600, 1600, 1600, 1600, 0, 0]), SUN), 0);
});

test('a past week has nothing left and keeps its result', () => {
  setToday('2026-10-07');
  const result = bank(week([1600, 1600, 0, 1600, 1600, 2000, 1900]));
  assert.equal(result.remaining.length, 0);
  assert.equal(result.banked, 200 * 4 - 200 - 100);
  assert.equal(result.left, result.banked);
});

test('a day target plans today and ahead but not finished days', () => {
  setToday(SAT);
  const state = week([1600, 1600, 1600, 1600, 1600, 0, 0]);
  state.dayCalorieOverrides = { [SAT]: 2500, [WED]: 2500 };
  assert.equal(u.resolveDayCalorieTarget(state, SAT).effective, 2500);
  assert.equal(u.resolveDayCalorieTarget(state, WED).effective, TARGET);
});

test('finished days keep the target they had when the goal changes', () => {
  setToday(SAT);
  let state = u.lockPastGoals(week([1600, 1600, 1600, 1600, 1600, 0, 0]));
  state = { ...state, settings: { ...state.settings, calories: 2000 } };
  const result = bank(state);
  assert.equal(result.days[0].goal.calories, TARGET);
  assert.equal(result.days[5].goal.calories, 2000);
  assert.equal(result.banked, 1000);
});
