import { expect, it } from 'vitest';
import { setCarHome, stepElevators } from '../../src/sim/elevators';
import { pressCall, joinQueue } from '../../src/sim/queues';
import { spawnTenantPeople } from '../../src/sim/people';
import { serializeGame, deserializeGame } from '../../src/sim';
import { newTestGame, scenarioTower } from '../helpers/simHarness';

function fixture() {
  const state = newTestGame(); scenarioTower(state);
  const group = [...state.elevatorGroups.values()][0]!;
  return { state, group, car: group.cars[0]! };
}

it('visits a newly assigned home before taking a new hall call', () => {
  const { state, group, car } = fixture();
  pressCall(state, 2, 'up'); setCarHome(state, group.id, car.id, 5);
  stepElevators(state); expect(car.targetFloor).toBe(5);
  let reached = false;
  for (let i = 0; i < 100; i++) {
    stepElevators(state);
    if (car.y === 5) { reached = true; break; }
    expect(car.state).toBe('moving');
  }
  expect(reached).toBe(true); expect(car.homeReassignmentPending).toBeUndefined();
});

it('delivers riders before relocating and does not board new riders along the way', () => {
  const { state, group, car } = fixture();
  spawnTenantPeople(state, [...state.tenants.values()].find(t => t.type === 'office')!);
  const [rider, waiter] = [...state.people.values()];
  rider!.route = [{ mode: 'elevator', groupId: group.id, from: 1, to: 3, dir: 1 }];
  rider!.legIndex = 0; rider!.state = 'riding'; car.passengers.push(rider!.id);
  waiter!.route = [{ mode: 'elevator', groupId: group.id, from: 3, to: 4, dir: 1 }];
  waiter!.legIndex = 0; waiter!.state = 'waiting';
  joinQueue(state, waiter!.id, 3, 'up'); pressCall(state, 3, 'up');
  setCarHome(state, group.id, car.id, 5);
  stepElevators(state); expect(car.targetFloor).toBe(3);
  for (let i = 0; i < 100 && rider!.legIndex === 0; i++) stepElevators(state);
  expect(rider!.legIndex).toBe(1); expect(waiter!.state).toBe('waiting');
  stepElevators(state); expect(car.targetFloor).toBe(5);
  const restored = deserializeGame(serializeGame(state));
  for (let i = 0; i < 100; i++) { stepElevators(state); stepElevators(restored); }
  expect(waiter!.legIndex).toBe(1);
  expect(serializeGame(restored)).toBe(serializeGame(state));
});

it('does not interrupt a car when its unchanged home is selected again', () => {
  const { state, group, car } = fixture();
  car.y = 3; const before = serializeGame(state);
  setCarHome(state, group.id, car.id, 1);
  expect(serializeGame(state)).toBe(before);
});
