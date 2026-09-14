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
    tenant.tradingDays = (tenant.tradingDays ?? 0) + 1;
    if (tenant.type === 'fastfood') {
      const age = tenant.tradingDays;
      const base = age === 1 ? 10 : age <= 4 ? 20 : 35;
      const demand = day % 3 === 0 ? (age > 4 ? 48 : Math.round(base * 1.2)) : base;
      tenant.externalDemand = Math.round(demand * (state.campaign.weather === 'rain' ? 0.5 : 1)
        * CONFIG.PRICING_LEVELS[tenant.pricing]!.visitorMult);
      tenant.externalArrivals = 0;
    }
  }
}
