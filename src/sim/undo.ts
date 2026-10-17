import { CONFIG } from '../data/config';
import { addElevatorCar, demolishElevatorGroup, placeEscalator, removeElevatorCar, setElevatorServiceRange } from './elevators';
import { addMoney } from './money';
import type { RouteLeg } from './routing';
import type { GameState } from './state';
import { demolishAt, demolishTenant, getTenantAt, placeTenant, type TenantType } from './tenants';
import { buildFloor, demolishFloor, extendFloor, floorBounds, floorContains, getFloor, placeStair, stairLowerFloor, trimFloor } from './tower';

/**
 * Command-based undo for the player's most recent constructions. Each build
 * records what it created and what it cost; undo reverses it with the normal
 * demolish/trim/remove commands and then refunds the cost explicitly (the
 * sim never rebates demolition on its own). Pure and deterministic.
 */

/** One reversible piece of a build (a row stroke records several). */
export type UndoPart = (
  | { kind: 'tenant'; id: number; type: TenantType; floor: number; x: number }
  /** A lobby cell (the lobby is one growing tenant); `basementGrew` = B1 was widened with it. */
  | { kind: 'lobbyCell'; x: number; basementGrew: boolean }
  /** Stair cells sit on `floor` (the floor farther from the lobby). */
  | { kind: 'stair'; floor: number; x: number }
  | { kind: 'escalator'; lower: number; x: number; dir: 'up' | 'down' }
  | { kind: 'floor'; floor: number }
  | { kind: 'floorExtend'; floor: number; prevLo: number; prevHi: number; lo: number; hi: number }
  | { kind: 'shaft'; groupId: number; lo: number; hi: number }
  | { kind: 'shaftRange'; groupId: number; prevLo: number; prevHi: number; lo: number; hi: number }
  | { kind: 'car'; groupId: number; carId: number }
) & { costCents: number };

export interface UndoEntry {
  /** Player-facing description, e.g. "Office on floor 5". */
  label: string;
  parts: UndoPart[];
  tick: number;
  /** Absolute game minute (day × 1440 + minute) when built. */
  minute: number;
}

export interface UndoBlock {
  reason: string;
  /** True when the entry can never be undone (gone, or too old). */
  permanent: boolean;
  /** True when the entry is too old — so is everything before it. */
  expired?: boolean;
}

export interface UndoResult {
  refundedCents: number;
  /** Parts reversed (a failure part-way leaves the rest on the entry). */
  undone: number;
  /** Set when a reversal failed after the pre-checks passed. */
  error: string | null;
}

export const UNDO_LIMIT = 20;
/** Finished things stay undoable for one game hour... */
export const UNDO_WINDOW_MINUTES = 60;
/** ...but never less than this many ticks (a night hour is only ~33 ticks). */
export const UNDO_MIN_WINDOW_TICKS = 150;

export function gameMinute(state: GameState): number {
  return state.calendar.day * 1440 + (state.calendar.minuteOfDay % 1440);
}

export function createUndoEntry(state: GameState, label: string, parts: UndoPart[]): UndoEntry {
  return { label, parts, tick: state.tickCount, minute: gameMinute(state) };
}

/** Push onto a bounded stack (oldest entries fall off). */
export function pushUndo(stack: UndoEntry[], entry: UndoEntry, limit = UNDO_LIMIT): void {
  if (!entry.parts.length) return;
  stack.push(entry);
  if (stack.length > limit) stack.splice(0, stack.length - limit);
}

// --- Recording wrappers: run the normal command and describe what it made. ---

function charged(state: GameState, before: number): number {
  return Math.max(0, before - state.money.balanceCents);
}

export function placeTenantRecorded(state: GameState, type: TenantType, floor: number, x: number): UndoPart {
  const before = state.money.balanceCents;
  const basement = getFloor(state.tower, 0);
  const basementBefore = basement ? `${basement.builtLo}:${basement.builtHi}` : '';
  const tenant = placeTenant(state, type, floor, x);
  const costCents = charged(state, before);
  if (type === 'lobby') {
    const after = basement ? `${basement.builtLo}:${basement.builtHi}` : '';
    return { kind: 'lobbyCell', x, basementGrew: after !== basementBefore, costCents };
  }
  return { kind: 'tenant', id: tenant.id, type, floor, x: tenant.x, costCents };
}

