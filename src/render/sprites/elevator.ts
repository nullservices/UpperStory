import type { Texture } from 'pixi.js';
import { PixMap, shade, tint } from './pixmap';

/**
 * Elevator hardware in pixels: shaft segments (one per floor band: housing,
 * dark well, guide rails, slab, and a landing door frame with an indicator
 * lamp at served stops) and cars with sliding doors in DOOR_STEPS stages.
 * Standard cars are brass, service cars brushed steel with hazard trim,
 * express cars navy with gold trim.
 */

export type CarKind = 'standard' | 'service' | 'express';
export type LandingKind = 'stop' | 'pass' | 'off';

/** Door animation stages: 0 = closed .. DOOR_STEPS - 1 = fully open. */
export const DOOR_STEPS = 6;

interface KindStyle {
  housing: number;
  frame: number;
  door: number;
  trim: number;
  header: number;
}

const STYLES: Record<CarKind, KindStyle> = {
  standard: { housing: 0x3b3f4a, frame: 0x4a3a14, door: 0xe8c860, trim: 0xb08a28, header: 0xf6e7a6 },
  service: { housing: 0x4a4238, frame: 0x3a3a42, door: 0xb8bcc2, trim: 0xf0c020, header: 0xd9d9d0 },
  express: { housing: 0x2a3650, frame: 0x16203a, door: 0x5a78b8, trim: 0xe0b840, header: 0xf3c76b },
};

const cache = new Map<string, Texture>();

function cached(key: string, paint: () => PixMap): Texture {
  let tex = cache.get(key);
  if (!tex) {
    tex = paint().texture();
    cache.set(key, tex);
  }
  return tex;
}

/** One floor band of shaft, w x h (h includes the 2 px slab at the bottom). */
export function shaftSegment(kind: CarKind, w: number, h: number, landing: LandingKind, carH: number): Texture {
  return cached(`shaft|${kind}|${w}|${h}|${landing}|${carH}`, () => {
    const s = STYLES[kind];
    const pm = new PixMap(w, h);
    pm.rect(0, 0, w, h, s.housing);
    pm.vline(0, 0, h, 0x2a2724);
    pm.vline(w - 1, 0, h, 0x2a2724);
    pm.vline(1, 0, h, tint(s.housing, 0.15));
    // The well: near-black with a faint brick dither.
    pm.rect(2, 0, w - 4, h, 0x1e2128);
    for (let y = 2; y < h; y += 4) for (let x = 2 + ((y >> 2) % 2) * 3; x < w - 2; x += 6) pm.set(x, y, 0x2a2e38);
    // Guide rails with brackets.
    for (const rx of [3, w - 4]) {
      pm.vline(rx, 0, h, 0x6a7080);
      for (let y = 3; y < h; y += 8) pm.set(rx + (rx === 3 ? 1 : -1), y, 0x8a90a0);
    }
    if (kind === 'express') { pm.vline(1, 0, h, s.trim); pm.vline(w - 2, 0, h, shade(s.trim, 0.3)); }
    // Slab through the shaft (continues the floor lines) and ceiling rows.
    pm.hline(0, 0, w, 0x2e2a27);
    pm.hline(0, 1, w, 0x58524a);
    pm.hline(0, h - 2, w, 0x8d877a);
    pm.hline(0, h - 1, w, 0x5b564c);
    if (landing === 'pass') return pm;
    // Landing: door jambs either side of the opening, header, sill, lamp.
    const sill = h - 3;
    const top = sill - carH;
    const jamb = landing === 'off' ? 0x6a6e76 : 0xc3cad2;
    pm.rect(1, top, 2, sill - top + 1, jamb);
    pm.rect(w - 3, top, 2, sill - top + 1, jamb);
    pm.vline(2, top, sill - top + 1, shade(jamb, 0.25));
    pm.vline(w - 2, top, sill - top + 1, shade(jamb, 0.25));
    pm.hline(1, top - 1, w - 2, landing === 'off' ? 0x4a4e56 : 0x5d6470);
    pm.hline(2, sill + 1, w - 4, 0x9aa3ad);
    if (kind === 'service') for (let y = top; y < sill; y += 2) { pm.set(1, y, 0xf0c020); pm.set(w - 2, y, 0xf0c020); }
    const mid = Math.floor(w / 2);
    if (landing === 'stop' && top >= 4) {
      pm.rect(mid - 3, top - 4, 6, 3, 0x16161a);
      pm.hline(mid - 2, top - 3, 4, 0xffb030);
    } else if (landing === 'off' && top >= 4) {
      pm.rect(mid - 3, top - 4, 6, 3, 0x16161a);
      pm.hline(mid - 2, top - 3, 4, 0x6a1010);
    }
    return pm;
  });
}

