import { CSSProperties, useEffect, useId, useRef } from 'react';
import type { AppState, DailyGoalSnapshot, TrackingMode } from '../types';
import { restOfWeekPlan, tideBalance, weekStory } from '../tidelight';
import {
  addDays,
  energyLabel,
  energyText,
  energyValue,
  energyValueForUnit,
  fmt,
  LIGHT_DAY_SHARE,
  readable,
  resolveDayCalorieTarget,
  shortDate,
  todayKey,
  weekBank,
  weekStartMonday,
  type DayBankStatus,
  type WeekBank
} from '../utils';
import { Icon } from '../ui/icons';
import { useSettleAnimation } from '../ui/AppShell';
import { useSky, skyStyle } from '../ui/sky';

/** Energy with a true minus sign, so −480 reads as a number rather than a dash. */
function signedEnergyNumber(state: AppState, kcal: number) {
  return signedEnergyValue(state, kcal).replace('-', '−');
}

/** The banked number and its label, worded for the goal (cutting banks; maintaining and bulking aim for the target). */
export function bankHeadline(state: AppState, week: WeekBank) {
  const firstMode = (week.counted[0] || week.days[0]).goal.trackingMode;
  const mixed = !week.counted.every(day => day.goal.trackingMode === firstMode);
  const mode: TrackingMode = mixed ? 'Cutting' : firstMode;
  const unit = energyLabel(state);
  const soFar = week.remaining.length ? ' so far' : '';
  const amount = fmt(energyValue(state, Math.abs(week.banked)));
  if (mode === 'Cutting') {
    if (week.banked >= 0) return { value: signedEnergyNumber(state, week.banked), label: `${unit} banked`, mode };
    return { value: amount, label: `${unit} over${soFar}`, mode };
  }
  if (Math.abs(week.banked) < 1) return { value: '0', label: `${unit} from target`, mode };
  const side = week.banked > 0 ? 'under' : 'over';
  return { value: amount, label: `${unit} ${side}`, mode };
}

type CalorieDayStatus = 'open' | 'good' | 'under' | 'over';

function getCalorieBand(goal: DailyGoalSnapshot) {
  const target = Math.max(goal.calories, 1);
  if (goal.trackingMode === 'Bulking') return { lower: target, target, upper: target + 300 };
  if (goal.trackingMode === 'Maintaining') return { lower: target - 150, target, upper: target + 150 };
  return { lower: 0, target, upper: target };
}

function classifyCalorieDay(intake: number | null, goal: DailyGoalSnapshot): CalorieDayStatus {
  if (intake == null) return 'open';
  const band = getCalorieBand(goal);
  if (goal.trackingMode === 'Cutting') return intake <= band.target ? 'good' : 'over';
  if (intake < band.lower) return 'under';
  return intake <= band.upper ? 'good' : 'over';
}

export function signedEnergyText(state: AppState, kcal: number) {
  return `${kcal > 0 ? '+' : ''}${energyText(state, kcal)}`;
}

function signedEnergyValue(state: AppState, kcal: number) {
  const value = energyValueForUnit(kcal, state.settings.energyUnit);
  return `${value > 0 ? '+' : ''}${fmt(value)}`;
}

/** A planning number, rounded to the nearest 10 Cal (50 kJ) so it doesn't look more exact than it is. */
export function aboutEnergyText(state: AppState, kcal: number) {
  const step = state.settings.energyUnit === 'kj' ? 50 : 10;
  return `${fmt(Math.round(energyValue(state, kcal) / step) * step)} ${energyLabel(state)}`;
}

const weekdayName = (date: string, style: 'long' | 'short' = 'long') => new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: style });

/** The plain answer to "how much can I eat for the rest of the week?". */
function bankAnswer(state: AppState, week: WeekBank) {
  const { remaining, perDay, overAtFloor, banked } = week;
  if (!remaining.length) {
    if (banked > 0) return `Finished ${energyText(state, banked)} under target.`;
    if (banked < 0) return `Finished ${energyText(state, -banked)} over target.`;
    return 'Finished right on target.';
  }
  const amount = aboutEnergyText(state, perDay);
  const includesToday = remaining[0].date === todayKey();
  const single = remaining.length === 1;
  if (overAtFloor > 0 && showsRounded(state, overAtFloor)) {
    const when = single ? (includesToday ? 'today' : `on ${weekdayName(remaining[0].date)}`) : 'a day';
    return `Aim for about ${amount} ${when}. The week will still finish about ${aboutEnergyText(state, overAtFloor)} over, and the bank resets Monday.`;
  }
  if (single) return includesToday ? `Today can be about ${amount} in total.` : `${weekdayName(remaining[0].date)} can be about ${amount}.`;
  return `The ${remaining.length} days left${includesToday ? ', including today,' : ''} can average about ${amount} each.`;
}

