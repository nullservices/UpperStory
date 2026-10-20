import type { Texture } from 'pixi.js';
import { PixMap, shade, tint } from './pixmap';

/**
 * Tower structure tiles: the unfurnished floor band (bare plaster wall,
 * concrete floor, structural column every 8 cells, ceiling slab underside)
 * as a 64x22 tile (8 cells of 8 px) repeated along each floor by a TilingSprite.
 */

export const BAND_TILE_W = 64;
export const BAND_TILE_H = 22;

const tiles = new Map<string, Texture>();

export function emptyBandTexture(basement: boolean): Texture {
  const key = basement ? 'b' : 'a';
  const cached = tiles.get(key);
  if (cached) return cached;
  const w = BAND_TILE_W, h = BAND_TILE_H;
  const pm = new PixMap(w, h);
  const wall = basement ? 0x9e9684 : 0xc9c2b0;
  const floor = basement ? 0x7a7466 : 0x9a9282;
  pm.rect(0, 0, w, 1, 0x2e2a27);
  pm.rect(0, 1, w, 1, 0x58524a);
  pm.rect(0, 2, w, h - 6, wall);
  pm.hline(0, 2, w, shade(wall, 0.3));
  pm.dither(0, 3, w, 1, shade(wall, 0.15));
  // Unfinished wall: faint plasterboard joints.
  for (let x = 16; x < w; x += 16) pm.vline(x, 4, h - 9, shade(wall, 0.08));
  pm.hline(0, h - 5, w, shade(wall, 0.35));
  pm.rect(0, h - 4, w, 4, floor);
  pm.sparse(0, h - 4, w, 4, shade(floor, 0.1));
  pm.hline(0, h - 4, w, tint(floor, 0.15));
  pm.hline(0, h - 1, w, shade(floor, 0.25));
  // Structural column straddling the tile seam (every 8 cells).
  const col = basement ? 0x8a8272 : 0xb2aa96;
  for (const x of [w - 2, w - 1, 0, 1]) pm.vline(x, 2, h - 6, col);
  pm.vline(w - 2, 2, h - 6, tint(col, 0.25));
  pm.vline(1, 2, h - 6, shade(col, 0.25));
  pm.vline(2, 2, h - 6, shade(wall, 0.18));
  pm.rect(w - 3, 2, 6, 1, shade(col, 0.2));
  pm.set(2, 2, shade(col, 0.2));
  const tex = pm.texture();
  tex.source.addressMode = 'repeat';
  tiles.set(key, tex);
  return tex;
}

const flights = new Map<string, Texture>();

/** Stairwell back wall for one band: w x h (h excludes the 2 px slab). */
export function wellTexture(w: number, h: number): Texture {
  const key = `well|${w}|${h}`;
  let tex = flights.get(key);
  if (tex) return tex;
  const pm = new PixMap(w, h);
  const wall = 0xd9d2c2;
  pm.rect(0, 0, w, h, wall);
  pm.hline(0, 0, w, 0x2e2a27);
  pm.hline(0, 1, w, 0x58524a);
  pm.hline(0, 2, w, shade(wall, 0.3));
  pm.dither(0, 3, w, 1, shade(wall, 0.14));
  // Painted dado band and a scuffed skirting, typical of a fire stair.
  const dado = Math.max(4, h - 9);
  pm.hline(0, dado, w, 0x9a8a6a);
  pm.sparse(0, dado + 1, w, Math.max(0, h - dado - 5), shade(wall, 0.08));
  pm.hline(0, h - 5, w, shade(wall, 0.4));
  pm.rect(0, h - 4, w, 4, 0x9a9282);
  pm.sparse(0, h - 4, w, 4, 0x8a8272);
  pm.vline(0, 0, h, 0x4a463e);
  pm.vline(w - 1, 0, h, 0x4a463e);
  tex = pm.texture();
  flights.set(key, tex);
  return tex;
}

/**
 * One stair or escalator flight rising left to right across `rise` pixels
 * over `width`. The texture is `rise + 10` tall: its bottom row sits on the
 * lower landing and the handrail runs 9 px above the treads.
 */
export function flightTexture(width: number, rise: number, escalator: boolean, dir: string): Texture {
  const key = `flight|${width}|${rise}|${escalator ? dir : 'stair'}`;
  let tex = flights.get(key);
  if (tex) return tex;
  const H = rise + 10;
  const pm = new PixMap(width, H);
  const steps = Math.max(4, Math.round(rise / 3));
  const stepW = (width - 4) / steps;
  const stepH = rise / steps;
  const topOf = (i: number): number => Math.round(H - (i + 1) * stepH);
  const xOf = (i: number): number => Math.round(2 + i * stepW);
  const tread = escalator ? 0xb4bcc4 : 0xa49c8c;
  const nose = escalator ? 0xe0e6ec : 0xc8c0b0;
  const riser = escalator ? 0x6a727c : 0x7a7466;
  const stringer = escalator ? 0x4d7fae : 0x5b564c;
  const stringerDark = escalator ? 0x2c4f73 : 0x3c3934;
  for (let i = 0; i < steps; i++) {
    const sx = xOf(i), sy = topOf(i);
    const sw = Math.max(1, xOf(i + 1) - sx);
    const sh = Math.max(2, Math.round(stepH));
    // Tread nosing, tread, riser face below it.
    pm.hline(sx, sy, sw, nose);
    pm.hline(sx, sy + 1, sw, tread);
    pm.rect(sx, sy + 2, sw, sh - 1, riser);
    if (escalator) for (let x = sx; x < sx + sw; x += 2) pm.set(x, sy + 1, shade(tread, 0.2));
    // Stringer / truss band under the flight.
    const band = escalator ? 5 : 3;
    pm.rect(sx, sy + sh + 1, sw, band, stringer);
    pm.hline(sx, sy + sh + band, sw, stringerDark);
    if (escalator && i % 2 === 0) pm.set(sx + Math.floor(sw / 2), sy + sh + 3, tint(stringer, 0.3));
    // Balustrade and handrail a figure's height above the treads.
    if (escalator) {
      for (let y = sy - 8; y < sy; y++) for (let x = sx; x < sx + sw; x++) if (((x + y) & 3) === 0) pm.set(x, y, 0xcfe8f4);
      pm.hline(sx, sy - 9, sw, 0x26262a);
      pm.hline(sx, sy - 8, sw, 0x4a4a52);
    } else {
      pm.hline(sx, sy - 9, sw, 0x7a4a22);
      pm.hline(sx, sy - 8, sw, shade(0x7a4a22, 0.3));
      if (i % 3 === 0) pm.vline(sx, sy - 7, 7, 0x6c6c74);
    }
  }
  // Newel posts at both ends of a stair; comb plates on an escalator.
  if (!escalator) {
    pm.rect(2, H - 11, 2, 11, 0x5a3418);
    pm.rect(width - 4, topOf(steps - 1) - 10, 2, 10, 0x5a3418);
  } else {
    pm.rect(0, H - 2, 4, 2, 0x9c9ca4);
    pm.rect(width - 4, topOf(steps - 1), 4, 2, 0x9c9ca4);
    // Direction chevron at mid-flight.
    const mx = Math.round(width / 2), my = Math.round(H - rise / 2 + 4);
    const color = dir === 'up' ? 0x3fbf5f : 0xff8a2f;
    for (let k = 0; k < 3; k++) {
      const row = dir === 'up' ? my - 1 + k : my + 1 - k;
      pm.hline(mx - k, row, 2 * k + 1, color);
    }
  }
  tex = pm.texture();
  flights.set(key, tex);
  return tex;
}
