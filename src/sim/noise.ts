import { facilityHeight, isHotel } from '../data/config';
import type { Tenant } from './tenants';
import type { GameState } from './state';

/** Nearby-floor noise model. Reach, spacing and penalty are approximations. */
export interface NoiseSource { tenantId: number; gap: number; clearance: number; floorDistance: number }

export function noiseSources(state: GameState, tenant: Tenant): NoiseSource[] {
  const residential = tenant.type === 'condo' || isHotel(tenant.type);
  if (tenant.type !== 'office' && !residential) return [];
  const sources: NoiseSource[] = [];
  const clearance = tenant.type === 'office' ? 11 : 21;
  for (const source of state.tenants.values()) {
    const commercial = ['fastfood', 'restaurant', 'shop', 'cinema'].includes(source.type);
    if ((!commercial && !(residential && source.type === 'office')) ||
        source.id === tenant.id || source.state !== 'open') continue;
    const sourceTop = source.floor + facilityHeight(source.type) - 1;
    const tenantTop = tenant.floor + facilityHeight(tenant.type) - 1;
    const floorDistance = Math.max(source.floor - tenantTop, tenant.floor - sourceTop, 0);
    // Include all occupied bands of multi-story venues and their neighbors.
    // A full intervening floor currently insulates them; exact falloff is unknown.
    if (floorDistance > 1) continue;
    const gap = Math.max(source.x - (tenant.x + tenant.sizeCells), tenant.x - (source.x + source.sizeCells), 0);
    if (gap < clearance) sources.push({ tenantId: source.id, gap, clearance, floorDistance });
  }
  return sources;
}

export function noisePenalty(state: GameState, tenant: Tenant): number {
  return noiseSources(state, tenant).length ? 20 : 0;
}
