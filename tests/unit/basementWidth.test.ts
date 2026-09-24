import { expect, it } from 'vitest';
import { createInitialState, setupNewGame, placeTenant, buildFloor, serializeGame, deserializeGame, placeElevatorGroup } from '../../src/sim';
import { floorBounds, extendFloor } from '../../src/sim/tower';
import { floorBuildPlan } from '../../src/game/floorBuild';

it('starts unexcavated and inherits the offset lobby footprint down to B9', () => {
  const state = createInitialState(); setupNewGame(state);
  expect(floorBounds(state, 0)).toEqual({ lo: 0, hi: 0 });
  expect(() => buildFloor(state, -1)).toThrow('Build a lobby');
  for (let x = 20; x < 30; x++) placeTenant(state, 'lobby', 1, x);
  state.money.balanceCents = 10_000_000_00;
  for (let f = -1; f >= -8; f--) buildFloor(state, f);
  expect(floorBounds(state, -8)).toEqual({ lo: 20, hi: 30 });
  expect(() => buildFloor(state, -9)).toThrow('range');
  expect(() => placeElevatorGroup(state, -1, 1, 18)).toThrow('Extend this floor');
});

it('extends basements downward, charges only added cells and preserves saved widths', () => {
  const state = createInitialState(); setupNewGame(state);
  for (let x = 20; x < 30; x++) placeTenant(state, 'lobby', 1, x);
  buildFloor(state, -1); buildFloor(state, -2);
  placeTenant(state, 'lobby', 1, 19); placeTenant(state, 'lobby', 1, 30);
  expect(floorBounds(state, 0)).toEqual({ lo: 19, hi: 31 });
  expect(() => extendFloor(state, -2, 19)).toThrow('above first');
  const balance = state.money.balanceCents;
  extendFloor(state, -1, 19); extendFloor(state, -1, 30); extendFloor(state, -2, 19);
  expect(state.money.balanceCents).toBe(balance - 1500_00);
  const loaded = deserializeGame(serializeGame(state));
  expect(floorBounds(loaded, -2)).toEqual({ lo: 19, hi: 30 });
  expect(floorBuildPlan(loaded, { floor: -2, cell: 30 }, true)).toMatchObject({ floor: -2, extending: true, lo: 30, hi: 31, error: null });
  expect(floorBuildPlan(loaded, null, true)).toMatchObject({ floor: -3, extending: false, lo: 19, hi: 30 });
});

it('retains legacy full-width basements', () => {
  const state = createInitialState(); setupNewGame(state, true);
  buildFloor(state, -1);
  expect(floorBounds(deserializeGame(serializeGame(state)), 0)).toEqual({ lo: 0, hi: 375 });
  expect(floorBounds(state, -1)).toEqual({ lo: 0, hi: 375 });
});
