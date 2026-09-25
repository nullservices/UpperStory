import { expect, it } from 'vitest';
import { addElevatorCar, setCarHome, setElevatorStop, setElevatorServiceRange } from '../../src/sim/elevators';
import { serializeGame, deserializeGame } from '../../src/sim';
import { newTestGame, scenarioTower } from '../helpers/simHarness';

it('assigns new cars homes and protects a floor until every car is reassigned', () => {
  const state = newTestGame(); scenarioTower(state);
  const group = [...state.elevatorGroups.values()][0]!;
  addElevatorCar(state, group.id);
  expect(group.cars.map(c => c.homeFloor)).toEqual([1, 1]);
  const before = serializeGame(state);
  expect(() => setElevatorStop(state, group.id, 1, false)).toThrow('car home');
  expect(() => setElevatorServiceRange(state, group.id, 2, 5)).toThrow('car homes');
  expect(() => setCarHome(state, group.id, group.cars[0]!.id, null)).toThrow('serviced stop');
  expect(serializeGame(state)).toBe(before);
  setCarHome(state, group.id, group.cars[0]!.id, 2);
  expect(() => setElevatorStop(state, group.id, 1, false)).toThrow('car home');
  setCarHome(state, group.id, group.cars[1]!.id, 2);
  setElevatorStop(state, group.id, 1, false);
  addElevatorCar(state, group.id);
  expect(group.cars[2]!.homeFloor).toBe(2);
  const restored = deserializeGame(serializeGame(state));
  expect(restored.elevatorGroups.get(group.id)!.cars.map(c => c.homeFloor)).toEqual([2, 2, 2]);
});

it('preserves unassigned legacy cars until the player selects a home', () => {
  const state = newTestGame(); scenarioTower(state);
  const group = [...state.elevatorGroups.values()][0]!;
  delete group.cars[0]!.homeFloor;
  const restored = deserializeGame(serializeGame(state));
  const car = restored.elevatorGroups.get(group.id)!.cars[0]!;
  expect(car.homeFloor).toBeUndefined();
  setCarHome(restored, group.id, car.id, 3);
  expect(car.homeFloor).toBe(3);
});
