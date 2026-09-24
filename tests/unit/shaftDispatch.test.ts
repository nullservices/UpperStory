import { expect, it } from 'vitest';
import { placeElevatorGroup, serializeGame, deserializeGame } from '../../src/sim';
import { stepElevators } from '../../src/sim/elevators';
import { spawnTenantPeople } from '../../src/sim/people';
import { joinQueue, pressCall, clearCall } from '../../src/sim/queues';
import { newTestGame, scenarioTower } from '../helpers/simHarness';

function fixture() {
  const state = newTestGame(); scenarioTower(state);
  const first = [...state.elevatorGroups.values()][0]!;
  const second = placeElevatorGroup(state, 1, 5, 40);
  const office = [...state.tenants.values()].find(t => t.type === 'office')!;
  spawnTenantPeople(state, office);
  const people = [...state.people.values()];
  function wait(index: number, groupId: number, from: number, to: number) {
    const person = people[index]!; const dir = to > from ? 1 : -1;
    person.route = [{ mode: 'elevator', groupId, from, to, dir }];
    person.legIndex = 0; person.state = 'waiting'; person.pos = { floor: from, x: 0 };
    joinQueue(state, person.id, from, dir === 1 ? 'up' : 'down');
    pressCall(state, from, dir === 1 ? 'up' : 'down');
    return person;
  }
  return { state, first, second, wait };
}

it('does not dispatch an idle shaft to another shaft’s passengers', () => {
  const { state, first, second, wait } = fixture();
  wait(0, second.id, 4, 1);
  stepElevators(state);
  expect(first.cars[0]!.state).toBe('idle');
  expect(second.cars[0]!.targetFloor).toBe(4);
});

it('serves its own queue even after another car clears the shared hall signal', () => {
  const { state, first, second, wait } = fixture();
  const a = wait(0, first.id, 1, 5); const b = wait(1, second.id, 1, 4);
  stepElevators(state);
  expect(first.cars[0]!.state).toBe('doors');
  expect(second.cars[0]!.state).toBe('doors');
  clearCall(state, 1, 'up');
  const loaded = deserializeGame(serializeGame(state));
  for (let i = 0; i < 100; i++) { stepElevators(state); stepElevators(loaded); }
  expect(a.legIndex).toBe(1); expect(b.legIndex).toBe(1);
  expect(serializeGame(loaded)).toBe(serializeGame(state));
});

it('chooses the direction for its assigned riders when both hall queues are occupied', () => {
  const { state, first, second, wait } = fixture();
  first.cars[0]!.y = 3; second.cars[0]!.y = 3;
  wait(0, first.id, 3, 5); wait(1, second.id, 3, 1);
  stepElevators(state);
  expect(first.cars[0]!.dir).toBe(1);
  expect(second.cars[0]!.dir).toBe(-1);
});

it('passes a same-direction call assigned to another shaft while travelling', () => {
  const { state, first, second, wait } = fixture();
  wait(0, second.id, 3, 5);
  const car = first.cars[0]!;
  car.y = 2.99; car.lastFloor = 2; car.dir = 1;
  car.state = 'moving'; car.targetFloor = 5;
  stepElevators(state);
  expect(car.y).toBeGreaterThan(3);
  expect(car.state).toBe('moving');
  expect(car.targetFloor).toBe(5);
});
