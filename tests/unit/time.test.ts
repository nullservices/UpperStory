import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/data/config';
import { formatTimeOfDay, minuteToTick, tick, tickToMinute } from '../../src/sim';
import { newTestGame } from '../helpers/simHarness';

describe('day cycle', () => {
  it('tickToMinute maps the uneven segments (7:00 start, lunch rush, compressed night)', () => {
    expect(tickToMinute(0)).toBeCloseTo(420); // 07:00
    expect(tickToMinute(400)).toBeCloseTo(720); // 12:00
    expect(tickToMinute(1200)).toBeCloseTo(780); // 13:00
    expect(tickToMinute(2400)).toBeCloseTo(1500); // 01:00
    expect(tickToMinute(2599)).toBeCloseTo(1858.2); // just before the 07:00 wrap
  });

  it('tickToMinute is monotonic across the day', () => {
    let prev = -1;
    for (let t = 0; t < CONFIG.DAY_TICKS; t++) {
      const m = tickToMinute(t);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });

  it('minuteToTick inverts tickToMinute at segment boundaries', () => {
    for (const m of [420, 500, 720, 780, 1000, 1500, 1800]) {
      expect(minuteToTick(m)).toBeCloseTo(
        Math.round(minuteToTick(tickToMinute(minuteToTick(m)))),
      );
    }
    expect(minuteToTick(420)).toBe(0);
    expect(minuteToTick(720)).toBe(400);
    expect(minuteToTick(780)).toBe(1200);
    expect(minuteToTick(1500)).toBe(2400);
  });

  it('the day wraps at DAY_TICKS and formatTimeOfDay normalizes', () => {
    const state = newTestGame();
    state.calendar.tickOfDay = CONFIG.DAY_TICKS - 1;
    tick(state);
    expect(state.calendar.tickOfDay).toBe(0);
    expect(state.calendar.day).toBe(2);
    expect(state.calendar.minuteOfDay).toBeCloseTo(420);
    expect(formatTimeOfDay(420)).toBe('07:00');
    expect(formatTimeOfDay(780)).toBe('13:00');
    expect(formatTimeOfDay(1500)).toBe('01:00');
    expect(formatTimeOfDay(540)).toBe('09:00');
  });
});
