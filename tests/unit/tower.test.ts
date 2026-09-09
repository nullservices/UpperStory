import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/data/config';
import {
  buildFloor,
  buildFloorError,
  cellIndexAtWorldX,
  createInitialState,
  demolishFloor,
  floorCostDollars,
  floorHeightPx,
  floorIndexAtWorldY,
  floorTopY,
  getFloor,
  placeStair,
  placeTenant,
  setupDemoTower,
  stairPlacementError,
} from '../../src/sim';
import { newTestGame } from '../helpers/simHarness';

describe('tower floors', () => {
  it('buildFloor adds sorted floors with empty cells', () => {
    const state = newTestGame();
    buildFloor(state, 2);
    buildFloor(state, 3);
    expect(state.tower.floors.map((f) => f.index)).toEqual([0, 1, 2, 3]);
    const f2 = getFloor(state.tower, 2)!;
    expect(f2.cells).toHaveLength(CONFIG.FLOOR_WIDTH_CELLS);
    expect(f2.cells.every((c) => c.content === 'empty')).toBe(true);
  });

  it('buildFloor requires contiguity (lower floors first)', () => {
    const state = newTestGame();
    expect(buildFloorError(state, 3)).toBe('Build lower floors first');
    expect(() => buildFloor(state, 3)).toThrow();
  });

  it('buildFloor rejects duplicates and out-of-range indexes', () => {
    const state = newTestGame();
    expect(() => buildFloor(state, 1)).toThrow();
    expect(() => buildFloor(state, CONFIG.MAX_FLOORS + 1)).toThrow();
  });

  it('floor costs: floor 1 is free, N≥2 costs base + step×(N−2)', () => {
    expect(floorCostDollars(0)).toBe(0);
    expect(floorCostDollars(1)).toBe(0);
    expect(floorCostDollars(2)).toBe(15_000);
    expect(floorCostDollars(3)).toBe(20_000);
    expect(floorCostDollars(CONFIG.MAX_FLOORS)).toBe(505_000);
  });

  it('buildFloor deducts costs and bumps structureRevision', () => {
    const state = newTestGame();
    const before = state.money.balanceCents;
    buildFloor(state, 2);
    expect(state.money.balanceCents).toBe(before - 15_000 * 100);
    expect(state.tower.structureRevision).toBe(4); // new game rev 3 + 1
  });

  it('buildFloor fails without funds', () => {
    const state = newTestGame();
    state.money.balanceCents = 0;
    expect(() => buildFloor(state, 2)).toThrow('Not enough funds');
    expect(state.tower.floors).toHaveLength(2);
  });

  it('demolishFloor: only the empty top floor', () => {
    const state = newTestGame();
    buildFloor(state, 2);
    buildFloor(state, 3);
    placeTenant(state, 'office', 3, 10);
    expect(() => demolishFloor(state, 3)).toThrow('Remove everything');
    expect(() => demolishFloor(state, 2)).toThrow('top floor');
    expect(() => demolishFloor(state, 1)).toThrow('lobby floor');
  });

  it('demolishFloor removes the empty top floor', () => {
    const state = newTestGame();
    buildFloor(state, 2);
    buildFloor(state, 3);
    demolishFloor(state, 3);
    expect(state.tower.floors.map((f) => f.index)).toEqual([0, 1, 2]);
  });
});

describe('stairs', () => {
  it('stairs accept lobby clicks and need a stair below higher floors', () => {
    const state = newTestGame();
    buildFloor(state, 2);
    buildFloor(state, 3);
    expect(stairPlacementError(state, 1, 5)).toBeNull();
    // floor 2: below is the lobby floor — allowed
    expect(stairPlacementError(state, 2, 5)).toBeNull();
    // floor 3: below floor 2 has no stair at col 5 — blocked
    expect(stairPlacementError(state, 3, 5)).toBe('Needs a stair directly below');
    placeStair(state, 2, 5);
    expect(stairPlacementError(state, 3, 5)).toBeNull();
    expect(() => placeStair(state, 3, 5)).not.toThrow();
  });

  it('placeStair deducts cost and sets the cell', () => {
    const state = newTestGame();
    buildFloor(state, 2);
    const before = state.money.balanceCents;
    placeStair(state, 2, 5);
    expect(state.money.balanceCents).toBe(before - CONFIG.STAIR_COST_DOLLARS * 100);
    expect(getFloor(state.tower, 2)!.cells[5]!.content).toBe('stair');
  });

  it('stairs cannot overlap tenants', () => {
    const state = newTestGame();
    buildFloor(state, 2);
    placeTenant(state, 'office', 2, 10); // cells 10..21
    expect(stairPlacementError(state, 2, 12)).toBe('Space is occupied');
  });
});

describe('grid math', () => {
  it('floor heights: lobby is double, others single', () => {
    const state = newTestGame();
    const b1 = getFloor(state.tower, 0)!;
    const lobby = getFloor(state.tower, 1)!;
    const f2 = buildFloor(state, 2);
    expect(floorHeightPx(b1)).toBe(CONFIG.FLOOR_HEIGHT_PX);
    expect(floorHeightPx(lobby)).toBe(CONFIG.FLOOR_HEIGHT_PX * CONFIG.LOBBY_HEIGHT_FLOORS);
    expect(floorHeightPx(f2)).toBe(CONFIG.FLOOR_HEIGHT_PX);
  });

  it('floorTopY: B1 at ground level, floors stack upward without overlap', () => {
    expect(floorTopY(0)).toBe(0);
    expect(floorTopY(1)).toBe(-40);
    expect(floorTopY(2)).toBe(-60);
    expect(floorTopY(5)).toBe(-120);
    for (let i = 2; i < 50; i++) {
      expect(floorTopY(i)).toBe(floorTopY(i - 1) - CONFIG.FLOOR_HEIGHT_PX);
    }
  });

  it('floorIndexAtWorldY maps bands correctly', () => {
    expect(floorIndexAtWorldY(10)).toBe(0); // B1
    expect(floorIndexAtWorldY(0)).toBe(0);
    expect(floorIndexAtWorldY(-20)).toBe(1); // lobby
    expect(floorIndexAtWorldY(-50)).toBe(2);
    expect(floorIndexAtWorldY(-60)).toBe(2); // boundary belongs to floor 2
    expect(floorIndexAtWorldY(-200)).toBe(9);
    expect(floorIndexAtWorldY(500)).toBe(CONFIG.MIN_FLOOR_INDEX); // deep underground clamps to B1
  });

  it('cellIndexAtWorldX clamps to floor width', () => {
    expect(cellIndexAtWorldX(-5)).toBe(0);
    expect(cellIndexAtWorldX(6)).toBe(0);
    expect(cellIndexAtWorldX(18)).toBe(1);
    expect(cellIndexAtWorldX(100000)).toBe(CONFIG.FLOOR_WIDTH_CELLS - 1);
  });
});

describe('demo scenario', () => {
  it('builds B1 + lobby + 6 floors with stairs, offices, condos and a fast-food', () => {
    const state = createInitialState(7);
    setupDemoTower(state);
    expect(state.tower.floors.map((f) => f.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect([...state.tenants.values()].map((t) => t.type).sort()).toEqual([
      'condo',
      'condo',
      'fastfood',
      'lobby',
      'office',
      'office',
    ]);
  });
});