/** Machine room cap above the top stop (w + 2 wide, 5 tall). */
export function machineRoom(kind: CarKind, w: number): Texture {
  return cached(`machine|${kind}|${w}`, () => {
    const pm = new PixMap(w + 2, 5);
    const c = kind === 'express' ? 0x3a4660 : 0x55545a;
    pm.rect(0, 0, w + 2, 5, c);
    pm.hline(0, 0, w + 2, tint(c, 0.3));
    pm.hline(0, 4, w + 2, shade(c, 0.4));
    const mid = Math.floor((w + 2) / 2);
    pm.rect(mid - 4, 1, 8, 3, 0x8a8a90);
    pm.disc(mid, 2, 1.2, 0x3a3a42);
    for (let x = 3; x < w - 1; x += 4) pm.set(x, 2, shade(c, 0.3));
    return pm;
  });
}

/** Car w x h with doors at stage `step` (0 closed .. DOOR_STEPS-1 open). */
export function carTexture(kind: CarKind, w: number, h: number, step: number): Texture {
  return cached(`car|${kind}|${w}|${h}|${step}`, () => {
    const s = STYLES[kind];
    const pm = new PixMap(w, h);
    pm.rect(0, 0, w, h, s.frame);
    // Header with a trim line.
    pm.rect(1, 1, w - 2, 2, s.header);
    pm.hline(1, 1, w - 2, tint(s.header, 0.5));
    pm.hline(1, 3, w - 2, s.trim);
    // Lit interior: back wall, ceiling light, handrail, floor.
    const inTop = 4, inBottom = h - 2;
    pm.rect(1, inTop, w - 2, inBottom - inTop, 0xfff0c8);
    pm.hline(1, inTop, w - 2, 0xfffbe8);
    pm.dither(1, inTop + 1, w - 2, 1, 0xfff6dc);
    pm.sparse(1, inTop + 3, w - 2, inBottom - inTop - 3, 0xf4e2b4);
    pm.hline(2, inBottom - 6, w - 4, 0xc0a060);
    pm.rect(1, inBottom, w - 2, 1, 0x8a7a5a);
    pm.hline(1, h - 1, w, s.frame);
    // Sliding doors meeting at the centre seam.
    const inner = w - 2;
    const open = step / (DOOR_STEPS - 1);
    const panel = Math.round((inner / 2) * (1 - open));
    if (panel > 0) {
      const door = (x: number, pw: number, seamRight: boolean): void => {
        pm.rect(x, inTop, pw, inBottom - inTop, s.door);
        pm.vline(x + (seamRight ? 1 : pw - 2), inTop, inBottom - inTop, tint(s.door, 0.35));
        if (kind === 'service') pm.sparse(x, inTop + 1, pw, inBottom - inTop - 1, shade(s.door, 0.12));
        else pm.dither(x, inTop, pw, 1, shade(s.door, 0.2));
        pm.vline(seamRight ? x + pw - 1 : x, inTop, inBottom - inTop, shade(s.door, 0.4));
        if (kind === 'express') pm.hline(x, inTop + 3, pw, s.trim);
      };
      door(1, panel, true);
      door(1 + inner - panel, panel, false);
    }
    return pm;
  });
}

/** A broken (out-of-service) car: dead interior, shut doors, hazard tape. */
export function brokenCarTexture(kind: CarKind, w: number, h: number): Texture {
  return cached(`broken|${kind}|${w}|${h}`, () => {
    const s = STYLES[kind];
    const pm = new PixMap(w, h);
    pm.rect(0, 0, w, h, shade(s.frame, 0.35));
    pm.rect(1, 1, w - 2, 2, shade(s.header, 0.55));
    pm.hline(1, 3, w - 2, shade(s.trim, 0.4));
    const inTop = 4, inBottom = h - 2;
    const door = shade(s.door, 0.55);
    pm.rect(1, inTop, w - 2, inBottom - inTop, door);
    pm.vline(Math.floor(w / 2), inTop, inBottom - inTop, shade(door, 0.4));
    pm.sparse(1, inTop + 1, w - 2, inBottom - inTop - 1, shade(door, 0.2));
    // Diagonal hazard tape across the doors.
    const band = Math.floor((inTop + inBottom) / 2) - 2;
    for (let y = band; y < band + 4; y++) {
      for (let x = 1; x < w - 1; x++) pm.set(x, y, ((x + y) >> 1) % 2 ? 0x26262a : 0xf0c020);
    }
    // Dead header lamp and a scorch mark.
    pm.set(Math.floor(w / 2), 2, 0x5a1010);
    pm.sparse(2, inBottom - 4, 6, 3, 0x16161a);
    pm.rect(1, inBottom, w - 2, 1, 0x3a3428);
    return pm;
  });
}
