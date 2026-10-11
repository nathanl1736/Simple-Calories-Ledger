// The Week view model (3.0), run straight from src/weekView.ts: npm test (Node 22.6+).
import { register } from 'node:module';
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

register('./resolveTs.mjs', import.meta.url);
const u = await import('../src/utils.ts');
const wv = await import('../src/weekView.ts');

// Monday 5 to Sunday 11 October 2026: the owner's week.
const WEEK = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
const [MON, , WED, THU, FRI, SAT, SUN] = WEEK;
const LIMIT = 1450;
const MINUS = '−';

// The owner's Monday to Friday, to a tenth of a Cal (serving sizes make fractions): the old screen read
// "+568 Cal banked" and "1,288 Cal left this week" from these, while the deltas row read +304 −38 +238 −110 +173.
const OWNER = [1145.8, 1487.8, 1211.8, 1559.8, 1276.8];
const OWNER_SAT = LIMIT + 730;

/** eaten: kcal logged per day, Monday first (0 or missing = nothing logged). */
function state(eaten, { confirmed = [], estimates = {}, mode = 'Cutting', unit = 'kcal', overrides = {}, protein = 0 } = {}) {
  const s = {
    settings: { calories: LIMIT, protein: 150, carbs: 90, fat: 50, trackingMode: mode, spreadWeeklyBank: false, energyUnit: unit },
    entries: [],
    foods: [],
    completedDates: [...confirmed],
    dayEstimates: { ...estimates },
    dailyGoals: {},
    dayCalorieOverrides: { ...overrides },
    customFoodDatabases: []
  };
  WEEK.forEach((date, i) => {
    if (eaten[i] > 0) s.entries.push({ id: `e${i}`, date, name: 'Food', calories: eaten[i], protein, carbs: 0, fat: 0, portion: 1, unitMode: 'serving', createdAt: i });
  });
  return s;
}

const num = text => Number(text.replace(MINUS, '-').replace(/[^\d-]/g, ''));

/**
 * Every bracketed working in a sentence must add up to the figure just before it:
 * "about 1,287 (1,450 − 163)", "287 left after what’s logged (450 − 163)", "finishes 613 over (450 + 163)".
 * Returns how many brackets it checked.
 */
function assertWorkings(sentence) {
  let checked = 0;
  for (const match of sentence.matchAll(/\(([\d,]+) ([+\u2212]) ([\d,]+)( each)?\)/g)) {
    const before = sentence.slice(0, match.index).match(/([\d,]+)\D*$/);
    assert.ok(before, `no figure before the working in: ${sentence}`);
    const [a, b] = [num(match[1]), num(match[3])];
    assert.equal(num(before[1]), match[2] === '+' ? a + b : a - b, `working doesn't add up in: ${sentence}`);
    checked += 1;
  }
  return checked;
}

const NBSP = ' ';
/** The answer with its non-breaking spaces (which hold each working on one line) read as spaces. */
const view = (s, today) => {
  const v = wv.weekViewFor(s, u.weekBank(s, MON), today);
  const answer = v.answer.replaceAll(NBSP, ' ');
  assertWorkings(answer);
  return { ...v, answer, rawAnswer: v.answer };
};
const cells = v => v.days.map(day => day.cell.text);
/** Every string the Week screen and Today's week row print. */
const printed = v => [v.headline.value, v.headline.label, v.working || '', v.answer, v.row.net, v.row.pace, v.targetLabel,
  ...v.stats.flatMap(s => [s.label, s.value, s.note || '']), ...v.detailStats.flatMap(s => [s.label, s.value, s.note || '']),
  ...v.days.flatMap(day => [day.cell.text, day.aria, day.table.eaten, day.table.vs, day.table.balance])];
