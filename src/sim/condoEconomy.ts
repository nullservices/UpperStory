import { CONFIG } from '../data/config';
import type { Tenant } from './tenants';
import type { GameState } from './state';
import { checkRouting, pickupRoute } from './routing';

export function condoHasAccess(state: GameState, tenant: Tenant): boolean {
  checkRouting(state);
  return pickupRoute(state, CONFIG.LOBBY_FLOOR_INDEX, tenant.floor, 'resident') !== null &&
    pickupRoute(state, tenant.floor, CONFIG.LOBBY_FLOOR_INDEX, 'resident') !== null;
}

/** Average sale is reference-backed; other tiers use provisional multipliers. */
export function condoSaleCents(tenant: Tenant): number {
  return Math.round(150_000_00 * CONFIG.PRICING_LEVELS[tenant.pricing].revenueMult);
}

export function sellCondo(tenant: Tenant): void {
  if (tenant.type !== 'condo' || tenant.sold) return;
  tenant.condoSaleCents = condoSaleCents(tenant);
  tenant.dailyRevenue += tenant.condoSaleCents;
  tenant.sold = true;
}

export function repurchaseCondo(tenant: Tenant): void {
  if (tenant.type !== 'condo' || !tenant.sold) return;
  // Older saves only recorded the fixed $150,000 sale.
  tenant.dailyRevenue -= tenant.condoSaleCents ?? 150_000_00;
  tenant.sold = false;
  delete tenant.condoSaleCents;
}
