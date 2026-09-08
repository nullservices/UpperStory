import { describe, expect, it } from 'vitest';
import {
  buildFloor,
  demolishAt,
  demolishTenant,
  getTenantAt,
  placeStair,
  placeTenant,
  placementError,
  tick,
  type SimEvent,
} from '../../src/sim';
import { newTestGame, tickN } from '../helpers/simHarness';

describe('tenant lifecycle', () => {
  it('new game: B1 + lobby floor with full-width open lobby', () => {
    const state = newTestGame();
    expect(state.tower.floors.map((f) => f.index)).toEqual([0, 1]);
    const lobbyFloor = state.tower.floors[1]!;
    expect(lobbyFloor.cells.every((c) => c.content === 'tenant')).toBe(true);
    const lobby = state.tenants.get(0)!;
    expect(lobby.type).toBe('lobby');
    expect(lobby.state).toBe('open');
    expect(lobby.sizeCells).toBe(60);
  });

  it('placing an office: cost, scaffold cells, construction queue', () => {
    const state = newTestGame();
    buildFloor(state, 2);
    const before = state.money.balanceCents;
    const office = placeTenant(state, 'office', 2, 10);
    expect(state.money.balanceCents).toBe(before - 9_000 * 100);
    expect(office.state).toBe('constructing');
    expect(state.constructionQueue).toEqual([office.id]);
    const floor = state.tower.floors[2]!;
    for (let x = 10; x < 22; x++) {
      expect(floor.cells[x]!.content).toBe('scaffold');
      expect(floor.cells[x]!.tenantId).toBe(office.id);
    }
  });

  it('construction completes after its duration, emits TENANT_COMPLETED', () => {
    const state = newTestGame();
    buildFloor(state, 2);
    const office = placeTenant(state, 'office', 2, 10); // 1300 ticks
    const events: SimEvent[] = [];
    for (let i = 0; i < 1_300; i++) {
      tick(state);
      events.push(...state.events);
    }
    const tenant = state.tenants.get(office.id)!;
    expect(tenant.state).toBe('open');
    expect(state.constructionQueue).toEqual([]);
    expect(state.tower.floors[2]!.cells[10]!.content).toBe('tenant');
    expect(events).toContainEqual({ type: 'TENANT_COMPLETED', tenantId: office.id });
  });

  it('placement validity: overlap, missing floor, funds, basement, bounds', () => {
    const state = newTestGame();
    expect(placementError(state, 'office', 2, 0)).toBe('Build this floor first');
    buildFloor(state, 2);
    expect(placementError(state, 'office', 2, 0)).toBeNull();
    expect(placementError(state, 'office', 0, 0)).toBe('No tenants in the basement');
    expect(placementError(state, 'office', 2, 55)).toBe('Does not fit on the floor');
    placeTenant(state, 'office', 2, 0);
    expect(placementError(state, 'office', 2, 6)).toBe('Space is occupied');
    state.money.balanceCents = 0;
    expect(placementError(state, 'condo', 2, 20)).toBe('Not enough funds');
  });

  it('lobby rules: floor 1 only, full width, one at a time', () => {
    const state = newTestGame();
    expect(placementError(state, 'lobby', 1, 0)).toBe('A lobby already exists');
    buildFloor(state, 2);
    expect(placementError(state, 'lobby', 2, 0)).toBe('Must be placed on floor 1');
    // remove the lobby so the full-width rule is what we're testing
    demolishTenant(state, 1, 0);
    expect(placementError(state, 'lobby', 1, 5)).toBe('The lobby spans the whole floor');
    expect(placementError(state, 'lobby', 1, 0)).toBeNull();
  });

  it('kinsoku: adjacency between allowed types is fine (table empty in M1)', () => {
    const state = newTestGame();
    buildFloor(state, 2);
    placeTenant(state, 'office', 2, 0); // cells 0..11
    expect(placementError(state, 'office', 2, 12)).toBeNull();
    expect(placementError(state, 'condo', 2, 12)).toBeNull();
  });

  it('getTenantAt resolves cells to tenants', () => {
    const state = newTestGame();
    expect(getTenantAt(state, 1, 30)?.type).toBe('lobby');
    expect(getTenantAt(state, 1, 61)).toBeUndefined();
    expect(getTenantAt(state, 0, 0)).toBeUndefined(); // empty B1
  });

  it('demolishTenant clears cells with no refund', () => {
    const state = newTestGame();
    buildFloor(state, 2);
    const office = placeTenant(state, 'office', 2, 10);
    const balance = state.money.balanceCents;
    demolishTenant(state, 2, 10);
    expect(state.money.balanceCents).toBe(balance);
    expect(state.tenants.has(office.id)).toBe(false);
    expect(state.constructionQueue).toEqual([]);
    const floor = state.tower.floors[2]!;
    for (let x = 10; x < 22; x++) expect(floor.cells[x]!.content).toBe('empty');
  });

  it('demolishAt: tenant, stair, then empty top floor', () => {
    const state = newTestGame();
    buildFloor(state, 2);
    buildFloor(state, 3);
    const office = placeTenant(state, 'office', 3, 10);
    demolishAt(state, 3, 15);
    expect(state.tenants.has(office.id)).toBe(false);
    placeStair(state, 2, 5);
    placeStair(state, 3, 5);
    demolishAt(state, 3, 5);
    expect(state.tower.floors[3]!.cells[5]!.content).toBe('empty');
    demolishAt(state, 3, 0); // empty top floor
    expect(state.tower.floors.map((f) => f.index)).toEqual([0, 1, 2]);
  });

  it('determinism: identical build + ticks produce identical state', () => {
    const a = newTestGame(42);
    const b = newTestGame(42);
    for (const s of [a, b]) {
      buildFloor(s, 2);
      buildFloor(s, 3);
      placeStair(s, 2, 5);
      placeStair(s, 3, 5);
      placeTenant(s, 'office', 2, 10);
      placeTenant(s, 'condo', 3, 10);
    }
    tickN(a, 500);
    tickN(b, 500);
    expect(a).toEqual(b);
  });
});
