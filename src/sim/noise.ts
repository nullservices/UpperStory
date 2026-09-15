import { isHotel } from '../data/config';
import type { Tenant } from './tenants';
import type { GameState } from './state';

/** Documented PC spacing pairs; penalty strength is a tuning approximation. */
export function noisePenalty(state: GameState, tenant: Tenant): number {
  const sourceType = tenant.type === 'office' ? 'fastfood' : isHotel(tenant.type) ? 'office' : null;
  if (!sourceType) return 0;
  const clearance = tenant.type === 'office' ? 11 : 21;
  for (const source of state.tenants.values()) {
    if (source.type !== sourceType || source.state !== 'open' || source.floor !== tenant.floor) continue;
    const gap = Math.max(source.x - (tenant.x + tenant.sizeCells), tenant.x - (source.x + source.sizeCells), 0);
    if (gap < clearance) return 20;
  }
  return 0;
}
