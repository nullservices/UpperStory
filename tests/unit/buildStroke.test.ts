import { CONFIG, TENANT_DATA } from '../../src/data/config';
import { describe, expect, it } from 'vitest';
import { BuildStroke } from '../../src/game/buildStroke';
import { buildFloor, createInitialState, setupNewGame, placeTenant, placeStair } from '../../src/sim';

function fixture() {
  const state = createInitialState(1); setupNewGame(state);
  buildFloor(state, 2); buildFloor(state, 3);
  return state;
}

describe('drag construction', () => {
  it('fills skipped mouse positions with adjacent rooms and charges once per room', () => {
    const state = fixture(), balance = state.money.balanceCents;
    const stroke = new BuildStroke('office', 2, 0);
    stroke.extend(state, 0); stroke.extend(state, 35);
    expect([...state.tenants.values()].filter(t => t.type === 'office').map(t => t.x)).toEqual([0, 9, 18, 27]);
    expect(balance - state.money.balanceCents).toBe(4 * 40000 * 100);
    expect(state.constructionQueue).toHaveLength(4);
  });
  it('places to the left and never rebuilds while retracing a stroke', () => {
    const state = fixture(), stroke = new BuildStroke('condo', 2, 48);
    stroke.extend(state, 48); stroke.extend(state, 0);
    stroke.extend(state, 48); stroke.extend(state, 0);
    expect(stroke.placed).toBe(4);
    expect([...state.tenants.values()].filter(t => t.type === 'condo').map(t => t.x)).toEqual([48, 32, 16, 0]);
  });
  it('keeps room placement on the selected row', () => {
    const state = fixture(), stroke = new BuildStroke('condo', 2, 0);
    stroke.extend(state, 18);
    expect([...state.tenants.values()].filter(t => t.type === 'condo').every(t => t.floor === 2)).toBe(true);
    expect(state.tower.floors.find(f => f.index === 3)!.cells.every(c => c.content === 'empty')).toBe(true);
  });
  it('skips occupied slots without deleting existing facilities', () => {
    const state = fixture(); placeStair(state, 2, 9);
    const stroke = new BuildStroke('office', 2, 0); stroke.extend(state, 27);
    expect(stroke.placed).toBe(3);
    expect(state.tower.floors.find(f => f.index === 2)!.cells[9]!.content).toBe('stair');
  });
  it('does not overspend or create partially paid rooms', () => {
    const state = fixture(); state.money.balanceCents = 160000 * 100;
    const stroke = new BuildStroke('condo', 2, 0); stroke.extend(state, 48);
    expect(stroke.placed).toBe(2); expect(state.money.balanceCents).toBe(0);
    expect(stroke.error).toBe('Not enough funds');
  });
  it('enforces unlocks and adjacency restrictions for every placement', () => {
    const state = fixture();
    const locked = new BuildStroke('hotel', 2, 0); locked.extend(state, 24);
    expect(locked.placed).toBe(0); expect(locked.error).toBe('Requires 2★');
    placeTenant(state, 'fastfood', 2, 0);
    const noisy = new BuildStroke('office', 2, 16); noisy.extend(state, 16);
    expect(noisy.placed).toBe(0); expect(noisy.error).toContain('Not allowed next to');
  });
  it('stays inside the tower when dragged beyond its edge', () => {
    const state = fixture(), stroke = new BuildStroke('condo', 2, 0);
    stroke.extend(state, 1000000);
    expect(stroke.placed).toBe(Math.floor(CONFIG.FLOOR_WIDTH_CELLS / TENANT_DATA.condo.sizeCells));
    stroke.extend(state, -1000000); expect(stroke.placed).toBe(Math.floor(CONFIG.FLOOR_WIDTH_CELLS / TENANT_DATA.condo.sizeCells));
  });
  it('paints stairs and escalators eight cells at a time', () => {
    const state = fixture(), stairs = new BuildStroke('stairs', 2, 0);
    stairs.extend(state, 24); expect(stairs.placed).toBe(4);
    const escalators = new BuildStroke('escalatorUp', 2, 40);
    escalators.extend(state, 56); expect(escalators.placed).toBe(3);
  });
});
