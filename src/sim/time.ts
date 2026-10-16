import { CONFIG } from '../data/config';
import type { GameState } from './state';

/**
 * The game clock. A day is DAY_TICKS ticks starting at 07:00, with the
 * original's uneven tick budget: a huge lunch-rush hour at noon and a
 * compressed night (reverse-engineered from the save format).
 */

export interface Calendar {
  /** 0..DAY_TICKS-1, day starts at tick 0 = 07:00. */
  tickOfDay: number;
  /** 420 (07:00) .. 1860 (07:00 next day); display normalizes % 1440. */
  minuteOfDay: number;
  /** 1-based day counter. */
  day: number;
}

/** Tick-of-day → minute-of-day via the piecewise segments. */
export function tickToMinute(tickOfDay: number): number {
  const t = ((tickOfDay % CONFIG.DAY_TICKS) + CONFIG.DAY_TICKS) % CONFIG.DAY_TICKS;
  let remaining = t;
  for (const seg of CONFIG.DAY_SEGMENTS) {
    if (remaining < seg.ticks) {
      const frac = remaining / seg.ticks;
      return seg.fromMin + frac * (seg.toMin - seg.fromMin);
    }
    remaining -= seg.ticks;
  }
  // Unreachable: segments sum to DAY_TICKS.
  return CONFIG.DAY_SEGMENTS[0]!.fromMin;
}

/** Minute-of-day → tick-of-day (inverse of tickToMinute). */
export function minuteToTick(minuteOfDay: number): number {
  const m = ((minuteOfDay - 420) % 1440 + 1440) % 1440 + 420;
  let tick = 0;
  for (const seg of CONFIG.DAY_SEGMENTS) {
    if (m < seg.fromMin) break;
    if (m < seg.toMin) {
      const frac = (m - seg.fromMin) / (seg.toMin - seg.fromMin);
      return Math.round(tick + frac * seg.ticks);
    }
    tick += seg.ticks;
  }
  return CONFIG.DAY_TICKS - 1;
}

export function stepTime(state: GameState): void {
  const c = state.calendar;
  c.tickOfDay++;
  if (c.tickOfDay >= CONFIG.DAY_TICKS) {
    c.tickOfDay = 0;

  }
  c.minuteOfDay = tickToMinute(c.tickOfDay);
  if (c.tickOfDay === minuteToTick(1440)) c.day++;
}

/** "07:30" style display string from a minute-of-day. */
export function formatTimeOfDay(minuteOfDay: number): string {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  const hh = Math.floor(m / 60);
  const mm = Math.floor(m % 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Schedule cycles run from 07:00 to 07:00 across the midnight date change. */
export function operatingDay(state: GameState): number {
  return state.calendar.day - (state.calendar.minuteOfDay >= 1440 ? 1 : 0);
}

/** Every third day is the weekend (two weekdays, then one weekend day). */
export function isWeekendDay(day: number): boolean {
  return day % 3 === 0;
}

/** Weekend for the current 07:00–07:00 operating day. */
export function isWeekend(state: GameState): boolean {
  return isWeekendDay(operatingDay(state));
}

export interface TowerDate {
  /** 1-based year; four quarters per year. */
  year: number;
  /** 1..4 */
  quarter: number;
  /** 0 = first weekday, 1 = second weekday, 2 = weekend. */
  dayOfQuarter: number;
}

/** SimTower calendar: each quarter is two weekdays then a weekend day. */
export function towerDate(day: number): TowerDate {
  const index = Math.max(0, day - 1);
  const quarterIndex = Math.floor(index / CONFIG.QUARTER_DAYS);
  return { year: Math.floor(quarterIndex / 4) + 1, quarter: (quarterIndex % 4) + 1, dayOfQuarter: index % CONFIG.QUARTER_DAYS };
}

/** "1st WD / 2nd Qtr / Year 3" style label. */
export function formatTowerDate(day: number): string {
  const { year, quarter, dayOfQuarter } = towerDate(day);
  const ordinal = (n: number): string => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
  const dayLabel = dayOfQuarter === 2 ? 'WE' : `${ordinal(dayOfQuarter + 1)} WD`;
  return `${dayLabel} / ${ordinal(quarter)} Qtr / Year ${year}`;
}
