import { expect, it } from 'vitest';
import { TENANT_DATA } from '../../src/data/config';
import { buildFloor, isUnlocked, placementError, type TenantType } from '../../src/sim';
import { toolUnlockStar } from '../../src/ui/toolPalette';
import { newTestGame } from '../helpers/simHarness';

// Upper Story's own facilities unlock with the star rating like the originals.
const MODERN: [TenantType, number][] = [
  ['fireStation', 2], ['maintenance', 2],
  ['bank', 3], ['rooftopPool', 3], ['generator', 3],
  ['helipad', 4],
];

it.each(MODERN)('%s unlocks at %i stars and not before', (type, star) => {
  expect(TENANT_DATA[type].unlockedAtStar).toBe(star);
  expect(toolUnlockStar(type)).toBe(star);
  const state = newTestGame();
  buildFloor(state, 2);
  const floor = type === 'generator' ? 0 : 2; // generators go below ground
  state.starLevel = star - 1;
  expect(isUnlocked(state, type)).toBe(false);
  expect(placementError(state, type, floor, 20)).toBe(`Requires ${star}★`);
  state.starLevel = star;
  expect(isUnlocked(state, type)).toBe(true);
  expect(placementError(state, type, floor, 20) ?? '').not.toMatch(/Requires/);
});
