import { CONFIG, KINSOKU_FORBIDDEN, TENANT_DATA, type TenantTypeData } from '../data/config';
import { pushEvent } from './core/events';
import { nextId } from './core/ids';
import { demolishElevatorGroup, groupAt } from './elevators';
import { spend } from './money';
import { removeTenantPeople, spawnTenantPeople } from './people';
import type { GameState } from './state';
import { demolishFloor, getFloor, topFloorIndex } from './tower';

export type TenantType = keyof typeof TENANT_DATA;
export type TenantState = 'constructing' | 'open' | 'vacant';

export interface Tenant {
  id: number;
  type: TenantType;
  floor: number;
  /** Leftmost cell. */
  x: number;
  sizeCells: number;
  state: TenantState;
  constructionTicksLeft: number;
  /** People currently inside, refreshed every tick. */
  occupancy: number;
  capacity: number;
  /** Pricing level index into CONFIG.PRICING_LEVELS (commercial only). */
  pricing: 0 | 1 | 2 | 3;
  /** 0..100 — hotels only; decays with occupancy, restored by housekeepers. */
  cleanliness: number;
  /** Cents earned today (meals, sales, nights); reset at daily settlement. */
  dailyRevenue: number;
  /** 0..5 evaluation grade, refreshed daily (JudgeT equivalent). */
  grade: number;
  evalScore: number;
  daysVacant: number;
  daysGood: number;
}

export function isUnlocked(state: GameState, type: TenantType): boolean {
  return state.starLevel >= TENANT_DATA[type].unlockedAtStar;
}

/** Cycle a commercial tenant's pricing level (very low → low → avg → high). */
export function cyclePricing(state: GameState, tenantId: number): void {
  const tenant = state.tenants.get(tenantId);
  if (!tenant) throw new Error('Tenant not found');
  if (tenant.type === 'lobby' || tenant.type === 'office' || tenant.type === 'condo') {
    throw new Error('This tenant has no pricing levels');
  }
  tenant.pricing = ((tenant.pricing + 1) % CONFIG.PRICING_LEVELS.length) as 0 | 1 | 2 | 3;
}

/** Tenant covering a cell, or undefined (null for 'empty'/'stair'/… cells). */
export function getTenantAt(
  state: GameState,
  floorIndex: number,
  x: number,
): Tenant | undefined {
  const floor = getFloor(state.tower, floorIndex);
  const cell = floor?.cells[x];
  if (!cell || (cell.content !== 'tenant' && cell.content !== 'scaffold')) return undefined;
  return state.tenants.get(cell.tenantId);
}

/** Kinsoku check: forbidden adjacency to the left/right neighbor. */
function kinsokuViolation(
  state: GameState,
  type: TenantType,
  floorIndex: number,
  x: number,
): string | null {
  const check = (neighbor: Tenant | undefined): string | null => {
    if (!neighbor) return null;
    const forbidden =
      KINSOKU_FORBIDDEN[type]?.includes(neighbor.type) ??
      KINSOKU_FORBIDDEN[neighbor.type]?.includes(type);
    return forbidden ? `Not allowed next to a ${neighbor.type}` : null;
  };
  const size = TENANT_DATA[type].sizeCells;
  return (
    check(getTenantAt(state, floorIndex, x - 1)) ??
    check(getTenantAt(state, floorIndex, x + size))
  );
}

/** Human-readable reason the placement would fail, or null if it is allowed. */
export function placementError(
  state: GameState,
  type: TenantType,
  floorIndex: number,
  x: number,
): string | null {
  // Widen the literal-type union to the interface so optional props (lobby's
  // requiresFullFloor/floorRestriction) type-check on every member.
  const data: TenantTypeData = TENANT_DATA[type];
  const floor = getFloor(state.tower, floorIndex);
  if (!floor) return 'Build this floor first';
  if (!isUnlocked(state, type)) return `Requires ${data.unlockedAtStar}★`;
  if (data.floorRestriction !== undefined && floorIndex !== data.floorRestriction) {
    return `Must be placed on floor ${data.floorRestriction}`;
  }
  if (type === 'lobby' && hasLobby(state)) return 'A lobby already exists';
  if (data.requiresFullFloor && x !== 0) return 'The lobby spans the whole floor';
  if (type !== 'lobby' && floorIndex === CONFIG.BASEMENT_FLOOR_INDEX) {
    return 'No tenants in the basement';
  }
  if (x < 0 || x + data.sizeCells > CONFIG.FLOOR_WIDTH_CELLS) {
    return 'Does not fit on the floor';
  }
  if (floor.cells.slice(x, x + data.sizeCells).some((c) => c.content !== 'empty')) {
    return 'Space is occupied';
  }
  const kinship = kinsokuViolation(state, type, floorIndex, x);
  if (kinship) return kinship;
  if (data.costDollars * 100 > state.money.balanceCents) return 'Not enough funds';
  return null;
}

