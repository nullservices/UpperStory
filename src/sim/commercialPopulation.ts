import { CONFIG } from '../data/config';
import type { GameState } from './state';
import type { TenantType } from './tenants';

/** Fast food uses the PC reference; other openings retain our visitor windows. */
export function commercialOpeningMinute(type: TenantType): number | null {
  if (type === 'fastfood') return 600;
  if (type === 'shop') return CONFIG.SHOPPER_WINDOW_MIN;
  if (type === 'restaurant') return 720;
  return null;
}

/** Count external patrons from the preceding trading day, once at opening. */
export function stepCommercialPopulation(state: GameState): void {
  const { day, minuteOfDay } = state.calendar;
  if (minuteOfDay >= 1440) return;
  for (const tenant of state.tenants.values()) {
    const opening = commercialOpeningMinute(tenant.type);
    if (tenant.state !== 'open' || opening === null || minuteOfDay < opening || tenant.populationUpdatedDay === day) continue;
    const weekend = (day - 1) % 3 === 0 && day > 1;
    const cap = tenant.type === 'fastfood' ? (weekend ? 48 : 35) : tenant.type === 'shop' ? (weekend ? 30 : 25) : 35;
    tenant.reportedPopulation = Math.min(cap, tenant.visitsToday ?? 0);
    tenant.visitsToday = 0;
    tenant.populationUpdatedDay = day;
  }
}