export function placeStairRecorded(state: GameState, floor: number, x: number): UndoPart {
  const before = state.money.balanceCents;
  placeStair(state, floor, x);
  return { kind: 'stair', floor: floor === CONFIG.LOBBY_FLOOR_INDEX ? floor + 1 : floor, x, costCents: charged(state, before) };
}

export function placeEscalatorRecorded(state: GameState, floor: number, x: number, dir: 'up' | 'down'): UndoPart {
  const before = state.money.balanceCents;
  placeEscalator(state, floor, x, dir);
  return { kind: 'escalator', lower: floor, x, dir, costCents: charged(state, before) };
}

/** Null when building it uncovered treasure (that windfall cannot be taken back). */
export function buildFloorRecorded(state: GameState, floor: number): UndoPart | null {
  const before = state.money.balanceCents;
  const treasure = state.campaign.treasureFound;
  buildFloor(state, floor);
  if (state.campaign.treasureFound !== treasure) return null;
  return { kind: 'floor', floor, costCents: charged(state, before) };
}

export function extendFloorRecorded(state: GameState, floor: number, x: number): UndoPart {
  const before = state.money.balanceCents;
  const prev = floorBounds(state, floor);
  extendFloor(state, floor, x);
  const next = floorBounds(state, floor);
  return { kind: 'floorExtend', floor, prevLo: prev.lo, prevHi: prev.hi, lo: next.lo, hi: next.hi, costCents: charged(state, before) };
}

export function addCarRecorded(state: GameState, groupId: number): UndoPart {
  const before = state.money.balanceCents;
  addElevatorCar(state, groupId);
  const cars = state.elevatorGroups.get(groupId)!.cars;
  return { kind: 'car', groupId, carId: cars[cars.length - 1]!.id, costCents: charged(state, before) };
}

/**
 * Describe a shaft build/extension from the group ids and range seen before
 * the command ran. Null when nothing changed.
 */
export function shaftPartAfter(
  state: GameState,
  beforeIds: ReadonlySet<number>,
  extended: { groupId: number; prevLo: number; prevHi: number } | null,
  costCents: number,
): UndoPart | null {
  if (extended) {
    const group = state.elevatorGroups.get(extended.groupId);
    if (!group || (group.serviceLo === extended.prevLo && group.serviceHi === extended.prevHi)) return null;
    return { kind: 'shaftRange', ...extended, lo: group.serviceLo, hi: group.serviceHi, costCents };
  }
  for (const group of state.elevatorGroups.values()) {
    if (!beforeIds.has(group.id)) return { kind: 'shaft', groupId: group.id, lo: group.serviceLo, hi: group.serviceHi, costCents };
  }
  return null;
}

// --- Safety checks ---

function expired(state: GameState, entry: UndoEntry): boolean {
  return gameMinute(state) - entry.minute > UNDO_WINDOW_MINUTES && state.tickCount - entry.tick > UNDO_MIN_WINDOW_TICKS;
}

function routeUses(state: GameState, matches: (leg: RouteLeg) => boolean): boolean {
  for (const p of state.people.values()) {
    const route = p.route;
    if (!route) continue;
    for (let i = p.legIndex; i < route.length; i++) if (matches(route[i]!)) return true;
  }
  return false;
}

function gone(reason = 'it has already been removed'): UndoBlock { return { reason, permanent: true }; }
function wait(reason: string): UndoBlock { return { reason, permanent: false }; }

