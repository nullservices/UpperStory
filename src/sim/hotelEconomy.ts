import { CONFIG, TENANT_DATA, isHotel } from '../data/config';
import type { Tenant } from './tenants';

/** Guest shares sum to the room rate when the room is fully occupied. */
export function hotelCheckoutCents(hotel: Tenant): number {
  if (!isHotel(hotel.type)) return 0;
  const type = hotel.type as keyof typeof CONFIG.HOTEL_ROOM_NIGHTLY_DOLLARS;
  const rate = CONFIG.HOTEL_ROOM_NIGHTLY_DOLLARS[type];
  return Math.round(rate * CONFIG.PRICING_LEVELS[hotel.pricing]!.revenueMult * 100 / TENANT_DATA[type].capacity);
}