test("the owner's Saturday: today's 730 over is in the headline, and every number reconciles", () => {
  setToday(SAT);
  const v = view(state([...OWNER, OWNER_SAT], { protein: 123 }), SAT);
  assert.equal(v.bankedBefore, 567);
  assert.equal(v.todayDelta, -730);
  assert.equal(v.todayExtra, 730);
  assert.equal(v.net, -163);
  assert.deepEqual(v.daysAfter, [SUN]);
  assert.equal(v.even, 1287);
  assert.equal(v.floor, 1160);
  assert.equal(v.allowance, 1287);
  assert.equal(v.perDayAdjust, -163);
  assert.equal(v.overAtFloor, 0);
  assert.equal(v.leftInBudget, 1287);
  assert.equal(v.budget, 10150);
  assert.equal(v.status, 'recoverable');

  assert.deepEqual(v.headline, { value: '163', label: 'Cal to even out' });
  assert.equal(v.working, `Before today +567 · today ${MINUS}730`);
  assert.equal(v.answer, `Recoverable. Sunday can have about 1,287 (1,450 ${MINUS} 163).`);
  assert.equal(assertWorkings(v.answer), 1);
  assert.ok(v.rawAnswer.endsWith(`(1,450${NBSP}${MINUS}${NBSP}163).`), 'the working holds together on one line');
  assert.deepEqual(cells(v), ['+304', `${MINUS}38`, '+238', `${MINUS}110`, '+173', '730 over', '~1,287']);
  assert.equal(v.days[5].cell.tone, 'over');
  assert.equal(v.days[6].cell.tone, 'plan');
  assert.equal(v.days[6].plan, 1287);
  assert.equal(v.targetLabel, 'target 1,450');
  assert.deepEqual(v.row, { net: `${MINUS}163 to even out`, pace: 'Sun about 1,287' });
  assert.deepEqual(v.stats, [
    { label: 'Weekly budget', value: '10,150' },
    { label: 'Left in budget', value: '1,287', note: 'counting today so far' },
    { label: 'Counted', value: '5 of 7' },
    { label: 'Average', value: '1,336' },
    { label: 'Protein', value: '123g / 150g avg' }
  ]);
  assert.deepEqual(v.days.map(day => day.table.balance), ['+304', '+266', '+504', '+394', '+567', `${MINUS}163`, '—']);
  assert.deepEqual(v.days.map(day => day.table.eaten), ['1,146', '1,488', '1,212', '1,560', '1,277', '2,180 so far', '~1,287']);
  assert.equal(v.promptLine, `Week so far: net ${MINUS}163 Cal, 1 day left after today, plan about 1,287 Cal a day`);

  // Reconcile by eye: the deltas row adds up to "before today", before today and today make the headline,
  // and the base less the headline is Sunday's plan, which is also what's left in the budget: one value, one figure.
  const counted = v.days.slice(0, 5).map(day => num(day.cell.text));
  assert.equal(counted.reduce((a, b) => a + b, 0), v.bankedBefore);
  assert.equal(v.bankedBefore - v.todayExtra, v.net);
  assert.equal(LIMIT + v.perDayAdjust, v.allowance);
  assert.equal(v.allowance, v.leftInBudget);
  assert.equal(v.stats[1].value, '1,287');
  v.days.slice(0, 5).forEach(day => assert.equal(day.base - day.eaten, day.delta));
  // The pairs the owner saw are gone: one quantity, one rounding.
  const all = printed(v).join(' | ');
  for (const stale of ['568', '1,288', '1,290', 'Still on track', 'on pace']) assert.ok(!all.includes(stale), `"${stale}" should not be printed: ${all}`);
});

test('ahead with two days left: Sat & Sun share the bank, worked to the Cal', () => {
  setToday(FRI);
  // +304 −38 +238 +63 = +567, and Friday is under target and still going.
  const v = view(state([1146, 1488, 1212, 1387, 900]), FRI);
  assert.equal(v.net, 567);
  assert.equal(v.todayExtra, 0);
  assert.equal(v.status, 'ahead');
  assert.equal(v.allowance, 1734);
  assert.equal(v.perDayAdjust, 284);
  assert.deepEqual(v.headline, { value: '+567', label: 'Cal banked' });
  assert.equal(v.working, 'Before today +567 · today still going');
  assert.equal(v.answer, 'A little ahead. Sat & Sun can each have about 1,734 (1,450 + 284 each).');
  assert.equal(assertWorkings(v.answer), 1);
  assert.ok(v.rawAnswer.endsWith(`(1,450${NBSP}+${NBSP}284${NBSP}each).`));
  assert.deepEqual(cells(v).slice(4), ['550 left', '~1,734', '~1,734']);
  assert.equal(v.days[4].cell.tone, 'today');
  assert.deepEqual(v.row, { net: '+567 banked', pace: 'Sat & Sun about 1,734 each' });
  assert.equal(v.leftInBudget, 567 + 550 + 2 * LIMIT);
  assert.equal(v.stats[1].note, 'counting today’s unspent');
});

