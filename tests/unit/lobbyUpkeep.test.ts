import { expect, it } from 'vitest';
import { createInitialState, setupNewGame, placeTenant, stepDailySettlement, serializeGame, deserializeGame } from '../../src/sim';

it.each([[1, 0], [2, 0], [3, 2100], [4, 7000], [5, 7000], [6, 7000]])('charges a seven-cell lobby at %i stars exactly $%i per quarter', (stars, cost) => {
  let state = createInitialState(); setupNewGame(state);
  for (let x = 20; x < 27; x++) placeTenant(state, 'lobby', 1, x);
  state.starLevel = stars!;
  const before = state.money.balanceCents;
  stepDailySettlement(state, 1);
  state = deserializeGame(serializeGame(state));
  stepDailySettlement(state, 2); stepDailySettlement(state, 3);
  expect(before - state.money.balanceCents).toBe(cost! * 100);
});

it('uses the current rating and expanded width at the next settlement', () => {
  const state = createInitialState(); setupNewGame(state);
  placeTenant(state, 'lobby', 1, 20);
  state.starLevel = 2; stepDailySettlement(state, 1);
  expect(state.money.dailyUpkeepCents).toBe(0);
  state.starLevel = 3; stepDailySettlement(state, 2);
  expect(state.money.dailyUpkeepCents).toBe(100_00);
  placeTenant(state, 'lobby', 1, 21);
  state.starLevel = 4; stepDailySettlement(state, 3);
  expect(state.money.dailyUpkeepCents).toBe(66_668);
});
