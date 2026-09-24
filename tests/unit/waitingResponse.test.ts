import { expect, it } from 'vitest';
import { activeWaitingResponse, addElevatorCar, setWaitingResponse, stepElevators } from '../../src/sim/elevators';
import { pressCall } from '../../src/sim/queues';
import { serializeGame, deserializeGame } from '../../src/sim';
import { newTestGame, scenarioTower } from '../helpers/simHarness';

function fixture() {
  const state = newTestGame(); scenarioTower(state);
  const group = [...state.elevatorGroups.values()][0]!;
  addElevatorCar(state, group.id);
  const idle = group.cars[0]!; idle.y = 3;
  const moving = group.cars[1]!;
  moving.y = 1; moving.dir = 1; moving.state = 'moving'; moving.targetFloor = 5;
  pressCall(state, 4, 'up');
  return { state, group, idle, moving };
}

it('favors an approaching car unless the idle car is sufficiently closer', () => {
  const a = fixture(); stepElevators(a.state); expect(a.idle.state).toBe('idle');
  const b = fixture(); setWaitingResponse(b.state, b.group.id, 'weekday', 0, 1);
  stepElevators(b.state); expect(b.idle.targetFloor).toBe(4);
  const c = fixture(); setWaitingResponse(c.state, c.group.id, 'weekday', 0, 2);
  stepElevators(c.state); expect(c.idle.targetFloor).toBe(4);
});

it.each(['full', 'opposite', 'short'] as const)('ignores a %s moving car that cannot collect the call', reason => {
  const { state, idle, moving } = fixture();
  if (reason === 'full') moving.passengers = Array<number>(21).fill(9999);
  if (reason === 'opposite') { moving.y = 5; moving.dir = -1; moving.targetFloor = 1; }
  if (reason === 'short') moving.targetFloor = 2;
  stepElevators(state); expect(idle.targetFloor).toBe(4);
});

it('switches periods and weekends, rejects invalid settings, and saves the schedule', () => {
  const { state, group } = fixture();
  expect(activeWaitingResponse(state, group)).toBe(5);
  setWaitingResponse(state, group.id, 'weekday', 1, 3);
  setWaitingResponse(state, group.id, 'weekend', 1, 8);
  state.calendar.minuteOfDay = 600; expect(activeWaitingResponse(state, group)).toBe(3);
  state.calendar.day = 3; expect(activeWaitingResponse(state, group)).toBe(8);
  for (const value of [-1, 101, 1.5, NaN]) expect(() => setWaitingResponse(state, group.id, 'weekday', 0, value)).toThrow();
  const restored = deserializeGame(serializeGame(state));
  for (let i = 0; i < 100; i++) { stepElevators(state); stepElevators(restored); }
  expect(serializeGame(restored)).toBe(serializeGame(state));
});
