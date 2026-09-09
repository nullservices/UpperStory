import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/data/config';
import { placeElevatorGroup, setElevatorServiceRange, stepElevators } from '../../src/sim/elevators';
import { joinQueue, pressCall } from '../../src/sim/queues';
import { spawnTenantPeople } from '../../src/sim/people';
import { newTestGame, scenarioTower } from '../helpers/simHarness';

describe('elevator fidelity regressions', () => {
  it.each([['standard', 21], ['service', 10], ['express', 42]] as const)(
    '%s boards up to its documented capacity', (kind, capacity) => {
      const state = newTestGame();
      scenarioTower(state);
      state.starLevel = 5;
      const group = placeElevatorGroup(state, 1, 5, 40, kind);
      const tenant = [...state.tenants.values()].find(t => t.type === 'office')!;
      spawnTenantPeople(state, tenant);
      const prototype = [...state.people.values()][0]!;
      state.people.clear();
      const count = Math.min(capacity + 1, CONFIG.QUEUE_MAX_PER_SIDE);
      for (let id = 1000; id < 1000 + count; id++) {
        state.people.set(id, { ...prototype, id, state: 'waiting', pos: { floor: 1, x: 41 },
          route: [{ mode: 'elevator', from: 1, to: 5, dir: 1, groupId: group.id }], legIndex: 0 });
        joinQueue(state, id, 1, 'up');
      }
      // Express cars can already contain passengers from another stop.
      if (kind === 'express') {
        for (let id = 2000; id < 2003; id++) {
          state.people.set(id, { ...prototype, id, state: 'riding',
            route: [{ mode: 'elevator', from: 0, to: 5, dir: 1, groupId: group.id }], legIndex: 0 });
          group.cars[0]!.passengers.push(id);
        }
      }
      Object.assign(group.cars[0]!, { state: 'doors', dir: 1, doorsTicksLeft: 1 });
      stepElevators(state);
      expect(group.cars[0]!.passengers).toHaveLength(capacity);
      expect(state.queues['1:up']).toHaveLength(1);
      const rider = state.people.get(group.cars[0]!.passengers.at(-1)!)!;
      expect(rider.pos).toEqual({ floor: 1, x: 40.5 });
    },
  );

  it('serves a down call immediately after traveling upward to it', () => {
    const state = newTestGame();
    scenarioTower(state);
    const car = [...state.elevatorGroups.values()][0]!.cars[0]!;
    pressCall(state, 5, 'down');
    for (let i = 0; i < 40 && car.state !== 'doors'; i++) stepElevators(state);
    expect(car.y).toBe(5);
    expect(car.dir).toBe(-1);
  });

  it('stops exactly on an intermediate pickup without reversing back to it', () => {
    const state = newTestGame();
    scenarioTower(state);
    const car = [...state.elevatorGroups.values()][0]!.cars[0]!;
    Object.assign(car, { y: 2.9, state: 'moving', dir: 1, targetFloor: 5, lastFloor: 2 });
    pressCall(state, 3, 'up');
    stepElevators(state);
    expect(car.y).toBe(3);
    expect(car.state).toBe('doors');
  });

  it('updates stops and parks idle cars inside a shortened shaft', () => {
    const state = newTestGame();
    scenarioTower(state);
    const group = [...state.elevatorGroups.values()][0]!;
    group.cars[0]!.y = 5;
    setElevatorServiceRange(state, group.id, 1, 3);
    expect(group.stops).toEqual([1, 2, 3]);
    expect(group.cars[0]!.y).toBe(3);
    group.cars[0]!.state = 'moving';
    expect(() => setElevatorServiceRange(state, group.id, 1, 2)).toThrow('empty and stop');
    expect(group.serviceHi).toBe(3);
  });
});
