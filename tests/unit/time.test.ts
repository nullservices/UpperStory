import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/data/config';
import { formatTimeOfDay, minuteToTick, tick, tickToMinute } from '../../src/sim';
import { newTestGame } from '../helpers/simHarness';
import { operatingDay, stepTime } from '../../src/sim/time';
import { deserializeGame, serializeGame } from '../../src/sim/save';

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

  it('the schedule cycle wraps at DAY_TICKS without advancing the date', () => {
    const state = newTestGame();
    state.calendar.tickOfDay = CONFIG.DAY_TICKS - 1;
    tick(state);
    expect(state.calendar.tickOfDay).toBe(0);
    expect(state.calendar.day).toBe(1);
    expect(state.calendar.minuteOfDay).toBeCloseTo(420);
    expect(formatTimeOfDay(420)).toBe('07:00');
    expect(formatTimeOfDay(780)).toBe('13:00');
    expect(formatTimeOfDay(1500)).toBe('01:00');
    expect(formatTimeOfDay(540)).toBe('09:00');
  });
});

it('advances the date and settles once at midnight without running a second evaluation', () => {
  const state = newTestGame();
  state.calendar.tickOfDay = minuteToTick(1440) - 1;
  state.calendar.minuteOfDay = tickToMinute(state.calendar.tickOfDay);
  state.evaluationDay = 1;
  tick(state);
  expect(state.calendar.day).toBe(2);
  expect(formatTimeOfDay(state.calendar.minuteOfDay)).toBe('00:00');
  expect(state.evaluationDay).toBe(1);
  expect(state.events.filter(e => e.type === 'MONEY_CHANGED')).toHaveLength(1);
  tick(state);
  expect(state.events.filter(e => e.type === 'MONEY_CHANGED')).toHaveLength(0);
});

it('keeps the operating day across midnight and starts a new schedule cycle at seven', () => {
  const state = newTestGame();
  state.calendar.tickOfDay = minuteToTick(1440) - 1;
  stepTime(state);
  expect(operatingDay(state)).toBe(1);
  while (state.calendar.tickOfDay !== 0) stepTime(state);
  expect(state.calendar.day).toBe(2);
  expect(operatingDay(state)).toBe(2);
});

it('migrates an older after-midnight save without changing its schedule cycle', () => {
  const state = newTestGame();
  state.calendar.tickOfDay = minuteToTick(1500); state.calendar.minuteOfDay = 1500;
  const saved = JSON.parse(serializeGame(state)); saved.version = 4;
  const loaded = deserializeGame(JSON.stringify(saved));
  expect(loaded.calendar.day).toBe(2);
  expect(operatingDay(loaded)).toBe(1);
  expect(deserializeGame(serializeGame(loaded)).calendar.day).toBe(2);
});

it('closes the previous quarter at midnight using the day that just ended', () => {
  const state = newTestGame(); state.calendar.day = CONFIG.QUARTER_DAYS;
  state.calendar.tickOfDay = minuteToTick(1440) - 1;
  tick(state);
  expect(state.events.find(e => e.type === 'QUARTER_REPORT')).toMatchObject({ quarter: 1 });
  tick(state);
  expect(state.events.some(e => e.type === 'QUARTER_REPORT')).toBe(false);
});
