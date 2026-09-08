import { describe, expect, it } from 'vitest';
import {
  buildFloor,
  placeEscalator,
  placeElevatorGroup,
  pickupRoute,
  rebuildRouting,
  tick,
} from '../../src/sim';
import { newTestGame, scenarioTower } from '../helpers/simHarness';

describe('pickupRoute', () => {
  it('stairs for short hops: continuous column reaches the lobby', () => {
    const state = newTestGame();
    scenarioTower(state); // stairs at col 4 on floors 2-3
    const route = pickupRoute(state, 3, 1, 'officeWorker');
    expect(route).toEqual([
      { mode: 'stair', from: 3, to: 2, dir: -1, x: 4 },
      { mode: 'stair', from: 2, to: 1, dir: -1, x: 4 },
    ]);
  });

  it('stairs rejected beyond STAIR_MAX_FLOORS or without a column', () => {
    const state = newTestGame();
    scenarioTower(state);
    // 1 → 5: too far for stairs; the elevator serves both floors.
    const route = pickupRoute(state, 1, 5, 'officeWorker');
    expect(route?.length).toBe(1);
    expect(route?.[0]?.mode).toBe('elevator');
    // 5 → 3: no stair on floor 5; elevator serves both.
    const route2 = pickupRoute(state, 5, 3, 'officeWorker');
    expect(route2?.length).toBe(1);
    expect(route2?.[0]?.mode).toBe('elevator');
  });

  it('escalators: 1-way hops, direction matters', () => {
    const state = newTestGame();
    scenarioTower(state);
    placeEscalator(state, 4, 40, 'up'); // rides 4 → 5
    rebuildRouting(state);
    const up = pickupRoute(state, 4, 5, 'officeWorker');
    expect(up).toEqual([{ mode: 'escalator', from: 4, to: 5, dir: 1, x: 40 }]);
    // No down-escalator: falls through to the elevator.
    const down = pickupRoute(state, 5, 4, 'officeWorker');
    expect(down?.[0]?.mode).toBe('elevator');
  });

  it('escalator chains ride multiple floors', () => {
    const state = newTestGame();
    scenarioTower(state);
    placeEscalator(state, 4, 40, 'up'); // 4 → 5
    // Need a second hop for a chain: 2→3, 3→4 up escalators (floors 2-3 have stairs
    // at col 4 only; cols 40-42 are free).
    placeEscalator(state, 2, 40, 'up'); // 2 → 3
    placeEscalator(state, 3, 40, 'up'); // 3 → 4
    rebuildRouting(state);
    const route = pickupRoute(state, 2, 4, 'officeWorker');
    expect(route).toEqual([
      { mode: 'escalator', from: 2, to: 3, dir: 1, x: 40 },
      { mode: 'escalator', from: 3, to: 4, dir: 1, x: 40 },
    ]);
  });

  it('direct elevator wins when a group serves both floors', () => {
    const state = newTestGame();
    scenarioTower(state);
    const route = pickupRoute(state, 2, 4, 'officeWorker');
    expect(route).toHaveLength(1);
    expect(route?.[0]).toMatchObject({ mode: 'elevator', from: 2, to: 4, dir: 1 });
  });

  it('no route → null (no transport at all)', () => {
    const state = newTestGame();
    for (let i = 2; i <= 5; i++) buildFloor(state, i);
    rebuildRouting(state);
    expect(pickupRoute(state, 5, 1, 'officeWorker')).toBeNull();
  });

  it('same-floor trips are walk-only', () => {
    const state = newTestGame();
    scenarioTower(state);
    expect(pickupRoute(state, 2, 2, 'officeWorker')).toEqual([]);
  });
});

describe('routing tables', () => {
  it('groupsServing matches a brute-force recompute', () => {
    const state = newTestGame();
    scenarioTower(state);
    placeElevatorGroup(state, 3, 5, 30);
    rebuildRouting(state);
    for (let f = 0; f <= 5; f++) {
      const expected = [...state.elevatorGroups.values()]
        .filter((g) => g.serviceLo <= f && f <= g.serviceHi)
        .map((g) => g.id);
      expect(state.routing.groupsServing.get(f) ?? []).toEqual(expected);
    }
  });

  it('tables rebuild when the structure changes (checkRouting via tick)', () => {
    const state = newTestGame();
    scenarioTower(state);
    const before = state.routing.revision;
    placeElevatorGroup(state, 3, 5, 30); // bumps structureRevision
    tick(state);
    expect(state.routing.revision).toBeGreaterThan(before);
    expect(state.routing.groupsServing.get(5)).toContain(
      [...state.elevatorGroups.values()][1]!.id,
    );
  });
});
