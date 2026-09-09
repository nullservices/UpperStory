import { expect, it } from 'vitest';
import { buildFloor, placeTenant, placeStair, placeEscalator, rebuildRouting, pickupRoute, demolishAt, serializeGame } from '../../src/sim';
import { newTestGame } from '../helpers/simHarness';
import { stairEscalatorCount } from '../../src/sim/tower';

function fixture(floors = 10) {
  const state = newTestGame(); state.starLevel = 5; state.money.balanceCents = 1_000_000_000_00;
  for (let floor = 2; floor <= floors; floor++) buildFloor(state, floor);
  return state;
}

it('allows four stair flights and seven escalator flights, but no longer trips', () => {
  const state = fixture();
  for (let floor = 2; floor <= 6; floor++) placeStair(state, floor, 4);
  for (let floor = 1; floor <= 8; floor++) placeEscalator(state, floor, 20, 'up');
  rebuildRouting(state);
  expect(pickupRoute(state, 1, 5, 'resident')![0]!.mode).toBe('stair');
  expect(pickupRoute(state, 1, 6, 'resident')![0]!.mode).toBe('escalator');
  expect(pickupRoute(state, 1, 8, 'resident')![0]!.mode).toBe('escalator');
  expect(pickupRoute(state, 1, 9, 'resident')).toBeNull();
  expect(pickupRoute(state, 6, 1, 'resident')).toBeNull();
});

it('shares the 64-link limit between stairs and escalators and frees demolished slots', () => {
  const state = fixture(); const funds = state.money.balanceCents;
  for (let x = 0; x < 63; x++) placeStair(state, 2, x);
  placeEscalator(state, 1, 100, 'up');
  expect(stairEscalatorCount(state)).toBe(64);
  expect(state.money.balanceCents).toBe(funds - (63 * 5000 + 20000) * 100);
  const before = serializeGame(state);
  expect(() => placeStair(state, 2, 200)).toThrow('64');
  expect(() => placeEscalator(state, 2, 200, 'up')).toThrow('64');
  expect(serializeGame(state)).toBe(before);
  demolishAt(state, 2, 0);
  placeEscalator(state, 2, 100, 'up');
  expect(stairEscalatorCount(state)).toBe(64);
});

it('counts cinemas and party halls together, including unfinished buildings', () => {
  const state = fixture();
  for (let i = 0; i < 8; i++) {
    placeTenant(state, 'cinema', 2, i * 40);
    placeTenant(state, 'partyHall', 4, i * 30);
  }
  expect(() => placeTenant(state, 'cinema', 6, 0)).toThrow('16');
  expect(() => placeTenant(state, 'partyHall', 6, 0)).toThrow('16');
  demolishAt(state, 3, 0);
  expect(() => placeTenant(state, 'partyHall', 6, 0)).not.toThrow();
});

it('enforces one shared 512-facility food and retail limit', () => {
  const state = fixture(40);
  const types = ['fastfood', 'restaurant', 'shop'] as const;
  for (let i = 0; i < 512; i++) placeTenant(state, types[i % 3]!, 2 + Math.floor(i / 15), (i % 15) * 24);
  for (const type of types) expect(() => placeTenant(state, type, 39, 0)).toThrow('512');
  demolishAt(state, 2, 0);
  expect(() => placeTenant(state, 'shop', 39, 0)).not.toThrow();
});

it('limits security offices to ten', () => {
  const state = fixture();
  for (let i = 0; i < 10; i++) placeTenant(state, 'security', 2, i * 16);
  expect(() => placeTenant(state, 'security', 3, 0)).toThrow('10');
});
