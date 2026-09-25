import { expect, it } from 'vitest';
import { placeElevatorGroup, serializeGame, deserializeGame } from '../../src/sim';
import { stepElevators } from '../../src/sim/elevators';
import { callPending, joinQueue, leaveQueue, pressCall, queueLength } from '../../src/sim/queues';
import { giveUp, spawnTenantPeople } from '../../src/sim/people';
import { newTestGame, scenarioTower } from '../helpers/simHarness';

it('allows forty waiters per shaft and direction, preserving FIFO boarding after load', () => {
  const state = newTestGame(); scenarioTower(state);
  const a = [...state.elevatorGroups.values()][0]!;
  const b = placeElevatorGroup(state, 1, 5, 40);
  spawnTenantPeople(state, [...state.tenants.values()].find(t => t.type === 'office')!);
  const prototype = [...state.people.values()][0]!;
  function person(id: number, groupId: number, dir: 1 | -1 = 1) {
    state.people.set(id, { ...prototype, id, state: 'waiting', legIndex: 0,
      route: [{ mode: 'elevator', groupId, from: 3, to: dir === 1 ? 5 : 1, dir }] });
  }
  for (let i = 0; i < 40; i++) {
    person(1000 + i, a.id); person(2000 + i, b.id);
    expect(joinQueue(state, 1000 + i, 3, 'up')).toBe(true);
    expect(joinQueue(state, 2000 + i, 3, 'up')).toBe(true);
  }
  person(3000, a.id); expect(joinQueue(state, 3000, 3, 'up')).toBe(false);
  expect(joinQueue(state, 1000, 3, 'up')).toBe(true); // Duplicate joins don't consume slots.
  expect(queueLength(state, 3, 'up')).toBe(80);
  expect(queueLength(state, 3, 'up', a.id)).toBe(40);
  person(3001, a.id, -1); expect(joinQueue(state, 3001, 3, 'down')).toBe(true);
  leaveQueue(state, 1000); expect(joinQueue(state, 3000, 3, 'up')).toBe(true);
  const loaded = deserializeGame(serializeGame(state));
  const group = loaded.elevatorGroups.get(a.id)!;
  Object.assign(group.cars[0]!, { y: 3, state: 'doors', dir: 1, doorsTicksLeft: 1 });
  stepElevators(loaded);
  expect(group.cars[0]!.passengers).toEqual(Array.from({ length: 21 }, (_, i) => 1001 + i));
  expect(queueLength(loaded, 3, 'up', a.id)).toBe(19);
  expect(queueLength(loaded, 3, 'up', b.id)).toBe(40);
  expect(queueLength(loaded, 3, 'down', a.id)).toBe(1);
});

it('clears abandoned hall calls without cancelling other shafts or directions', () => {
  const state = newTestGame(); scenarioTower(state);
  const a = [...state.elevatorGroups.values()][0]!;
  const b = placeElevatorGroup(state, 1, 5, 40);
  spawnTenantPeople(state, [...state.tenants.values()].find(t => t.type === 'office')!);
  const prototype = [...state.people.values()][0]!;
  for (const [id, groupId, dir] of [[1000, a.id, 1], [2000, b.id, 1], [3000, a.id, -1]] as const) {
    state.people.set(id, { ...prototype, id, state: 'waiting', legIndex: 0,
      pos: { floor: 3, x: 11 },
      route: [{ mode: 'elevator', groupId, from: 3, to: dir === 1 ? 5 : 1, dir }] });
    joinQueue(state, id, 3, dir === 1 ? 'up' : 'down');
    pressCall(state, 3, dir === 1 ? 'up' : 'down');
  }
  giveUp(state, state.people.get(1000)!);
  expect(callPending(state, 3, 'up')).toBe(true);
  giveUp(state, state.people.get(2000)!);
  expect(callPending(state, 3, 'up')).toBe(false);
  expect(callPending(state, 3, 'down')).toBe(true);
  giveUp(state, state.people.get(3000)!);
  expect(callPending(state, 3, 'down')).toBe(false);
  a.cars[0]!.y = 1;
  stepElevators(state);
  expect(a.cars[0]!.state).toBe('idle');
});
