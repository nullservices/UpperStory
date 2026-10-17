import { facilityHeight, isHotel } from '../data/config';
import type { Tenant } from './tenants';
import type { GameState } from './state';

/** Nearby-floor noise model. Reach, spacing and penalty are approximations. */
export interface NoiseSource { tenantId: number; gap: number; clearance: number; floorDistance: number }

export function noiseSources(state: GameState, tenant: Tenant): NoiseSource[] {
  const sources: NoiseSource[] = [];
  for (const source of state.tenants.values()) {
    const found = noiseFrom(tenant, source);
    if (found) sources.push(found);
  }
  return sources;
}

/** Open tenants that can make noise, listed under every floor band they occupy. */
export type NoiseIndex = Map<number, Tenant[]>;

export function noiseIndex(state: GameState): NoiseIndex {
  const index: NoiseIndex = new Map();
  for (const source of state.tenants.values()) {
    if (source.state !== 'open' || (!COMMERCIAL.includes(source.type) && source.type !== 'office')) continue;
    for (let f = source.floor; f < source.floor + facilityHeight(source.type); f++) {
      const list = index.get(f) ?? [];
      list.push(source);
      index.set(f, list);
    }
  }
  return index;
}

/** Pass an index when evaluating many tenants; only adjacent floors can be heard. */
export function noisePenalty(state: GameState, tenant: Tenant, index?: NoiseIndex): number {
  if (!index) return noiseSources(state, tenant).length ? 20 : 0;
  const top = tenant.floor + facilityHeight(tenant.type) - 1;
  for (let f = tenant.floor - 1; f <= top + 1; f++) {
    for (const source of index.get(f) ?? []) if (noiseFrom(tenant, source)) return 20;
  }
  return 0;
}

/** Noisy neighbours; the bar (Upper Story original) is as loud as fast food. */
const COMMERCIAL: readonly string[] = ['fastfood', 'restaurant', 'shop', 'cinema', 'bar'];

function noiseFrom(tenant: Tenant, source: Tenant): NoiseSource | null {
  const residential = tenant.type === 'condo' || tenant.type === 'apartment' || isHotel(tenant.type);
  if (tenant.type !== 'office' && !residential) return null;
  const commercial = COMMERCIAL.includes(source.type);
  if ((!commercial && !(residential && source.type === 'office')) ||
      source.id === tenant.id || source.state !== 'open') return null;
  const sourceTop = source.floor + facilityHeight(source.type) - 1;
  const tenantTop = tenant.floor + facilityHeight(tenant.type) - 1;
  const floorDistance = Math.max(source.floor - tenantTop, tenant.floor - sourceTop, 0);
  // Include all occupied bands of multi-story venues and their neighbors.
  // A full intervening floor currently insulates them; exact falloff is unknown.
  if (floorDistance > 1) return null;
  const clearance = tenant.type === 'office' ? 11 : 21;
  const gap = Math.max(source.x - (tenant.x + tenant.sizeCells), tenant.x - (source.x + source.sizeCells), 0);
  return gap < clearance ? { tenantId: source.id, gap, clearance, floorDistance } : null;
}
