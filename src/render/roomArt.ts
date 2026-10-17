import type { Texture } from 'pixi.js';
import { CONFIG, isHotel } from '../data/config';
import type { Tenant, TenantState, TenantType } from '../sim';
import { PixMap, hash32, mix } from './sprites/pixmap';
import { lookCount, paintRoom, type RoomLook } from './sprites/rooms';

export type { RoomLook } from './sprites/rooms';
export { cinemaScreen, isOpenAir, poolWater } from './sprites/rooms';

/**
 * Pixel-art room interiors. Each room look is painted once (sprites/rooms.ts)
 * and baked into nearest-sampled textures keyed by type/state/size/variant/
 * look, so a thousand identical offices share one texture. Rooms wider than
 * MAX_PIECE_PX are cut into side-by-side pieces to stay under GPU texture
 * limits (wide lobbies). Coordinates are room-local: (0,0) is the top-left
 * of the room's top floor band; the textures cover the footprint minus the
 * 2 px floor slab the tower shell draws below.
 */

/** Widest single texture piece (safe on every WebGL device). */
const MAX_PIECE_PX = 2048;

export interface RoomPiece {
  texture: Texture;
  /** Room-local x of the piece. */
  x: number;
  /**
   * Night emissive layer for the same piece: lamp pixels at full brightness
   * plus a dithered warm pool of light around them (null when the piece has
   * no lamps). Drawn untinted over the night-tinted room while it is lit.
   */
  glow: Texture | null;
}

/** Lamp colours in the room art that glow after dark. */
const EMISSIVE = new Set([0xfff4bc, 0xeef6ff, 0xfff6d8, 0xfff4c0, 0xffd75a, 0xfff0a8, 0xfffbe8]);
const GLOW_WARM = 0xffe2a0;
const HALO_R = 4;

/** Emissive layer of a painted room; null when nothing in it glows. */
function glowMap(pm: PixMap): PixMap | null {
  const out = new PixMap(pm.w, pm.h);
  let any = false;
  for (let y = 0; y < pm.h; y++) {
    for (let x = 0; x < pm.w; x++) {
      if (!EMISSIVE.has(pm.get(x, y))) continue;
      any = true;
      // Light falls mostly downward from ceiling lamps: a dithered half-disc.
      for (let dy = -1; dy <= HALO_R + 1; dy++) {
        for (let dx = -HALO_R; dx <= HALO_R; dx++) {
          if (dx * dx + dy * dy > HALO_R * HALO_R + 2) continue;
          const hx = x + dx, hy = y + dy;
          if (((hx + hy) & 1) !== 0 || out.get(hx, hy) >= 0) continue;
          const c = pm.get(hx, hy);
          if (c >= 0) out.set(hx, hy, mix(c, GLOW_WARM, 0.35));
        }
      }
    }
  }
  if (!any) return null;
  for (let y = 0; y < pm.h; y++) for (let x = 0; x < pm.w; x++) {
    const c = pm.get(x, y);
    if (EMISSIVE.has(c)) out.set(x, y, c);
  }
  return out;
}

const cache = new Map<string, RoomPiece[]>();

/** The look a tenant's room should show right now (cheap; read-only). */
export function roomLook(tenant: Tenant): RoomLook {
  if (tenant.state !== 'open') return '';
  if (isHotel(tenant.type)) {
    if (tenant.cleanliness < CONFIG.DIRTY_HOTEL_THRESHOLD) return 'dirty';
    return tenant.occupancy > 0 ? 'guest' : '';
  }
  if ((tenant.type === 'office' || tenant.type === 'condo' || tenant.type === 'apartment') && tenant.grade <= 1) return 'unhappy';
  return '';
}

/** Deterministic interior variant for a tenant (by id). */
export function roomVariant(tenant: Tenant): number {
  // Layout and style together; neighbours rarely share both.
  return hash32(tenant.id) % lookCount(tenant.type);
}

/** Cache key of one room look. */
export function roomKey(type: TenantType, state: TenantState, w: number, h: number, variant: number, look: RoomLook): string {
  return `${type}|${state}|${w}|${h}|${variant}|${look}`;
}

/** Shared textures for one room look; painted on first use, then reused. */
export function roomTextures(
  type: TenantType,
  state: TenantState,
  w: number,
  h: number,
  variant: number,
  look: RoomLook = '',
): RoomPiece[] {
  const key = roomKey(type, state, w, h, variant, look);
  let pieces = cache.get(key);
  if (!pieces) {
    const pm = paintRoom(type, state, w, h, variant, look);
    const glow = state === 'open' ? glowMap(pm) : null;
    if (pm.w <= MAX_PIECE_PX) {
      pieces = [{ texture: pm.texture(), x: 0, glow: glow ? glow.texture() : null }];
    } else {
      pieces = [];
      for (let x = 0; x < pm.w; x += MAX_PIECE_PX) {
        const pw = Math.min(MAX_PIECE_PX, pm.w - x);
        const part = new PixMap(pw, pm.h);
        part.paste(pm, 0, 0, x, 0, pw, pm.h);
        let glowPart: Texture | null = null;
        if (glow) {
          const g = new PixMap(pw, pm.h);
          g.paste(glow, 0, 0, x, 0, pw, pm.h);
          glowPart = g.texture();
        }
        pieces.push({ texture: part.texture(), x, glow: glowPart });
      }
    }
    cache.set(key, pieces);
  }
  return pieces;
}

/** Number of distinct cached room looks (diagnostics/tests). */
export function roomArtCacheSize(): number {
  return cache.size;
}
