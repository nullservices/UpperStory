import { expect, it } from 'vitest';
import { createInitialState, setupNewGame, placeTenant, buildFloor, demolishAt, serializeGame, deserializeGame, placeElevatorGroup } from '../../src/sim';
import { floorBounds, trimFloor, extendFloor, getFloor } from '../../src/sim/tower';

function fixture() {
  const state = createInitialState(); setupNewGame(state);
  for (let x = 20; x < 40; x++) placeTenant(state, 'lobby', 1, x);
  buildFloor(state, 2); buildFloor(state, 3);
  return state;
}

it('trims downward from either edge, preserves bounds in saves, and allows rebuilding', () => {
  const state = fixture(); const before = serializeGame(state);
  expect(() => demolishAt(state, 2, 20)).toThrow('floor above');
  expect(serializeGame(state)).toBe(before);
  const balance = state.money.balanceCents;
  demolishAt(state, 3, 20); demolishAt(state, 3, 39);
  demolishAt(state, 2, 20); demolishAt(state, 1, 20);
  const loaded = deserializeGame(serializeGame(state));
  expect(floorBounds(loaded, 3)).toEqual({ lo: 21, hi: 39 });
  expect(floorBounds(loaded, 2)).toEqual({ lo: 21, hi: 40 });
  expect(loaded.money.balanceCents).toBe(balance);
  extendFloor(loaded, 3, 39);
  expect(floorBounds(loaded, 3)).toEqual({ lo: 21, hi: 40 });
});

it('protects rooms, transport, interior cells and unbuilt space', () => {
  const state = fixture();
  placeTenant(state, 'office', 3, 20);
  placeElevatorGroup(state, 2, 3, 36);
  const before = serializeGame(state);
  expect(() => trimFloor(state, 3, 20)).toThrow('room or transport');
  expect(() => trimFloor(state, 3, 39)).toThrow('room or transport');
  expect(() => trimFloor(state, 3, 30)).toThrow('either edge');
  expect(() => demolishAt(state, 3, 19)).toThrow('Nothing');
  expect(serializeGame(state)).toBe(before);
  demolishAt(state, 3, 20); // First click removes the room, preserving its floor.
  expect(floorBounds(state, 3)).toEqual({ lo: 20, hi: 40 });
  demolishAt(state, 3, 20);
  expect(floorBounds(state, 3).lo).toBe(21);
});

it('removes the final top-floor cell and retains whole-floor demolition from the interior', () => {
  const state = fixture();
  demolishAt(state, 3, 30);
  expect(getFloor(state.tower, 3)).toBeUndefined();
  for (let x = 20; x < 40; x++) demolishAt(state, 2, x);
  expect(getFloor(state.tower, 2)).toBeUndefined();
  expect([...state.tenants.values()][0]!.sizeCells).toBe(20);
});