export const BANK_STATUS_TEXT: Record<DayBankStatus, string> = {
  counted: '',
  estimated: 'rough guess',
  light: 'looks light, check it',
  untracked: 'nothing logged, counts as on target',
  today: 'today, still in progress',
  upcoming: 'coming up'
};

const WEEKDAY_LONG = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long' });

/** "Saturday and Sunday", "Sunday", or "The 4 days after today". */
function planDaysPhrase(days: { date: string }[]) {
  if (days.length === 1) return WEEKDAY_LONG(days[0].date);
  if (days.length === 2) return `${WEEKDAY_LONG(days[0].date)} and ${WEEKDAY_LONG(days[1].date)}`;
  return `The ${days.length} days after today`;
}

/** How the week is going, in a word or two, for the goal: banking under target is ahead when cutting but behind when bulking. */
function paceLead(mode: TrackingMode, banked: number) {
  if (mode === 'Bulking') return banked >= 100 ? 'A little behind.' : banked <= -100 ? 'A little ahead.' : 'Right on pace.';
  if (mode === 'Maintaining') return Math.abs(banked) >= 100 ? 'Easy to even out.' : 'Right on pace.';
  return banked >= 100 ? 'A little ahead.' : banked <= -100 ? 'Easy to even out.' : 'Right on pace.';
}

/** True when a planning amount would still show once rounded, so nothing says "about 0 Cal over". */
function showsRounded(state: AppState, kcal: number) {
  return Math.round(energyValue(state, kcal) / (state.settings.energyUnit === 'kj' ? 50 : 10)) >= 1;
}

/** The plain answer to "how much can I eat for the rest of the week?". Today is treated as using at least the target Today shows, so this agrees with Today's "left today". */
function weekAnswer(state: AppState, week: WeekBank) {
  const today = todayKey();
  if (week.remaining.length === 1 && week.remaining[0].date === today) {
    return week.left >= 0
      ? `Last day of the week: about ${aboutEnergyText(state, week.left)} left after what’s logged.`
      : `Last day of the week. It will finish about ${aboutEnergyText(state, -week.left)} over, and the bank resets Monday.`;
  }
  const plan = restOfWeekPlan(week.days, week.banked, today, resolveDayCalorieTarget(state, today).effective);
  if (!plan) return bankAnswer(state, week);
  const amount = aboutEnergyText(state, plan.perDay);
  const who = planDaysPhrase(plan.days);
  const each = plan.days.length > 1 ? ' each' : '';
  if (plan.overAtFloor > 0 && showsRounded(state, plan.overAtFloor)) return `Aim for about ${amount} a day. The week will still finish about ${aboutEnergyText(state, plan.overAtFloor)} over, and the bank resets Monday.`;
  if (plan.todayExtra > 0 && showsRounded(state, plan.todayExtra)) return `Still on track. Today’s extra ${energyText(state, plan.todayExtra)} comes off ${plan.days.length > 1 ? 'the days after' : who}: about ${amount}${each}.`;
  return `${paceLead(bankHeadline(state, week).mode, week.banked)} ${who} can${each} be about ${amount}.`;
}

/** "5–11 October", or "28 September – 4 October" across months, in the reader's locale. */
export function weekRange(start: string) {
  const from = new Date(`${start}T00:00:00`);
  const to = new Date(`${addDays(start, 6)}T00:00:00`);
  try {
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' }).formatRange(from, to);
  } catch {
    return `${shortDate(start)} – ${shortDate(addDays(start, 6))}`;
  }
}

