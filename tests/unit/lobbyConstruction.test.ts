import { expect, it } from 'vitest';
import { createInitialState, setupNewGame, serializeGame, deserializeGame, placeTenant } from '../../src/sim';
import { BuildStroke } from '../../src/game/buildStroke';

it('starts player games without a free full-width lobby', () => {
  const state = createInitialState(); const balance = state.money.balanceCents;
  setupNewGame(state);
  expect(state.tenants.size).toBe(0);
  expect(state.money.balanceCents).toBe(balance);
});

it('drags and extends one continuous lobby in both directions at $5,000 per cell', () => {
  const state = createInitialState(); setupNewGame(state);
  const balance = state.money.balanceCents;
  const stroke = new BuildStroke('lobby', 1, 20); stroke.extend(state, 24); stroke.extend(state, 18);
  expect(state.tenants.size).toBe(1);
  const lobby = [...state.tenants.values()][0]!;
  expect([lobby.x, lobby.sizeCells]).toEqual([18, 7]);
  expect(state.money.balanceCents).toBe(balance - 7 * 5_000_00);
  const loaded = deserializeGame(serializeGame(state));
  placeTenant(loaded, 'lobby', 1, 25);
  expect(loaded.tenants.get(lobby.id)!.sizeCells).toBe(8);
  expect(() => placeTenant(loaded, 'lobby', 1, 30)).toThrow('either edge');
});

it('stops lobby construction at the available budget', () => {
  const state = createInitialState(); setupNewGame(state); state.money.balanceCents = 10_000_00;
  const stroke = new BuildStroke('lobby', 1, 20); stroke.extend(state, 24);
  expect([...state.tenants.values()][0]!.sizeCells).toBe(2);
  expect(state.money.balanceCents).toBe(0);
});
