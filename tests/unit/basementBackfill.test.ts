import { expect, it } from 'vitest';
import { createInitialState, setupNewGame, placeTenant, buildFloor, demolishAt, placeElevatorGroup, serializeGame, deserializeGame } from '../../src/sim';
import { extendFloor, floorBounds, getFloor, trimFloor } from '../../src/sim/tower';
import { floorBuildPlan } from '../../src/game/floorBuild';

function fixture() {
  const state = createInitialState(); setupNewGame(state);
  for (let x = 20; x < 30; x++) placeTenant(state, 'lobby', 1, x);
  buildFloor(state, -1); buildFloor(state, -2);
  return state;
}

it('backfills either edge bottom-up without refunds and preserves saved bounds', () => {
  const state = fixture(); const before = serializeGame(state);
  expect(() => demolishAt(state, -1, 20)).toThrow('below first');
  expect(serializeGame(state)).toBe(before);
  const balance = state.money.balanceCents;
  demolishAt(state, -2, 20); demolishAt(state, -2, 29);
  demolishAt(state, -1, 20); demolishAt(state, 0, 20);
  const loaded = deserializeGame(serializeGame(state));
  expect(floorBounds(loaded, -2)).toEqual({ lo: 21, hi: 29 });
  expect(floorBounds(loaded, -1)).toEqual({ lo: 21, hi: 30 });
  expect(floorBounds(loaded, 0)).toEqual({ lo: 21, hi: 30 });
  expect(loaded.money.balanceCents).toBe(balance);
  extendFloor(loaded, -2, 29);
  expect(floorBounds(loaded, -2).hi).toBe(30);
});

it('preserves transport until explicitly removed and ignores unexcavated space', () => {
  const state = fixture(); placeElevatorGroup(state, -2, 1, 20);
  const before = serializeGame(state);
  expect(() => trimFloor(state, -2, 20)).toThrow('room or transport');
  expect(() => demolishAt(state, -2, 19)).toThrow('Nothing');
  expect(serializeGame(state)).toBe(before);
  demolishAt(state, -2, 20);
  expect(floorBounds(state, -2).lo).toBe(20);
  demolishAt(state, -2, 20);
  expect(floorBounds(state, -2).lo).toBe(21);
});

it('removes final deep cells and re-excavates empty B1 at the chosen offset', () => {
  const state = fixture();
  for (let x = 20; x < 30; x++) demolishAt(state, -2, x);
  expect(getFloor(state.tower, -2)).toBeUndefined();
  demolishAt(state, -1, 25);
  for (let x = 20; x < 30; x++) demolishAt(state, 0, x);
  expect(floorBounds(state, 0)).toEqual({ lo: 0, hi: 0 });
  expect(() => buildFloor(state, -1)).toThrow();
  const loaded = deserializeGame(serializeGame(state));
  const balance = loaded.money.balanceCents;
  expect(floorBuildPlan(loaded, { floor: 0, cell: 25 }, true)).toMatchObject({ extending: true, lo: 25, hi: 26, error: null });
  extendFloor(loaded, 0, 25);
  expect(floorBounds(loaded, 0)).toEqual({ lo: 25, hi: 26 });
  expect(loaded.money.balanceCents).toBe(balance - 500_00);
  buildFloor(loaded, -1);
  expect(floorBounds(loaded, -1)).toEqual({ lo: 25, hi: 26 });
});