/** Week: First Light's seven skies filled with Tide's water, under the same clock-following sky as Today. */
export function RichStatsView({ state, bankingWeekStart, setBankingWeekStart, onDetails, onOpenDay }: { state: AppState; bankingWeekStart: string; setBankingWeekStart: (start: string) => void; onDetails: () => void; onOpenDay: (date: string) => void }) {
  const prevBankingWeekRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevBankingWeekRef.current !== null && prevBankingWeekRef.current !== bankingWeekStart) {
      requestAnimationFrame(() => {
        try {
          window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        } catch {
          window.scrollTo(0, 0);
        }
      });
    }
    prevBankingWeekRef.current = bankingWeekStart;
  }, [bankingWeekStart]);

  const sky = useSky();
  const settleRef = useSettleAnimation(bankingWeekStart);
  const tideAbove = useId();
  const tideBelow = useId();
  const today = todayKey();
  const currentWeek = weekStartMonday(today);
  const isCurrent = bankingWeekStart === currentWeek;
  const week = weekBank(state, bankingWeekStart);
  const { days, counted, toCheck } = week;
  const started = days[0].date <= today;
  const finished = !week.remaining.length;
  const unit = energyLabel(state);
  const headline = bankHeadline(state, week);
  const range = weekRange(bankingWeekStart);
  const nothing = started && finished && !counted.length && !toCheck.length;
  const answer = !started
    ? `This week hasn’t started yet. Its budget is ${energyText(state, week.budget)}.`
    : nothing ? 'Nothing was logged this week.' : weekAnswer(state, week);
  const story = started ? weekStory(days) : null;
  const storyText = story ? `${WEEKDAY_LONG(story.lowDate)} took the week to ${signedEnergyNumber(state, story.low)}. ${WEEKDAY_LONG(story.backDate)} brought it back.` : '';

  // The running balance behind the bank, finished (or already counted) days only.
  const tide = tideBalance(days);
  const showTide = tide.filter(point => point.counted).length >= 2;
  const extreme = Math.max(400, ...tide.map(point => Math.ceil(Math.abs(point.balance) / 200) * 200));
  const tideY = (balance: number) => 24 - balance * 20 / extreme;
  const tideX = (index: number) => (index + 1) * 52 - 4;
  const tidePath = [`M0 24`, ...tide.map((point, index) => `L${tideX(index)} ${tideY(point.balance).toFixed(1)}`)].join(' ');
  const tideArea = `${tidePath} L${tide.length ? tideX(tide.length - 1) : 0} 24 Z`;
  const lastTide = tide[tide.length - 1];

  // Today shows the target Today shows (custom, or with a spread bank).
  const shown = days.map(day => (day.status === 'today' ? { ...day, goal: { ...day.goal, calories: resolveDayCalorieTarget(state, day.date).effective } } : day));
  const maxGoal = Math.max(...shown.map(day => day.goal.calories), 1);
  const domain = maxGoal * 4 / 3;
  const px = (kcal: number) => Math.max(0, Math.min(200, kcal / domain * 200));

  const bankNumber = started ? headline.value : fmt(energyValue(state, maxGoal));
  const firstCheck = toCheck[0];
  const checkTitle = toCheck.length === 1 ? `${WEEKDAY_LONG(firstCheck.date)} looks light` : toCheck.length ? `${toCheck.length} days look light` : '';

  return (
    <div className="tl-screen week-screen view-transition" ref={settleRef}>
      <div className="tl-sky week" style={skyStyle(sky)}>
        <header className="tl-head">
          <div>
            <h1 className="tl-title">Week</h1>
            <p className="tl-range">{range}</p>
          </div>
          <div className="tl-tools">
            {!isCurrent && <button className="tl-glass tl-pill" type="button" onClick={() => setBankingWeekStart(currentWeek)}>This week</button>}
            <div className="tl-glass tl-toolbar">
              <button className="tl-tool" type="button" aria-label="Previous week" onClick={() => setBankingWeekStart(addDays(bankingWeekStart, -7))}><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
              <button className="tl-tool" type="button" aria-label="Next week" disabled={bankingWeekStart >= currentWeek} onClick={() => setBankingWeekStart(addDays(bankingWeekStart, 7))}><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
            </div>
          </div>
        </header>

        <button type="button" className="tl-bank" onClick={onDetails} aria-label={`${started ? `${headline.value} ${headline.label}` : `${energyText(state, maxGoal)} a day`}. ${answer} Opens week details.`}>
          <span className={`tl-bank-number ${bankNumber.length <= 3 ? '' : bankNumber.length <= 5 ? 'size-5' : 'size-6'}`}>{bankNumber}</span>
          <span className="tl-bank-label">{started ? headline.label : `${unit} a day`}<Icon name="chevron" size={14} /></span>
        </button>
        <p className="tl-answer">{answer}</p>
        {storyText && <p className="tl-story">{storyText}</p>}

        {showTide && (
          <div className="tl-tide" role="img" aria-label={`Week balance: ${tide.map(point => `${point.held ? 'held' : signedEnergyNumber(state, point.balance)} after ${WEEKDAY_LONG(point.date)}`).join(', ')}.`}>
            <svg viewBox="0 0 356 48" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <clipPath id={tideAbove}><rect x="0" y="0" width="356" height="24" /></clipPath>
                <clipPath id={tideBelow}><rect x="0" y="24" width="356" height="24" /></clipPath>
              </defs>
              <path className="tl-tide-zero" d="M0 24 H356" />
              <path className="tl-tide-up" d={tideArea} clipPath={`url(#${tideAbove})`} />
              <path className="tl-tide-down" d={tideArea} clipPath={`url(#${tideBelow})`} />
              {tide.map((point, index) => {
                const x0 = index ? tideX(index - 1) : 0;
                const y0 = index ? tideY(tide[index - 1].balance) : 24;
                return <path key={point.date} className={`tl-tide-line ${point.held ? 'held' : ''}`} d={`M${x0} ${y0.toFixed(1)} L${tideX(index)} ${tideY(point.balance).toFixed(1)}`} />;
              })}
            </svg>
            {lastTide && <i className="tl-tide-end" style={{ left: `${tideX(tide.length - 1) / 356 * 100}%`, top: `${tideY(lastTide.balance)}px` }} />}
            <span className="tl-tide-label">on pace</span>
          </div>
        )}

        <div className="tl-deltas" aria-hidden="true">
          {shown.map(day => {
            let text = '';
            let tone = '';
            if (day.status === 'counted') text = signedEnergyNumber(state, day.delta);
            else if (day.status === 'estimated') text = `≈${signedEnergyNumber(state, day.delta)}`;
            else if (day.status === 'light') text = 'Check';
            else if (day.status === 'untracked') text = '—';
            else if (day.status === 'today') {
              const left = day.goal.calories - day.totals.calories;
              const amount = fmt(energyValue(state, Math.abs(left)));
              const word = left >= 0 ? (day.goal.trackingMode === 'Bulking' ? 'to go' : 'left') : 'over';
              tone = left >= 0 ? 'today' : 'over';
              // Long amounts (kJ, early mornings) put the word on a second line rather than dropping it.
              return <span key={day.date} className={tone}>{amount}{amount.length >= 5 ? <br /> : ' '}{word}</span>;
            }
            return <span key={day.date} className={tone}>{text}</span>;
          })}
        </div>
      </div>

      <div className="tl-tiles">
        {shown.map(day => {
          const goal = Math.max(1, day.goal.calories);
          const room = px(goal);
          const logged = day.status === 'today' || day.status === 'light' ? day.totals.calories : day.intake;
          const water = logged == null ? 0 : px(Math.min(logged, goal));
          const over = logged == null ? 0 : Math.max(0, logged - goal);
          const capTop = px(goal + over);
          const held = day.status === 'light';
          const rough = day.status === 'estimated';
          const isTodayTile = day.status === 'today';
          const label = BANK_STATUS_TEXT[day.status]
            || (day.intake != null ? `${energyText(state, day.intake)}, ${energyText(state, Math.abs(day.delta))} ${day.delta >= 0 ? 'under' : 'over'} target` : '');
          return (
            <button
              key={day.date}
              type="button"
              className={`tl-tile ${day.status} ${held ? 'held' : ''} ${rough ? 'rough' : ''}`}
              style={{ '--tile-sky': `linear-gradient(180deg, ${sky.stops[1]} 0px, ${sky.stops[2]} 90px, ${sky.stops[3]} 200px)` } as CSSProperties}
              onClick={() => onOpenDay(day.date)}
              aria-label={`${readable(day.date)}: ${isTodayTile ? `${energyText(state, day.totals.calories)} so far` : label}. Open this day.`}
            >
              {day.status !== 'untracked' && <span className="tl-tile-room" style={{ height: room }} />}
              <span className="tl-tile-target" style={{ bottom: room }} />
              {water > 0 && <span className="tl-tile-water" style={{ height: over > 0 ? water - 1 : water }} />}
              {over > 0 && <span className="tl-tile-cap" style={{ bottom: room + 1, height: Math.max(3, capTop - room - 1) }} />}
              {isTodayTile && (logged || 0) > 0 && <span className="tl-tile-sun" style={{ bottom: Math.max(14, Math.min(px(logged || 0), 192)) - 8 }} />}
            </button>
          );
        })}
        <span className="tl-tiles-target" aria-hidden="true">{fmt(energyValue(state, maxGoal))}</span>
      </div>

      <div className="tl-tile-days" aria-hidden="true">
        {days.map(day => {
          const date = new Date(`${day.date}T00:00:00`);
          return (
            <span key={day.date} className={`${day.date === today ? 'today' : ''} ${day.status === 'upcoming' ? 'upcoming' : ''}`}>
              <small>{date.toLocaleDateString(undefined, { weekday: 'narrow' })}</small>
              <b>{date.getDate()}</b>
            </span>
          );
        })}
      </div>

      {firstCheck ? (
        <div className="tl-platter check">
          <i aria-hidden="true" />
          <span>
            <strong>{checkTitle}</strong>
            <small>{toCheck.length === 1 ? `${fmt(energyValue(state, firstCheck.totals.calories))} logged · held at ${fmt(energyValue(state, firstCheck.goal.calories))}` : 'Held at target until checked'}</small>
          </span>
          <button type="button" className="tl-text-btn" onClick={() => onOpenDay(firstCheck.date)}>Check</button>
        </div>
      ) : started && !nothing ? (
        <button type="button" className="tl-platter" onClick={onDetails}>
          <span>
            <strong>{finished ? `${energyText(state, week.budget)} budget` : week.left < 0 ? `${energyText(state, -week.left)} over this week` : `${energyText(state, week.left)} left this week`}</strong>
            <small>{counted.length} of 7 days counted{counted.length ? ` · average ${energyText(state, counted.reduce((acc, day) => acc + (day.intake || 0), 0) / counted.length)}` : ''}</small>
          </span>
          <Icon name="chevron" size={16} />
        </button>
      ) : null}
    </div>
  );
}

