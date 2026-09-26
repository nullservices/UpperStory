import { expect, it } from 'vitest';
import { deserializeGame, placeElevatorGroup, serializeGame } from '../../src/sim';
import { demolishElevatorGroup, stepElevators } from '../../src/sim/elevators';
import { spawnTenantPeople, stepPeople } from '../../src/sim/people';
import { newTestGame, scenarioTower } from '../helpers/simHarness';

function fixture() {
  const state = newTestGame(); scenarioTower(state);
  const group = [...state.elevatorGroups.values()][0]!;
  const other = placeElevatorGroup(state, 1, 5, 40);
  spawnTenantPeople(state, [...state.tenants.values()].find(t => t.type === 'office')!);
  const person = [...state.people.values()][0]!;
  state.people.clear(); state.people.set(person.id, person);
  person.scheduleDone = true;
  return { state, group, other, person };
}

it('cancels a walker who already has a target at the demolished shaft', () => {
  const { state, group, person } = fixture();
  Object.assign(person, { state: 'walking', pos: { floor: 3, x: 10 }, target: { floor: 3, x: 11 },
    destination: { floor: 5, x: 70 }, legIndex: 0,
    route: [{ mode: 'elevator', from: 3, to: 5, dir: 1, groupId: group.id }] });
  demolishElevatorGroup(state, group.id);
  expect(person).toMatchObject({ state: 'offscreen', route: null, target: null, failedTripsToday: 1 });
  const restored = deserializeGame(serializeGame(state));
  for (let i = 0; i < 10; i++) {
    stepPeople(state); stepElevators(state); stepPeople(restored); stepElevators(restored);
  }
  expect(Object.values(state.queues).flat()).toEqual([]);
  expect(serializeGame(restored)).toBe(serializeGame(state));
});

it('cancels a future transfer and frees the passenger from the first car', () => {
  const { state, group, other, person } = fixture();
  Object.assign(person, { state: 'riding', legIndex: 0, route: [
    { mode: 'elevator', from: 3, to: 1, dir: -1, groupId: other.id },
    { mode: 'elevator', from: 1, to: 5, dir: 1, groupId: group.id },
  ] });
  other.cars[0]!.passengers.push(person.id);
  demolishElevatorGroup(state, group.id);
  expect(person.failedTripsToday).toBe(1);
  expect(other.cars[0]!.passengers).toEqual([]);
  expect(person.route).toBeNull();
});

it('preserves a journey whose use of the removed shaft is already complete', () => {
  const { state, group, other, person } = fixture();
  Object.assign(person, { state: 'walking', legIndex: 1, route: [
    { mode: 'elevator', from: 3, to: 1, dir: -1, groupId: group.id },
    { mode: 'elevator', from: 1, to: 5, dir: 1, groupId: other.id },
  ] });
  demolishElevatorGroup(state, group.id);
  expect(person.failedTripsToday).toBe(0);
  expect(person.route).toHaveLength(2);
});

it('rejects demolition of an occupied shaft before changing any journeys', () => {
  const { state, group, person } = fixture();
  person.state = 'riding'; group.cars[0]!.passengers.push(person.id);
  const before = serializeGame(state);
  expect(() => demolishElevatorGroup(state, group.id)).toThrow('occupied');
  expect(serializeGame(state)).toBe(before);
});
