import { CONFIG, KINSOKU_FORBIDDEN, TENANT_DATA, facilityHeight, type TenantTypeData } from '../data/config';
import { pushEvent } from './core/events';
import { nextId } from './core/ids';
import { demolishElevatorGroup, groupAt } from './elevators';
import { spend } from './money';
import { removeTenantPeople, spawnTenantPeople } from './people';
import type { GameState } from './state';
import { demolishFloor, getFloor, topFloorIndex } from './tower';

export type TenantType = keyof typeof TENANT_DATA;
export type TenantState = 'constructing' | 'open' | 'vacant' | 'damaged';

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
  sold?: boolean;
  movieAge?: number;
  visitsToday?: number;
  reportedPopulation?: number;
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
  if (data.basementOnly && floorIndex + facilityHeight(type) - 1 > 0) return 'Build this facility entirely below ground';
  if (!data.basementOnly && type !== 'lobby' && floorIndex <= 0) return 'No tenants in the basement';
  if (data.limit && [...state.tenants.values()].filter(t => t.type === type).length >= data.limit) return `Maximum ${data.limit} of this facility`;
  if (type === 'parkingSpace' && ![...state.tenants.values()].some(t => t.type === 'parkingRamp' && t.floor === floorIndex)) return 'Build a parking ramp on this basement first';
  if (type === 'parkingRamp' && floorIndex < 0 && ![...state.tenants.values()].some(t => t.type === 'parkingRamp' && t.floor === floorIndex + 1 && t.x === x)) return 'Align the ramp with the basement above';
  if (x < 0 || x + data.sizeCells > CONFIG.FLOOR_WIDTH_CELLS) {
    return 'Does not fit on the floor';
  }
  for (let f = floorIndex; f < floorIndex + facilityHeight(type); f++) {
    const band = getFloor(state.tower, f);
    if (!band) return `Build all ${facilityHeight(type)} floors first`;
    if (band.cells.slice(x, x + data.sizeCells).some(c => c.content !== 'empty')) return 'Space is occupied';
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

  const content = constructing ? 'scaffold' : 'tenant';
  for (let f = floorIndex; f < floorIndex + facilityHeight(type); f++) {
    const floor = getFloor(state.tower, f)!;
    for (let i = x; i < x + data.sizeCells; i++) floor.cells[i] = { content, tenantId: id };
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
  for (let f = tenant.floor; f < tenant.floor + facilityHeight(tenant.type); f++) {
    const floor = getFloor(state.tower, f)!;
    for (let i = tenant.x; i < tenant.x + tenant.sizeCells; i++) floor.cells[i] = { content: 'empty', tenantId: -1 };
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
    (topFloorIndex(state.tower) === floorIndex || state.tower.floors[0]?.index === floorIndex)
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
    if (tenant.type === 'condo' && !tenant.sold) { tenant.dailyRevenue += 150_000_00; tenant.sold = true; }
    for (let f = tenant.floor; f < tenant.floor + facilityHeight(tenant.type); f++) {
      const floor = getFloor(state.tower, f);
      if (!floor) continue;
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

/** Repair damaged space using the normal construction pipeline. */
export function repairTenant(state: GameState, id: number): void {
  const tenant = state.tenants.get(id);
  if (!tenant || tenant.state !== 'damaged') throw new Error('This facility does not need repairs');
  const data = TENANT_DATA[tenant.type];
  if (!spend(state, Math.round(data.costDollars * 25))) throw new Error('Not enough funds');
  tenant.state = 'constructing';
  tenant.constructionTicksLeft = Math.max(100, Math.round(data.constructionTicks / 2));
  state.constructionQueue.push(id);
  state.tower.structureRevision++;
}
export function changeMovie(state: GameState, id: number): void {
  const tenant = state.tenants.get(id);
  if (!tenant || tenant.type !== 'cinema' || tenant.state !== 'open') throw new Error('Select an open cinema');
  if (!spend(state, 5000 * 100)) throw new Error('Not enough funds');
  tenant.movieAge = 0;
}