test('on pace: within 100 either side, no plan line unless the plan moves', () => {
  setToday(SAT);
  let v = view(state([1450, 1450, 1450, 1450, 1410, 1000]), SAT);
  assert.equal(v.net, 40);
  assert.equal(v.status, 'onPace');
  assert.equal(v.answer, 'On pace. Sunday can have about 1,490 (1,450 + 40).');
  assert.equal(v.days[6].cell.text, '~1,490');

  v = view(state([1447, 1450, 1450, 1450, 1450, 1000]), SAT);
  assert.equal(v.net, 3);
  assert.equal(v.answer, 'On pace. Sunday can have about 1,453 (1,450 + 3).');
  // Under 10 Cal from target, no plan line or ~ cell.
  assert.equal(v.days[6].cell.text, '');
  assert.equal(v.days[6].plan, null);
  assert.deepEqual(v.headline, { value: '+3', label: 'Cal banked' });
});

test('over for the week: the 80% floor binds and the answer says where it finishes', () => {
  setToday(SAT);
  // −100 −100 0 0 0 = −200 before today, then 730 over.
  let v = view(state([1550, 1550, 1450, 1450, 1450, OWNER_SAT]), SAT);
  assert.equal(v.net, -930);
  assert.equal(v.even, 520);
  assert.equal(v.allowance, 1160);
  assert.equal(v.overAtFloor, 640);
  assert.equal(v.status, 'overForWeek');
  assert.deepEqual(v.headline, { value: '930', label: 'Cal over this week' });
  assert.equal(v.answer, 'Over for the week. Aim for about 1,160 on Sunday; it finishes about 640 over and resets Monday.');
  assert.equal(v.days[6].cell.text, '~1,160');
  assert.deepEqual(v.row, { net: '930 over this week', pace: 'Sun about 1,160' });
  // The finish is the headline less what eating the floor saves: 930 − (1,450 − 1,160).
  assert.equal(-v.net - (LIMIT - v.allowance), v.overAtFloor);

  setToday(FRI);
  // −1,200 before Friday, Friday 450 over, two days after: (1,160 − 625) × 2.
  v = view(state([1550, 1550, 2450, 1450, 1900]), FRI);
  assert.equal(v.status, 'overForWeek');
  assert.equal(v.answer, 'Over for the week. Aim for about 1,160 a day; it finishes about 1,070 over and resets Monday.');
});

