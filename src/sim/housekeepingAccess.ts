import { isHotel } from '../data/config';
import { checkRouting, pickupRoute } from './routing';
import type { GameState } from './state';
import type { Tenant } from './tenants';

export interface HousekeepingAccess {
  openOffices: number;
  reachableOffices: number;
  assignedCleaners: number;
}

/** Structural access from operating offices, not a promise of cleaning capacity. */
export function housekeepingAccess(state: GameState, hotel: Tenant): HousekeepingAccess | undefined {
  if (!isHotel(hotel.type)) return undefined;
  checkRouting(state);
  const offices = [...state.tenants.values()].filter(t => t.type === 'housekeeping' && t.state === 'open');
  return {
    openOffices: offices.length,
    reachableOffices: offices.filter(office => pickupRoute(state, office.floor, hotel.floor, 'housekeeper') !== null).length,
    assignedCleaners: [...state.people.values()].filter(p => p.kind === 'housekeeper' &&
      p.activityTenantId === hotel.id && ['walking', 'waiting', 'riding', 'onStairs', 'onEscalator', 'cleaning'].includes(p.state)).length,
  };
}
