import { CONFIG } from '../data/config';
import { rngNext, seedRng } from './core/rng';
import { pickupRoute } from './routing';
import type { GameState } from './state';
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

/** An open fire station within reach (20 floors and a staff route) of `floor`. */
export function fireStationCovers(state: GameState, floor: number): boolean {
  return openTenants(state, 'fireStation').some(t =>
    Math.abs(t.floor - floor) <= CONFIG.FIRE_STATION_REACH_FLOORS && staffReach(state, t.floor, floor));
}

/** An open maintenance office whose mechanics can reach `floor`. */
export function maintenanceReaches(state: GameState, floor: number): boolean {
  return openTenants(state, 'maintenance').some(t => staffReach(state, t.floor, floor));
}

/** Mechanics reach a shaft when they can get to its stop nearest their office. */
export function maintenanceCoversShaft(state: GameState, stops: readonly number[]): boolean {
  if (stops.length === 0) return false;
  return openTenants(state, 'maintenance').some(t => {
    const nearest = stops.reduce((best, s) => Math.abs(s - t.floor) < Math.abs(best - t.floor) ? s : best);
    return staffReach(state, t.floor, nearest);
  });
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