test('the last day: what is left for the week, to the Cal', () => {
  setToday(SUN);
  // Saturday is now counted at 730 over; Sunday is in progress.
  let v = view(state([...OWNER, OWNER_SAT, 1000]), SUN);
  assert.equal(v.bankedBefore, -163);
  assert.equal(v.net, -163);
  assert.equal(v.allowance, null);
  assert.equal(v.leftInBudget, 287);
  assert.equal(v.status, 'recoverable');
  assert.equal(v.working, `Before today ${MINUS}163 · today still going`);
  assert.equal(v.answer, `Last day. 287 left after what’s logged (450 ${MINUS} 163).`);
  assert.equal(assertWorkings(v.answer), 1);
  assert.deepEqual(v.row, { net: `${MINUS}163 to even out`, pace: '287 left this week' });
  assert.equal(v.stats[1].value, '287');

  // Sunday runs 450 over: the week is 613 over, the same figure in every place.
  v = view(state([...OWNER, OWNER_SAT, 1900]), SUN);
  assert.equal(v.net, -613);
  assert.equal(v.leftInBudget, -613);
  assert.equal(v.status, 'overForWeek');
  assert.deepEqual(v.headline, { value: '613', label: 'Cal over this week' });
  assert.equal(v.answer, 'Last day. It finishes 613 over (450 + 163) and resets Monday.');
  assert.equal(assertWorkings(v.answer), 1);
  assert.deepEqual(v.row, { net: '613 over this week', pace: 'Resets Monday' });
  assert.deepEqual(v.stats[1], { label: 'Over budget', value: '613', note: 'counting today so far' });

  // Behind before today and under target today: today's unspent still counts, so the finish is a floor.
  v = view(state([1550, 1550, 1550, 1550, 1550, 1450, 1200]), SUN);
  assert.equal(v.net, -500);
  assert.equal(v.leftInBudget, -250);
  assert.equal(v.status, 'overForWeek');
  assert.equal(v.answer, `Last day. It finishes at least 250 over (500 ${MINUS} 250) and resets Monday.`);
  assert.equal(assertWorkings(v.answer), 1);

  // Ahead before today and over today: the bank covers it.
  v = view(state([...OWNER, 1450, 1550]), SUN);
  assert.equal(v.answer, `Last day. 467 left after what’s logged (567 ${MINUS} 100).`);
});

test('a finished week says how it ended, with the same number as its headline', () => {
  setToday('2026-10-12');
  const v = view(state([...OWNER, OWNER_SAT, 1130]), '2026-10-12');
  assert.equal(v.finished, true);
  assert.equal(v.status, 'finished');
  assert.equal(v.net, 567 - 730 + 320);
  assert.deepEqual(v.headline, { value: '+157', label: 'Cal banked' });
  assert.equal(v.answer, 'Finished 157 under target.');
  assert.equal(v.working, null);
  assert.deepEqual(v.row, { net: '+157 banked', pace: 'Week finished' });
  assert.deepEqual(v.stats[1], { label: 'Under budget', value: '157', note: undefined });
  assert.equal(v.days[6].table.balance, '+157');

  const over = view(state([...OWNER, OWNER_SAT, 1600]), '2026-10-12');
  assert.deepEqual(over.headline, { value: '313', label: 'Cal over' });
  assert.equal(over.answer, 'Finished 313 over target.');
  assert.equal(view(state([1450, 1450, 1450, 1450, 1450, 1450, 1450]), '2026-10-12').answer, 'Finished right on target.');
  assert.equal(view(state([]), '2026-10-12').answer, 'Nothing was logged this week.');
});

test('Done for today counts all of today straight away', () => {
  setToday(SAT);
  const v = view(state([...OWNER, OWNER_SAT], { confirmed: [SAT] }), SAT);
  assert.equal(v.todayState, 'counted');
  assert.equal(v.todayDelta, -730);
  assert.equal(v.todayExtra, 0);
  assert.equal(v.net, -163);
  assert.equal(v.working, `Before today +567 · today ${MINUS}730`);
  assert.equal(v.days[5].cell.text, `${MINUS}730`);
  assert.equal(v.answer, `Recoverable. Sunday can have about 1,287 (1,450 ${MINUS} 163).`);
  assert.equal(v.stats[1].note, undefined);

  // A counted day under target lifts the bank by all of it.
  const under = view(state([...OWNER, 1330], { confirmed: [SAT] }), SAT);
  assert.equal(under.net, 687);
  assert.equal(under.working, 'Before today +567 · today +120');
});

test('today under target and still going: only an overage counts before midnight', () => {
  setToday(SAT);
  const v = view(state([...OWNER, 1000]), SAT);
  assert.equal(v.todayDelta, 450);
  assert.equal(v.todayExtra, 0);
  assert.equal(v.net, 567);
  assert.equal(v.status, 'ahead');
  assert.equal(v.working, 'Before today +567 · today still going');
  assert.equal(v.answer, 'A little ahead. Sunday can have about 2,017 (1,450 + 567).');
  assert.equal(v.days[5].cell.text, '450 left');
  assert.equal(v.leftInBudget, 567 + 450 + LIMIT);
});

