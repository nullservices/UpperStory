import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/data/config';
import { BuildStroke } from '../../src/game/buildStroke';
import { buildElevator } from '../../src/game/elevatorBuild';
import { buildFloor, demolishTenant, getFloor, placeElevatorGroup, tick, type GameState } from '../../src/sim';
import { floorBounds } from '../../src/sim/tower';
import {
  UNDO_LIMIT, addCarRecorded, applyUndo, buildFloorRecorded, createUndoEntry, extendFloorRecorded,
  placeEscalatorRecorded, placeStairRecorded, placeTenantRecorded, pushUndo, shaftPartAfter, undoBlock,
  type UndoEntry, type UndoPart,
} from '../../src/sim/undo';
import { newTestGame } from '../helpers/simHarness';

function fixture(): GameState {
  const state = newTestGame();
  buildFloor(state, 2); buildFloor(state, 3);
  return state;
}

function entry(state: GameState, parts: UndoPart[]): UndoEntry {
  return createUndoEntry(state, 'test', parts);
}

/** Check, then undo; returns the refund. */
function undo(state: GameState, e: UndoEntry): number {
  expect(undoBlock(state, e)).toBeNull();
  const result = applyUndo(state, e);
  expect(result.error).toBeNull();
  return result.refundedCents;
}

