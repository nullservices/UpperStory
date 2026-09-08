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
    c.day++;
  }
  c.minuteOfDay = tickToMinute(c.tickOfDay);
}

/** "07:30" style display string from a minute-of-day. */
export function formatTimeOfDay(minuteOfDay: number): string {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  const hh = Math.floor(m / 60);
  const mm = Math.floor(m % 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
