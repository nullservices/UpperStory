import { expect, it } from 'vitest';
import { createInitialState, setupNewGame, placeTenant, demolishAt, demolishTenant, buildFloor, placeElevatorGroup, serializeGame, deserializeGame } from '../../src/sim';

function fixture() {
  const state = createInitialState(); setupNewGame(state);
  for (let x = 20; x < 28; x++) placeTenant(state, 'lobby', 1, x);
  return state;
}

it('trims either edge without refunds and preserves the rest through save/load', () => {
  const state = fixture(); const balance = state.money.balanceCents;
  demolishAt(state, 1, 20); demolishAt(state, 1, 27);
  const loaded = deserializeGame(serializeGame(state));
  const lobby = [...loaded.tenants.values()][0]!;
  expect([lobby.x, lobby.sizeCells]).toEqual([21, 6]);
  expect(loaded.money.balanceCents).toBe(balance);
  expect(() => demolishAt(loaded, 1, 23)).toThrow('either edge');
  placeTenant(loaded, 'lobby', 1, 20);
  expect(lobby.sizeCells).toBe(7);
});

it('refuses to trim an elevator entrance without changing the save', () => {
  const state = fixture(); buildFloor(state, 2); placeElevatorGroup(state, 1, 2, 20);
  const before = serializeGame(state);
  expect(() => demolishTenant(state, 1, 20)).toThrow('elevator');
  expect(serializeGame(state)).toBe(before);
});

it('removes the final cell only when no upper tower or other facilities remain', () => {
  const state = createInitialState(); setupNewGame(state); placeTenant(state, 'lobby', 1, 20);
  buildFloor(state, 2);
  expect(() => demolishAt(state, 1, 20)).toThrow('last lobby cell');
  demolishAt(state, 2, 0); demolishAt(state, 1, 20);
  expect(state.tenants.size).toBe(0);
});