function partBlock(state: GameState, part: UndoPart, old: boolean): UndoBlock | null {
  const tooOld: UndoBlock = { reason: 'it was finished over an hour ago', permanent: true, expired: true };
  switch (part.kind) {
    case 'tenant': {
      const tenant = state.tenants.get(part.id);
      if (!tenant || tenant.type !== part.type || tenant.floor !== part.floor || tenant.x !== part.x) return gone();
      if (tenant.state !== 'constructing' && old) return tooOld;
      if (tenant.sold) return { reason: 'the condo has already been sold', permanent: true };
      for (const p of state.people.values()) {
        if (p.tenantId === tenant.id || p.activityTenantId === tenant.id) return wait('people have moved in or are visiting');
      }
      for (const group of state.elevatorGroups.values()) {
        if (group.serviceLo <= tenant.floor && group.serviceHi >= tenant.floor && group.x < tenant.x + tenant.sizeCells && group.x + (group.widthCells ?? 2) > tenant.x) {
          return wait('an elevator now runs through it');
        }
      }
      return null;
    }
    case 'lobbyCell': {
      const lobby = getTenantAt(state, CONFIG.LOBBY_FLOOR_INDEX, part.x);
      if (!lobby || lobby.type !== 'lobby') return gone();
      if (old) return tooOld;
      if (part.basementGrew && getFloor(state.tower, 0)?.cells[part.x]?.content !== 'empty') return wait('something was built in the basement beneath it');
      return null;
    }
    case 'stair': {
      const cell = getFloor(state.tower, part.floor)?.cells[part.x];
      if (cell?.content !== 'stair' || (cell.transportX ?? part.x) !== part.x) return gone();
      if (old) return tooOld;
      const lower = stairLowerFloor(part.floor);
      if (routeUses(state, leg => leg.mode === 'stair' && leg.x === part.x && Math.min(leg.from, leg.to) === lower)) return wait('people are using the stairs');
      return null;
    }
    case 'escalator': {
      if (state.escalators.get(`${part.lower}:${part.x}`) !== part.dir) return gone();
      if (old) return tooOld;
      if (part.lower === CONFIG.LOBBY_FLOOR_INDEX && state.escalators.has(`${part.lower + 1}:${part.x}`)) return wait('another escalator now shares its landing');
      if (routeUses(state, leg => leg.mode === 'escalator' && leg.x === part.x && Math.min(leg.from, leg.to) === part.lower)) return wait('people are riding the escalator');
      return null;
    }
    case 'floor': {
      const floor = getFloor(state.tower, part.floor);
      if (!floor) return gone();
      if (old) return tooOld;
      if (floor.cells.some(c => c.content !== 'empty')) return wait('something has been built on it');
      const outer = part.floor > 0 ? part.floor + 1 : part.floor - 1;
      if (getFloor(state.tower, outer)) return wait(`${part.floor > 0 ? 'a floor has been built above it' : 'a deeper basement has been dug'}`);
      return null;
    }
    case 'floorExtend': {
      if (!getFloor(state.tower, part.floor)) return gone();
      const bounds = floorBounds(state, part.floor);
      if (bounds.lo !== part.lo || bounds.hi !== part.hi) return gone('the floor has changed since');
      if (old) return tooOld;
      const floor = getFloor(state.tower, part.floor)!;
      const outer = part.floor > 0 ? part.floor + 1 : part.floor - 1;
      const added = part.prevLo === part.prevHi ? range(part.lo, part.hi) : [...range(part.lo, part.prevLo), ...range(part.prevHi, part.hi)];
      for (const x of added) {
        if (floor.cells[x]?.content !== 'empty') return wait('something has been built on the new section');
        if (floorContains(state, outer, x, 1)) return wait(part.floor > 0 ? 'the floor above rests on it' : 'the basement below reaches under it');
      }
      return null;
    }
    case 'shaft': {
      const group = state.elevatorGroups.get(part.groupId);
      if (!group) return gone();
      if (group.serviceLo !== part.lo || group.serviceHi !== part.hi) return gone('the shaft has been resized since');
      if (old) return tooOld;
      if (group.cars.length > 1) return wait('cars have been added to it');
      if (group.cars.some(car => car.passengers.length > 0)) return wait('people are riding it');
      if (routeUses(state, leg => leg.mode === 'elevator' && leg.groupId === group.id)) return wait('people are waiting for it');
      return null;
    }
    case 'shaftRange': {
      const group = state.elevatorGroups.get(part.groupId);
      if (!group) return gone();
      if (group.serviceLo !== part.lo || group.serviceHi !== part.hi) return gone('the shaft has been resized since');
      if (old) return tooOld;
      if (group.cars.some(car => car.passengers.length > 0 || car.state !== 'idle')) return wait('its cars are moving');
      if (routeUses(state, leg => leg.mode === 'elevator' && leg.groupId === group.id &&
        (leg.from < part.prevLo || leg.from > part.prevHi || leg.to < part.prevLo || leg.to > part.prevHi))) return wait('people need the added floors');
      return null;
    }
    case 'car': {
      const group = state.elevatorGroups.get(part.groupId);
      const car = group?.cars.find(c => c.id === part.carId);
      if (!group || !car) return gone();
      if (old) return tooOld;
      if (group.cars.length <= 1) return gone();
      if (car.passengers.length > 0) return wait('people are riding the car');
      return null;
    }
  }
}

