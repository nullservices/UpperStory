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

it('demolishes stairs from their lobby landing without removing the lobby', () => {
  const state = newTestGame(); buildFloor(state, 2); placeStair(state, 2, 20);
  const lobby = getFloor(state.tower, 1)!.cells[27];
  demolishAt(state, 1, 27);
  expect(getFloor(state.tower, 1)!.cells[27]).toEqual(lobby);
  expect(stairEscalatorCount(state)).toBe(0);
});

it('extends a legacy stair anchor with a modern flight without widening the old floor', () => {
  const state = newTestGame(); buildFloor(state, 2); buildFloor(state, 3);
  const lower = getFloor(state.tower, 2)!;
  lower.cells[20] = { content: 'stair', tenantId: -1 };
  lower.cells[21] = { content: 'stair', tenantId: -1 };
  const loaded = deserializeGame(serializeGame(state));
  placeStair(loaded, 3, 20);
  expect(getFloor(loaded.tower, 2)!.cells[20]!.transportWidth).toBeUndefined();
  expect(getFloor(loaded.tower, 2)!.cells[21]!.content).toBe('stair');
  expect(getFloor(loaded.tower, 3)!.cells.slice(20, 28).every(c => c.transportWidth === 8)).toBe(true);
  rebuildRouting(loaded);
  expect(pickupRoute(loaded, 1, 3, 'resident')).not.toBeNull();
  demolishAt(loaded, 3, 27);
  expect(stairEscalatorCount(loaded)).toBe(2);
});

it('removes only the lobby escalator when its upper landing is shared', () => {
  const state = newTestGame(); buildFloor(state, 2); buildFloor(state, 3);
  placeEscalator(state, 1, 20, 'up'); placeEscalator(state, 2, 20, 'up');
  const lobby = getFloor(state.tower, 1)!.cells[27];
  demolishAt(state, 1, 27);
  expect(state.escalators.has('1:20')).toBe(false);
  expect(state.escalators.has('2:20')).toBe(true);
  expect(getFloor(state.tower, 1)!.cells[27]).toEqual(lobby);
  expect(getFloor(state.tower, 2)!.cells[27]!.content).toBe('escalator');
});

it('extends legacy escalators and clears mixed-width landings on demolition', () => {
  const state = newTestGame(); for (let f = 2; f <= 4; f++) buildFloor(state, f);
  for (const f of [2, 3]) getFloor(state.tower, f)!.cells[20] = { content: 'escalator', tenantId: -1 };
  state.escalators.set('2:20', 'up');
  placeEscalator(state, 3, 20, 'up');
  expect(getFloor(state.tower, 2)!.cells[20]!.transportWidth).toBeUndefined();
  expect(getFloor(state.tower, 3)!.cells[27]!.transportWidth).toBe(8);
  demolishAt(state, 4, 27);
  demolishAt(state, 2, 20);
  expect(state.escalators.size).toBe(0);
  expect(getFloor(state.tower, 3)!.cells.slice(20, 28).every(c => c.content === 'empty')).toBe(true);
});

it('does not widen a legacy escalator into occupied neighboring space', () => {
  const state = newTestGame(); for (let f = 2; f <= 4; f++) buildFloor(state, f);
  getFloor(state.tower, 3)!.cells[20] = { content: 'escalator', tenantId: -1 };
  getFloor(state.tower, 3)!.cells[21] = { content: 'stair', tenantId: -1 };
  state.escalators.set('2:20', 'up');
  const balance = state.money.balanceCents;
  expect(() => placeEscalator(state, 3, 20, 'up')).toThrow('occupied');
  expect(state.money.balanceCents).toBe(balance);
  expect(getFloor(state.tower, 3)!.cells[21]!.content).toBe('stair');
});
