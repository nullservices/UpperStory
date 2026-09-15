import { expect, it } from 'vitest';
import { createInitialState, setupNewGame, placeTenant, buildFloor, placeStair, placeEscalator, placeElevatorGroup } from '../../src/sim';

it.each(['stairs', 'escalator', 'standard', 'service', 'express'] as const)('requires complete lobby coverage for %s', kind => {
  const state = createInitialState(); setupNewGame(state); state.starLevel = 5;
  const width = kind === 'stairs' || kind === 'escalator' ? 8 : kind === 'express' ? 6 : 4;
  for (let x = 20; x < 20 + width - 1; x++) placeTenant(state, 'lobby', 1, x);
  buildFloor(state, 2);
  const build = () => kind === 'stairs' ? placeStair(state, 2, 20)
    : kind === 'escalator' ? placeEscalator(state, 1, 20, 'up') : placeElevatorGroup(state, 1, 2, 20, kind);
  const balance = state.money.balanceCents;
  expect(build).toThrow('Extend the lobby');
  expect(state.money.balanceCents).toBe(balance);
  placeTenant(state, 'lobby', 1, 20 + width - 1);
  expect(build).not.toThrow();
});
