import { expect, it } from 'vitest';
import { deserializeGame, placeTenant, serializeGame } from '../../src/sim';
import { stepElevators } from '../../src/sim/elevators';
import { removeTenantPeople, spawnTenantPeople } from '../../src/sim/people';
import { callPending, joinQueue, pressCall } from '../../src/sim/queues';
import { newTestGame, scenarioTower } from '../helpers/simHarness';

it.each(['officeWorker', 'diner', 'housekeeper'] as const)(
  'releases a riding %s when their activity destination disappears', kind => {
    const state = newTestGame(); scenarioTower(state);
    const group = [...state.elevatorGroups.values()][0]!;
    const car = group.cars[0]!;
    const destination = placeTenant(state, 'fastfood', 5, 60);
    spawnTenantPeople(state, [...state.tenants.values()].find(t => t.type === 'office')!);
    const people = [...state.people.values()];
    const cancelled = people[0]!; const other = people[1]!;
    for (const p of [cancelled, other]) {
      Object.assign(p, { state: 'riding', legIndex: 0,
        route: [{ mode: 'elevator', from: 1, to: 5, dir: 1, groupId: group.id }] });
      car.passengers.push(p.id);
    }
    cancelled.kind = kind; cancelled.activityTenantId = destination.id;
    Object.assign(car, { state: 'moving', targetFloor: 5, y: 2, dir: 1 });
    removeTenantPeople(state, destination.id);
    expect(car.passengers).toEqual([other.id]);
    expect(cancelled.failedTripsToday).toBe(1);
    if (kind === 'diner') expect(state.people.has(cancelled.id)).toBe(false);
    else expect(cancelled.route).toBeNull();
    const retreatPosition = { ...cancelled.pos };
    const restored = deserializeGame(serializeGame(state));
    for (let i = 0; i < 150; i++) { stepElevators(state); stepElevators(restored); }
    expect(other.legIndex).toBe(1);
    expect(car.passengers).toEqual([]);
    expect(car.state).toBe('idle');
    expect(cancelled.pos).toEqual(retreatPosition);
    expect(serializeGame(restored)).toBe(serializeGame(state));
  },
);

it('removing a destination cancels only its waiting visitors and clears the final hall call', () => {
  const state = newTestGame(); scenarioTower(state);
  const destination = placeTenant(state, 'fastfood', 5, 60);
  const group = [...state.elevatorGroups.values()][0]!;
  spawnTenantPeople(state, [...state.tenants.values()].find(t => t.type === 'office')!);
  const p = [...state.people.values()][0]!;
  Object.assign(p, { kind: 'diner', state: 'waiting', legIndex: 0, activityTenantId: destination.id,
    route: [{ mode: 'elevator', from: 3, to: 5, dir: 1, groupId: group.id }] });
  joinQueue(state, p.id, 3, 'up'); pressCall(state, 3, 'up');
  removeTenantPeople(state, destination.id);
  expect(state.people.has(p.id)).toBe(false);
  expect(state.queues['3:up']).toEqual([]);
  expect(callPending(state, 3, 'up')).toBe(false);
});
