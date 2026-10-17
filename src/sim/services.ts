import { CONFIG } from '../data/config';
import { rngNext, seedRng } from './core/rng';
import { pickupRoute } from './routing';
import type { GameState } from './state';
import type { ElevatorCar, ElevatorGroup } from './elevators';
import type { Tenant, TenantType } from './tenants';

/**
 * Reach checks for service facilities and the separate random stream used by
 * tower events (breakdowns, blackouts, fire spread, security firefighting).
 * Keeping events on their own seeded stream means adding an event never
 * shifts the main stream that drives people and visitors.
 */

/** Next float in [0, 1) from the campaign's event stream (seeded, saved). */
export function eventRoll(state: GameState): number {
  const c = state.campaign;
  const holder = { rngState: c.eventRngState ?? seedRng((state.seed ^ 0x5bd1e995) >>> 0) };
  const value = rngNext(holder);
  c.eventRngState = holder.rngState;
  return value;
}

/** Integer in [min, max] from the event stream. */
export function eventInt(state: GameState, min: number, max: number): number {
  return min + Math.floor(eventRoll(state) * (max - min + 1));
}

export function openTenants(state: GameState, type: TenantType): Tenant[] {
  const result: Tenant[] = [];
  for (const t of state.tenants.values()) if (t.type === type && t.state === 'open') result.push(t);
  return result;
}

/** Staff (guards, firefighters, mechanics) ride service cars, stairs and escalators. */
function staffReach(state: GameState, from: number, to: number): boolean {
  return pickupRoute(state, from, to, 'guard') !== null;
}

/** Open security offices whose guards can reach `floor`. */
export function reachableSecurityCount(state: GameState, floor: number): number {
  return openTenants(state, 'security').filter(t => staffReach(state, t.floor, floor)).length;
}

/**
 * Firefighters and mechanics are modern responders: unlike guards and
 * housekeepers (who keep to service cars, stairs and escalators, as in the
 * original), they may ride any car. They reach `to` when it is their own
 * floor or any public or staff route connects the two floors.
 */
export function responderReach(state: GameState, from: number, to: number): boolean {
  return from === to || pickupRoute(state, from, to, 'resident') !== null || pickupRoute(state, from, to, 'guard') !== null;
}

/** An open fire station within reach (20 floors and a route) of `floor`. */
export function fireStationCovers(state: GameState, floor: number): boolean {
  return openTenants(state, 'fireStation').some(t =>
    Math.abs(t.floor - floor) <= CONFIG.FIRE_STATION_REACH_FLOORS && responderReach(state, t.floor, floor));
}

// --- Maintenance (Upper Story original) ---

/** An open maintenance office within reach (MAINTENANCE_REACH_FLOORS and a route) of `floor`. */
export function maintenanceReaches(state: GameState, floor: number): boolean {
  return openTenants(state, 'maintenance').some(t =>
    Math.abs(t.floor - floor) <= CONFIG.MAINTENANCE_REACH_FLOORS && responderReach(state, t.floor, floor));
}

/**
 * The stop of `group` a maintenance office's mechanics use to enter the
 * shaft: the nearest stop within MAINTENANCE_REACH_FLOORS they can get to,
 * or null when the office does not look after this shaft. Once inside, they
 * work along the whole shaft.
 */
function mechanicEntry(state: GameState, office: Tenant, group: ElevatorGroup): number | null {
  const stops = group.stops
    .filter(s => Math.abs(s - office.floor) <= CONFIG.MAINTENANCE_REACH_FLOORS)
    .sort((a, b) => Math.abs(a - office.floor) - Math.abs(b - office.floor) || a - b);
  for (const stop of stops) if (responderReach(state, office.floor, stop)) return stop;
  return null;
}

export interface MaintenanceCoverage {
  covered: boolean;
  /** Open offices that look after the shaft, nearest entry first. */
  officeIds: number[];
}

/** Which maintenance offices look after a shaft (for dispatch, rolls and the inspector). */
export function maintenanceCoverage(state: GameState, groupId: number): MaintenanceCoverage {
  const group = state.elevatorGroups.get(groupId);
  if (!group) return { covered: false, officeIds: [] };
  const found: { id: number; distance: number }[] = [];
  for (const office of openTenants(state, 'maintenance')) {
    const entry = mechanicEntry(state, office, group);
    if (entry !== null) found.push({ id: office.id, distance: Math.abs(entry - office.floor) });
  }
  found.sort((a, b) => a.distance - b.distance || a.id - b.id);
  return { covered: found.length > 0, officeIds: found.map(f => f.id) };
}

