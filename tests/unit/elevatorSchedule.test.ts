import { expect, it } from 'vitest';
import { activePriority, setCarHome, setElevatorPriority, setElevatorServiceRange, setElevatorStop, stepElevators } from '../../src/sim/elevators';
import { joinQueue, pressCall } from '../../src/sim/queues';
import { spawnTenantPeople } from '../../src/sim/people';
import { buildFloor, deserializeGame, serializeGame, checkRouting, pickupRoute } from '../../src/sim';
import { newTestGame, scenarioTower, tickN } from '../helpers/simHarness';

function fixture() {
  const state = newTestGame(); scenarioTower(state);
  const group = [...state.elevatorGroups.values()][0]!;
  return { state, group, car: group.cars[0]! };
}

it('switches priorities at period boundaries and distinguishes weekends', () => {
  const { state, group } = fixture();
  setElevatorPriority(state, group.id, 'weekday', 0, 'up');
  setElevatorPriority(state, group.id, 'weekday', 1, 'down');
  setElevatorPriority(state, group.id, 'weekend', 5, 'up');
  state.calendar.minuteOfDay = 599; expect(activePriority(state, group)).toBe('up');
  state.calendar.minuteOfDay = 600; expect(activePriority(state, group)).toBe('down');
  state.calendar.day = 3; expect(activePriority(state, group)).toBe('normal');
  state.calendar.minuteOfDay = 1500; expect(activePriority(state, group)).toBe('up');
});

it('serves preferred calls first and serves the other direction when none remain', () => {
  const { state, group, car } = fixture();
  setElevatorPriority(state, group.id, 'weekday', 0, 'up');
  pressCall(state, 2, 'down'); pressCall(state, 5, 'up');
  stepElevators(state); expect(car.targetFloor).toBe(5);
  for (let i = 0; i < 100; i++) stepElevators(state);
  expect(car.y).toBe(2);
});

it('keeps passenger destinations ahead of priority calls and home floors', () => {
  const { state, group, car } = fixture();
  const office = [...state.tenants.values()].find(t => t.type === 'office')!;
  spawnTenantPeople(state, office);
  const passenger = [...state.people.values()][0]!;
  passenger.route = [{ mode: 'elevator', from: 1, to: 3, dir: 1, groupId: group.id }];
  passenger.legIndex = 0; passenger.state = 'riding'; car.passengers.push(passenger.id);
  setCarHome(state, group.id, car.id, 4);
  setElevatorPriority(state, group.id, 'weekday', 0, 'up');
  pressCall(state, 5, 'up'); stepElevators(state);
  expect(car.targetFloor).toBe(3);
});

it('parks at home without cycling its doors and responds to new calls', () => {
  const { state, group, car } = fixture();
  setCarHome(state, group.id, car.id, 4);
  for (let i = 0; i < 100; i++) stepElevators(state);
  expect(car.y).toBe(4); expect(car.state).toBe('idle');
  for (let i = 0; i < 20; i++) { stepElevators(state); expect(car.state).toBe('idle'); }
  pressCall(state, 1, 'up'); stepElevators(state); expect(car.targetFloor).toBe(1);
});

it('rejects invalid home stops and clears a home removed by shaft resizing', () => {
  const { state, group, car } = fixture();
  expect(() => setCarHome(state, group.id, car.id, 8)).toThrow('serviced stop');
  setCarHome(state, group.id, car.id, 5);
  setElevatorServiceRange(state, group.id, 1, 3);
  expect(car.homeFloor).toBeNull();
  expect(() => setElevatorPriority(state, group.id, 'weekday', 6, 'up')).toThrow('Invalid');
});

it('preserves scheduled service and home floors through deterministic save replay', () => {
  const { state, group, car } = fixture();
  setCarHome(state, group.id, car.id, 4);
  setElevatorPriority(state, group.id, 'weekday', 0, 'up');
  const restored = deserializeGame(serializeGame(state));
  tickN(state, 200); tickN(restored, 200);
  expect(serializeGame(restored)).toBe(serializeGame(state));
});

it.each([1, 5])('finishes a trip from floor %i after its stop is disabled', from => {
  const { state, group } = fixture();
  const to = from === 1 ? 5 : 1;
  const office = [...state.tenants.values()].find(t => t.type === 'office')!;
  spawnTenantPeople(state, office);
  const person = [...state.people.values()][0]!;
  person.route = [{ mode: 'elevator', from, to, dir: to > from ? 1 : -1, groupId: group.id }];
  person.legIndex = 0; person.state = 'waiting'; person.pos = { floor: from, x: 11 };
  joinQueue(state, person.id, from, to > from ? 'up' : 'down');
  pressCall(state, from, to > from ? 'up' : 'down');
  setElevatorStop(state, group.id, 5, false); checkRouting(state);
  expect(pickupRoute(state, 1, 5, 'officeWorker')).toBeNull();
  for (let i = 0; i < 200; i++) stepElevators(state);
  expect(person.state).toBe('walking'); expect(person.pos.floor).toBe(to);
  expect(person.legIndex).toBe(1);
  setElevatorStop(state, group.id, 5, true); checkRouting(state);
  expect(pickupRoute(state, 1, 5, 'officeWorker')).not.toBeNull();
});

it('retains disabled stops on extension and save, without disabling new floors', () => {
  const { state, group, car } = fixture();
  setCarHome(state, group.id, car.id, 5);
  setElevatorStop(state, group.id, 5, false);
  expect(car.homeFloor).toBeNull();
  buildFloor(state, 6); setElevatorServiceRange(state, group.id, 1, 6);
  expect(group.stops).toEqual([1, 2, 3, 4, 6]);
  const restored = deserializeGame(serializeGame(state));
  expect(restored.elevatorGroups.get(group.id)!.disabledStops).toEqual([5]);
  for (const floor of [1, 2, 3]) setElevatorStop(state, group.id, floor, false);
  const before = serializeGame(state);
  expect(() => setElevatorStop(state, group.id, 4, false)).toThrow('two stops');
  expect(() => setElevatorServiceRange(state, group.id, 1, 3)).toThrow('two stops');
  expect(serializeGame(state)).toBe(before);
});
