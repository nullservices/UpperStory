import { expect, it } from 'vitest';
import { addElevatorCar, buildFloor, placeElevatorGroup, serializeGame, stepDailySettlement } from '../../src/sim';
import { newTestGame } from '../helpers/simHarness';

it.each([
  ['standard', 200_000, 80_000, 30_000],
  ['service', 100_000, 50_000, 30_000],
  ['express', 400_000, 150_000, 60_000],
] as const)('%s charges its purchase, additional car and exact quarterly upkeep', (kind, shaft, car, upkeep) => {
  const state = newTestGame(); state.starLevel = 5; buildFloor(state, 2);
  const before = state.money.balanceCents;
  const group = placeElevatorGroup(state, 1, 2, 10, kind);
  expect(state.money.balanceCents).toBe(before - shaft * 100);
  expect(group.cars).toHaveLength(1);
  addElevatorCar(state, group.id);
  expect(state.money.balanceCents).toBe(before - (shaft + car) * 100);
  const operatingBalance = state.money.balanceCents;
  for (let day = 1; day <= 3; day++) { state.calendar.day = day; stepDailySettlement(state); }
  expect(state.money.balanceCents).toBe(operatingBalance - upkeep * 100);
});

it('rejects an unaffordable shaft or extra car without spending or partial construction', () => {
  const state = newTestGame(); buildFloor(state, 2);
  state.money.balanceCents = 199_999_00;
  const before = serializeGame(state);
  expect(() => placeElevatorGroup(state, 1, 2, 10)).toThrow('funds');
  expect(serializeGame(state)).toBe(before);
  state.money.balanceCents = 200_000_00;
  const group = placeElevatorGroup(state, 1, 2, 10);
  const built = serializeGame(state);
  expect(() => addElevatorCar(state, group.id)).toThrow('funds');
  expect(serializeGame(state)).toBe(built);
});