/** Place a tenant, deducting its cost. Throws Error(reason) if invalid. */
export function placeTenant(
  state: GameState,
  type: TenantType,
  floorIndex: number,
  x: number,
): Tenant {
  const error = placementError(state, type, floorIndex, x);
  if (error) throw new Error(error);
  const data: TenantTypeData = TENANT_DATA[type];
  const cost = data.costDollars * 100;
  if (cost > 0 && !spend(state, cost)) throw new Error('Not enough funds');

  const id = nextId(state);
  const constructing = data.constructionTicks > 0;
  const tenant: Tenant = {
    id,
    type,
    floor: floorIndex,
    x,
    sizeCells: data.sizeCells,
    state: constructing ? 'constructing' : 'open',
    constructionTicksLeft: data.constructionTicks,
    occupancy: 0,
    capacity: data.capacity,
    pricing: 2, // average
    cleanliness: 100,
    dailyRevenue: 0,
    grade: 3,
    evalScore: 60,
    daysVacant: 0,
    daysGood: 0,
  };
  state.tenants.set(id, tenant);

  const floor = getFloor(state.tower, floorIndex)!;
  const content = constructing ? 'scaffold' : 'tenant';
  for (let i = x; i < x + data.sizeCells; i++) {
    floor.cells[i] = { content, tenantId: id };
  }
  if (constructing) state.constructionQueue.push(id);
  state.tower.structureRevision++;
  return tenant;
}

function hasLobby(state: GameState): boolean {
  for (const tenant of state.tenants.values()) {
    if (tenant.type === 'lobby') return true;
  }
  return false;
}

/** Demolish the tenant occupying a cell. No refund (matches the original). */
export function demolishTenant(state: GameState, floorIndex: number, x: number): void {
  const tenant = getTenantAt(state, floorIndex, x);
  if (!tenant) throw new Error('Nothing to demolish here');
  removeTenantPeople(state, tenant.id);
  const floor = getFloor(state.tower, floorIndex)!;
  for (let i = tenant.x; i < tenant.x + tenant.sizeCells; i++) {
    floor.cells[i] = { content: 'empty', tenantId: -1 };
  }
  state.tenants.delete(tenant.id);
  const qi = state.constructionQueue.indexOf(tenant.id);
  if (qi >= 0) state.constructionQueue.splice(qi, 1);
  state.tower.structureRevision++;
}

/**
 * Composite demolish command used by the UI tool: tenants first, then stair
 * cells, then (empty top) floors. Throws Error(reason) when nothing applies.
 */
export function demolishAt(state: GameState, floorIndex: number, x: number): void {
  const floor = getFloor(state.tower, floorIndex);
  if (!floor) throw new Error('Nothing to demolish here');
  const cell = floor.cells[x];
  if (!cell) throw new Error('Nothing to demolish here');
  if (cell.content === 'tenant' || cell.content === 'scaffold') {
    demolishTenant(state, floorIndex, x);
    return;
  }
  if (cell.content === 'stair') {
    floor.cells[x] = { content: 'empty', tenantId: -1 };
    state.tower.structureRevision++;
    return;
  }
  if (cell.content === 'elevatorShaft' || cell.content === 'elevatorLobby') {
    const group = groupAt(state, floorIndex, x);
    if (!group) throw new Error('Nothing to demolish here');
    demolishElevatorGroup(state, group.id);
    return;
  }
  if (cell.content === 'escalator') {
    // The escalator spans floor..floor+1; its key uses the lower floor.
    const keyFloor = state.escalators.has(`${floorIndex}:${x}`) ? floorIndex : floorIndex - 1;
    if (!state.escalators.has(`${keyFloor}:${x}`)) throw new Error('Nothing to demolish here');
    state.escalators.delete(`${keyFloor}:${x}`);
    // Keep shared landing cells alive if another escalator still uses them.
    for (const f of [keyFloor, keyFloor + 1]) {
      if (f === CONFIG.LOBBY_FLOOR_INDEX) continue; // the lobby hosts the lower end
      const escFloor = getFloor(state.tower, f);
      if (!escFloor) continue;
      const stillUsed = state.escalators.has(`${f}:${x}`) || state.escalators.has(`${f - 1}:${x}`);
      escFloor.cells[x] = stillUsed
        ? { content: 'escalator', tenantId: -1 }
        : { content: 'empty', tenantId: -1 };
    }
    state.tower.structureRevision++;
    return;
  }
  if (
    floor.cells.every((c) => c.content === 'empty') &&
    topFloorIndex(state.tower) === floorIndex
  ) {
    demolishFloor(state, floorIndex);
    return;
  }
  throw new Error('Remove everything on this floor first');
}

/** Advance construction; complete finished tenants (called from the tick). */
export function stepConstruction(state: GameState): void {
  for (let i = state.constructionQueue.length - 1; i >= 0; i--) {
    const id = state.constructionQueue[i]!;
    const tenant = state.tenants.get(id);
    if (!tenant) {
      state.constructionQueue.splice(i, 1);
      continue;
    }
    tenant.constructionTicksLeft--;
    if (tenant.constructionTicksLeft > 0) continue;
    tenant.state = 'open';
    const floor = getFloor(state.tower, tenant.floor);
    if (floor) {
      for (let c = tenant.x; c < tenant.x + tenant.sizeCells; c++) {
        floor.cells[c] = { content: 'tenant', tenantId: tenant.id };
      }
    }
    state.constructionQueue.splice(i, 1);
    state.tower.structureRevision++;
    pushEvent(state, { type: 'TENANT_COMPLETED', tenantId: tenant.id });
    // The occupants move in (6 workers per office, 3 residents per condo).
    spawnTenantPeople(state, tenant);
  }
}