describe('undo', () => {
  it('removes a room under construction and refunds it in full', () => {
    const state = fixture();
    const balance = state.money.balanceCents;
    const e = entry(state, [placeTenantRecorded(state, 'office', 2, 0)]);
    expect(e.parts[0]!.costCents).toBe(40_000 * 100);
    expect(undo(state, e)).toBe(40_000 * 100);
    expect(state.money.balanceCents).toBe(balance);
    expect([...state.tenants.values()].some(t => t.type === 'office')).toBe(false);
    expect(getFloor(state.tower, 2)!.cells.every(c => c.content === 'empty')).toBe(true);
    expect(state.constructionQueue).toHaveLength(0);
  });

  it('undoes a whole row stroke as one action', () => {
    const state = fixture();
    const balance = state.money.balanceCents;
    const stroke = new BuildStroke('office', 2, 0);
    stroke.extend(state, 0); stroke.extend(state, 35);
    expect(stroke.parts).toHaveLength(4);
    const e = entry(state, [...stroke.parts]);
    expect(undo(state, e)).toBe(4 * 40_000 * 100);
    expect(state.money.balanceCents).toBe(balance);
    expect(state.tenants.size).toBe(1); // only the lobby remains
  });

  it('refuses rooms people have moved into, and rooms finished over an hour ago', () => {
    const state = fixture();
    const e = entry(state, [placeTenantRecorded(state, 'office', 2, 0)]);
    const office = [...state.tenants.values()].find(t => t.type === 'office')!;
    office.constructionTicksLeft = 1;
    tick(state);
    expect(office.state).toBe('open');
    expect(undoBlock(state, e)?.reason).toMatch(/people/);
    // Nobody inside, but old: permanently expired.
    for (const [id, p] of state.people) if (p.tenantId === office.id) state.people.delete(id);
    e.minute -= 120; e.tick -= 1000;
    expect(undoBlock(state, e)).toMatchObject({ permanent: true, expired: true });
  });

  it('keeps rooms under construction undoable however long ago they were placed', () => {
    const state = fixture();
    const e = entry(state, [placeTenantRecorded(state, 'condo', 2, 0)]);
    e.minute -= 600; e.tick -= 5000;
    expect(undoBlock(state, e)).toBeNull();
  });

  it('reports a room that has already been demolished as gone', () => {
    const state = fixture();
    const part = placeTenantRecorded(state, 'office', 2, 0);
    const e = entry(state, [part]);
    state.tenants.delete((part as { id: number }).id);
    expect(undoBlock(state, e)).toMatchObject({ permanent: true, reason: 'it has already been removed' });
  });

  it('undoes stairs and escalators', () => {
    const state = fixture();
    const balance = state.money.balanceCents;
    const stair = entry(state, [placeStairRecorded(state, 2, 20)]);
    const esc = entry(state, [placeEscalatorRecorded(state, 2, 40, 'up')]);
    expect(undo(state, esc)).toBe(CONFIG.ESCALATOR_COST_DOLLARS * 100);
    expect(undo(state, stair)).toBe(CONFIG.STAIR_COST_DOLLARS * 100);
    expect(state.money.balanceCents).toBe(balance);
    expect(state.escalators.size).toBe(0);
    expect(getFloor(state.tower, 3)!.cells.every(c => c.content === 'empty')).toBe(true);
  });

  it('undoes a new floor only while nothing depends on it', () => {
    const state = fixture();
    const balance = state.money.balanceCents;
    const four = entry(state, [buildFloorRecorded(state, 4)!]);
    const five = entry(state, [buildFloorRecorded(state, 5)!]);
    expect(undoBlock(state, four)?.reason).toMatch(/above/);
    undo(state, five);
    placeTenantRecorded(state, 'office', 4, 0);
    expect(undoBlock(state, four)?.reason).toMatch(/built on it/);
    const office = [...state.tenants.values()].find(t => t.type === 'office')!;
    state.tenants.delete(office.id);
    for (const c of getFloor(state.tower, 4)!.cells) { c.content = 'empty'; c.tenantId = -1; }
    undo(state, four);
    expect(getFloor(state.tower, 4)).toBeUndefined();
    expect(state.money.balanceCents).toBe(balance - 40_000 * 100);
  });

  it('trims a floor extension back to its previous width', () => {
    const state = fixture();
    const floor = getFloor(state.tower, 3)!;
    floor.builtLo = 10; floor.builtHi = 30;
    const balance = state.money.balanceCents;
    const e = entry(state, [extendFloorRecorded(state, 3, 35)]);
    expect(floorBounds(state, 3)).toEqual({ lo: 10, hi: 36 });
    expect(undo(state, e)).toBe(6 * 500 * 100);
    expect(floorBounds(state, 3)).toEqual({ lo: 10, hi: 30 });
    expect(state.money.balanceCents).toBe(balance);
  });

  it('undoes a new shaft, a shaft extension and an added car', () => {
    const state = fixture();
    buildFloor(state, 4);
    const balance = state.money.balanceCents;
    let ids = new Set(state.elevatorGroups.keys());
    let before = state.money.balanceCents;
    buildElevator(state, 1, 3, 60, 'standard');
    const shaft = entry(state, [shaftPartAfter(state, ids, null, before - state.money.balanceCents)!]);
    const group = [...state.elevatorGroups.values()][0]!;
    ids = new Set(state.elevatorGroups.keys());
    before = state.money.balanceCents;
    buildElevator(state, 3, 4, 60, 'standard');
    const ext = entry(state, [shaftPartAfter(state, ids, { groupId: group.id, prevLo: 1, prevHi: 3 }, before - state.money.balanceCents)!]);
    expect(group.serviceHi).toBe(4);
    const car = entry(state, [addCarRecorded(state, group.id)]);
    expect(undoBlock(state, shaft)?.reason).toMatch(/resized/);
    undo(state, car);
    expect(group.cars).toHaveLength(1);
    undo(state, ext);
    expect(group.serviceHi).toBe(3);
    expect(getFloor(state.tower, 4)!.cells.every(c => c.content === 'empty')).toBe(true);
    undo(state, shaft);
    expect(state.elevatorGroups.size).toBe(0);
    expect(state.money.balanceCents).toBe(balance);
  });

  it('refuses a shaft that has extra cars', () => {
    const state = fixture();
    const ids = new Set(state.elevatorGroups.keys());
    placeElevatorGroup(state, 1, 3, 60);
    const e = entry(state, [shaftPartAfter(state, ids, null, 1)!]);
    addCarRecorded(state, [...state.elevatorGroups.keys()][0]!);
    expect(undoBlock(state, e)?.reason).toMatch(/cars/);
  });

  it('undoes lobby cells from a stroke and refunds them', () => {
    const state = newTestGame();
    const lobby = [...state.tenants.values()].find(t => t.type === 'lobby')!;
    // Trim the right edge so there is room to extend it again.
    for (let i = 0; i < 4; i++) demolishTenant(state, CONFIG.LOBBY_FLOOR_INDEX, lobby.x + lobby.sizeCells - 1);
    const end = lobby.x + lobby.sizeCells;
    const balance = state.money.balanceCents;
    const size = lobby.sizeCells;
    const stroke = new BuildStroke('lobby', CONFIG.LOBBY_FLOOR_INDEX, end);
    stroke.extend(state, end + 2);
    expect(lobby.sizeCells).toBe(size + 3);
    undo(state, entry(state, [...stroke.parts]));
    expect(lobby.sizeCells).toBe(size);
    expect(state.money.balanceCents).toBe(balance);
  });

  it('keeps a bounded stack', () => {
    const state = fixture();
    const stack: UndoEntry[] = [];
    for (let i = 0; i < UNDO_LIMIT + 5; i++) pushUndo(stack, entry(state, [{ kind: 'floor', floor: 99, costCents: i }]));
    pushUndo(stack, entry(state, []));
    expect(stack).toHaveLength(UNDO_LIMIT);
    expect(stack[0]!.parts[0]!.costCents).toBe(5);
  });
});
