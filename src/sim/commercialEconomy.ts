import { CONFIG } from '../data/config';
import type { Tenant } from './tenants';

/** Calibrated income curves, not a recovered original-game formula. */
export function recordCommercialVisit(tenant: Tenant, officeWorker: boolean, day: number): boolean {
  if (!['fastfood', 'restaurant', 'shop'].includes(tenant.type)) return false;
  const weekend = day % 3 === 0;
  const natural = tenant.paidExternalVisits ?? 0;
  const workers = tenant.paidOfficeVisits ?? 0;
  const total = (external: number, office: number): number => {
    if (tenant.type === 'fastfood') {
      return Math.round(Math.min(external / (weekend ? 48 : 35), 1) * 3000_00)
        + (weekend ? 0 : Math.round(Math.min(office / 15, 1) * 2000_00));
    }
    const patrons = external + office;
    return Math.round(Math.min(patrons / (tenant.type === 'shop' ? (weekend ? 30 : 25) : 35), 1)
      * (tenant.type === 'shop' ? 5000_00 : 6000_00));
  };
  const nextNatural = natural + (officeWorker ? 0 : 1);
  const nextWorkers = workers + (officeWorker ? 1 : 0);
  const delta = total(nextNatural, nextWorkers) - total(natural, workers);
  tenant.paidExternalVisits = nextNatural;
  tenant.paidOfficeVisits = nextWorkers;
  tenant.visitsToday = (tenant.visitsToday ?? 0) + (officeWorker ? 0 : 1);
  tenant.dailyRevenue += Math.round(delta * CONFIG.PRICING_LEVELS[tenant.pricing]!.revenueMult);
  return true;
}
