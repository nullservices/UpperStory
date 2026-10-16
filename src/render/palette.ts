import type { CellContent, PersonKind, Tenant, TenantType } from '../sim';

/**
 * Art seam for the procedural tower. Every color the world renderers share
 * lives here; the visual language follows the classic cutaway-tower look
 * (bright sky, green street line, tan soil, cream framed rooms) with all art
 * drawn procedurally — the sim never changes when this file does.
 */
export const PALETTE = {
  /** Daytime sky gradient (screen-space, top → horizon). */
  skyTop: 0x2f6fd6,
  skyBottom: 0xa9d8ff,
  /** Night sky gradient. */
  nightSkyTop: 0x060a1f,
  nightSkyBottom: 0x1b2856,
  /** Dawn/dusk horizon glow. */
  duskGlow: 0xf2a25a,
  cloud: 0xffffff,
  cloudShade: 0xd4e6fa,
  /** Street-level grass line and the soil band below ground. */
  grass: 0x4fae3a,
  grassLight: 0x86d35e,
  grassDark: 0x2f7d25,
  soil: 0xa5784a,
  soilDark: 0x8a6239,
  soilLight: 0xbf935f,
  soilDeep: 0x7a5432,
  /** Built but unfurnished floor space. */
  floorBg: 0xcdc6b4,
  floorBgShade: 0xb9b19d,
  basementBg: 0xa79f8e,
  basementShade: 0x948b79,
  /** Floor slab (bottom of each band) and the tower's outer walls. */
  slab: 0x5b564c,
  slabLight: 0x8d877a,
  shell: 0x3c3934,
  roof: 0x6d6a63,
  roofLight: 0xd9d4c6,
  floorLabel: 0x2a3a5a,
  /** Room frame shared by every furnished room. */
  roomDivider: 0x4a463e,
  roomCeiling: 0xd6cfbf,
  scaffold: 0xc0813a,
  scaffoldDark: 0x8a5a28,
  stair: 0x8e877a,
  stairWell: 0xd9d2c2,
  escalator: 0x4d7fae,
  escalatorRail: 0x2c4f73,
  elevatorShaft: 0x4a4a55,
  elevatorLobby: 0x6a4f8f,
  facility: 0x9e4a4a,
  gridLine: 0x303a52,
} as const;

/**
 * Body color per tenant type — used by the minimap and as the dominant hue
 * of each room's art (signage, upholstery).
 */
export const TENANT_COLORS: Record<TenantType, number> = {
  lobby: 0xd9c38a,
  office: 0x6f8fb8,
  condo: 0xc9824a,
  fastfood: 0xe0452e,
  security: 0x3f5fa8,
  housekeeping: 0x9aa7a0,
  hotel: 0x4f7fc0,
  restaurant: 0x8a2f35,
  shop: 0x3f9a58,
  skyLobby: 0x7fb3cf,
  hotelTwin: 0x5aa060, hotelSuite: 0xb58a3a, partyHall: 0xe07fa0, cinema: 0xb3262f,
  medical: 0xd8403a, parkingRamp: 0x8f8f8a, parkingSpace: 0x7a7a76, recycling: 0x3d7a3a, metro: 0x2f5fb3, cathedral: 0xc9b07a,
  fireStation: 0xc8281e, bank: 0x2a5a8a, helipad: 0x5a5e66, rooftopPool: 0x3aa8d8, maintenance: 0xd09a2a, generator: 0x6a6a3a,
};

/**
 * Person silhouette color per kind. People read as small dark figures; the
 * hue only hints at who they are (stress blends toward pink/red).
 */
export const PERSON_COLORS: Record<PersonKind, number> = {
  officeWorker: 0x1d2a44,
  resident: 0x3b2618,
  hotelGuest: 0x2c1f3e,
  diner: 0x2f2a1c,
  shopper: 0x1e3424,
  guard: 0x1a2c6e,
  housekeeper: 0x4a3a2a,
};

/** Stress ramp for impatient people: dark → pink → red. */
export const STRESS_COLORS = { pink: 0xf07aa8, red: 0xe02020 } as const;

/**
 * Elevator hardware colors: shaft interior, landing doors, car bodies, and
 * the red call lamps beside each serviced floor's door.
 */
export const ELEVATOR_COLORS = {
  shaftHousing: 0x3b3f4a,
  shaftInner: 0x23262e,
  serviceHousing: 0x4a4238,
  expressHousing: 0x2f3c52,
  rail: 0x6a7080,
  door: 0x9aa3ad,
  doorLight: 0xc3cad2,
  doorFrame: 0x5d6470,
  carBody: 0xf6e7a6,
  carShade: 0xd9c47a,
  carFrame: 0x5a4a1e,
  serviceCar: 0xd9d9d0,
  expressCar: 0xf3c76b,
  carDoorsOpen: 0xfff6d6,
  callLight: 0xff3b2f,
  arrowUp: 0x3fbf5f,
  arrowDown: 0xff8a2f,
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

/** Linear RGB blend of two 0xRRGGBB colors. */
export function lerpRgb(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}
