import type { CellContent, PersonKind, Tenant, TenantType } from '../sim';

/**
 * Flat-color art for the M1 tower. Every sim concept maps to a color here;
 * this file is the seam where pixel-art tiles/sprites later replace
 * procedural blocks — the sim never changes.
 */
export const PALETTE = {
  skyTop: 0x0a1024,
  skyBottom: 0x1e2c4d,
  ground: 0x2b3123,
  basementBg: 0x15181f,
  floorBg: 0x242a3a,
  gridLine: 0x303a52,
  floorLabel: 0x7d8db1,
  scaffold: 0x8a6d3b,
  stair: 0x6e7b8f,
  escalator: 0x7f9f5f,
  elevatorShaft: 0x4a4a55,
  elevatorLobby: 0x6a4f8f,
  facility: 0x9e4a4a,
} as const;

/** Body color per tenant type (lobby is a Tenant now, not a cell kind). */
export const TENANT_COLORS: Record<TenantType, number> = {
  lobby: 0xc9a227,
  office: 0x3d6b9e,
  condo: 0x8a5f3d,
  fastfood: 0xd17a3f,
  security: 0x4a5a8a,
  housekeeping: 0x8a6a5a,
  hotel: 0xa06ab0,
  restaurant: 0x4f9e6a,
  shop: 0xc78a3d,
  skyLobby: 0x6a9fb5,
};

/** Body color per person kind (M2). */
export const PERSON_COLORS: Record<PersonKind, number> = {
  officeWorker: 0x355d72,
  resident: 0x9c5e3e,
  hotelGuest: 0x81517f,
  diner: 0xab743c,
  shopper: 0x447e57,
  guard: 0x3d5a99,
  housekeeper: 0x756346,
};

/**
 * Elevator hardware colors (M2): shaft housing, car bodies, and the red call
 * lamps beside each serviced floor's door.
 */
export const ELEVATOR_COLORS = {
  shaftHousing: 0x82958a,
  carBody: 0xc2c8b6,
  carDoorsOpen: 0xe3e4d3,
  callLight: 0xe05555,
} as const;

/**
 * Color for a filled cell. 'tenant' cells look up the occupying tenant's
 * type (unknown tenants fall back to grey); every other content kind has a
 * fixed color. 'empty' is never filled by the renderer.
 */
export function cellColor(content: CellContent, tenant?: Tenant): number {
  switch (content) {
    case 'tenant': {
      const type = tenant?.type;
      return type ? TENANT_COLORS[type] : 0x888888;
    }
    case 'scaffold':
      return PALETTE.scaffold;
    case 'stair':
      return PALETTE.stair;
    case 'escalator':
      return PALETTE.escalator;
    case 'elevatorShaft':
      return PALETTE.elevatorShaft;
    case 'elevatorLobby':
      return PALETTE.elevatorLobby;
    case 'facility':
      return PALETTE.facility;
    case 'empty':
    default:
      return PALETTE.floorBg;
  }
}
