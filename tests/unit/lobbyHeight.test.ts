import { expect, it } from 'vitest';
import { buildFloor, carWorldY, createInitialState, deserializeGame, floorHeightPx, floorIndexAtWorldY, floorTopY, serializeGame, setupNewGame } from '../../src/sim';
import { Motion } from '../../src/render/motion';
import { placeElevatorGroup, stepElevators } from '../../src/sim/elevators';

it.each([1, 2, 3] as const)('keeps geometry, picking and elevator interpolation aligned for a %i-story lobby', height => {
  const state = createInitialState(1); state.tower.lobbyHeight = height; setupNewGame(state);
  for (let floor = 2; floor <= 5; floor++) buildFloor(state, floor);
  for (const floor of state.tower.floors) {
    const top = floorTopY(floor.index, height);
    const size = floorHeightPx(floor, height);
    expect(floorIndexAtWorldY(top + size / 2, height)).toBe(floor.index);
    if (floor.index === 1) expect(top + size).toBe(0);
  }
  expect(floorTopY(2, height)).toBe(-20 * (height + 1));
  expect(carWorldY(1, height)).toBe(-20);
  expect(carWorldY(2, height)).toBe(floorTopY(2, height));
  for (const boundary of [0, 1, 2]) expect(Math.abs(carWorldY(boundary - 0.00001, height) - carWorldY(boundary + 0.00001, height))).toBeLessThan(0.002);
  const group = placeElevatorGroup(state, 1, 5, 10); const car = group.cars[0]!;
  const motion = new Motion(); car.y = 1; motion.capture(state); car.y = 2;
  expect(motion.carY(state, car.id, car.y, 0.5)).toBe((-20 + floorTopY(2, height)) / 2);
  expect(deserializeGame(serializeGame(state)).tower.lobbyHeight).toBe(height);
});

it.each([1, 2])('preserves the two-story geometry of version %i saves', version => {
  const state = createInitialState(1); setupNewGame(state);
  const saved = JSON.parse(serializeGame(state)); saved.version = version; delete saved.state.tower.lobbyHeight;
  const restored = deserializeGame(JSON.stringify(saved));
  expect(restored.tower.lobbyHeight).toBe(2);
  expect(floorTopY(2, restored.tower.lobbyHeight)).toBe(-60);
});

it.each([1, 2, 3] as const)('maintains elevator travel speed through a %i-story lobby in both directions', height => {
  const state = createInitialState(1); state.tower.lobbyHeight = height; setupNewGame(state);
  buildFloor(state, 2);
  const car = placeElevatorGroup(state, 1, 2, 10).cars[0]!;
  for (const [from, to] of [[1, 2], [2, 1]] as const) {
    car.y = from; car.targetFloor = to; car.state = 'moving'; car.dir = to > from ? 1 : -1;
    const start = carWorldY(from, height);
    stepElevators(state);
    expect(Math.abs(carWorldY(car.y, height) - start)).toBeCloseTo(4);
    for (let tick = 1; tick <= height * 5; tick++) stepElevators(state);
    expect(car.y).toBe(to);
    expect(car.state).toBe('doors');
  }
});

it('rejects an invalid lobby height in a current save', () => {
  const state = createInitialState(1); setupNewGame(state);
  const saved = JSON.parse(serializeGame(state)); saved.state.tower.lobbyHeight = 8;
  expect(() => deserializeGame(JSON.stringify(saved))).toThrow('Invalid lobby height');
});
