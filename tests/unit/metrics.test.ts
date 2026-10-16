import { describe, expect, it } from 'vitest';
import { flattenMetrics, towerMetrics } from '../../src/sim/metrics';
import { serializeGame } from '../../src/sim/save';
import { newTestGame, scenarioTower, tickN } from '../helpers/simHarness';

describe('towerMetrics', () => {
  it('summarizes a fresh tower', () => {
    const state = newTestGame();
    const m = towerMetrics(state);
    expect(m.day).toBe(1);
    expect(m.dateLabel).toBe('1st WD / 1st Qtr / Year 1');
    expect(m.time).toBe('07:00');
    expect(m.stars).toBe(1);
    expect(m.fundsCents).toBe(state.money.balanceCents);
    expect(m.population).toBe(0);
    expect(m.tenants.lobby).toEqual({ total: 1, constructing: 0, open: 1, vacant: 0, damaged: 0 });
    expect(m.elevators).toMatchObject({ shafts: 0, cars: 0, utilization: 0, loadFactor: 0 });
    expect(m.queues).toEqual({ waiting: 0, nonEmpty: 0, longest: 0, longestKey: null });
  });

  it('counts tenants, people and elevators in a running tower', () => {
    const state = newTestGame();
    scenarioTower(state);
    expect(towerMetrics(state).tenants.office?.constructing).toBe(1);
    tickN(state, 2_600 + 300); // construction done, next morning commute underway
    const m = towerMetrics(state);
    expect(m.tenants.office).toMatchObject({ total: 1, open: 1 });
    expect(m.tenants.condo).toMatchObject({ total: 1, open: 1 });
    expect(m.population).toBe(9);
    expect(m.peopleByKind).toMatchObject({ officeWorker: 6, resident: 3 });
    expect(Object.values(m.peopleByState).reduce((a, b) => a + (b ?? 0), 0)).toBe(m.trackedPeople);
    expect(m.elevators.byKind.standard).toMatchObject({ shafts: 1, cars: 1 });
    expect(m.occupancy.capacity).toBe(9);
    expect(m.occupancy.ratio).toBeGreaterThanOrEqual(0);
    expect(m.occupancy.ratio).toBeLessThanOrEqual(1);
  });

  it('is pure: the snapshot leaves the game state untouched', () => {
    const state = newTestGame(7);
    scenarioTower(state);
    tickN(state, 3_000);
    const before = serializeGame(state);
    towerMetrics(state);
    expect(serializeGame(state)).toEqual(before);
  });

  it('flattens to scalar columns', () => {
    const state = newTestGame();
    const row = flattenMetrics(towerMetrics(state));
    expect(row['date.year']).toBe(1);
    expect(row['tenants.lobby.open']).toBe(1);
    expect(row['queues.longestKey']).toBe('');
    for (const value of Object.values(row)) expect(['string', 'number', 'boolean']).toContain(typeof value);
  });
});
