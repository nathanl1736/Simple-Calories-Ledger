import { CSSProperties, useEffect, useRef } from 'react';
import type { AppState } from '../types';
import { weekViewFor } from '../weekView';
import {
  addDays,
  energyText,
  fmt,
  LIGHT_DAY_SHARE,
  readable,
  shortDate,
  SPREAD_FLOOR_SHARE,
  todayKey,
  weekBank,
  weekStartMonday,
  type DayBankStatus,
  type WeekBank
} from '../utils';
import { Icon } from '../ui/icons';
import { SettingsTool } from '../ui/SettingsButton';
import { useSettleAnimation } from '../ui/AppShell';
import { useSky, skyStyle } from '../ui/sky';

export function signedEnergyText(state: AppState, kcal: number) {
  return `${kcal > 0 ? '+' : ''}${energyText(state, kcal)}`;
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

/** Week: the balance that drives the next decision, how it got there, and seven skies filled with what was eaten. */
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
  const today = todayKey();
  const currentWeek = weekStartMonday(today);
  const isCurrent = bankingWeekStart === currentWeek;
  const week = weekBank(state, bankingWeekStart);
  // Every number and word on this screen comes from the view model, rounded once.
  const view = weekViewFor(state, week, today);
  const { days, toCheck } = week;
  const range = weekRange(bankingWeekStart);

  // The tiles draw each day's base target, the one the bank uses.
  const maxGoal = Math.max(...days.map(day => day.goal.calories), 1);
  const domain = maxGoal * 4 / 3;
  const px = (kcal: number) => Math.max(0, Math.min(200, kcal / domain * 200));

  const bankNumber = view.headline.value;
  const firstCheck = toCheck[0];
  const firstCheckView = firstCheck ? view.days.find(day => day.date === firstCheck.date) : undefined;
  const checkTitle = toCheck.length === 1 ? `${WEEKDAY_LONG(firstCheck.date)} looks light` : toCheck.length ? `${toCheck.length} days look light` : '';
  const showStats = view.started && !view.empty;
  const lastDay = view.days[view.days.length - 1];
  const planAboveTarget = lastDay.plan != null && lastDay.plan > lastDay.base;

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
              <SettingsTool />
            </div>
          </div>
        </header>

        <button type="button" className="tl-bank" onClick={onDetails} aria-label={`${view.headline.value} ${view.headline.label}. ${view.working ? `${view.working}. ` : ''}${view.answer} Opens week details.`}>
          <span className={`tl-bank-number ${bankNumber.length <= 3 ? '' : bankNumber.length <= 5 ? 'size-5' : 'size-6'}`}>{bankNumber}</span>
          <span className="tl-bank-label">{view.headline.label}<Icon name="chevron" size={14} /></span>
        </button>
        {view.working && <p className="tl-working">{view.working}</p>}
        <p className="tl-answer">{view.answer}</p>

        <div className="tl-deltas" aria-hidden="true">
          {view.days.map(day => {
            const { cell } = day;
            if (cell.amount && cell.word) {
              // Long amounts (kJ, early mornings) put the word on a second line rather than dropping it.
              return <span key={day.date} className={cell.tone}>{cell.amount}{cell.amount.length >= 5 ? <br /> : ' '}{cell.word}</span>;
            }
            return <span key={day.date} className={cell.tone}>{cell.text}</span>;
          })}
        </div>
      </div>

      <div className="tl-tiles">
        {days.map((day, index) => {
          const shown = view.days[index];
          const goal = Math.max(1, day.goal.calories);
          const room = px(goal);
          const logged = day.status === 'today' || day.status === 'light' ? day.totals.calories : day.intake;
          const water = logged == null ? 0 : px(Math.min(logged, goal));
          const over = logged == null ? 0 : Math.max(0, logged - goal);
          const capTop = px(goal + over);
          const held = day.status === 'light';
          const rough = day.status === 'estimated';
          const isTodayTile = day.status === 'today';
          return (
            <button
              key={day.date}
              type="button"
              className={`tl-tile ${day.status} ${held ? 'held' : ''} ${rough ? 'rough' : ''}`}
              style={{ '--tile-sky': `linear-gradient(180deg, ${sky.stops[1]} 0px, ${sky.stops[2]} 90px, ${sky.stops[3]} 200px)` } as CSSProperties}
              onClick={() => onOpenDay(day.date)}
              aria-label={`${readable(day.date)}: ${shown.aria}. Open this day.`}
            >
              {day.status !== 'untracked' && <span className="tl-tile-room" style={{ height: room }} />}
              <span className="tl-tile-target" style={{ bottom: room }} />
              {shown.planKcal != null && <span className="tl-tile-plan" style={{ bottom: Math.min(194, px(shown.planKcal)) }} />}
              {water > 0 && <span className="tl-tile-water" style={{ height: over > 0 ? water - 1 : water }} />}
              {over > 0 && <span className="tl-tile-cap" style={{ bottom: room + 1, height: Math.max(3, capTop - room - 1) }} />}
              {isTodayTile && (logged || 0) > 0 && <span className="tl-tile-sun" style={{ bottom: Math.max(14, Math.min(px(logged || 0), 192)) - 8 }} />}
            </button>
          );
        })}
        {/* Sits in Sunday's tile, above the target line, or below it when Sunday's plan line is above. */}
        <span className={`tl-tiles-target ${planAboveTarget ? 'below' : ''}`} style={{ bottom: planAboveTarget ? undefined : px(maxGoal) + 3, top: planAboveTarget ? 200 - px(maxGoal) + 4 : undefined }} aria-hidden="true">
          target<br />{view.target}
        </span>
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

      {firstCheck && (
        <div className="tl-platter check">
          <i aria-hidden="true" />
          <span>
            <strong>{checkTitle}</strong>
            <small>{firstCheckView && toCheck.length === 1 ? `${fmt(firstCheckView.logged)} logged · held at ${fmt(firstCheckView.base)}` : 'Held at target until checked'}</small>
          </span>
          <button type="button" className="tl-text-btn" onClick={() => onOpenDay(firstCheck.date)}>Check</button>
        </div>
      )}

      {showStats && (
        <button
          type="button"
          className="tl-stats"
          onClick={onDetails}
          aria-label={`${view.stats.map(stat => `${stat.label} ${stat.value}${stat.note ? `, ${stat.note}` : ''}`).join('. ')}. Opens week details.`}
        >
          {view.stats.map(stat => (
            <span key={stat.label} className="tl-stat" aria-hidden="true">
              <small>{stat.label}</small>
              <b>{stat.value}</b>
              {stat.note && <em>{stat.note}</em>}
            </span>
          ))}
          <span className="tl-stat more" aria-hidden="true">Day by day<Icon name="chevron" size={14} /></span>
        </button>
      )}
    </div>
  );
}