/** The detail behind the week's headline: the bank as a table, plus how it works. */
export function WeekDetails({ state, week }: { state: AppState; week: WeekBank }) {
  const { days, counted } = week;
  let balance = 0;
  const eaten = counted.reduce((acc, day) => acc + (day.intake || 0), 0);
  const logged = counted.filter(day => day.status === 'counted');
  const onTrack = counted.filter(day => classifyCalorieDay(day.intake, day.goal) === 'good').length;
  return (
    <div className="week-details">
      <table className="week-table">
        <thead><tr><th scope="col">Day</th><th scope="col">Eaten</th><th scope="col">vs target</th><th scope="col">Balance</th></tr></thead>
        <tbody>
          {days.map(day => {
            const counts = day.intake != null;
            if (counts) balance += day.delta;
            const eatenText = day.status === 'today' ? `${fmt(energyValue(state, day.totals.calories))} so far`
              : day.status === 'light' ? `${fmt(energyValue(state, day.totals.calories))} logged`
                : counts ? `${day.status === 'estimated' ? '≈' : ''}${fmt(energyValue(state, day.intake || 0))}` : '—';
            const vs = counts ? signedEnergyNumber(state, day.delta) : day.status === 'light' ? 'held' : day.status === 'today' ? 'today' : '—';
            return (
              <tr key={day.date}>
                <th scope="row">{readable(day.date)}</th>
                <td>{eatenText}</td>
                <td>{vs}</td>
                <td>{day.status === 'today' || day.status === 'upcoming' ? '—' : signedEnergyNumber(state, balance)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="stat"><span>Weekly budget</span><strong>{energyText(state, week.budget)}</strong></div>
      {week.remaining.length > 0 && <div className="stat"><span>{week.left < 0 ? 'Over this week' : 'Left this week'}</span><strong>{energyText(state, Math.abs(week.left))}</strong></div>}
      <div className="stat"><span>Counted days</span><strong>{counted.length} of 7{week.toCheck.length ? ` (${week.toCheck.length} held)` : ''}</strong></div>
      {counted.length > 0 && <div className="stat"><span>Average on counted days</span><strong>{energyText(state, eaten / counted.length)}</strong></div>}
      {counted.length > 0 && <div className="stat"><span>At or within target</span><strong>{onTrack} of {counted.length} counted days</strong></div>}
      {logged.length > 0 && <div className="stat"><span>Average protein</span><strong>{fmt(logged.reduce((acc, day) => acc + day.totals.protein, 0) / logged.length)}g / {fmt(logged.reduce((acc, day) => acc + day.goal.protein, 0) / logged.length)}g</strong></div>}
      <h3 className="week-details-heading">How the week bank works</h3>
      <p className="hint">Each finished day adds what you ate under target to your bank, or takes off what you ate over. Days count on their own at midnight; tap Done for today on Today if you want it counted sooner. The bank resets each Monday.</p>
      <ul className="update-list bank-help-list">
        <li><strong>Looks light:</strong> a day logged under {Math.round(LIGHT_DAY_SHARE * 100)}% of target is held at target until you check it, so a forgotten dinner never banks as savings.</li>
        <li><strong>Nothing logged:</strong> counts as on target, so it can’t help or hurt the bank.</li>
        <li><strong>Ate out or hard to track:</strong> add a rough meal by size, or give the whole day a rough guess. Rough numbers show with ≈.</li>
        <li><strong>The plan</strong> treats today as using at least its target until midnight, and never asks a day to go below 80% of its target.</li>
      </ul>
    </div>
  );
}
