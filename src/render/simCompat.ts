import type { ElevatorCar, GameState, Tenant } from '../sim';

/**
 * Read-only accessors for simulation fields from the shared feature contract
 * (docs/feature-plan.md). They tolerate saves and states that predate the
 * fields, so the renderer never crashes on an absent value.
 */

/** A broken car: it holds position and takes no passengers until repaired. */
export function carOutOfService(car: ElevatorCar): boolean {
  return car.outOfService === true;
}

/** Tick until which a blackout lasts (0 = none). */
export function blackoutUntilTick(state: GameState): number {
  return state.campaign.blackoutUntilTick ?? 0;
}

/** True while the grid is down (ignores backup power). */
export function blackoutActive(state: GameState): boolean {
  return state.tickCount < blackoutUntilTick(state);
}

/** An open backup generator keeps the whole tower powered (sim rule). */
export function isPowerSource(tenant: Tenant): boolean {
  return tenant.type === 'generator' && tenant.state === 'open';
}

/** Tower is dark: a blackout is on and no open generator exists. */
export function towerUnpowered(state: GameState): boolean {
  if (!blackoutActive(state)) return false;
  for (const tenant of state.tenants.values()) if (isPowerSource(tenant)) return false;
  return true;
}