function range(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let x = lo; x < hi; x++) out.push(x);
  return out;
}

/** Why the entry cannot be undone right now, or null when it can. */
export function undoBlock(state: GameState, entry: UndoEntry): UndoBlock | null {
  const old = expired(state, entry);
  // A row is only undone as a whole if every room in it still exists.
  for (const part of entry.parts) {
    const block = partBlock(state, part, old);
    if (block) return block;
  }
  return null;
}

// --- Reversal ---

function reverse(state: GameState, part: UndoPart): void {
  switch (part.kind) {
    case 'tenant':
      demolishTenant(state, part.floor, part.x);
      return;
    case 'lobbyCell':
      demolishTenant(state, CONFIG.LOBBY_FLOOR_INDEX, part.x);
      if (part.basementGrew && getFloor(state.tower, 0)) {
        const bounds = floorBounds(state, 0);
        if (bounds.hi > bounds.lo && (part.x === bounds.lo || part.x === bounds.hi - 1)) trimFloor(state, 0, part.x);
      }
      return;
    case 'stair':
      demolishAt(state, part.floor, part.x);
      return;
    case 'escalator':
      demolishAt(state, part.lower === CONFIG.LOBBY_FLOOR_INDEX ? part.lower + 1 : part.lower, part.x);
      return;
    case 'floor':
      demolishFloor(state, part.floor);
      return;
    case 'floorExtend': {
      if (part.prevLo === part.prevHi) {
        // The floor had no built cells before (only B1 can be empty); trim it all back.
        for (let x = part.hi - 1; x >= part.lo; x--) trimFloor(state, part.floor, x);
        return;
      }
      for (let x = part.lo; x < part.prevLo; x++) trimFloor(state, part.floor, x);
      for (let x = part.hi - 1; x >= part.prevHi; x--) trimFloor(state, part.floor, x);
      return;
    }
    case 'shaft':
      demolishElevatorGroup(state, part.groupId);
      return;
    case 'shaftRange':
      setElevatorServiceRange(state, part.groupId, part.prevLo, part.prevHi);
      return;
    case 'car':
      removeElevatorCar(state, part.groupId, part.carId);
      return;
  }
}

/**
 * Reverse an entry (newest part first) and refund what each reversed part
 * cost. Call undoBlock first; a reversal that still fails stops there, keeps
 * the remaining parts on the entry and refunds only what was undone.
 */
export function applyUndo(state: GameState, entry: UndoEntry): UndoResult {
  let refundedCents = 0;
  let undone = 0;
  let error: string | null = null;
  while (entry.parts.length) {
    const part = entry.parts[entry.parts.length - 1]!;
    try {
      reverse(state, part);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      break;
    }
    entry.parts.pop();
    refundedCents += part.costCents;
    undone++;
  }
  if (refundedCents > 0) addMoney(state, refundedCents);
  return { refundedCents, undone, error };
}
