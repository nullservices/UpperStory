import { expect, it } from 'vitest';
import {
  buildFloor, demolishAt, demolishTenant, deserializeGame, getFloor, pickupRoute, placeElevatorGroup,
  placeStair, rebuildRouting, serializeGame, stairPlacementError,
} from '../../src/sim';
import { stairEscalatorCount } from '../../src/sim/tower';
import { newTestGame } from '../helpers/simHarness';

function basements(depth: number) {
  const state = newTestGame();
  for (let f = -1; f >= -depth; f--) buildFloor(state, f);
  return state;
}

it('links B1 to the lobby without painting lobby tiles, and basements to each other', () => {
  const state = basements(2);
  const lobbyCell = { ...getFloor(state.tower, 1)!.cells[20]! };
  placeStair(state, 0, 20); // B1↔lobby
  placeStair(state, -1, 20); // B2↔B1
  expect(getFloor(state.tower, 0)!.cells[20]!.content).toBe('stair');
  expect(getFloor(state.tower, -1)!.cells[20]!.content).toBe('stair');
  expect(getFloor(state.tower, 1)!.cells[20]).toEqual(lobbyCell);
  expect(stairEscalatorCount(state)).toBe(2);
  rebuildRouting(state);
  expect(pickupRoute(state, 1, -1, 'resident')).toEqual([
    { mode: 'stair', from: 1, to: 0, dir: -1, x: 20 },
    { mode: 'stair', from: 0, to: -1, dir: -1, x: 20 },
  ]);
  expect(pickupRoute(state, -1, 0, 'resident')).toEqual([{ mode: 'stair', from: -1, to: 0, dir: 1, x: 20 }]);
  const loaded = deserializeGame(serializeGame(state));
  rebuildRouting(loaded);
  expect(pickupRoute(loaded, 0, 1, 'resident')).toEqual([{ mode: 'stair', from: 0, to: 1, dir: 1, x: 20 }]);
});

it('places an upper stair without a stair below; each placement is a single link', () => {
  const state = newTestGame();
  for (let f = 2; f <= 4; f++) buildFloor(state, f);
  placeStair(state, 3, 40); // 2↔3 only
  rebuildRouting(state);
  expect(pickupRoute(state, 2, 3, 'resident')).toEqual([{ mode: 'stair', from: 2, to: 3, dir: 1, x: 40 }]);
  expect(pickupRoute(state, 1, 3, 'resident')).toBeNull();
  expect(pickupRoute(state, 3, 4, 'resident')).toBeNull();
});

it('chains offset stairs by walking across the landing', () => {
  const state = newTestGame();
  for (let f = 2; f <= 3; f++) buildFloor(state, f);
  placeStair(state, 2, 0);
  placeStair(state, 3, 40);
  placeStair(state, 3, 100);
  rebuildRouting(state);
  expect(pickupRoute(state, 1, 3, 'resident')).toEqual([
    { mode: 'stair', from: 1, to: 2, dir: 1, x: 0 },
    { mode: 'stair', from: 2, to: 3, dir: 1, x: 40 },
  ]);
});

it('keeps the four-flight stair limit across the lobby', () => {
  const state = basements(3);
  buildFloor(state, 2); buildFloor(state, 3);
  for (const f of [3, 2, 0, -1, -2]) placeStair(state, f, 60);
  rebuildRouting(state);
  expect(pickupRoute(state, 3, -1, 'resident')).toHaveLength(4);
  expect(pickupRoute(state, 3, -2, 'resident')).toBeNull();
});

it('keeps lobby stair landings clear of elevator shafts', () => {
  const state = newTestGame();
  buildFloor(state, 2);
  placeElevatorGroup(state, 1, 2, 100);
  expect(stairPlacementError(state, 0, 98)).toBe('Space is occupied');
  expect(stairPlacementError(state, 2, 98)).toBe('Space is occupied');
  placeStair(state, 0, 20);
  expect(() => placeElevatorGroup(state, 1, 2, 22)).toThrow('Space is occupied');
});

it('removes a B1 stair from its lobby landing, and protects the lobby above it', () => {
  const state = newTestGame();
  placeStair(state, 0, 0);
  expect(() => demolishTenant(state, 1, 0)).toThrow('Remove the stairs');
  demolishAt(state, 1, 3);
  expect(getFloor(state.tower, 0)!.cells[0]!.content).toBe('empty');
  expect(getFloor(state.tower, 1)!.cells[0]!.content).toBe('tenant');
  expect(stairEscalatorCount(state)).toBe(0);
});
