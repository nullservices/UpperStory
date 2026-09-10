import { expect, it } from 'vitest';
import { newTestGame } from '../helpers/simHarness';
import { buildFloor, placeStair, placeEscalator, demolishAt, getFloor, deserializeGame, serializeGame, pickupRoute, rebuildRouting } from '../../src/sim';
import { stairEscalatorCount } from '../../src/sim/tower';

it('reserves and demolishes eight stair cells as one installation', () => {
  const state = newTestGame(); buildFloor(state, 2);
  placeStair(state, 2, 20);
  expect(stairEscalatorCount(state)).toBe(1);
  expect(() => placeStair(state, 2, 27)).toThrow('occupied');
  expect(() => placeStair(state, 2, 368)).toThrow('fit');
  demolishAt(state, 2, 27);
  expect(getFloor(state.tower, 2)!.cells.slice(20, 28).every(c => c.content === 'empty')).toBe(true);
  expect(stairEscalatorCount(state)).toBe(0);
});

it('preserves shared escalator landings when a link is demolished from its far edge', () => {
  const state = newTestGame(); for (let f = 2; f <= 3; f++) buildFloor(state, f);
  placeEscalator(state, 1, 20, 'up'); placeEscalator(state, 2, 20, 'up');
  expect(() => placeEscalator(state, 2, 21, 'up')).toThrow('occupied');
  const loaded = deserializeGame(serializeGame(state));
  demolishAt(loaded, 3, 27);
  expect(loaded.escalators.size).toBe(1);
  expect(getFloor(loaded.tower, 2)!.cells.slice(20, 28).every(c => c.content === 'escalator')).toBe(true);
  expect(getFloor(loaded.tower, 3)!.cells.slice(20, 28).every(c => c.content === 'empty')).toBe(true);
  rebuildRouting(loaded); expect(pickupRoute(loaded, 1, 2, 'resident')![0]!.mode).toBe('escalator');
});

it('loads legacy single-cell stairs without expanding into neighboring cells', () => {
  const state = newTestGame(); buildFloor(state, 2);
  getFloor(state.tower, 2)!.cells[20] = { content: 'stair', tenantId: -1 };
  getFloor(state.tower, 2)!.cells[21] = { content: 'stair', tenantId: -1 };
  const saved = JSON.parse(serializeGame(state)); saved.version = 4;
  const loaded = deserializeGame(JSON.stringify(saved));
  expect(stairEscalatorCount(loaded)).toBe(2);
  demolishAt(loaded, 2, 20);
  expect(getFloor(loaded.tower, 2)!.cells[21]!.content).toBe('stair');
});
