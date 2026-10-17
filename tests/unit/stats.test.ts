import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/data/config';
import { deserializeGame, serializeGame } from '../../src/sim/save';
import {
  STATS_LIMITS,
  compactStats,
  createStats,
  mergeSamples,
  statsHistory,
  stepStats,
  type StatsSample,
} from '../../src/sim/stats';
import { newTestGame, scenarioTower, tickN } from '../helpers/simHarness';

const DAY = CONFIG.DAY_TICKS;

function sample(day: number, overrides: Partial<StatsSample> = {}): StatsSample {
  return {
    day, span: 1, pop: day, funds: day * 100, income: 1000, upkeep: 400, net: 600, stars: 1,
    stress: 10, stressed: 0, giveUps: 2, waitPeak: 5, waitAvg: 1, util: 20,
    offices: 1, officesVacant: 0, condos: 1, condosVacant: 0, hotelRooms: 0, hotelOcc: 0,
    food: 0, retail: 0, leisure: 0, services: 0, revHotel: 0, revFood: 0, revRetail: 0, revLeisure: 0,
    ...overrides,
  };
}

describe('statistics recording', () => {
  it('starts empty and records one sample per settled day', () => {
    const state = newTestGame();
    scenarioTower(state);
    tickN(state, 10);
    expect(state.stats?.days).toEqual([]);
    tickN(state, DAY * 3);
    const days = state.stats!.days;
    expect(days.map(d => d.day)).toEqual([1, 2, 3]);
    const last = days[2]!;
    expect(last.span).toBe(1);
    // The sample is taken right after settlement: money matches the books.
    expect(last.income).toBe(state.money.dailyIncomeCents);
    expect(last.upkeep).toBe(state.money.dailyUpkeepCents);
    expect(last.net).toBe(last.income - last.upkeep);
    expect(last.offices + last.officesVacant).toBe(1);
    expect(last.condos + last.condosVacant).toBe(1);
    expect(last.stars).toBe(state.starLevel);
    expect(last.util).toBeGreaterThanOrEqual(0);
    expect(last.util).toBeLessThanOrEqual(100);
    expect(state.stats!.lastHours).toHaveLength(24);
  });

  it('counts give-ups from the event stream', () => {
    const state = newTestGame();
    state.stats = createStats(state.calendar.day);
    state.events.push({ type: 'PERSON_GAVE_UP', personId: 1, floor: 1 }, { type: 'PERSON_GAVE_UP', personId: 2, floor: 1 });
    stepStats(state);
    expect(state.stats.today.giveUps).toBe(2);
  });

  it('is deterministic and leaves the simulation untouched', () => {
    const a = newTestGame(5); scenarioTower(a); tickN(a, DAY * 2);
    const b = newTestGame(5); scenarioTower(b); tickN(b, DAY * 2);
    expect(a.stats).toEqual(b.stats);
    // Discarding the history mid-run changes nothing else in the tower.
    const c = newTestGame(5); scenarioTower(c);
    for (let i = 0; i < DAY * 2; i++) { tickN(c, 1); if (i % 997 === 0) delete c.stats; }
    expect(serializeGame({ ...c, stats: undefined })).toBe(serializeGame({ ...a, stats: undefined }));
  });

  it('starts a fresh history for saves without statistics', () => {
    const state = newTestGame();
    delete state.stats;
    const loaded = deserializeGame(serializeGame(state));
    expect(loaded.stats).toBeUndefined();
    tickN(loaded, 1);
    expect(loaded.stats?.days).toEqual([]);
    expect(loaded.stats?.lastDay).toBe(loaded.calendar.day);
  });

  it('round-trips through a save', () => {
    const state = newTestGame();
    scenarioTower(state);
    tickN(state, DAY * 2 + 50);
    const loaded = deserializeGame(serializeGame(state));
    expect(loaded.stats).toEqual(state.stats);
    tickN(state, DAY);
    tickN(loaded, DAY);
    expect(loaded.stats).toEqual(state.stats);
  });
});

describe('statistics bounding', () => {
  it('merges flows as span-weighted means and levels as the last value', () => {
    const merged = mergeSamples([sample(1, { income: 100, pop: 5 }), sample(2, { income: 200, pop: 7, span: 3 })]);
    expect(merged).toMatchObject({ day: 2, span: 4, pop: 7, income: 175 });
  });

  it('keeps recent days daily and folds older ones into quarters and years', () => {
    const stats = createStats();
    const total = 2_000;
    for (let day = 1; day <= total; day++) {
      stats.days.push(sample(day));
      compactStats(stats);
    }
    expect(stats.days.length).toBeLessThanOrEqual(STATS_LIMITS.DAILY_KEEP);
    expect(stats.quarters.length).toBeLessThanOrEqual(STATS_LIMITS.QUARTER_KEEP);
    expect(stats.years.length).toBeLessThanOrEqual(STATS_LIMITS.YEAR_KEEP);
    const history = statsHistory(stats);
    // Every day is accounted for exactly once, in order.
    expect(history.reduce((n, s) => n + s.span, 0)).toBe(total);
    for (let i = 1; i < history.length; i++) expect(history[i]!.day).toBeGreaterThan(history[i - 1]!.day);
    expect(history[history.length - 1]!.day).toBe(total);
    // Quarter buckets line up with the calendar.
    for (const q of stats.quarters) expect(q.day % CONFIG.QUARTER_DAYS).toBe(0);
    expect(stats.quarters.every(q => q.span === CONFIG.QUARTER_DAYS)).toBe(true);
    // Small enough to live in every save.
    expect(JSON.stringify(stats).length).toBeLessThan(150_000);
  });

  it('keeps history bounded over centuries', () => {
    const stats = createStats();
    for (let day = 1; day <= 20_000; day++) {
      stats.days.push(sample(day));
      compactStats(stats);
    }
    expect(statsHistory(stats).length).toBeLessThanOrEqual(STATS_LIMITS.DAILY_KEEP + STATS_LIMITS.QUARTER_KEEP + STATS_LIMITS.YEAR_KEEP);
    expect(statsHistory(stats).reduce((n, s) => n + s.span, 0)).toBe(20_000);
  });
});