/** Whether any open maintenance office looks after the shaft. */
export function maintenanceCoversShaft(state: GameState, group: ElevatorGroup): boolean {
  for (const office of openTenants(state, 'maintenance')) if (mechanicEntry(state, office, group) !== null) return true;
  return false;
}

/** Cars an office's mechanics are repairing now. */
export function mechanicsBusy(state: GameState, officeId: number): number {
  let busy = 0;
  for (const group of state.elevatorGroups.values()) {
    for (const car of group.cars) if (car.outOfService && car.repairOfficeId === officeId) busy++;
  }
  return busy;
}

export interface MaintenanceOfficeReport {
  /** Shafts this office looks after, in shaft order. */
  shafts: number[];
  /** Mechanics (one car each at a time). */
  crews: number;
  /** Mechanics repairing a car right now. */
  busy: number;
}

/** Inspector summary for one maintenance office; undefined for other tenants. */
export function maintenanceOfficeReport(state: GameState, tenantId: number): MaintenanceOfficeReport | undefined {
  const office = state.tenants.get(tenantId);
  if (office?.type !== 'maintenance') return undefined;
  const open = office.state === 'open';
  const shafts: number[] = [];
  if (open) for (const group of state.elevatorGroups.values()) if (mechanicEntry(state, office, group) !== null) shafts.push(group.id);
  return { shafts, crews: open ? office.capacity : 0, busy: mechanicsBusy(state, tenantId) };
}

export interface MaintenanceSummary {
  shafts: number;
  coveredShafts: number;
  uncoveredShaftIds: number[];
  brokenCars: number;
  /** Broken cars on covered shafts waiting for a free mechanic. */
  waitingForMechanics: number;
}

/** Tower-wide maintenance status (overlay legend, metrics, the playthrough bot). */
export function maintenanceSummary(state: GameState): MaintenanceSummary {
  const summary: MaintenanceSummary = { shafts: 0, coveredShafts: 0, uncoveredShaftIds: [], brokenCars: 0, waitingForMechanics: 0 };
  for (const group of state.elevatorGroups.values()) {
    summary.shafts++;
    const covered = maintenanceCoversShaft(state, group);
    if (covered) summary.coveredShafts++;
    else summary.uncoveredShaftIds.push(group.id);
    for (const car of group.cars) {
      if (!car.outOfService) continue;
      summary.brokenCars++;
      if (covered && car.repairAtTick === undefined) summary.waitingForMechanics++;
    }
  }
  return summary;
}

/**
 * Send the nearest office with a free mechanic to a broken car. The repair
 * takes MAINTENANCE_REPAIR_TICKS plus travel along the shaft from the
 * mechanics' entry stop. Returns the office, or null when none is free.
 */
export function assignMechanic(state: GameState, group: ElevatorGroup, car: ElevatorCar, carFloor: number): Tenant | null {
  const candidates: { office: Tenant; entry: number }[] = [];
  for (const office of openTenants(state, 'maintenance')) {
    const entry = mechanicEntry(state, office, group);
    if (entry !== null) candidates.push({ office, entry });
  }
  candidates.sort((a, b) => Math.abs(a.entry - a.office.floor) - Math.abs(b.entry - b.office.floor) || a.office.id - b.office.id);
  for (const { office, entry } of candidates) {
    if (mechanicsBusy(state, office.id) >= office.capacity) continue;
    const floors = Math.abs(office.floor - entry) + Math.abs(entry - carFloor);
    car.repairOfficeId = office.id;
    car.repairAtTick = state.tickCount + CONFIG.MAINTENANCE_REPAIR_TICKS + floors * CONFIG.MAINTENANCE_TRAVEL_TICKS_PER_FLOOR;
    return office;
  }
  return null;
}

export function blackoutActive(state: GameState): boolean {
  return state.tickCount < (state.campaign.blackoutUntilTick ?? 0);
}

export function hasOpenGenerator(state: GameState): boolean {
  for (const t of state.tenants.values()) if (t.type === 'generator' && t.state === 'open') return true;
  return false;
}

/** False while a blackout cuts power to a tower without an open generator. */
export function elevatorsPowered(state: GameState): boolean {
  return !blackoutActive(state) || hasOpenGenerator(state);
}

/** Floor of an open helipad connected to `floor`, or null. */
export function helipadFloorFor(state: GameState, floor: number): number | null {
  for (const pad of openTenants(state, 'helipad')) {
    if (pickupRoute(state, pad.floor, floor, 'hotelGuest') !== null) return pad.floor;
  }
  return null;
}