test("a custom target for today doesn't move the bank: it stays on the base goal", () => {
  setToday(SAT);
  const plain = view(state([...OWNER, 2000]), SAT);
  const custom = view(state([...OWNER, 2000], { overrides: { [SAT]: 2400 } }), SAT);
  assert.equal(custom.net, plain.net);
  assert.equal(custom.net, 567 - 550);
  assert.equal(custom.days[5].cell.text, '550 over');
});

test('bulking: eating over is ahead, under is behind', () => {
  setToday(SAT);
  let v = view(state([...OWNER, OWNER_SAT], { mode: 'Bulking' }), SAT);
  assert.equal(v.status, 'ahead');
  assert.deepEqual(v.headline, { value: '+163', label: 'Cal ahead' });
  assert.equal(v.answer, `A little ahead. Sunday can have about 1,287 (1,450 ${MINUS} 163).`);
  assert.equal(v.row.net, '+163 ahead');

  v = view(state([...OWNER, 1000], { mode: 'Bulking' }), SAT);
  assert.equal(v.status, 'recoverable');
  assert.deepEqual(v.headline, { value: '567', label: 'Cal behind' });
  assert.equal(v.answer, 'A little behind. Sunday can have about 2,017 (1,450 + 567).');
  assert.equal(v.days[5].cell.text, '450 to go');

  // Far ahead, the floor still holds and the answer says the week finishes over target.
  v = view(state([1550, 1550, 1450, 1450, 1450, OWNER_SAT], { mode: 'Bulking' }), SAT);
  assert.equal(v.status, 'ahead');
  assert.equal(v.answer, 'A little ahead. Sunday can have about 1,160, and the week still finishes about 640 over target.');
});

test('maintaining: 100 either side needs evening out', () => {
  setToday(SAT);
  let v = view(state([...OWNER, OWNER_SAT], { mode: 'Maintaining' }), SAT);
  assert.equal(v.status, 'recoverable');
  assert.deepEqual(v.headline, { value: '163', label: 'Cal over' });
  assert.equal(v.answer, `Easy to even out. Sunday can have about 1,287 (1,450 ${MINUS} 163).`);
  v = view(state([...OWNER, 1000], { mode: 'Maintaining' }), SAT);
  assert.equal(v.status, 'recoverable');
  assert.deepEqual(v.headline, { value: '567', label: 'Cal under' });
  assert.equal(v.answer, 'Easy to even out. Sunday can have about 2,017 (1,450 + 567).');
  v = view(state([1450, 1450, 1450, 1450, 1400, 1000], { mode: 'Maintaining' }), SAT);
  assert.equal(v.status, 'onPace');
});

test('kJ: converted before rounding, whole kJ throughout, and still adds up', () => {
  setToday(SAT);
  const v = view(state([...OWNER, OWNER_SAT], { unit: 'kj' }), SAT);
  assert.equal(v.unitLabel, 'kJ');
  assert.equal(v.days[0].base, 6067);
  assert.deepEqual(cells(v).slice(0, 5), ['+1,273', `${MINUS}158`, '+997', `${MINUS}459`, '+725']);
  assert.equal(v.bankedBefore, 2378);
  assert.equal(v.todayExtra, 3054);
  assert.equal(v.net, -676);
  assert.equal(v.status, 'recoverable');
  assert.equal(v.allowance, 5391);
  assert.deepEqual(v.headline, { value: '676', label: 'kJ to even out' });
  assert.equal(v.working, `Before today +2,378 · today ${MINUS}3,054`);
  assert.equal(v.answer, `Recoverable. Sunday can have about 5,391 (6,067 ${MINUS} 676).`);
  assert.equal(assertWorkings(v.answer), 1);
  assert.equal(v.bankedBefore - v.todayExtra, v.net);
  assert.equal(v.days[6].cell.text, '~5,391');
  assert.equal(v.leftInBudget, v.allowance);
  assert.equal(v.budget, 7 * 6067);
  assert.equal(v.detailStats[0].value, '42,469 kJ');
});

