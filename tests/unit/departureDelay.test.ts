import { expect, it } from 'vitest';
import { activeDepartureDelay, setDepartureDelay, stepElevators } from '../../src/sim/elevators';
import { spawnTenantPeople } from '../../src/sim/people';
import { callPending, joinQueue, pressCall } from '../../src/sim/queues';
import { serializeGame, deserializeGame, stepTime, tickToMinute } from '../../src/sim';
import { newTestGame, scenarioTower, setClock } from '../helpers/simHarness';

function fixture(delay = 30) {
  const state = newTestGame(); scenarioTower(state); setClock(state, 720);
  const group = [...state.elevatorGroups.values()][0]!; const car = group.cars[0]!;
  setDepartureDelay(state, group.id, 'weekday', 2, delay);
  const office = [...state.tenants.values()].find(t => t.type === 'office')!;
  spawnTenantPeople(state, office); const people = [...state.people.values()];
  function wait(index: number) {
    const p = people[index]!;
    p.route = [{ mode: 'elevator', from: 1, to: 5, dir: 1, groupId: group.id }];
    p.legIndex = 0; p.state = 'waiting'; p.pos = { floor: 1, x: group.x };
    joinQueue(state, p.id, 1, 'up'); pressCall(state, 1, 'up'); return p;
  }
  return { state, group, car, wait };
}

it('boards late arrivals during a delay and departs when game time reaches the deadline', () => {
  const { state, group, car, wait } = fixture();
  const first = wait(0); stepElevators(state);
  for (let i = 0; i < 2; i++) { stepTime(state); stepElevators(state); }
  expect(first.state).toBe('riding'); expect(car.state).toBe('doors');
  const later = wait(1); stepTime(state); stepElevators(state);
  expect(later.state).toBe('riding');
  expect(callPending(state, 1, 'up')).toBe(false);
  setDepartureDelay(state, group.id, 'weekday', 2, 0); // Does not cancel this stop.
  const restored = deserializeGame(serializeGame(state));
  for (let i = 0; i < 4; i++) { stepTime(state); stepElevators(state); stepTime(restored); stepElevators(restored); }
  expect(car.state).toBe('idle'); expect(car.departureAt).toBeUndefined();
  expect(serializeGame(restored)).toBe(serializeGame(state));
  stepElevators(state); expect(car.targetFloor).toBe(5);
});

it('keeps zero delay compatible with ordinary boarding', () => {
  const { state, car, wait } = fixture(0); wait(0); stepElevators(state);
  stepElevators(state); stepElevators(state);
  expect(car.state).toBe('idle'); expect(car.departureAt).toBeUndefined();
});

it.each([2299, 2599])('finishes its hold across the clock boundary after tick %i', tick => {
  const { state, group, car, wait } = fixture();
  state.calendar.tickOfDay = tick; state.calendar.minuteOfDay = tickToMinute(tick);
  setDepartureDelay(state, group.id, 'weekday', 5, 300);
  wait(0); stepElevators(state);
  for (let i = 0; i < 2; i++) { stepTime(state); stepElevators(state); }
  expect(car.state).toBe('doors');
  for (let i = 0; i < 10; i++) { stepTime(state); stepElevators(state); }
  expect(car.departureAt).toBeUndefined();
});

it('selects weekday/weekend periods and rejects invalid delays without mutation', () => {
  const { state, group } = fixture();
  setDepartureDelay(state, group.id, 'weekend', 2, 60);
  expect(activeDepartureDelay(state, group)).toBe(30);
  state.calendar.day = 3; expect(activeDepartureDelay(state, group)).toBe(60);
  setClock(state, 780); expect(activeDepartureDelay(state, group)).toBe(0);
  const before = serializeGame(state);
  for (const value of [-1, 301, 0.5, NaN]) expect(() => setDepartureDelay(state, group.id, 'weekday', 2, value)).toThrow();
  expect(serializeGame(state)).toBe(before);
});
