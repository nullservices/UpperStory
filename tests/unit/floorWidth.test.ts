import { expect, it } from 'vitest';
import { createInitialState, setupNewGame, placeTenant, buildFloor, placeStair, placeElevatorGroup, serializeGame, deserializeGame } from '../../src/sim';
import { extendFloor, floorBounds } from '../../src/sim/tower';
import { floorBuildPlan } from '../../src/game/floorBuild';

function fixture() {
  const state = createInitialState(); setupNewGame(state);
  for (let x = 20; x < 40; x++) placeTenant(state, 'lobby', 1, x);
  buildFloor(state, 2); buildFloor(state, 3);
  return state;
}

it('inherits the footprint below and blocks rooms or transport outside it', () => {
  const state = fixture();
  expect(floorBounds(state, 3)).toEqual({ lo: 20, hi: 40 });
  expect(() => placeTenant(state, 'office', 2, 35)).toThrow('Extend this floor');
  expect(() => placeStair(state, 3, 35)).toThrow('Extend this floor');
  expect(() => placeElevatorGroup(state, 2, 3, 38)).toThrow('Extend this floor');
  expect(() => placeTenant(state, 'office', 2, 20)).not.toThrow();
});

it('expands bottom-up in both directions, charges added cells, and saves the result', () => {
  const state = fixture();
  expect(() => extendFloor(state, 2, 19)).toThrow('below first');
  placeTenant(state, 'lobby', 1, 19); placeTenant(state, 'lobby', 1, 40);
  const before = state.money.balanceCents;
  expect(() => extendFloor(state, 3, 19)).toThrow('below first');
  extendFloor(state, 2, 19); extendFloor(state, 2, 40); extendFloor(state, 3, 19);
  expect(before - state.money.balanceCents).toBe(1500_00);
  const loaded = deserializeGame(serializeGame(state));
  expect(floorBounds(loaded, 2)).toEqual({ lo: 19, hi: 41 });
  expect(floorBounds(loaded, 3)).toEqual({ lo: 19, hi: 40 });
  expect(floorBuildPlan(loaded, { floor: 3, cell: 40 }).extending).toBe(true);
  expect(floorBuildPlan(loaded, { floor: 4, cell: 30 })).toMatchObject({ floor: 4, lo: 19, hi: 40, extending: false });
});

it('keeps legacy floor dimensions full-width', () => {
  const state = fixture();
  for (const floor of state.tower.floors) { delete floor.builtLo; delete floor.builtHi; }
  const saved = JSON.parse(serializeGame(state)); saved.version = 8;
  expect(floorBounds(deserializeGame(JSON.stringify(saved)), 2)).toEqual({ lo: 0, hi: 375 });
});