/** The detail behind the week's headline: the bank as a table, plus how it works. Every cell comes from the view model. */
export function WeekDetails({ state, week }: { state: AppState; week: WeekBank }) {
  const view = weekViewFor(state, week);
  return (
    <div className="week-details">
      <table className="week-table">
        <thead><tr><th scope="col">Day</th><th scope="col">Eaten</th><th scope="col">vs target</th><th scope="col">Balance</th></tr></thead>
        <tbody>
          {view.days.map(day => (
            <tr key={day.date} className={day.status === 'upcoming' ? 'plan' : ''}>
              <th scope="row">{readable(day.date)}</th>
              <td>{day.table.eaten}</td>
              <td>{day.table.vs}</td>
              <td>{day.table.balance}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {view.detailStats.map(stat => (
        <div key={stat.label} className="stat">
          <span>{stat.label}{stat.note && <small className="stat-note">{stat.note}</small>}</span>
          <strong>{stat.value}</strong>
        </div>
      ))}
      <h3 className="week-details-heading">How the week bank works</h3>
      <p className="hint">Each finished day adds what you ate under target to your bank, or takes off what you ate over. Days count on their own at midnight; tap Done for today on Today if you want it counted sooner. The bank resets each Monday.</p>
      <ul className="update-list bank-help-list">
        <li><strong>Until midnight,</strong> today only counts what it is over by. What you haven’t eaten yet is still yours.</li>
        <li><strong>Looks light:</strong> a day logged under {Math.round(LIGHT_DAY_SHARE * 100)}% of target is held at target until you check it, so a forgotten dinner never banks as savings.</li>
        <li><strong>Nothing logged:</strong> counts as on target, so it can’t help or hurt the bank.</li>
        <li><strong>Ate out or hard to track:</strong> add a rough meal by size, or give the whole day a rough guess. Rough numbers show with ≈.</li>
        <li><strong>The plan</strong> shares the bank across the days left and never asks a day to go below {Math.round(SPREAD_FLOOR_SHARE * 100)}% of its target. A custom target for a day doesn’t change the bank, which always uses your usual target.</li>
      </ul>
    </div>
  );
}