test('negative zero never prints as −0', () => {
  setToday(SAT);
  assert.ok(Object.is(wv.roundOnce(-0.3), 0));
  assert.equal(wv.signedNumber(wv.roundOnce(-0.4)), '0');
  // Each day a hair either side of target.
  const v = view(state([1450.4, 1449.6, 1450.3, 1449.8, 1450.2, 1450.4]), SAT);
  assert.ok(Object.is(v.net, 0));
  assert.ok(Object.is(v.bankedBefore, 0));
  assert.ok(Object.is(v.perDayAdjust, 0));
  assert.deepEqual(v.headline, { value: '0', label: 'Cal banked' });
  assert.deepEqual(cells(v).slice(0, 6), ['0', '0', '0', '0', '0', '0 left']);
  assert.equal(v.answer, 'On pace. Sunday can have about 1,450.');
  assert.ok(!printed(v).join(' ').includes(`${MINUS}0`));
  const kj = view(state([1450.04, 1449.96, 0, 0, 0, 1450.01], { unit: 'kj' }), SAT);
  assert.ok(!printed(kj).join(' ').includes(`${MINUS}0`));
});

test('a held light day counts as on target until checked', () => {
  setToday(SAT);
  // Wednesday logged 600 of 1,450, under 60%.
  const v = view(state([1146, 1488, 600, 1560, 1277, 1000]), SAT);
  assert.equal(v.days[2].status, 'light');
  assert.equal(v.days[2].cell.text, 'Check');
  assert.equal(v.days[2].delta, null);
  assert.equal(v.bankedBefore, 304 - 38 - 110 + 173);
  assert.deepEqual(v.days.slice(0, 4).map(day => day.table.balance), ['+304', '+266', '+266', '+156']);
  assert.equal(v.days[2].table.vs, 'held');
  assert.equal(v.days[2].table.eaten, '600 logged');
  assert.equal(v.stats[2].value, '4 of 7');
  assert.equal(v.detailStats[2].value, '4 of 7 (1 held)');

  // "That's everything" counts it as logged.
  const checked = view(state([1146, 1488, 600, 1560, 1277, 1000], { confirmed: [WED] }), SAT);
  assert.equal(checked.days[2].cell.text, '+850');
  assert.equal(checked.bankedBefore, v.bankedBefore + 850);
});

test('rough guesses show with ≈ and count as target plus the guess', () => {
  setToday(SAT);
  const v = view(state([...OWNER, 1000], { estimates: { [THU]: 500 } }), SAT);
  assert.equal(v.days[3].cell.text, `≈${MINUS}500`);
  assert.equal(v.days[3].table.eaten, '≈1,950');
  assert.equal(v.bankedBefore, 304 - 38 + 238 - 500 + 173);
});

test("a week that hasn't started shows its daily target and budget", () => {
  setToday('2026-10-04');
  const v = view(state([]), '2026-10-04');
  assert.equal(v.started, false);
  assert.deepEqual(v.headline, { value: '1,450', label: 'Cal a day' });
  assert.equal(v.answer, 'This week hasn’t started yet. Its budget is 10,150 Cal.');
  assert.deepEqual(v.row, { net: '10,150 budget', pace: '1,450 a day' });
});

test('Monday has nothing before today, so no working line', () => {
  setToday(MON);
  const v = view(state([2000]), MON);
  assert.equal(v.working, null);
  assert.equal(v.net, -550);
  assert.equal(v.answer, `Recoverable. Tue–Sun can each have about 1,358 (1,450 ${MINUS} 92 each).`);
  assert.equal(v.row.pace, 'Tue–Sun about 1,358 each');
});

test('the working check catches a bracket that does not add up', () => {
  assert.throws(() => assertWorkings('Sunday can have about 1,290 (1,450 \u2212 163).'));
  assert.equal(assertWorkings('On pace. Sunday can have about 1,450.'), 0);
});
