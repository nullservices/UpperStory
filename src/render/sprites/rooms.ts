import type { TenantState, TenantType } from '../../sim';
import * as F from './furniture';
import { accent } from './furniture';
import { PixMap, hash32, mix, shade, tint } from './pixmap';
import { paintText, textWidth } from './pixelFont';

/**
 * Room interiors, composed in pixels from pieces: ceiling/slab underside,
 * a shaded back wall, a floor strip with perspective shading, and furniture
 * sprites. Coordinates are room-local world pixels; the canvas is the room's
 * footprint minus the 2 px floor slab the tower shell draws below it.
 *
 * Band layout for a 24 px floor (texture rows 0..21):
 *   0-1   ceiling structure (reads as the slab with the 2 px slab below)
 *   2-16  back wall (ceiling shadow at the top, baseboard at row 17)
 *   18-21 floor strip; furniture stands with its last row on 19, people's
 *         feet land on 21 (the front edge).
 */

export type RoomLook = '' | 'guest' | 'dirty' | 'unhappy';

const STRUCT_DARK = 0x2e2a27;
const STRUCT_MID = 0x58524a;
const DIVIDER = 0x2a2724;
const W = 0xffffff;

/** Paint context for one room. */
interface R {
  pm: PixMap;
  w: number;
  /** Canvas height (footprint minus slab). */
  th: number;
  /** Furniture base: sprites stand with their bottom row on base - 1. */
  base: number;
  /** Baseboard row (last wall row). */
  wallBottom: number;
  /** Furniture layout. */
  v: number;
  /** Style seed: colours, wall finish, flooring and decor, independent of layout. */
  s: number;
  look: RoomLook;
}

/** Colour/finish styles layered over each layout of the common room types. */
export const STYLE_COUNT = 12;

export function styleCount(type: TenantType): number {
  switch (type) {
    case 'office': case 'condo': case 'shop': case 'fastfood':
    case 'hotel': case 'hotelTwin': case 'hotelSuite': return STYLE_COUNT;
    case 'bank': case 'rooftopPool': case 'restaurant': case 'cinema': case 'partyHall':
    case 'medical': case 'security': case 'housekeeping': case 'lobby': case 'skyLobby':
    case 'gym': case 'supermarket': case 'bar': case 'conference': return 4;
    case 'apartment': return 6;
    case 'parkingRamp': case 'recycling': return 3;
    case 'fireStation': case 'maintenance': case 'helipad': case 'observationDeck': return 3;
    case 'generator': return 2;
    default: return 1;
  }
}

/** Distinct looks a room type can take: every layout times every style. */
export function lookCount(type: TenantType): number {
  return Math.max(1, variantCount(type)) * styleCount(type);
}

/** Number of furniture layouts a type cycles through. */
export function variantCount(type: TenantType): number {
  switch (type) {
    case 'office': case 'condo': case 'shop': return 4;
    case 'hotel': case 'hotelTwin': case 'hotelSuite': case 'fastfood': case 'restaurant': return 3;
    case 'parkingSpace': return 6;
    case 'fireStation': case 'maintenance': case 'bank': case 'rooftopPool': case 'helipad':
    case 'partyHall': case 'medical': case 'security': case 'housekeeping': case 'parkingRamp': case 'recycling':
    case 'apartment': case 'gym': case 'supermarket': case 'bar': case 'conference': case 'observationDeck': return 2;
    default: return 1;
  }
}

/** Screen rectangle of a cinema of the given footprint (for the film overlay). */
export function cinemaScreen(w: number, h: number): { x: number; y: number; w: number; h: number } {
  const th = h - 2;
  const sw = Math.floor(w * 0.5);
  const sh = Math.max(8, th - 25);
  return { x: Math.floor((w - sw) / 2), y: 8, w: sw, h: sh };
}

export function paintRoom(type: TenantType, state: TenantState, w: number, h: number, variant: number, look: RoomLook): PixMap {
  const th = Math.max(4, h - 2);
  const pm = new PixMap(w, th);
  const layouts = Math.max(1, variantCount(type));
  const r: R = { pm, w, th, base: th - 2, wallBottom: th - 5, v: variant % layouts, s: Math.floor(variant / layouts) % styleCount(type), look };
  if (state === 'constructing') { construction(r); return pm; }
  if (state === 'damaged') { damaged(r); return pm; }
  switch (type) {
    case 'lobby': lobby(r, false); break;
    case 'skyLobby': lobby(r, true); break;
    case 'office': office(r); break;
    case 'condo': condo(r); break;
    case 'hotel': case 'hotelTwin': case 'hotelSuite': hotel(r, type); break;
    case 'fastfood': fastfood(r); break;
    case 'restaurant': restaurant(r); break;
    case 'shop': shop(r); break;
    case 'cinema': cinema(r); break;
    case 'partyHall': partyHall(r); break;
    case 'medical': medical(r); break;
    case 'security': security(r); break;
    case 'housekeeping': housekeeping(r); break;
    case 'parkingSpace': parkingSpace(r); break;
    case 'parkingRamp': parkingRamp(r); break;
    case 'recycling': recycling(r); break;
    case 'metro': metro(r); break;
    case 'cathedral': cathedral(r); break;
    case 'fireStation': fireStation(r); break;
    case 'maintenance': maintenance(r); break;
    case 'generator': generator(r); break;
    case 'bank': bank(r); break;
    case 'rooftopPool': rooftopPool(r); break;
    case 'helipad': helipad(r); break;
    case 'apartment': apartment(r); break;
    case 'gym': gym(r); break;
    case 'supermarket': supermarket(r); break;
    case 'bar': bar(r); break;
    case 'conference': conference(r); break;
    case 'observationDeck': observationDeck(r); break;
    default: shell(r, { wall: 0xe8e2d2, floor: 0x9a8e78 });
  }
  if (state === 'vacant' && !isOpenAir(type)) {
    // Unlet: lights off. Everything sinks toward a dark blue-grey but the
    // furniture still reads as dim shapes (the classic dark empty room).
    pm.map((c, x, y) => (y < 2 ? c : mix(c, 0x161a2a, x === 0 || x === w - 1 ? 0.3 : 0.74)));
    pm.hline(2, r.base - 1, w - 4, 0x2c3248);
  } else if (look === 'unhappy') {
    pm.map((c, _x, y) => (y < 2 ? c : mix(c, 0xff2a2a, 0.24)));
    pm.hline(1, 2, w - 2, 0xd01818);
    pm.dither(1, 3, w - 2, 1, 0xd01818);
  }
  return pm;
}

// --- Shared pieces -------------------------------------------------------------

/** One style choice for this room, stable per salt and independent of others. */
function pick<T>(r: R, list: readonly T[], salt: number): T {
  return list[hash32(r.s * 7919 + r.v * 131 + salt * 104729) % list.length]!;
}

/** Style-indexed choice for hand-tuned palettes: one entry per style, in order. */
function sty<T>(r: R, list: readonly T[]): T {
  return list[r.s % list.length]!;
}

const WALLS_WORK = [0xeae6d8, 0xdde3e6, 0xe8e2cc, 0xdfe7da, 0xe6dccc, 0xd8dde8, 0xefe4d2, 0xe2e2e2] as const;
const WALLS_HOME = [0xf2e2c0, 0xe8dad0, 0xdfe6cf, 0xe8dcc6, 0xf0d8d0, 0xd8e0ec, 0xe8e0f0, 0xf4ecd8] as const;
const CARPETS = [0x5a6e98, 0x5e7a58, 0x86685a, 0x686a7a, 0x7a4a5a, 0x4a7a7a, 0x8a7a5a, 0x5a5a8a] as const;
const ACCENTS = [0xc0503a, 0x3f6fb0, 0x4f9a5a, 0xc9952f, 0x7a4fb0, 0x2a8a8a, 0xd06a9a, 0x8a5a2c] as const;
const WOODS = [0xa86c36, 0x8a8a8a, 0xb07a44, 0x9a6a3a, 0x6b4426, 0xc8a070] as const;

type FloorStyle = 'carpet' | 'wood' | 'tile' | 'check' | 'marble' | 'concrete' | 'parquet';
type WallStyle = 'plain' | 'stripe' | 'wainscot' | 'panel' | 'block' | 'paper';

interface ShellOpts {
  wall: number;
  floor: number;
  floor2?: number;
  style?: FloorStyle;
  wallStyle?: WallStyle;
  /** Wainscot / panel colour. */
  lower?: number;
  trim?: number;
}

function shell(r: R, o: ShellOpts): void {
  const { pm, w, wallBottom } = r;
  pm.rect(0, 0, w, 1, STRUCT_DARK);
  pm.rect(0, 1, w, 1, STRUCT_MID);
  pm.rect(0, 2, w, wallBottom - 2, o.wall);
  const lower = o.lower ?? shade(o.wall, 0.12);
  switch (o.wallStyle) {
    case 'stripe':
      for (let x = 3; x < w; x += 4) pm.vline(x, 4, wallBottom - 4, shade(o.wall, 0.07));
      break;
    case 'paper':
      for (let y = 6; y < wallBottom - 1; y += 4) for (let x = (y >> 2) % 2 ? 2 : 6; x < w; x += 8) pm.set(x, y, shade(o.wall, 0.12));
      break;
    case 'wainscot': {
      const top = wallBottom - 6;
      pm.rect(0, top, w, wallBottom - top, lower);
      pm.hline(0, top, w, tint(lower, 0.35));
      pm.hline(0, top + 1, w, shade(lower, 0.18));
      for (let x = 6; x < w; x += 12) pm.vline(x, top + 2, wallBottom - top - 2, shade(lower, 0.16));
      break;
    }
    case 'panel':
      pm.rect(0, 3, w, wallBottom - 3, lower);
      for (let x = 2; x < w; x += 8) { pm.vline(x, 4, wallBottom - 4, shade(lower, 0.2)); pm.vline(x + 1, 4, wallBottom - 4, tint(lower, 0.12)); }
      break;
    case 'block':
      for (let y = 6, i = 0; y < wallBottom; y += 5, i++) {
        pm.hline(0, y, w, shade(o.wall, 0.1));
        for (let x = i % 2 ? 4 : 12; x < w; x += 16) pm.vline(x, y - 4, 4, shade(o.wall, 0.1));
      }
      pm.sparse(0, 3, w, wallBottom - 3, tint(o.wall, 0.06), 1);
      break;
    default:
      break;
  }
  // Ceiling shadow falling down the back wall.
  pm.hline(0, 2, w, shade(o.wall, 0.34));
  pm.dither(0, 3, w, 1, shade(o.wall, 0.18));
  pm.sparse(0, 4, w, 1, shade(o.wall, 0.1));
  pm.hline(0, wallBottom, w, o.trim ?? shade(o.wall, 0.45));
  floorStrip(r, o.floor, o.style ?? 'carpet', o.floor2);
  sides(r, o.wall);
}

function sides(r: R, wall: number): void {
  const { pm, w, th, wallBottom } = r;
  pm.vline(0, 0, th, DIVIDER);
  pm.vline(w - 1, 0, th, DIVIDER);
  pm.vline(1, 2, wallBottom - 2, shade(wall, 0.22));
  pm.vline(w - 2, 2, wallBottom - 2, shade(wall, 0.1));
}

function floorStrip(r: R, floor: number, style: FloorStyle, floor2?: number): void {
  const { pm, w, th } = r;
  const y0 = th - 4;
  pm.rect(0, y0, w, 4, floor);
  const seam = shade(floor, 0.22);
  switch (style) {
    case 'wood':
      for (let y = 0; y < 4; y++) for (let x = (y * 5) % 9; x < w; x += 9) pm.set(x, y0 + y, seam);
      pm.sparse(0, y0, w, 4, tint(floor, 0.08), 1);
      break;
    case 'parquet':
      for (let x = 0; x < w; x += 4) for (let y = 0; y < 4; y++) if (((x >> 2) + y) % 2) pm.set(x + (y % 2), y0 + y, seam);
      break;
    case 'carpet':
      pm.sparse(0, y0, w, 4, shade(floor, 0.12));
      break;
    case 'tile':
      for (let x = 0; x < w; x += 6) pm.vline(x, y0, 4, shade(floor, 0.14));
      pm.hline(0, y0 + 2, w, shade(floor, 0.1));
      break;
    case 'check': {
      const b = floor2 ?? shade(floor, 0.3);
      for (let x = 0; x < w; x += 4) for (let y = 0; y < 4; y += 2) if (((x >> 2) + (y >> 1)) % 2) pm.rect(x, y0 + y, 4, 2, b);
      break;
    }
    case 'marble': {
      const b = floor2 ?? shade(floor, 0.18);
      for (let x = 0; x < w; x += 8) if ((x >> 3) % 2) pm.rect(x, y0, 8, 4, b);
      for (let x = 3; x < w; x += 11) { pm.set(x, y0 + 1, shade(floor, 0.25)); pm.set(x + 1, y0 + 2, shade(floor, 0.25)); }
      break;
    }
    case 'concrete':
      pm.sparse(0, y0, w, 4, shade(floor, 0.1));
      for (let x = 23; x < w; x += 24) pm.vline(x, y0, 4, shade(floor, 0.2));
      break;
  }
  pm.wash(W, 0.18, 0, y0, w, 1);
  pm.wash(0x000000, 0.25, 0, y0 + 3, w, 1);
}

/** Interior partition wall between zones of one apartment. */
function partition(r: R, x: number, wall: number): void {
  r.pm.rect(x, 2, 3, r.wallBottom - 1, shade(wall, 0.2));
  r.pm.vline(x, 2, r.wallBottom - 1, shade(wall, 0.36));
  r.pm.vline(x + 2, 2, r.wallBottom - 1, tint(wall, 0.2));
}

function desk(r: R, x: number, wd: number, wood: number): void {
  const { pm, base: b } = r;
  pm.hline(x, b - 6, wd, tint(wood, 0.3));
  pm.hline(x, b - 5, wd, wood);
  pm.rect(x + 1, b - 4, 2, 4, shade(wood, 0.3));
  pm.rect(x + wd - 7, b - 4, 6, 4, shade(wood, 0.08));
  pm.hline(x + wd - 6, b - 3, 4, shade(wood, 0.45));
  pm.vline(x + wd - 1, b - 4, 4, shade(wood, 0.35));
}

function workstation(r: R, x: number, chair: number, wood: number, flip = false): void {
  desk(r, x + (flip ? 6 : 0), 18, wood);
  const dx = flip ? 6 : 0;
  r.pm.stand(F.CRT, x + dx + (flip ? 8 : 2), r.base - 6, { flip });
  r.pm.hline(x + dx + (flip ? 3 : 12), r.base - 7, 4, 0xcfd0d4);
  r.pm.stand(F.OFFICE_CHAIR, flip ? x : x + 18, r.base, { inks: accent(chair), flip });
}

function cabinet(r: R, x: number, hgt: number, c = 0x9aa3ad): void {
  const { pm, base: b } = r;
  pm.rect(x, b - hgt, 7, hgt, c);
  pm.vline(x, b - hgt, hgt, tint(c, 0.3));
  pm.vline(x + 6, b - hgt, hgt, shade(c, 0.3));
  pm.hline(x, b - hgt, 7, tint(c, 0.4));
  for (let y = b - hgt + 4; y < b; y += 4) {
    pm.hline(x + 1, y, 5, shade(c, 0.35));
    pm.hline(x + 2, y - 2, 3, shade(c, 0.5));
  }
}

const BOOK_COLORS = [0xc83030, 0x3464bc, 0xd0a028, 0x44a03a, 0x5c2c88, 0xe2d2a8, 0x7a4a22, 0x24582a];

function bookshelf(r: R, x: number, wd: number, hgt: number, wood: number, seed: number): void {
  const { pm, base: b } = r;
  const top = b - hgt;
  pm.rect(x, top, wd, hgt, shade(wood, 0.15));
  pm.rect(x + 1, top + 1, wd - 2, hgt - 2, shade(wood, 0.6));
  for (let y = top + 5; y < b - 1; y += 5) {
    pm.hline(x + 1, y, wd - 2, wood);
    for (let bx = x + 1; bx < x + wd - 1; bx++) {
      const hv = hash32(seed + bx * 31 + y * 7);
      if (hv % 7 === 0) continue;
      const bh = 3 + (hv >> 4) % 2;
      pm.vline(bx, y - bh, bh, BOOK_COLORS[(hv >> 8) % BOOK_COLORS.length]!);
    }
  }
  pm.hline(x, top, wd, tint(wood, 0.25));
}

function nightstand(r: R, x: number, wood = 0x8a5a2c): void {
  const { pm, base: b } = r;
  pm.rect(x, b - 6, 6, 6, wood);
  pm.hline(x, b - 6, 6, tint(wood, 0.3));
  pm.hline(x + 1, b - 3, 4, shade(wood, 0.35));
  pm.vline(x + 5, b - 5, 5, shade(wood, 0.3));
  pm.stand(F.TABLE_LAMP, x, b - 6);
}

function plant(r: R, x: number, tall = false): void {
  r.pm.stand(tall ? F.TALL_PLANT : F.PLANT, x, r.base);
}

/** Bed seen side-on, headboard at the left (or right when flipped). */
function bed(r: R, x: number, len: number, blanket: number, wood: number, double = false, flip = false): void {
  const { pm, base: b, look } = r;
  const total = len + 3;
  const X = (dx: number, wd = 1): number => (flip ? x + total - dx - wd : x + dx);
  // Headboard and footboard.
  pm.rect(X(0, 3), b - 11, 3, 11, wood);
  pm.hline(X(0, 3), b - 11, 3, tint(wood, 0.35));
  pm.vline(X(2), b - 10, 10, shade(wood, 0.3));
  pm.rect(X(total - 2, 2), b - 6, 2, 6, wood);
  // Frame, mattress, sheet.
  pm.rect(X(3, len - 2), b - 3, len - 2, 2, shade(wood, 0.15));
  pm.hline(X(3, len - 2), b - 2, len - 2, shade(wood, 0.4));
  pm.rect(X(3, len), b - 5, len, 2, 0xf4f2ec);
  pm.hline(X(3, len), b - 4, len, 0xd8d4c8);
  const pillow = (dx: number, dy: number): void => {
    pm.rect(X(dx, 5), b - 7 - dy, 5, 2, W);
    pm.hline(X(dx, 5), b - 6 - dy, 5, 0xdcd8cc);
  };
  if (look === 'dirty') {
    // Unmade: pillow thrown askew, blanket heaped at the foot, sheet rumpled.
    pm.rect(X(5, 5), b - 8, 5, 2, 0xe4e0d4);
    pm.set(X(9), b - 9, 0xe4e0d4);
    pm.dither(X(9, len - 12), b - 5, len - 12, 1, 0xc4bcaa);
    const heap = Math.min(10, len - 8);
    pm.rect(X(len - heap, heap), b - 8, heap, 4, blanket);
    pm.rect(X(len - heap + 2, heap - 4), b - 9, heap - 4, 1, tint(blanket, 0.2));
    pm.dither(X(len - heap, heap), b - 7, heap, 2, shade(blanket, 0.25));
    pm.rect(X(total - 1, 2), b - 4, 2, 4, blanket);
    return;
  }
  pillow(4, 0);
  if (double) pillow(4, 2);
  if (look === 'guest') {
    // Turned down with a guest asleep: hair and face on the pillow.
    pm.rect(X(6, 3), b - 9, 3, 2, 0x3a2212);
    pm.rect(X(6, 3), b - 8, 2, 1, 0xf2bc94);
    if (double) { pm.rect(X(5, 3), b - 11, 3, 2, 0x8a5a2a); pm.set(X(6), b - 10, 0xf2bc94); }
    pm.rect(X(9, len - 6), b - 7, len - 6, 3, blanket);
    pm.hline(X(9, len - 6), b - 7, len - 6, tint(blanket, 0.3));
    pm.rect(X(9, 2), b - 7, 2, 3, W);
    pm.set(X(14), b - 8, blanket); pm.hline(X(13, 4), b - 8, 4, blanket);
    return;
  }
  pm.rect(X(10, len - 7), b - 6, len - 7, 2, blanket);
  pm.hline(X(10, len - 7), b - 6, len - 7, tint(blanket, 0.3));
  pm.rect(X(10, 2), b - 6, 2, 2, 0xf4f2ec);
  pm.vline(X(len + 2), b - 6, 3, shade(blanket, 0.2));
}

// --- Construction and damage -------------------------------------------------------

function construction(r: R): void {
  const { pm, w, th, base: b } = r;
  // Bare concrete box with a sanded-plaster dither.
  shell(r, { wall: 0xb9b2a2, floor: 0x8e8778, style: 'concrete', wallStyle: 'block' });
  pm.sparse(2, 5, w - 4, r.wallBottom - 6, 0xa8a090, 1);
  const pole = 0xd09040, poleDark = 0x8a5a24, plank = 0xb8884a;
  // Scaffold standards every cell, ledgers and planks at each lift.
  for (let x = 4; x < w - 3; x += 12) {
    pm.vline(x, 2, th - 4, pole);
    pm.vline(x + 1, 2, th - 4, poleDark);
  }
  for (let y = 9; y < b - 2; y += 10) {
    pm.hline(2, y, w - 4, plank);
    pm.hline(2, y + 1, w - 4, poleDark);
    for (let x = 6; x < w - 4; x += 5) pm.set(x, y, tint(plank, 0.25));
  }
  // Cross bracing between standards.
  for (let x = 4; x + 12 < w - 3; x += 24) pm.line(x + 2, b - 2, x + 12, 4, 0x7a5a30);
  // Hazard tape at the floor line and a few site props.
  for (let x = 1; x < w - 1; x++) pm.set(x, b - 4, ((x >> 2) % 2) ? 0x26262a : 0xf0c020);
  for (let x = 1; x < w - 1; x++) pm.set(x, b - 3, ((x >> 2) % 2) ? 0x26262a : 0xf0c020);
  for (let x = 10; x < w - 12; x += 37) {
    pm.rect(x, b - 3, 5, 3, 0xd8d0b8); // cement bag
    pm.hline(x, b - 3, 5, 0xf0ead8);
    pm.rect(x + 7, b - 4, 3, 4, 0x606870); // bucket
    pm.hline(x + 7, b - 4, 3, 0x90989f);
  }
  // A hoist hook hanging from the slab.
  const hx = Math.floor(w / 2);
  pm.vline(hx, 2, 6, 0x3a3a42);
  pm.rect(hx - 1, 8, 3, 2, 0xf0c020);
  pm.set(hx + 1, 10, 0x3a3a42);
}

function damaged(r: R): void {
  const { pm, w, th } = r;
  pm.rect(0, 0, w, th, 0x221c18);
  pm.rect(0, 0, w, 1, 0x141210);
  pm.dither(0, 2, w, th - 6, 0x2e2620);
  pm.sparse(0, 2, w, 8, 0x0e0c0a);
  // Scorched wall streaks and fallen beams.
  for (let x = 3; x < w - 6; x += 9) {
    const t = hash32(x * 7 + w) % 6;
    pm.rect(x, 3 + t, 4, th - 9 - t, 0x3a2e26);
    pm.vline(x + 1, 3 + t, th - 9 - t, 0x4a3a2e);
  }
  for (let x = 5; x < w - 14; x += 23) {
    pm.line(x, 3, x + 11, th - 6, 0x5a3e24);
    pm.line(x + 1, 3, x + 12, th - 6, 0x3e2a18);
  }
  // Rubble on the floor with glowing embers.
  const y0 = th - 4;
  pm.rect(0, y0, w, 4, 0x171310);
  for (let x = 2; x < w - 3; x += 3) {
    const t = hash32(x * 13 + 5);
    pm.rect(x, y0 - (t % 3), 2 + (t % 2), 1 + (t % 3), (t >> 3) % 2 ? 0x4a4038 : 0x30281f);
    if (t % 11 === 0) pm.set(x, y0 + 1, 0xff7a2a);
    if (t % 17 === 0) pm.set(x + 1, y0, 0xffc040);
  }
  pm.vline(0, 0, th, 0x110e0c);
  pm.vline(w - 1, 0, th, 0x110e0c);
}

// --- Public spaces ----------------------------------------------------------------

function lobby(r: R, sky: boolean): void {
  const { pm, w, th, base: b, wallBottom } = r;
  // Subtle per-lobby finish: marble tone and the metal of the trim. A lobby is
  // one wide tenant, so a style applies to the whole hall and stays coherent.
  const S = sty(r, sky ? [
    { wall: 0xe6eef2, floor: 0xd8e0e4, floor2: 0x8ea4b4, lower: 0xb8ccd8, cornice: 0x5f8fae },
    { wall: 0xeceeee, floor: 0xe2e2de, floor2: 0x9a9a96, lower: 0xc8ccd0, cornice: 0x6e7c8a },
    { wall: 0xe6f0ec, floor: 0xd6e2dc, floor2: 0x7aa498, lower: 0xb4d0c4, cornice: 0x4a8a7a },
    { wall: 0xeeecf4, floor: 0xdedae6, floor2: 0x8e88a8, lower: 0xc6bed8, cornice: 0x6a5f9e },
  ] : [
    { wall: 0xf0e8d6, floor: 0xe6dcc6, floor2: 0xa8987a, lower: 0xd8c8a2, cornice: 0xb89a5a },
    { wall: 0xf2eee6, floor: 0xeae6e0, floor2: 0x8e8884, lower: 0xd6d0c6, cornice: 0x9a8e80 },
    { wall: 0xf2e6da, floor: 0xe8d2be, floor2: 0x9e7058, lower: 0xd2a88a, cornice: 0xb06a40 },
    { wall: 0xeeecdc, floor: 0xe2e4d6, floor2: 0x6a846a, lower: 0xc2ccb2, cornice: 0x5e8058 },
  ]);
  const wall = S.wall;
  shell(r, { wall, floor: S.floor, floor2: S.floor2, style: 'marble', wallStyle: 'wainscot', lower: S.lower });
  const tall = th > 30;
  // Cornice band.
  const cornice = S.cornice;
  pm.hline(0, 2, w, shade(cornice, 0.3));
  pm.hline(0, 3, w, cornice);
  pm.hline(0, 4, w, tint(cornice, 0.4));
  pm.dither(0, 5, w, 1, shade(wall, 0.15));
  const pitch = 60;
  const planters = r.s % 2 === 1;
  for (let c = 6, bay = 0; c < w - 6; c += pitch, bay++) {
    // Fluted column: capital, shaft with highlight/shadow, plinth.
    const colTop = 5;
    pm.rect(c, colTop, 8, wallBottom - colTop, 0xf6f2e8);
    pm.vline(c, colTop, wallBottom - colTop, W);
    pm.vline(c + 3, colTop + 2, wallBottom - colTop - 2, 0xe0d8c6);
    pm.vline(c + 6, colTop, wallBottom - colTop, 0xcfc4ae);
    pm.vline(c + 7, colTop, wallBottom - colTop, 0xb0a48c);
    pm.rect(c - 1, colTop, 10, 2, cornice);
    pm.hline(c - 1, colTop, 10, tint(cornice, 0.4));
    pm.rect(c - 1, wallBottom - 2, 10, 3, shade(S.lower, 0.1));
    pm.hline(c - 1, wallBottom - 2, 10, tint(S.lower, 0.4));
    const gap = c + 8;
    const gw = Math.min(pitch - 8, w - 2 - gap);
    if (gw < 16) continue;
    // Tall curtain-wall glass between columns: sky reflection with dithered
    // highlight and mullions.
    const top = 8, bottom = wallBottom - 7;
    if (bottom - top > 4) {
      const frame = sky ? shade(cornice, 0.15) : 0x8a8270;
      pm.rect(gap + 4, top, gw - 8, bottom - top, frame);
      pm.rect(gap + 5, top + 1, gw - 10, bottom - top - 2, sky ? 0x9cc8e4 : 0xa8d0e8);
      pm.dither(gap + 5, top + 1, gw - 10, Math.floor((bottom - top - 2) / 2), sky ? 0xb8dcf0 : 0xc4e2f4);
      for (let k = 0; k < bottom - top - 2; k++) pm.set(gap + 7 + k, top + 1 + k, 0xe8f6ff);
      for (let mx = gap + 4 + 12; mx < gap + gw - 6; mx += 12) pm.vline(mx, top, bottom - top, frame);
      if (tall) pm.hline(gap + 4, top + Math.floor((bottom - top) / 2), gw - 8, frame);
    }
    const slot = (bay + (r.s >> 1)) % 3;
    const seat = (x: number): void => { if (planters) planterBox(r, x, cornice); else pm.stand(F.BENCH, x, b); };
    if (slot === 0) {
      plant(r, gap + 3, true);
      seat(gap + 16);
    } else if (slot === 1) {
      plant(r, gap + gw - 12, true);
      if (gw > 40) seat(gap + 10);
    } else if (tall) {
      pm.blit(F.CHANDELIER, gap + Math.floor(gw / 2) - 5, 5);
    } else {
      pm.blit(F.PENDANT, gap + Math.floor(gw / 2) - 2, 5);
    }
  }
  if (sky) {
    // Sky lobby sign plate.
    const sx = Math.floor(w / 2) - 12;
    const plateC = shade(cornice, 0.45);
    pm.rect(sx, 6, 24, 6, plateC);
    pm.hline(sx, 6, 24, tint(plateC, 0.3));
    for (let x = sx + 3; x < sx + 21; x += 2) pm.set(x, 8, W);
    for (let x = sx + 4; x < sx + 20; x += 3) pm.set(x, 9, W);
  }
  sides(r, wall);
}

/** Low stone planter box with shrubs (the lobby's alternative to a bench). */
function planterBox(r: R, x: number, trim: number): void {
  const { pm, base: b } = r;
  const stone = 0xd8d0c0;
  pm.stand(F.PLANT, x, b - 3);
  pm.stand(F.PLANT, x + 7, b - 3);
  pm.rect(x, b - 4, 15, 4, stone);
  pm.hline(x, b - 4, 15, trim);
  pm.hline(x, b - 3, 15, tint(stone, 0.4));
  pm.hline(x, b - 1, 15, shade(stone, 0.25));
}

// --- Offices and homes -------------------------------------------------------------

function office(r: R): void {
  const { pm, w, base: b, v } = r;
  const wall = pick(r, WALLS_WORK, 1);
  const carpet = pick(r, CARPETS, 2);
  const chair = pick(r, [0x2a3f6a, 0x3a3a3a, 0x7a2a2a, 0x2a5a4a, 0x5a3a6a, 0x6a5a2a] as const, 3);
  const wood = pick(r, WOODS, 4);
  shell(r, {
    wall, floor: carpet,
    style: pick(r, ['carpet', 'carpet', 'carpet', 'parquet', 'tile'] as const, 5),
    wallStyle: v === 2 ? 'wainscot' : pick(r, ['plain', 'plain', 'stripe', 'panel', 'paper'] as const, 6),
    lower: pick(r, [0xc8b48c, 0x9aa8b4, 0xa88a6a] as const, 7),
  });
  pm.blit(F.CEILING_LIGHT, 20, 2);
  pm.blit(F.CEILING_LIGHT, w - 40, 2);
  if (v === 0) {
    for (let x = 4; x + 24 < w - 10; x += 33) workstation(r, x, chair, wood);
    pm.blit(F.CLOCK, 30, 6);
    pm.blit(F.SMALL_PICTURE, 62, 6, { inks: accent(0x8cc8f0, 0x4ca040) });
    cabinet(r, w - 10, 12);
  } else if (v === 1) {
    workstation(r, 4, chair, wood);
    workstation(r, 30, chair, wood);
    pm.blit(F.WHITEBOARD, 58, 5);
    pm.stand(F.COPIER, 58, b);
    pm.stand(F.WATER_COOLER, 72, b);
    plant(r, w - 10);
  } else if (v === 2) {
    plant(r, 4);
    // Meeting table with chair backs behind it.
    const tx = 14, tw = Math.min(46, w - 50);
    for (let x = tx + 3; x < tx + tw - 3; x += 9) {
      pm.rect(x, b - 10, 4, 4, chair);
      pm.hline(x, b - 10, 4, tint(chair, 0.3));
    }
    pm.hline(tx, b - 6, tw, tint(wood, 0.3));
    pm.hline(tx, b - 5, tw, wood);
    pm.rect(tx + 2, b - 4, 2, 4, shade(wood, 0.3));
    pm.rect(tx + tw - 4, b - 4, 2, 4, shade(wood, 0.3));
    pm.blit(F.PICTURE, tx + Math.floor(tw / 2) - 5, 5, { inks: accent(0x8cc8f0, 0x6a9a48) });
    bookshelf(r, w - 26, 20, 14, 0x8a5a2c, 7);
  } else {
    // Reception counter with a logo panel.
    pm.rect(4, b - 8, 24, 8, chair);
    pm.hline(4, b - 8, 24, tint(chair, 0.4));
    pm.rect(13, b - 6, 6, 4, 0xf0c020);
    pm.rect(14, b - 5, 4, 2, chair);
    pm.stand(F.CRT, 6, b - 8);
    pm.blit(F.BLINDS, 34, 4);
    workstation(r, 50, chair, wood);
    cabinet(r, w - 18, 12);
    plant(r, w - 10);
  }
}

function condo(r: R): void {
  const { w, v } = r;
  const wall = pick(r, WALLS_HOME, 1);
  const acc = pick(r, ACCENTS, 2);
  const acc2 = pick(r, ACCENTS.filter(c => c !== acc), 3);
  const floorStyle = pick(r, ['wood', 'carpet', 'parquet', 'wood'] as const, 4);
  shell(r, {
    wall,
    floor: floorStyle === 'carpet'
      ? pick(r, [0x8a7a9a, 0x7a8a6a, 0x9a7a6a, 0x6a7a9a] as const, 5)
      : pick(r, [0xa06a38, 0x8a5a30, 0xb88a50, 0x7a4a2a] as const, 5),
    style: floorStyle,
    wallStyle: pick(r, ['stripe', 'paper', 'plain', 'paper', 'wainscot'] as const, 6),
  });
  const zones: [Zone, number][] = [
    [[bedroom, 56], [living, 76], [kitchen, 60]],
    [[kitchen, 60], [living, 76], [bedroom, 56]],
    [[living, 72], [bedroom, 56], [kitchen, 64]],
    [[bedroom, 56], [kitchen, 56], [living, 80]],
  ][v]! as [Zone, number][];
  const total = zones.reduce((s, [, f]) => s + f, 0);
  let x = 0;
  zones.forEach(([zone, frac], i) => {
    const x1 = i === zones.length - 1 ? w : Math.round(x + (frac / total) * w);
    zone(r, x + (i ? 3 : 2), x1 - 2, wall, acc, acc2);
    if (i < zones.length - 1) partition(r, x1 - 1, wall);
    x = x1;
  });
}

type Zone = (r: R, x0: number, x1: number, wall: number, acc: number, acc2: number) => void;

const bedroom: Zone = (r, x0, x1, _wall, acc, acc2) => {
  const { pm, base: b } = r;
  bed(r, x0 + 2, 22, acc, 0x6b4426, true);
  nightstand(r, x0 + 28);
  pm.blit(F.PICTURE, x0 + 8, 5, { inks: accent(0x8cc8f0, acc2) });
  if (x1 - x0 > 46) {
    // Wardrobe.
    const wx = x1 - 12;
    pm.rect(wx, b - 14, 10, 14, 0x8a5a2c);
    pm.hline(wx, b - 14, 10, 0xb07a44);
    pm.vline(wx + 5, b - 13, 13, 0x5a3818);
    pm.set(wx + 4, b - 8, 0xd0a028); pm.set(wx + 6, b - 8, 0xd0a028);
  }
};

const living: Zone = (r, x0, x1, _wall, acc, acc2) => {
  const { pm, base: b } = r;
  // Window with curtains on the back wall.
  const wx = x0 + 8;
  pm.rect(wx, 5, 18, 9, 0x8a8270);
  pm.rect(wx + 1, 6, 16, 7, 0x9fd0f0);
  pm.dither(wx + 1, 6, 16, 3, 0xc4e4f8);
  pm.vline(wx + 9, 6, 7, 0x8a8270);
  pm.rect(wx - 2, 4, 3, 11, acc2);
  pm.rect(wx + 17, 4, 3, 11, acc2);
  pm.vline(wx - 1, 4, 11, shade(acc2, 0.25));
  pm.vline(wx + 18, 4, 11, shade(acc2, 0.25));
  pm.stand(F.SOFA, x0 + 4, b, { inks: accent(acc) });
  pm.stand(F.FLOOR_LAMP, x0 + 27, b);
  // Coffee table.
  pm.hline(x0 + 34, b - 4, 11, 0xa86c36);
  pm.hline(x0 + 34, b - 3, 11, 0x7a4a22);
  pm.vline(x0 + 35, b - 2, 2, 0x45280f);
  pm.vline(x0 + 43, b - 2, 2, 0x45280f);
  if (x1 - x0 > 60) pm.stand(F.TV, x1 - 13, b);
  if (x1 - x0 > 74) plant(r, x1 - 22);
};

const kitchen: Zone = (r, x0, x1) => {
  const { pm, base: b } = r;
  const cab = 0xe0d4b4, cabDark = 0xb8a882;
  const len = Math.min(26, x1 - x0 - 12);
  // Lower cabinets with the stove set in, upper cabinets on the wall.
  pm.rect(x0 + 1, b - 7, len, 7, cab);
  pm.hline(x0 + 1, b - 8, len, 0x6c6c74);
  for (let x = x0 + 2; x < x0 + len; x += 6) { pm.rect(x, b - 6, 5, 5, cabDark); pm.set(x + 2, b - 4, 0x45280f); }
  pm.stand(F.STOVE, x0 + 10, b);
  pm.rect(x0 + 1, 5, len, 6, cab);
  for (let x = x0 + 2; x < x0 + len; x += 6) { pm.rect(x, 6, 5, 4, cabDark); pm.set(x + 2, 9, 0x45280f); }
  pm.hline(x0 + 1, 11, len, shade(cab, 0.3));
  pm.stand(F.FRIDGE, x0 + len + 2, b);
  if (x1 - (x0 + len + 12) >= 14) {
    // Dining table with two chairs.
    const tx = x0 + len + 13;
    pm.stand(F.DINING_CHAIR_L, tx, b, { inks: accent(0xa86c36) });
    pm.hline(tx + 4, b - 6, 9, 0xa86c36);
    pm.hline(tx + 4, b - 5, 9, 0x7a4a22);
    pm.vline(tx + 8, b - 4, 4, 0x45280f);
    pm.stand(F.DINING_CHAIR_R, tx + 13, b, { inks: accent(0xa86c36) });
    pm.blit(F.PENDANT, tx + 6, 2);
  }
};

function hotel(r: R, type: TenantType): void {
  const { pm, w, base: b, look } = r;
  const suite = type === 'hotelSuite';
  const wall = suite
    ? pick(r, [0xf2e6c8, 0xece0d8, 0xe8e4d0, 0xf0e0c8] as const, 1)
    : pick(r, [0xf0ebdc, 0xe6e2ee, 0xe2eadc, 0xf0e2d8, 0xe0e8ec, 0xeee6d0] as const, 1);
  const carpet = suite
    ? pick(r, [0x8a2f35, 0x2f4a6a, 0x3a5a3a, 0x5a2f5a] as const, 2)
    : pick(r, [0x9a4a3a, 0x4a5a8a, 0x5a7a4a, 0x7a5a8a, 0x8a6a4a, 0x4a7a7a] as const, 2);
  const blanket = suite
    ? pick(r, [0xb58a3a, 0xa83a40, 0x3a5a8a, 0xe8e0d0] as const, 3)
    : pick(r, [0x5aa060, 0x4f7fc0, 0xc06050, 0x8a5ab0, 0xd8a040, 0x5a8a9a, 0xe8e0d0] as const, 3);
  shell(r, { wall, floor: carpet, style: 'carpet', wallStyle: suite ? 'wainscot' : pick(r, ['stripe', 'paper', 'plain', 'paper'] as const, 4), lower: 0xd8c08a, trim: suite ? 0xb08a3a : undefined });
  if (suite) pm.hline(2, 5, w - 4, 0xc8a050);
  const wood = 0x6b4426;
  if (type === 'hotel') {
    bed(r, 3, 20, blanket, wood);
    nightstand(r, 28);
    pm.blit(F.SMALL_PICTURE, 9, 6, { inks: accent(0x8cc8f0, 0x6a9a48) });
    pm.blit(F.CEILING_LIGHT, 32, 2);
  } else if (type === 'hotelTwin') {
    bed(r, 3, 18, blanket, wood);
    nightstand(r, 26);
    bed(r, 34, 18, blanket, wood);
    pm.blit(F.SMALL_PICTURE, 8, 6, { inks: accent(0xe0c49f, 0x8a5a2a) });
    pm.blit(F.SMALL_PICTURE, 40, 6, { inks: accent(0x8cc8f0, 0x6a9a48) });
  } else {
    bed(r, 3, 26, blanket, wood, true);
    nightstand(r, 33);
    pm.blit(F.PICTURE, 10, 5, { inks: accent(0x7fa0c8, 0xd2b062) });
    pm.stand(F.SOFA, 46, b, { inks: accent(0xa83a42) });
    pm.stand(F.ARMCHAIR, 72, b, { inks: accent(0xa83a42) });
    pm.hline(83, b - 4, 9, 0x8a5a2c);
    pm.vline(84, b - 3, 3, 0x45280f);
    pm.vline(90, b - 3, 3, 0x45280f);
    pm.blit(F.CHANDELIER, 58, 2);
    plant(r, w - 10);
  }
  if (look === 'guest') {
    pm.stand(F.SUITCASE, w - 10, b, { inks: accent(pick(r, [0x8a3a2a, 0x2a4a7a, 0x3a3a3a, 0x5a6a2a] as const, 5)) });
  } else if (look === 'dirty') {
    // Towels and litter on the floor, a stained carpet and a dingy air.
    pm.stand(F.TOWELS, w - 13, b + 1);
    pm.set(Math.floor(w / 2) - 2, b, 0x8a8a6a);
    pm.hline(Math.floor(w / 2) + 3, b, 2, 0xd8c070);
    pm.sparse(4, b, 6, 2, 0x5a4020);
    pm.sparse(w - 30, b + 1, 5, 1, 0x5a4020);
    pm.map((c, _x, y) => (y < 2 ? c : mix(c, 0x8a7a40, 0.12)));
  }
}

// --- Commerce -------------------------------------------------------------------------

function fastfood(r: R): void {
  const { pm, w, base: b } = r;
  // Each outlet is its own brand: a main/secondary colour pair and floor.
  const [main, second] = pick(r, [
    [0xd03028, 0xffc820], [0x2f8a3a, 0xd03028], [0xe0609a, 0x7a4a2a], [0x2f6fb0, 0xffc820],
    [0xe07020, 0x3a3a3a], [0x7a3a9a, 0xf0e0a0], [0x2a8a8a, 0xf4f4f4], [0x8a2a2a, 0xe8c070],
  ] as const, 1);
  const floorA = pick(r, [0xf4ead8, 0xf0f0f0, 0xf6e0ea, 0xe8f0f4] as const, 2);
  const floorB = pick(r, [0xc83a30, 0x303030, 0xb07850, main], 3);
  shell(r, { wall: pick(r, [0xfff2d4, 0xf4f0e2, 0xfde8f0, 0xeef4f8] as const, 4), floor: floorA, floor2: floorB, style: 'check', wallStyle: 'plain' });
  // Signboard band with logo blocks, then a scalloped striped awning.
  pm.rect(2, 2, w - 4, 3, main);
  for (let x = 6; x < w - 10; x += 14) pm.hline(x, 3, 8, second);
  for (let x = 2; x < w - 2; x++) {
    const stripe = ((x - 2) >> 2) % 2 ? W : main;
    pm.set(x, 5, stripe);
    if ((x - 2) % 4 === 1 || (x - 2) % 4 === 2) pm.set(x, 6, stripe);
  }
  // Menu boards on the back wall above the counter.
  const cw = Math.min(70, Math.floor(w * 0.38));
  for (let x = 6; x + 14 < cw; x += 17) {
    pm.rect(x, 8, 15, 5, 0x26262a);
    pm.hline(x, 8, 15, 0x4a4a52);
    pm.rect(x + 1, 9, 4, 3, [0xffb84a, 0xe86a3a, 0xf0e0a0][x % 3]!);
    pm.hline(x + 7, 9, 6, W); pm.hline(x + 7, 10, 5, 0xffdc58); pm.hline(x + 7, 11, 3, W);
  }
  // Counter: steel top, branded front, register and drinks machine.
  pm.rect(3, b - 6, cw, 6, main);
  pm.hline(3, b - 7, cw, 0xd8d8dc);
  pm.hline(3, b - 6, cw, shade(main, 0.2));
  pm.rect(3, b - 4, cw, 1, second);
  pm.vline(3 + cw - 1, b - 6, 6, shade(main, 0.3));
  pm.stand(F.REGISTER, cw - 10, b - 7);
  pm.rect(10, b - 11, 7, 4, 0x9c9ca4);
  pm.hline(10, b - 11, 7, 0xd8d8dc);
  pm.set(11, b - 9, 0xc83030); pm.set(14, b - 9, 0x5a3a20);
  // Tables with stools.
  for (let x = cw + 12; x + 18 < w - 4; x += 24) {
    pm.stand(F.STOOL, x, b, { inks: accent(main) });
    pm.stand(F.CAFE_TABLE, x + 5, b, { inks: accent(second) });
    pm.stand(F.STOOL, x + 15, b, { inks: accent(main) });
    if (x % 3 === 0) { pm.set(x + 8, b - 7, 0xd03028); pm.set(x + 9, b - 7, 0xffdc58); }
  }
  plant(r, w - 10);
}

function restaurant(r: R): void {
  const { pm, w, base: b, v } = r;
  if (v === 1) {
    // Sushi bar: timber, noren curtains, lanterns and a long counter.
    const S = sty(r, [
      { wall: 0xe6d4aa, lower: 0xdcc898, floor: 0x8a6a42, noren: 0x24448a, lantern: 0xd03028, stool: 0xc83030, counter: 0x6a4020, top: 0xe8d0a0, tank: true },
      { wall: 0x3e3430, lower: 0x544640, floor: 0x4a3424, noren: 0xa82828, lantern: 0xf4ecd8, stool: 0x3a3a42, counter: 0x2e1c12, top: 0xc89a5a, tank: false },
      { wall: 0xdfe4c6, lower: 0xc6cfa4, floor: 0xa8885a, noren: 0x2f6a3a, lantern: 0xf0b030, stool: 0x6a8a3a, counter: 0x8a6034, top: 0xf0e0b8, tank: false },
      { wall: 0xf0ece2, lower: 0xc4cedc, floor: 0x7a6248, noren: 0x5a2a6a, lantern: 0xe07020, stool: 0x3464bc, counter: 0x5a3a28, top: 0xe0d4c0, tank: true },
    ]);
    shell(r, { wall: S.wall, floor: S.floor, style: 'wood', wallStyle: 'panel', lower: S.lower });
    for (let x = 4; x < w - 4; x += 10) {
      pm.rect(x, 3, 8, 5, S.noren);
      pm.hline(x, 3, 8, tint(S.noren, 0.25));
      if (r.s % 2) { pm.hline(x, 6, 8, tint(S.noren, 0.55)); } else { pm.set(x + 3, 5, W); pm.set(x + 4, 5, W); }
    }
    for (let x = 20; x < w - 20; x += 40) {
      pm.vline(x + 2, 8, 2, 0x26262a);
      pm.disc(x + 2, 12, 2.4, S.lantern);
      pm.hline(x + 1, 11, 3, tint(S.lantern, 0.45));
    }
    const cx = 8, cw = w - 50;
    pm.rect(cx, b - 8, cw, 8, S.counter);
    pm.hline(cx, b - 9, cw, S.top);
    pm.hline(cx, b - 8, cw, shade(S.top, 0.2));
    for (let x = cx + 4; x < cx + cw - 4; x += 6) pm.vline(x, b - 7, 7, shade(S.counter, 0.18));
    for (let x = cx + 6; x < cx + cw - 6; x += 13) {
      pm.hline(x, b - 10, 4, W);
      pm.set(x + 1, b - 11, 0xf07050); pm.set(x + 2, b - 11, W);
    }
    for (let x = cx + 4; x < cx + cw - 4; x += 13) pm.stand(F.STOOL, x, b, { inks: accent(S.stool) });
    const tx = w - 34;
    if (S.tank) {
      // Fish tank.
      pm.rect(tx, b - 13, 24, 13, 0x45280f);
      pm.rect(tx + 1, b - 12, 22, 8, 0x3a8ac8);
      pm.dither(tx + 1, b - 12, 22, 2, 0x68acdc);
      pm.set(tx + 5, b - 9, 0xff8030); pm.set(tx + 6, b - 9, 0xff8030);
      pm.set(tx + 14, b - 7, 0xffdc58); pm.set(tx + 15, b - 7, 0xffdc58);
      pm.hline(tx + 1, b - 5, 22, 0xd0b070);
    } else {
      // Sake shelf with a bonsai on top.
      pm.rect(tx, b - 13, 24, 13, shade(S.counter, 0.2));
      pm.rect(tx + 1, b - 12, 22, 11, shade(S.counter, 0.45));
      for (const sy of [b - 8, b - 2]) {
        pm.hline(tx + 1, sy, 22, S.top);
        for (let k = 0, x = tx + 2; x < tx + 22; x += 3, k++) {
          const c = [0xf4ecd8, 0x3a8a4a, 0x8a2a2a, 0x2a2a2e, 0xc8a050][(k + sy) % 5]!;
          pm.vline(x, sy - 3, 3, c);
          pm.set(x, sy - 4, shade(c, 0.3));
        }
      }
      pm.rect(tx + 8, b - 15, 8, 2, 0x5a3a2a);
      pm.rect(tx + 6, b - 18, 12, 3, 0x3f7a3a);
      pm.dither(tx + 6, b - 18, 12, 2, 0x5a9a4a);
      pm.vline(tx + 11, b - 16, 2, 0x5a3418);
    }
    return;
  }
  if (v === 2) {
    // Steakhouse: dark panelling, leather booths, sconces or pendants.
    const S = sty(r, [
      { wall: 0x9a6a3c, lower: 0x6a3a1c, trim: 0x2a160a, floor: 0x5a3418, ws: 'panel', seat: 0x8a2028, linen: 0xd8c8a8, check: false, pendant: false },
      { wall: 0x56664a, lower: 0x3e2a18, trim: 0x1e140a, floor: 0x4a2c16, ws: 'wainscot', seat: 0x2a5a3a, linen: 0xf0ecdc, check: false, pendant: true },
      { wall: 0xa0503a, lower: 0x4a2a18, trim: 0x2a160a, floor: 0x6a4022, ws: 'block', seat: 0x6a3a1c, linen: 0xc83a30, check: true, pendant: false },
      { wall: 0x34405a, lower: 0x5a3a20, trim: 0x16161a, floor: 0x3a2a1c, ws: 'wainscot', seat: 0xa87a44, linen: 0xf4f0e6, check: false, pendant: true },
    ] as const);
    shell(r, { wall: S.wall, floor: S.floor, style: 'parquet', wallStyle: S.ws, lower: S.lower, trim: S.trim });
    if (!S.pendant) {
      for (let x = 14; x < w - 10; x += 34) {
        pm.rect(x, 5, 2, 3, 0xd0a028);
        pm.disc(x + 0.5, 4, 1.5, 0xfff4bc);
      }
    }
    for (let x = 6; x + 30 < w - 4; x += 34) {
      const seat = S.seat;
      pm.rect(x, b - 12, 4, 12, seat);
      pm.vline(x, b - 12, 12, tint(seat, 0.25));
      pm.rect(x + 4, b - 5, 4, 2, seat);
      pm.rect(x + 22, b - 12, 4, 12, seat);
      pm.vline(x + 25, b - 12, 12, shade(seat, 0.3));
      pm.rect(x + 18, b - 5, 4, 2, seat);
      pm.hline(x + 8, b - 6, 10, S.linen);
      if (S.check) for (let k = x + 8; k < x + 18; k += 2) pm.set(k, b - 6, 0xf4f0e6);
      pm.hline(x + 8, b - 5, 10, 0x45280f);
      pm.vline(x + 12, b - 4, 4, 0x2a160a);
      pm.set(x + 12, b - 7, 0xfff4bc);
      pm.set(x + 10, b - 7, 0xc8c8c8); pm.set(x + 15, b - 7, 0xc8c8c8);
      if (S.pendant) {
        pm.blit(F.PENDANT, x + 11, 2);
        pm.blit(F.SMALL_PICTURE, x + 28, 6, { inks: accent(0x8ab0d0, 0x6a8a48) });
      }
    }
    return;
  }
  // French bistro: pale wall over a coloured wainscot, wine bar and set tables.
  const S = sty(r, [
    { wall: 0xf1dfbd, lower: 0x7a2e2e, trim: 0x3a1010, floor: 0x6b4423, floor2: 0, fs: 'wood', chair: 0x7a2e2e, linen: W, bar: 0x5b3a20, barTop: 0xc9a24a, art: [0xe0b060, 0x6a9a48], clock: false },
    { wall: 0xe2ead4, lower: 0x4a6a4a, trim: 0x24341f, floor: 0x8a6038, floor2: 0, fs: 'parquet', chair: 0x4a6a4a, linen: 0xf4f0e0, bar: 0x6a4a2a, barTop: 0xd8d0b8, art: [0xd07890, 0x3464bc], clock: true },
    { wall: 0xf4ecdc, lower: 0x2c4a7a, trim: 0x16243a, floor: 0xe8e2d0, floor2: 0x2a2a2e, fs: 'check', chair: 0x2c4a7a, linen: 0xf0f0f0, bar: 0x3a3a42, barTop: 0xb8bcc4, art: [0xf0c040, 0xc83030], clock: false },
    { wall: 0xf6e0d8, lower: 0xb87a6a, trim: 0x6a3a2a, floor: 0x7a5232, floor2: 0, fs: 'parquet', chair: 0xc8a050, linen: 0xfff6ee, bar: 0x8a5a3a, barTop: 0xe8d8b0, art: [0x7a4fb0, 0x6a9a48], clock: true },
  ] as const);
  shell(r, { wall: S.wall, floor: S.floor, floor2: S.floor2 || undefined, style: S.fs, wallStyle: 'wainscot', lower: S.lower, trim: S.trim });
  pm.stand(F.WINE_RACK, 4, b - 9);
  pm.rect(3, b - 9, 28, 9, S.bar);
  pm.hline(3, b - 10, 28, S.barTop);
  for (let x = 5; x < 30; x += 4) pm.vline(x, b - 8, 7, shade(S.bar, 0.25));
  const cloth = { W: S.linen, w: shade(S.linen, 0.1) };
  for (let x = 44; x + 22 < w - 10; x += 34) {
    pm.stand(F.DINING_CHAIR_L, x, b, { inks: accent(S.chair) });
    pm.stand(F.DINING_TABLE, x + 4, b, { inks: cloth });
    pm.stand(F.DINING_CHAIR_R, x + 18, b, { inks: accent(S.chair) });
    pm.blit(F.PENDANT, x + 9, 2);
  }
  if (S.clock) pm.blit(F.CLOCK, 40, 5);
  else pm.blit(F.PICTURE, 38, 4, { inks: accent(S.art[0], S.art[1]) });
  if (S.clock) pm.stand(F.FLOOR_LAMP, w - 9, b);
  else plant(r, w - 10, r.th > 22);
}

function shop(r: R): void {
  const { pm, w, base: b, v } = r;
  const awning = pick(r, [0x3f9a58, 0x2f6fb0, 0xc0503a, 0x8a4fb0, 0xd08a20, 0x2a8a8a, 0xd06a9a, 0x3a3a4a] as const, 1);
  const wall = pick(r, [0xfaf2ea, 0xf0e6d0, 0xe4f0dc, 0xe6eaf0, 0xf4e4e4, 0xece8dc] as const, 2);
  const woodFloor = v === 1 || pick(r, [false, false, true] as const, 3);
  shell(r, {
    wall,
    floor: woodFloor ? pick(r, [0x9a6a38, 0xb88a50, 0x7a4a2a] as const, 4) : pick(r, [0xd8ccb4, 0x8a9a7a, 0xb8bcc4, 0xe0d8d0] as const, 4),
    style: woodFloor ? 'wood' : 'tile',
    wallStyle: pick(r, ['plain', 'plain', 'stripe', 'paper'] as const, 5),
  });
  for (let x = 2; x < w - 2; x++) {
    const s = ((x - 2) >> 2) % 2 ? W : awning;
    for (let y = 2; y < 6; y++) pm.set(x, y, s);
    if ((x - 2) % 4 !== 0 && (x - 2) % 4 !== 3) pm.set(x, 6, s);
  }
  pm.hline(2, 2, w - 4, shade(awning, 0.3));
  const shelfEnd = w - 30;
  if (v === 0) {
    pm.stand(F.CLOTHES_RACK, 6, b, { inks: accent(0xe07898, 0x3464bc) });
    pm.stand(F.MANNEQUIN, 26, b, { inks: accent(0xc83030, 0x24282c) });
    pm.stand(F.CLOTHES_RACK, 36, b, { inks: accent(0x44a03a, 0xffdc58) });
    pm.stand(F.MANNEQUIN, 56, b, { inks: accent(0xf4f4f4, 0x3464bc) });
    if (shelfEnd > 92) pm.stand(F.CLOTHES_RACK, 66, b, { inks: accent(0x5c2c88, 0xe07020) });
    pm.rect(8, 9, 30, 5, 0x26262a);
    for (let x = 10; x < 36; x += 3) pm.set(x, 11, 0xffdc58);
  } else if (v === 1) {
    for (let x = 4; x + 20 <= shelfEnd; x += 22) bookshelf(r, x, 20, 15, 0x8a5a2c, x * 3 + 11);
    pm.stand(F.ARMCHAIR, shelfEnd - 8, b, { inks: accent(0x2a5a4a) });
  } else if (v === 2) {
    for (let x = 4; x + 8 <= shelfEnd; x += 10) {
      const top = (x >> 1) % 2 === 0;
      if (top) { pm.hline(x - 1, b - 9, 9, 0x8a5a2c); pm.vline(x, b - 8, 8, 0x5a3818); pm.vline(x + 6, b - 8, 8, 0x5a3818); }
      pm.blit(F.FLOWER_BUCKET, x, top ? b - 17 : b - 8);
    }
    for (let x = 10; x < shelfEnd; x += 22) {
      pm.vline(x + 2, 7, 3, 0x45280f);
      pm.blit(F.PLANT, x, 9);
    }
  } else {
    for (let x = 4; x + 22 <= shelfEnd; x += 24) {
      pm.rect(x, b - 15, 22, 15, 0x5a5a62);
      for (let row = 0; row < 2; row++) {
        const y = b - 14 + row * 7;
        pm.hline(x, y + 6, 22, 0x9c9ca4);
        for (let tx = x + 1; tx + 6 < x + 22; tx += 7) {
          pm.rect(tx, y, 6, 5, 0x16161a);
          pm.rect(tx + 1, y + 1, 4, 3, [0x68acdc, 0x8cd05c, 0xec80a0][(tx + row) % 3]!);
          pm.set(tx + 1, y + 1, 0xbce2f8);
        }
      }
    }
  }
  // Counter with register.
  const cx = w - 24;
  pm.rect(cx, b - 7, 18, 7, 0x8a5a34);
  pm.hline(cx, b - 8, 18, 0xd9cdb2);
  pm.hline(cx + 1, b - 4, 16, 0x6a4020);
  pm.stand(F.REGISTER, cx + 9, b - 8);
}

function cinema(r: R): void {
  const { pm, w, th, base: b } = r;
  const S = sty(r, [
    { wall: 0x3a1a24, floor: 0x2a1418, rake: 0x24101a, marquee: 0x6a1018, curtain: [0xb3203a, 0x801828], valance: 0x901828, seats: [0xc02838, 0xa82030, 0x902030], ws: 'plain' },
    { wall: 0x1e2644, floor: 0x161c30, rake: 0x10162a, marquee: 0x1c2e6a, curtain: [0x3a5ab8, 0x24387e], valance: 0x2a4290, seats: [0x3a5ab8, 0x304ca2, 0x26408c], ws: 'panel' },
    { wall: 0x1e3028, floor: 0x14201a, rake: 0x0e1812, marquee: 0x24402c, curtain: [0xd0a028, 0x9a7418], valance: 0xb08a20, seats: [0x2f7a4a, 0x286a40, 0x205a36], ws: 'stripe' },
    { wall: 0x2e1a3a, floor: 0x20122a, rake: 0x180c20, marquee: 0x4a1a5a, curtain: [0x8a3aa8, 0x5e2478], valance: 0x6e2a8a, seats: [0xc8a040, 0xb08c34, 0x98782a], ws: 'panel' },
  ] as const);
  shell(r, { wall: S.wall, floor: S.floor, style: 'carpet', wallStyle: S.ws, lower: shade(S.wall, 0.2) });
  // Marquee strip with chaser bulbs.
  pm.rect(1, 2, w - 2, 4, S.marquee);
  for (let x = 3, i = 0; x < w - 3; x += 3, i++) pm.set(x, 3, i % 2 ? 0xffd75a : 0xfff4c0);
  for (let x = 4, i = 0; x < w - 3; x += 3, i++) pm.set(x, 4, i % 2 ? 0xfff4c0 : 0xffb030);
  // Screen with proscenium curtains.
  const s = cinemaScreen(w, th + 2);
  const [c0, c1] = S.curtain;
  pm.rect(s.x - 10, s.y - 2, s.w + 20, s.h + 4, 0x140608);
  pm.rect(s.x, s.y, s.w, s.h, 0xd8dce8);
  pm.dither(s.x, s.y, s.w, s.h, 0xc0c6d6);
  for (let x = s.x - 10; x < s.x; x++) pm.vline(x, s.y - 2, s.h + 4, (x % 2) ? c0 : c1);
  for (let x = s.x + s.w; x < s.x + s.w + 10; x++) pm.vline(x, s.y - 2, s.h + 4, (x % 2) ? c0 : c1);
  pm.rect(s.x - 10, s.y - 2, s.w + 20, 2, S.valance);
  if (r.s >= 2) for (let x = s.x - 10; x < s.x + s.w + 10; x += 2) pm.set(x, s.y, S.valance);
  // Raked rows of seats facing the screen.
  for (let row = 2; row >= 0; row--) {
    const y = b - row * 4;
    if (row > 0) pm.rect(3, y - 1, w - 6, row * 4 + 1, S.rake);
    for (let x = 6 + (row % 2) * 3; x + 5 < w - 6; x += 7) {
      pm.stand(F.CINEMA_SEAT, x, y, { inks: accent(S.seats[row]!) });
    }
  }
  for (let x = 12; x < w - 8; x += 56) pm.set(x, b, 0xffd75a);
  pm.rect(4, 8, 7, 3, 0x1a9a4a);
  pm.hline(5, 9, 5, 0xbaffd0);
  pm.rect(w - 11, 8, 7, 3, 0x1a9a4a);
  pm.hline(w - 10, 9, 5, 0xbaffd0);
}

function partyHall(r: R): void {
  const { pm, w, base: b, v } = r;
  const S = sty(r, [
    { wall: 0xfbe0e8, lower: 0xe8a8bc, trim: 0xb07040, floor: 0xb98552, floor2: 0, fs: 'parquet', chair: 0xd2a03a, cloth: [W, 0xf4e6ea, 0xe8d0d8], flower: 0xe07fa0, curtain: [0xb3203a, 0x801828], valance: 0x8a1828, flags: [0xe0452e, 0xf0c020, 0x2f8fd0, 0x4fae3a, 0xb05ad0], balloons: false },
    { wall: 0xe0f2ec, lower: 0x8ccab8, trim: 0x3a7a6a, floor: 0xc8a070, floor2: 0, fs: 'wood', chair: 0xb8bcc4, cloth: [W, 0xf0faf6, 0xd8ece4], flower: 0xf0c020, curtain: [0x2a8a8a, 0x1a6060], valance: 0x1e6a6a, flags: [0x2a9a9a, 0xf0c020, 0xf4f4f4, 0xf07a5a], balloons: false },
    { wall: 0xece4f6, lower: 0xb8a4d8, trim: 0x5a4a7a, floor: 0xa07850, floor2: 0, fs: 'parquet', chair: 0xd2a03a, cloth: [W, 0xf6f0fa, 0xe2d8ee], flower: 0x7a4fb0, curtain: [0x6a3a9a, 0x4a2470], valance: 0x5a2a80, flags: [0xb05ad0, 0xf0a0c8, 0x5ab4e8, 0xf4f4f4], balloons: true },
    { wall: 0xf6f0e0, lower: 0xd8c8a0, trim: 0x8a6a30, floor: 0xd8ccb4, floor2: 0, fs: 'tile', chair: 0xf0f0f0, cloth: [W, 0xfaf6ee, 0xece6d8], flower: 0xf0a0b0, curtain: [0xd0a028, 0x9a7418], valance: 0xb08a20, flags: [0xf0d070, 0xf4f4f4, 0xf0b0c0], balloons: true },
  ] as const);
  shell(r, { wall: S.wall, floor: S.floor, floor2: S.floor2 || undefined, style: S.fs, wallStyle: 'wainscot', lower: S.lower, trim: S.trim });
  if (S.balloons) {
    // String of fairy lights with balloon clusters.
    for (let x = 2; x < w - 2; x++) {
      const y = 4 + Math.round(Math.abs(Math.sin((x / 24) * Math.PI)) * 2);
      pm.set(x, y, 0x8a8a7a);
      if (x % 6 === 0) pm.set(x, y + 1, 0xfff4bc);
    }
    for (let x = 78, i = 0; x < w - 60; x += 80, i++) {
      for (let k = 0; k < 3; k++) {
        const c = S.flags[(i + k) % S.flags.length]!;
        const bx = x + k * 3, by = 9 + (k % 2) * 2;
        pm.disc(bx, by, 1.6, c);
        pm.set(bx - 1, by - 1, tint(c, 0.5));
        pm.vline(bx, by + 2, 4 - (k % 2) * 2, 0x9c9ca4);
      }
    }
  } else {
    // Bunting along the ceiling.
    pm.hline(2, 3, w - 4, 0x8a6a40);
    for (let x = 4, i = 0; x < w - 8; x += 7, i++) {
      const c = S.flags[i % S.flags.length]!;
      pm.hline(x, 4, 5, c); pm.hline(x + 1, 5, 3, c); pm.set(x + 2, 6, c);
    }
  }
  for (let x = 40; x < w - 56; x += 80) {
    if (v === 1) {
      // Mirror ball instead of chandeliers.
      pm.vline(x, 5, 4, 0x6c6c74);
      pm.disc(x, 11, 2.6, 0xb8bcc4);
      pm.dither(x - 2, 9, 5, 5, 0xf4f4f4);
      pm.set(x - 1, 10, W);
    } else {
      pm.blit(F.CHANDELIER, x - 5, 7);
    }
  }
  // Round banquet tables with chairs and centrepieces.
  const stageW = 50;
  const [top, cloth, folds] = S.cloth;
  for (let x = 10; x + 24 < w - stageW - 6; x += 30) {
    pm.stand(F.DINING_CHAIR_L, x, b, { inks: accent(S.chair) });
    pm.rect(x + 4, b - 6, 15, 2, top);
    pm.rect(x + 5, b - 4, 13, 4, cloth);
    pm.dither(x + 5, b - 4, 13, 4, folds);
    pm.disc(x + 11, b - 8, 1.5, S.flower);
    pm.set(x + 11, b - 10, 0x44a03a);
    pm.stand(F.DINING_CHAIR_R, x + 19, b, { inks: accent(S.chair) });
  }
  // Stage with curtains and a microphone.
  const sx = w - stageW - 3;
  const [c0, c1] = S.curtain;
  pm.rect(sx, b - 6, stageW, 6, 0x7a4a2a);
  pm.hline(sx, b - 7, stageW, 0xd2a03a);
  for (let x = sx; x < sx + 8; x++) pm.vline(x, 4, b - 11, x % 2 ? c0 : c1);
  for (let x = sx + stageW - 8; x < sx + stageW; x++) pm.vline(x, 4, b - 11, x % 2 ? c0 : c1);
  pm.rect(sx, 4, stageW, 4, S.valance);
  for (let x = sx; x < sx + stageW; x += 3) pm.set(x, 8, 0xd2a03a);
  const mx = sx + Math.floor(stageW / 2);
  pm.vline(mx, b - 15, 8, 0x3a3a42);
  pm.rect(mx - 1, b - 17, 3, 2, 0x16161a);
  if (v === 1) mirror(pm);
}

// --- Services ---------------------------------------------------------------------------

function medical(r: R): void {
  const { pm, w, base: b, v } = r;
  const S = sty(r, [
    { wall: 0xf2faf8, lower: 0xb8e0d8, floor: 0xbcd6d0, fs: 'tile', acc: 0x5fa8a0, cur: [0xc9e4f4, 0xa8cfe8], blanket: 0x9fd6c6 },
    { wall: 0xf2f6fc, lower: 0xbccae8, floor: 0xc4cad6, fs: 'check', acc: 0x4a6ab0, cur: [0xd8f0d8, 0xb4dcb4], blanket: 0xa8c0e8 },
    { wall: 0xfcf6ee, lower: 0xf0d4b4, floor: 0xd6c8b4, fs: 'tile', acc: 0xd0844a, cur: [0xf4e0c8, 0xe8c8a0], blanket: 0xf0b890 },
    { wall: 0xf6f2fa, lower: 0xd8c8ea, floor: 0xc8c0d0, fs: 'check', acc: 0x7a5aa8, cur: [0xf4dce6, 0xe4bccc], blanket: 0xc8b0e0 },
  ] as const);
  shell(r, { wall: S.wall, floor: S.floor, floor2: shade(S.floor, 0.12), style: S.fs, wallStyle: 'wainscot', lower: S.lower });
  pm.blit(F.RED_CROSS, 6, 5);
  // Reception desk with a CRT and waiting chairs.
  pm.rect(22, b - 8, 22, 8, 0xe8ecec);
  pm.hline(22, b - 9, 22, S.acc);
  pm.hline(22, b - 4, 22, tint(S.acc, 0.6));
  pm.stand(F.CRT, 32, b - 9);
  for (let x = 48; x < 60; x += 5) { pm.rect(x, b - 6, 4, 2, S.acc); pm.rect(x, b - 9, 1, 3, S.acc); pm.vline(x + 2, b - 4, 4, 0x6c6c74); }
  // Ward bays: privacy curtain, bed, IV stand.
  const [c0, c1] = S.cur;
  for (let x = 64; x + 32 < w - 4; x += 36) {
    pm.hline(x, 3, 14, 0x9c9ca4);
    for (let k = 0; k < 12; k++) pm.vline(x + 1 + k, 4, r.wallBottom - 6, k % 2 ? c0 : c1);
    pm.rect(x + 15, b - 7, 18, 3, W);
    pm.rect(x + 15, b - 8, 5, 2, 0xf4f4f4);
    pm.rect(x + 21, b - 7, 12, 3, S.blanket);
    pm.hline(x + 15, b - 4, 18, 0x9c9ca4);
    pm.vline(x + 15, b - 3, 3, 0x6c6c74);
    pm.vline(x + 32, b - 3, 3, 0x6c6c74);
    pm.vline(x + 14, b - 11, 8, 0x9c9ca4);
    pm.stand(F.IV_STAND, x + 34, b);
  }
  if (v === 1) mirror(pm);
}

function security(r: R): void {
  const { pm, w, base: b, v } = r;
  const S = sty(r, [
    { wall: 0xd6dee8, floor: 0x5a6680, ws: 'plain', console: 0x4a5568, locker: 0xcfd0d4, screens: [0x5ac07a, 0x68acdc] },
    { wall: 0xd8d4c8, floor: 0x4a4a52, ws: 'block', console: 0x3a3a42, locker: 0x8a9a6a, screens: [0x5ac07a, 0xe0a040] },
    { wall: 0xccd6de, floor: 0x2e3a4e, ws: 'wainscot', console: 0x2a3a5a, locker: 0x6a8ab8, screens: [0x68acdc, 0x9ad0f0] },
    { wall: 0xe4e0d4, floor: 0x6a5a4a, ws: 'stripe', console: 0x5a4a3a, locker: 0xb06a5a, screens: [0x5ac07a, 0xd8d8d0] },
  ] as const);
  shell(r, { wall: S.wall, floor: S.floor, style: 'tile', wallStyle: S.ws, lower: 0x7a869a });
  pm.blit(F.BADGE, 6, 5);
  // CCTV monitor wall above a console.
  const mx = 22;
  const cols = Math.max(2, Math.min(9, Math.floor((w * 0.48) / 9)));
  pm.rect(mx - 1, 3, cols * 9 + 1, 13, 0x3a3a42);
  const [sa, sb] = S.screens;
  for (let c = 0; c < cols; c++) {
    for (let row = 0; row < 2; row++) {
      const x = mx + c * 9, y = 4 + row * 6;
      const sc = (c + row) % 3 ? sa : sb;
      pm.rect(x, y, 8, 5, 0x16161a);
      pm.rect(x + 1, y + 1, 6, 3, sc);
      pm.dither(x + 1, y + 1, 6, 3, shade(sc, 0.2));
      pm.set(x + 2, y + 2, tint(sc, 0.7));
    }
  }
  pm.rect(mx, b - 7, cols * 9, 2, S.console);
  pm.hline(mx, b - 7, cols * 9, tint(S.console, 0.35));
  pm.rect(mx + 1, b - 5, cols * 9 - 2, 5, tint(S.console, 0.15));
  for (let c = 0; c < cols; c += 2) pm.hline(mx + c * 9 + 2, b - 4, 3, c % 4 ? 0xff5a4a : 0x6fe08a);
  const lk = { w: S.locker, G: shade(S.locker, 0.2), g: shade(S.locker, 0.4) };
  for (let x = w - 34; x < w - 6; x += 6) pm.stand(F.LOCKER, x, b, { inks: lk });
  if (v === 1) mirror(pm);
}

function housekeeping(r: R): void {
  const { pm, w, base: b, v } = r;
  const S = sty(r, [
    { wall: 0xeef2f1, floor: 0xa9b6b2, fs: 'tile', ws: 'plain', shelf: 0xb08a5a, linen: [W, 0x9fd4f5, 0xf7c8d8, 0xf0e0a0] },
    { wall: 0xe8f0f8, floor: 0x8a9ab0, fs: 'check', ws: 'stripe', shelf: 0x9aa3ad, linen: [W, 0xc8e8c8, 0x9fd4f5, 0xe4e4f0] },
    { wall: 0xf6eee2, floor: 0xc0a888, fs: 'tile', ws: 'wainscot', shelf: 0x8a5a2c, linen: [W, 0xf0d0a0, 0xe8b0b0, 0xf8f0d8] },
    { wall: 0xe6f2ec, floor: 0x7aa08e, fs: 'tile', ws: 'plain', shelf: 0xd0b890, linen: [W, 0xd8c8f0, 0xa8e0d0, 0xf7c8d8] },
  ] as const);
  shell(r, { wall: S.wall, floor: S.floor, floor2: shade(S.floor, 0.15), style: S.fs, wallStyle: S.ws, lower: tint(S.floor, 0.3) });
  const wEnd = Math.floor(Math.min(w * 0.42, w - 20));
  for (let x = 4; x + 11 < wEnd; x += 13) pm.stand(F.WASHER, x, b);
  // Linen shelves.
  const sx = wEnd + 4;
  pm.rect(sx, 4, 30, b - 4, S.shelf);
  pm.rect(sx + 1, 5, 28, b - 6, shade(S.shelf, 0.4));
  for (let row = 0; row < 3; row++) {
    const y = 5 + row * 5;
    if (y + 5 > b) break;
    pm.hline(sx + 1, y + 4, 28, S.shelf);
    for (let x = sx + 2, k = 0; x < sx + 27; x += 6, k++) {
      const c = S.linen[(k + row) % 4]!;
      pm.rect(x, y + 1, 5, 3, c);
      pm.hline(x, y + 2, 5, shade(c, 0.12));
    }
  }
  const cx = sx + 36;
  if (cx + 16 < w - 2) pm.stand(F.LINEN_CART, cx, b);
  if (cx + 36 < w - 2) pm.stand(F.LINEN_CART, cx + 20, b);
  if (v === 1) mirror(pm);
}

// --- Basement --------------------------------------------------------------------------

function concrete(r: R, wall = 0x9a988e, floor = 0x6a6a66): void {
  shell(r, { wall, floor, style: 'concrete', wallStyle: 'block' });
  const { pm, w, wallBottom } = r;
  for (let x = 10; x < w - 6; x += 24) {
    pm.rect(x, 2, 5, wallBottom - 1, shade(wall, 0.1));
    pm.vline(x, 2, wallBottom - 1, tint(wall, 0.2));
    pm.vline(x + 4, 2, wallBottom - 1, shade(wall, 0.28));
  }
  // Fluorescent tube.
  pm.hline(Math.floor(w / 2) - 6, 3, 12, 0xeef6ff);
}

const CAR_COLORS = [0xc83030, 0x3464bc, 0xe8e2d0, 0x44a03a, 0xe0b030, 0x3a3a42];

function parkingSpace(r: R): void {
  concrete(r);
  const { pm, w, base: b, v } = r;
  pm.vline(1, b - 1, 3, 0xf0c020);
  pm.vline(w - 2, b - 1, 3, 0xf0c020);
  pm.hline(2, b + 1, w - 4, 0x7a7a74);
  if (v !== 5) pm.stand(F.CAR, Math.floor((w - 34) / 2), b + 1, { inks: accent(CAR_COLORS[v]!) });
}

function parkingRamp(r: R): void {
  const S = sty(r, [
    { wall: 0x9a988e, floor: 0x6a6a66, deck: 0x7d7b74, paint: 0xf0c020 },
    { wall: 0xaaa496, floor: 0x76726a, deck: 0x8a857a, paint: 0xf0f0e8 },
    { wall: 0x8e949c, floor: 0x5e6268, deck: 0x6e737a, paint: 0xf08a30 },
  ] as const);
  concrete(r, S.wall, S.floor);
  const { pm, w, base: b, v } = r;
  // The ramp deck climbs left to right as a stepped pixel diagonal.
  for (let x = 2; x < w - 2; x++) {
    const y = Math.round(b - ((x - 2) / (w - 4)) * (b - 3));
    pm.vline(x, y, 3, S.deck);
    pm.set(x, y, tint(S.deck, 0.5));
    pm.vline(x, y + 3, Math.max(0, b - y - 3), shade(S.deck, 0.28));
  }
  for (let x = 14; x < w - 20; x += 28) {
    const y = Math.round(b - ((x - 2) / (w - 4)) * (b - 3)) - 4;
    pm.hline(x, y, 5, S.paint);
    pm.set(x + 4, y - 1, S.paint); pm.set(x + 4, y + 1, S.paint);
  }
  for (let x = 2; x < w - 2; x += 8) pm.hline(x, b, 4, S.paint);
  if (v === 1) mirror(pm);
}

function recycling(r: R): void {
  const { pm, w, th, base: b, v } = r;
  const S = sty(r, [
    { wall: 0x8e9a88, floor: 0x55604f, press: 0x6a7a8a, chev: 0xf0c020, belt: 0x3a3a42, bins: [0x3d7a3a, 0x2f5f9a, 0xe0b23a, 0x8a5a34] },
    { wall: 0x9c968a, floor: 0x5e5a52, press: 0x3f7a5a, chev: 0xf0c020, belt: 0x2e2e34, bins: [0x2f5f9a, 0xe0b23a, 0x3d7a3a, 0x9a3a3a] },
    { wall: 0x8a96a4, floor: 0x4e5660, press: 0xc0802a, chev: 0xe8e8e8, belt: 0x44444c, bins: [0xe0b23a, 0x3d7a3a, 0x6a6a74, 0x2f5f9a] },
  ] as const);
  shell(r, { wall: S.wall, floor: S.floor, style: 'concrete', wallStyle: 'block' });
  // Conveyor across the upper level.
  const cy = Math.floor(th / 2) - 4;
  pm.rect(6, cy, w - 60, 3, S.belt);
  pm.hline(6, cy, w - 60, tint(S.belt, 0.35));
  for (let x = 8; x < w - 56; x += 6) pm.rect(x, cy + 3, 2, 2, 0x6c6c74);
  for (let x = 12; x < w - 60; x += 14) {
    const c = [0x9fd4f5, 0xd9cdb2, 0x4fae3a][x % 3]!;
    pm.rect(x, cy - 4, 6, 4, c);
    pm.hline(x, cy - 4, 6, tint(c, 0.3));
  }
  for (let x = 8, i = 0; x + 22 < w - 60; x += 30, i++) pm.stand(F.RECYCLE_BIN, x, b, { inks: accent(S.bins[i % 4]!) });
  // Compactor with hazard chevrons.
  const kx = w - 50;
  pm.rect(kx, 4, 44, b - 4, S.press);
  pm.vline(kx, 4, b - 4, tint(S.press, 0.25));
  pm.rect(kx + 3, 7, 38, 10, shade(S.press, 0.28));
  pm.dither(kx + 3, 7, 38, 10, shade(S.press, 0.42));
  for (let x = kx; x < kx + 44; x++) for (let y = b - 6; y < b; y++) pm.set(x, y, ((x + y) >> 2) % 2 ? 0x26262a : S.chev);
  if (v === 1) mirror(pm);
}

function metro(r: R): void {
  const { pm, w, th, base: b } = r;
  const band = Math.floor((th + 2) / 3);
  // Concourse (top band), then the tunnel, platform and train.
  pm.rect(0, 0, w, th, 0x2a2d35);
  const concourse = new PixMap(w, band);
  const top: R = { ...r, pm: concourse, th: band, base: band - 2, wallBottom: band - 5 };
  shell(top, { wall: 0xe8e2d2, floor: 0xb7ad9a, style: 'tile', wallStyle: 'plain' });
  for (let x = 16; x < w - 40; x += 48) {
    concourse.rect(x, 4, 22, 6, 0x2f5fb3);
    concourse.hline(x, 4, 22, 0x5a8ad8);
    for (let k = 2; k < 20; k += 3) concourse.set(x + k, 7, W);
    concourse.rect(x + 28, top.base - 8, 3, 8, 0x6c6c74);
    concourse.rect(x + 34, top.base - 8, 3, 8, 0x6c6c74);
    concourse.hline(x + 27, top.base - 8, 11, 0x9c9ca4);
  }
  pm.paste(concourse, 0, 0);
  // Tunnel wall tiles.
  pm.rect(1, band, w - 2, th - band, 0x30343d);
  for (let y = band + 2; y < b - 8; y += 4) for (let x = (y >> 2) % 2 ? 0 : 4; x < w - 1; x += 8) pm.rect(x, y, 7, 3, 0x3a3f4a);
  pm.rect(1, band, w - 2, 2, 0x16161a);
  // Platform edge.
  pm.rect(1, b, w - 2, 2, 0xd2cab8);
  pm.hline(1, b - 1, w - 2, 0xf0c020);
  // The train.
  const tx = 10, tw = w - 20, ty = b - 23;
  pm.rect(tx, ty, tw, 21, 0xc9ced6);
  pm.hline(tx, ty, tw, 0xe6e9ee);
  pm.hline(tx, ty + 1, tw, 0xdadde4);
  pm.rect(tx, ty + 13, tw, 3, 0x2f5fb3);
  pm.hline(tx, ty + 13, tw, 0x5a8ad8);
  for (let x = tx + 6; x < tx + tw - 12; x += 14) {
    pm.rect(x, ty + 4, 9, 7, 0x23324a);
    pm.rect(x + 1, ty + 5, 3, 5, 0x4a6a8a);
    pm.set(x + 1, ty + 5, 0x8ab0d0);
  }
  for (let x = tx + 60; x < tx + tw - 10; x += 60) pm.vline(x, ty + 1, 20, 0x8a9098);
  pm.rect(tx + tw - 4, ty + 4, 4, 15, 0x9aa3ad);
  pm.rect(tx + tw - 2, ty + 8, 2, 3, 0xfff0a8);
  pm.hline(tx, ty + 20, tw, 0x6c6c74);
  for (let x = tx + 8; x < tx + tw - 8; x += 30) { pm.disc(x, ty + 21, 1.5, 0x16161a); pm.disc(x + 8, ty + 21, 1.5, 0x16161a); }
  pm.vline(0, 0, th, DIVIDER);
  pm.vline(w - 1, 0, th, DIVIDER);
}

function cathedral(r: R): void {
  const { pm, w, th, base: b, wallBottom } = r;
  shell(r, { wall: 0xe2d8c0, floor: 0x9a8a6a, style: 'marble', floor2: 0x7a6a50, wallStyle: 'block' });
  const glass = [0x2f5fb3, 0xc0283a, 0xf0c020, 0x3f9a58, 0x7a4fb0];
  const pitch = 38;
  const centre = Math.floor(w / 2);
  for (let x = 8; x + 22 < w - 8; x += pitch) {
    // Pillar.
    pm.rect(x - 6, 2, 5, wallBottom - 1, 0xcfc3a6);
    pm.vline(x - 6, 2, wallBottom - 1, 0xf3ecdc);
    pm.vline(x - 2, 2, wallBottom - 1, 0xa89c80);
    // Lancet window with stained glass (the rose window takes the centre).
    if (Math.abs(x + 11 - centre) < 22) continue;
    const top = 12, bottom = Math.min(th - 24, b - 20);
    for (let y = top - 6; y < bottom; y++) {
      const k = y - (top - 6);
      const half = y < top ? Math.min(9, Math.round(Math.sqrt(Math.max(0, 81 - (6 - k) * (6 - k) * 2.2)))) : 9;
      pm.hline(x + 11 - half, y, half * 2 + 1, 0x4a3a2a);
      for (let gx = x + 12 - half; gx < x + 11 + half; gx++) {
        if (gx % 4 === 0 || y % 4 === 0) continue;
        pm.set(gx, y, glass[((gx >> 2) + (y >> 2) + x) % glass.length]!);
      }
    }
  }
  // Rose window above the altar.
  const cx = Math.floor(w / 2), cy = 16;
  pm.disc(cx, cy, 11, 0x4a3a2a);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    pm.disc(cx + Math.cos(a) * 6, cy + Math.sin(a) * 6, 2.6, glass[i % glass.length]!);
  }
  pm.disc(cx, cy, 2.5, 0xf0c020);
  // Altar, gold cross, candles; pews either side.
  pm.rect(cx - 14, b - 8, 28, 8, 0xf3ecdc);
  pm.hline(cx - 14, b - 9, 28, 0xd2a03a);
  pm.rect(cx - 10, b - 6, 20, 4, 0xc0283a);
  pm.rect(cx - 1, b - 22, 2, 13, 0xd2a03a);
  pm.rect(cx - 5, b - 18, 10, 2, 0xd2a03a);
  for (const dx of [-12, 11]) { pm.vline(cx + dx, b - 13, 4, W); pm.set(cx + dx, b - 14, 0xffdc58); }
  for (let x = 10; x < w - 14; x += 16) {
    if (Math.abs(x + 6 - cx) < 26) continue;
    pm.stand(F.PEW, x, b);
  }
}

// --- Modern facilities (Upper Story originals) ----------------------------------------

/** Roof facilities drawn open to the sky (no ceiling; transparent above the deck). */
export function isOpenAir(type: TenantType): boolean {
  return type === 'rooftopPool' || type === 'helipad' || type === 'observationDeck';
}

/** Mirror a PixMap left-right in place (whole-room layout flips). */
function mirror(pm: PixMap): void {
  const stride = pm.w * 4;
  const row = new Uint8Array(stride);
  for (let y = 0; y < pm.h; y++) {
    const off = y * stride;
    row.set(pm.data.subarray(off, off + stride));
    for (let x = 0; x < pm.w; x++) {
      const s = (pm.w - 1 - x) * 4;
      pm.data[off + x * 4] = row[s]!;
      pm.data[off + x * 4 + 1] = row[s + 1]!;
      pm.data[off + x * 4 + 2] = row[s + 2]!;
      pm.data[off + x * 4 + 3] = row[s + 3]!;
    }
  }
}

/** Paste with an optional horizontal flip (opaque pixels only). */
function pasteFlip(dst: PixMap, src: PixMap, x: number, y: number, flip: boolean): void {
  for (let yy = 0; yy < src.h; yy++) {
    for (let xx = 0; xx < src.w; xx++) {
      const c = src.get(flip ? src.w - 1 - xx : xx, yy);
      if (c >= 0) dst.set(x + xx, y + yy, c);
    }
  }
}

/** A small wall plate with pixel lettering (painted after any mirroring). */
function plate(pm: PixMap, x: number, y: number, text: string, bg: number, fg: number, border: number): void {
  const tw = textWidth(text);
  pm.rect(x, y, tw + 4, 7, bg);
  pm.hline(x, y, tw + 4, border);
  pm.hline(x, y + 6, tw + 4, shade(border, 0.3));
  paintText(pm, text, x + 2, y + 1, fg);
}

/** Fire engine, 62x16, cab at the right; the wheels touch the bottom row. */
function fireEngine(ladder: boolean, body: number): PixMap {
  const pm = new PixMap(62, 16);
  const dark = shade(body, 0.35), light = tint(body, 0.3);
  // Apparatus body with roller-shutter lockers and a reflective stripe.
  pm.rect(1, 4, 44, 9, body);
  pm.hline(1, 4, 44, light);
  pm.hline(1, 12, 44, dark);
  for (let x = 4; x + 10 < 44; x += 13) {
    pm.rect(x, 6, 10, 4, 0xc8ccd2);
    pm.hline(x, 6, 10, 0xe8ecf0);
    pm.hline(x, 8, 10, 0x9aa0a8);
  }
  pm.hline(1, 11, 44, 0xf0e8a0);
  // Cab: side window, windscreen, door seam, light bar.
  pm.rect(45, 2, 15, 11, body);
  pm.hline(45, 2, 15, light);
  pm.rect(46, 3, 5, 4, 0x68acdc);
  pm.set(46, 3, 0xbce2f8);
  pm.rect(53, 3, 6, 4, 0x68acdc);
  pm.set(54, 3, 0xbce2f8); pm.set(55, 4, 0xbce2f8);
  pm.vline(52, 3, 9, dark);
  pm.set(50, 8, light);
  pm.hline(45, 11, 15, 0xf0e8a0);
  pm.hline(47, 1, 4, 0xff3a2a);
  pm.hline(51, 1, 4, 0x3a6aff);
  // Bumper, headlight, chassis and wheels.
  pm.rect(59, 9, 3, 3, 0xcfd0d4);
  pm.set(60, 7, 0xfff4bc); pm.set(61, 7, 0xfff4bc);
  pm.hline(1, 13, 60, 0x26262a);
  for (const wx of [9, 22, 51]) {
    pm.disc(wx, 13, 2.4, 0x16161a);
    pm.set(wx, 13, 0x9c9ca4);
  }
  if (ladder) {
    // Aerial ladder bedded along the roof with its turntable.
    pm.hline(2, 1, 42, 0xcfd0d4);
    pm.hline(2, 3, 42, 0x9c9ca4);
    for (let x = 3; x < 44; x += 3) pm.set(x, 2, 0xcfd0d4);
    pm.rect(38, 0, 5, 4, 0x6c6c74);
    pm.hline(38, 0, 5, 0x9c9ca4);
  } else {
    // Pumper: hose bed and a roof monitor nozzle.
    pm.rect(4, 2, 30, 2, 0x8a6a40);
    for (let x = 5; x < 34; x += 2) pm.set(x, 2, 0xc8a060);
    pm.rect(38, 2, 2, 2, 0xcfd0d4);
    pm.hline(38, 1, 4, 0xcfd0d4);
  }
  return pm;
}

function fireStation(r: R): void {
  const { pm, w, base: b, wallBottom, v, th } = r;
  const wall = pick(r, [0xb05a40, 0xe4dccc, 0xc4c8cc] as const, 1);
  const brick = wall === 0xb05a40;
  const body = pick(r, [0xc8281e, 0xd23a26, 0xb21c26] as const, 2);
  shell(r, { wall, floor: 0x8c8a84, style: 'concrete', wallStyle: brick ? 'block' : 'wainscot', lower: 0xa83228, trim: 0x3a3a42 });
  const bayW = Math.min(150, w - 84);
  const bayX = 2;
  // Engine bay: roll-up door on the back wall, kerb stripe, the engine.
  const dx = bayX + 12, dw = bayW - 22;
  pm.rect(dx - 2, 5, dw + 4, wallBottom - 5, 0x5a5a62);
  pm.rect(dx, 6, dw, wallBottom - 6, 0xb4b8be);
  for (let y = 7; y < wallBottom; y += 2) pm.hline(dx, y, dw, 0x9298a0);
  pm.hline(dx, 6, dw, 0xd8dce0);
  for (let x = dx + 4; x + 6 < dx + dw - 2; x += 9) { pm.rect(x, 8, 6, 2, 0x68acdc); pm.set(x, 8, 0xbce2f8); }
  pm.rect(dx + Math.floor(dw / 2) - 3, wallBottom - 2, 6, 1, 0x3a3a42);
  for (let x = bayX + 1; x < bayX + bayW - 1; x++) pm.set(x, th - 4, ((x >> 2) & 1) ? 0xf0f0f0 : 0xc82820);
  for (let x = 20; x < bayW - 10; x += 44) pm.blit(F.CEILING_LIGHT, bayX + x, 2);
  const truck = fireEngine(pick(r, [true, false, true] as const, 3), body);
  pasteFlip(pm, truck, bayX + 18, b + 1 - truck.h, false);
  // Sliding pole down through a hole in the slab, and a wall hose reel.
  const px = bayX + 6;
  pm.rect(px - 2, 0, 6, 2, 0x16161a);
  pm.vline(px, 2, b - 2, 0xb08a28);
  pm.vline(px + 1, 2, b - 2, 0xf0d070);
  pm.rect(px - 3, b - 1, 8, 1, 0x3a3a42);
  pm.disc(bayX + bayW - 8, 10, 3.5, 0xc82820);
  pm.disc(bayX + bayW - 8, 10, 1.5, 0x5a1010);
  pm.vline(bayX + bayW - 5, 11, b - 12, 0xc82820);
  // Divider column between bay and crew room.
  const cx0 = bayX + bayW;
  pm.rect(cx0, 2, 3, wallBottom - 1, shade(wall, 0.25));
  pm.vline(cx0, 2, wallBottom - 1, shade(wall, 0.4));
  // Crew room: turnout gear on pegs, lockers, dispatch desk, alarm bell.
  let x = cx0 + 6;
  const helmets = pick(r, [[0xd8a020, 0xc82820, 0x26262a], [0x26262a, 0x26262a, 0xf0f0f0], [0xc82820, 0xc82820, 0xd8a020]] as const, 4);
  for (let k = 0; k < 3; k++, x += 9) {
    const hc = helmets[k]!;
    pm.set(x + 2, 5, 0x3a3a42);
    pm.rect(x + 1, 6, 3, 1, hc);
    pm.set(x + 1, 6, tint(hc, 0.4));
    pm.hline(x, 7, 5, hc);
    pm.hline(x - 1, 8, 7, shade(hc, 0.3));
    pm.rect(x, 9, 5, 7, 0xb89848);
    pm.vline(x + 2, 9, 7, 0x8a6a28);
    pm.hline(x, 12, 5, 0xf0f0a0);
    pm.hline(x, 14, 5, 0xc0c0c0);
    pm.rect(x, b - 3, 2, 3, 0x26262a);
    pm.rect(x + 3, b - 3, 2, 3, 0x26262a);
    pm.hline(x, b - 4, 5, 0xb89848);
  }
  pm.stand(F.LOCKER, x, b);
  pm.stand(F.LOCKER, x + 6, b);
  x += 15;
  if (x + 22 < w - 2) {
    desk(r, x, 20, 0x7a4a22);
    pm.stand(F.CRT, x + 3, b - 6);
    pm.rect(x + 14, b - 8, 4, 2, 0xc82820);
    pm.disc(x + 10, 6, 2.5, 0xc82820);
    pm.set(x + 10, 6, 0xffdc58);
    pm.vline(x + 10, 9, 1, 0x3a3a42);
  }
  pm.blit(F.CEILING_LIGHT, cx0 + 30, 2);
  if (v === 1) mirror(pm);
  // Signage after mirroring keeps the lettering readable.
  const sx = v === 1 ? 4 : w - 23;
  plate(pm, sx, 3, 'FIRE', 0xc82820, 0xffffff, 0xf08070);
}

function maintenance(r: R): void {
  const { pm, w, base: b, v, th } = r;
  const wall = pick(r, [0xa9b6a2, 0xcac2aa, 0x9eacbc] as const, 1);
  shell(r, { wall, floor: 0x7c7a72, style: 'concrete', wallStyle: pick(r, ['block', 'plain', 'wainscot'] as const, 2), lower: 0x6a7a6a });
  pm.blit(F.CEILING_LIGHT, 22, 2);
  pm.blit(F.CEILING_LIGHT, w - 34, 2);
  // Pegboard with tool silhouettes.
  const ax = 4;
  pm.rect(ax, 5, 44, 9, 0xc89a64);
  pm.hline(ax, 5, 44, 0xe0b880);
  for (let y = 6; y < 14; y += 2) for (let xx = ax + 1; xx < ax + 44; xx += 2) pm.set(xx, y, 0xa87a48);
  pm.line(ax + 3, 12, ax + 6, 7, 0x8a8e96);
  pm.set(ax + 6, 6, 0x8a8e96); pm.set(ax + 7, 7, 0x8a8e96); pm.set(ax + 2, 13, 0x8a8e96);
  pm.vline(ax + 11, 8, 5, 0x7a4a22);
  pm.rect(ax + 9, 7, 5, 2, 0x5a5e66);
  pm.rect(ax + 16, 8, 9, 3, 0xcfd0d4);
  for (let xx = ax + 16; xx < ax + 25; xx += 2) pm.set(xx, 10, 0x8a8e96);
  pm.rect(ax + 25, 8, 3, 3, 0xc82820);
  for (let k = 0; k < 4; k++) {
    pm.vline(ax + 31 + k * 2, 10, 3, 0x9c9ca4);
    pm.vline(ax + 31 + k * 2, 7, 3, [0xc82820, 0xf0c020, 0x3464bc, 0x44a03a][k]!);
  }
  pm.disc(ax + 41, 10, 1.5, 0xf0c020);
  // Workbench with vise, drawers and a toolbox.
  const wb = ax, wbw = 46;
  pm.hline(wb, b - 8, wbw, 0xb07a44);
  pm.hline(wb, b - 7, wbw, 0x7a4a22);
  pm.rect(wb + 1, b - 6, 2, 6, 0x45280f);
  pm.rect(wb + wbw - 3, b - 6, 2, 6, 0x45280f);
  pm.rect(wb + 26, b - 6, 12, 6, 0x9aa3ad);
  pm.hline(wb + 26, b - 4, 12, 0x6c7480);
  pm.hline(wb + 26, b - 2, 12, 0x6c7480);
  pm.rect(wb + 2, b - 11, 5, 3, 0x3a5a8a);
  pm.vline(wb + 4, b - 12, 1, 0x9c9ca4);
  pm.rect(wb + 14, b - 11, 9, 3, 0xc82820);
  pm.hline(wb + 14, b - 11, 9, 0xe85a4a);
  pm.hline(wb + 16, b - 12, 5, 0x26262a);
  // Rolling tool chest.
  const tx = ax + 50;
  pm.rect(tx, b - 13, 12, 12, 0xc82820);
  pm.hline(tx, b - 13, 12, 0xe85a4a);
  for (let y = b - 11; y < b - 2; y += 2) { pm.hline(tx + 1, y, 10, 0x8a1818); pm.hline(tx + 4, y - 1, 4, 0xcfd0d4); }
  pm.set(tx + 1, b - 1, 0x26262a); pm.set(tx + 10, b - 1, 0x26262a);
  // Spare elevator parts: a hoist sheave, a cable spool, a car door panel.
  const bx = tx + 18;
  if (bx + 40 < w - 2) {
    const sy = b - 7;
    pm.disc(bx + 6, sy, 6.4, 0x5a5e66);
    pm.disc(bx + 6, sy, 5, 0x9c9ca4);
    pm.disc(bx + 6, sy, 4, 0x6c7078);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI;
      pm.line(bx + 6 - Math.cos(a) * 4, sy - Math.sin(a) * 4, bx + 6 + Math.cos(a) * 4, sy + Math.sin(a) * 4, 0xb8bcc2);
    }
    pm.disc(bx + 6, sy, 1.4, 0x26262a);
    pm.disc(bx + 21, b - 6, 5.5, 0x6a4020);
    pm.rect(bx + 18, b - 9, 7, 7, 0x3a3a42);
    for (let y = b - 9; y < b - 2; y += 2) pm.hline(bx + 18, y, 7, 0x5a5a62);
    pm.vline(bx + 16, b - 11, 10, 0x8a5a2c);
    pm.vline(bx + 26, b - 11, 10, 0x8a5a2c);
    pm.rect(bx + 30, 7, 8, b - 7, 0xe8c860);
    pm.vline(bx + 31, 7, b - 7, 0xf6e7a6);
    pm.vline(bx + 37, 7, b - 7, 0xb08a28);
    pm.hline(bx + 30, 7, 8, 0xb08a28);
  }
  // Parts shelving with boxed motors.
  const shx = bx + 42;
  if (shx + 18 < w - 2) {
    pm.rect(shx, 5, 18, b - 5, 0x5a5e66);
    pm.rect(shx + 1, 6, 16, b - 7, 0x3a3e46);
    for (const y of [10, 15]) pm.hline(shx + 1, y, 16, 0x9c9ca4);
    pm.rect(shx + 2, 7, 6, 3, 0xb08a5a);
    pm.rect(shx + 9, 6, 7, 4, 0xb08a5a);
    pm.hline(shx + 9, 8, 7, 0x8a6a40);
    pm.rect(shx + 2, 12, 8, 3, 0x6c7078);
    for (let xx = shx + 2; xx < shx + 10; xx += 2) pm.set(xx, 12, 0x9c9ca4);
    pm.rect(shx + 11, 12, 5, 3, 0xb08a5a);
    pm.rect(shx + 3, b - 4, 12, 3, 0xd8a020);
  }
  // Hazard tape along the floor edge of the parts bay.
  for (let xx = tx - 2; xx < w - 2; xx++) pm.set(xx, th - 1, ((xx >> 2) & 1) ? 0x26262a : 0xf0c020);
  if (v === 1) mirror(pm);
}

function generator(r: R): void {
  const { pm, w, base: b, th } = r;
  shell(r, { wall: 0x9a988e, floor: 0x6a6a66, style: 'concrete', wallStyle: 'block' });
  const body = pick(r, [0x3f6a40, 0xd09a28] as const, 1);
  // Cable tray under the slab, fluorescent tubes.
  pm.hline(2, 2, w - 4, 0x3a3a42);
  pm.hline(2, 3, w - 4, 0x5a5a62);
  for (let x = 4; x < w - 4; x += 6) pm.set(x, 4, 0x5a5a62);
  pm.hline(40, 5, 14, 0xeef6ff);
  pm.hline(w - 60, 5, 14, 0xeef6ff);
  // Genset on its skid.
  const gx = 6, gw = 92;
  pm.rect(gx, b - 2, gw, 2, 0x3a3a42);
  pm.hline(gx, b - 2, gw, 0x6c6c74);
  pm.rect(gx + 2, b - 15, gw - 4, 13, body);
  pm.hline(gx + 2, b - 15, gw - 4, tint(body, 0.3));
  pm.hline(gx + 2, b - 3, gw - 4, shade(body, 0.35));
  for (let x = gx + 6; x < gx + 50; x += 4) for (let y = b - 12; y < b - 5; y += 2) pm.hline(x, y, 3, shade(body, 0.3));
  pm.vline(gx + 28, b - 14, 11, shade(body, 0.45));
  pm.vline(gx + 54, b - 14, 11, shade(body, 0.45));
  const rx = gx + gw - 22;
  pm.rect(rx, b - 16, 18, 14, 0x4a4e56);
  for (let x = rx + 1; x < rx + 17; x += 2) pm.vline(x, b - 15, 12, 0x6c7078);
  pm.disc(rx + 9, b - 9, 4.5, 0x30343c);
  pm.line(rx + 6, b - 12, rx + 12, b - 6, 0x8a8e96);
  pm.line(rx + 12, b - 12, rx + 6, b - 6, 0x8a8e96);
  pm.rect(gx + 58, b - 13, 8, 7, 0x26262a);
  pm.set(gx + 60, b - 11, 0x5ae07a);
  pm.set(gx + 63, b - 11, 0xff5a4a);
  pm.hline(gx + 59, b - 8, 6, 0xffb030);
  pm.rect(gx + 8, b - 6, 6, 3, 0xf0c020);
  pm.set(gx + 10, b - 5, 0x16161a); pm.set(gx + 11, b - 5, 0x16161a);
  // Exhaust stack up through the slab with a silencer.
  const ex = gx + 14;
  pm.rect(ex, 0, 3, b - 15, 0x7a7a80);
  pm.vline(ex, 0, b - 15, 0xa8a8b0);
  pm.rect(ex - 2, 6, 7, 5, 0x6c6c74);
  pm.hline(ex - 2, 6, 7, 0x9c9ca4);
  // Fuel tank on saddles, with a feed pipe to the set.
  const tank = pick(r, [0xc8ccd0, 0xb83a2a] as const, 2);
  const tx = gx + gw + 10;
  if (tx + 44 < w - 30) {
    pm.disc(tx + 4, b - 7, 4, shade(tank, 0.1));
    pm.disc(tx + 38, b - 7, 4, shade(tank, 0.1));
    pm.rect(tx + 4, b - 11, 34, 9, tank);
    pm.hline(tx + 4, b - 10, 34, tint(tank, 0.4));
    pm.hline(tx + 4, b - 3, 34, shade(tank, 0.3));
    for (const bx of [tx + 12, tx + 30]) pm.vline(bx, b - 11, 9, shade(tank, 0.25));
    pm.rect(tx + 8, b - 2, 3, 2, 0x3a3a42);
    pm.rect(tx + 32, b - 2, 3, 2, 0x3a3a42);
    pm.vline(tx + 20, b - 13, 2, 0x5a5a62);
    pm.hline(gx + gw - 2, b - 1, tx - gx - gw + 4, 0x3a3a42);
  }
  // Control and transfer-switch panel.
  const cx = w - 26;
  pm.rect(cx, b - 17, 18, 17, 0x8a96a4);
  pm.hline(cx, b - 17, 18, 0xb4c0cc);
  pm.vline(cx + 17, b - 17, 17, 0x5a6470);
  pm.vline(cx + 9, b - 15, 15, 0x6a7684);
  for (const gxp of [cx + 4, cx + 13]) {
    pm.disc(gxp, b - 13, 2, 0xf4f4f4);
    pm.set(gxp, b - 14, 0xc82820);
    pm.set(gxp, b - 13, 0x26262a);
  }
  pm.set(cx + 3, b - 9, 0x5ae07a); pm.set(cx + 5, b - 9, 0xffb030); pm.set(cx + 12, b - 9, 0xff5a4a);
  pm.rect(cx + 12, b - 7, 3, 4, 0x26262a);
  pm.rect(cx + 2, b - 6, 6, 3, 0x26262a);
  pm.hline(cx + 3, b - 5, 4, 0x5ae07a);
  pm.rect(cx - 12, 6, 9, 9, 0x6a7686);
  pm.line(cx - 7, 7, cx - 9, 10, 0xf0c020);
  pm.line(cx - 9, 10, cx - 6, 10, 0xf0c020);
  pm.line(cx - 6, 10, cx - 8, 13, 0xf0c020);
  // Hazard markings on the floor round the set.
  for (let x = gx; x < gx + gw; x++) if (((x >> 2) & 1) === 0) pm.set(x, th - 1, 0xf0c020);
}

function bank(r: R): void {
  const { pm, w, base: b, wallBottom, v } = r;
  const wall = pick(r, [0xece4d0, 0xdfe6dc, 0xe4e0dc, 0xf0e6d6] as const, 1);
  const marble = pick(r, [0x8a9a8a, 0xa89a80, 0x7a8a9a, 0x9a7a6a] as const, 2);
  const wood = pick(r, [0x5a3418, 0x6b4426, 0x3a2a20, 0x7a4a2a] as const, 3);
  const vaultOpen = pick(r, [false, true, false] as const, 4);
  shell(r, { wall, floor: 0xe2dccc, floor2: 0xb8ae98, style: 'marble', wallStyle: 'wainscot', lower: marble, trim: shade(marble, 0.4) });
  pm.hline(0, 2, w, 0x8a6a2a);
  pm.hline(0, 3, w, 0xd8bc78);
  pm.hline(0, 4, w, 0xb89a5a);
  // Queue posts with sagging rope.
  const posts = [8, 22, 36, 50];
  for (let i = 0; i < posts.length; i++) {
    const x = posts[i]!;
    pm.vline(x, b - 8, 8, 0xd0a028);
    pm.set(x, b - 9, 0xffdc58);
    pm.hline(x - 1, b - 1, 3, 0xa07818);
    const next = posts[i + 1];
    if (next === undefined) break;
    for (let t = 1; t < next - x; t++) pm.set(x + t, b - 7 + Math.round(Math.sin((Math.PI * t) / (next - x)) * 1.6), 0xa82030);
  }
  // Teller counter behind glass with numbered windows.
  const cx = 64, cw = Math.max(60, w - 120);
  const glassTop = 7, counterTop = b - 10;
  pm.rect(cx, glassTop, cw, counterTop - glassTop, mix(wall, 0xcfe6f2, 0.55));
  pm.dither(cx, glassTop, cw, counterTop - glassTop, 0xdcf0fa);
  for (let x = cx + 4; x < cx + cw - 6; x += 9) pm.line(x, counterTop - 2, x + 4, glassTop + 1, 0xf2fbff);
  pm.hline(cx, glassTop - 1, cw, 0xb08a3a);
  const windows = Math.max(2, Math.floor(cw / 30));
  const pitch = cw / windows;
  for (let k = 0; k <= windows; k++) pm.vline(Math.round(cx + k * pitch) - (k === windows ? 1 : 0), glassTop - 1, counterTop - glassTop + 1, 0xb08a3a);
  for (let k = 0; k < windows; k++) {
    const mx = Math.round(cx + (k + 0.5) * pitch);
    pm.rect(mx - 3, counterTop - 3, 7, 3, shade(wall, 0.25));
    pm.hline(mx - 3, counterTop - 4, 7, 0xb08a3a);
    pm.stand(F.CRT, mx + 4, counterTop + 1);
  }
  pm.rect(cx - 1, counterTop, cw + 2, b - counterTop, wood);
  pm.hline(cx - 2, counterTop, cw + 4, 0xece6da);
  pm.hline(cx - 2, counterTop + 1, cw + 4, 0xb8b0a0);
  for (let x = cx + 6; x < cx + cw - 4; x += 16) pm.rect(x, counterTop + 3, 10, b - counterTop - 5, tint(wood, 0.15));
  // Vault: riveted steel wall with a round door (sometimes open, showing gold).
  const vx = cx + cw + 6, vw = w - vx - 4;
  if (vw >= 24) {
    pm.rect(vx, 5, vw, wallBottom - 5, 0x6c707a);
    pm.hline(vx, 5, vw, 0x9aa0aa);
    for (let y = 7; y < wallBottom; y += 4) for (let x = vx + 2; x < vx + vw - 1; x += 5) pm.set(x, y, 0x9aa0aa);
    const dcx = vx + Math.floor(vw / 2) - (vaultOpen ? 4 : 0), dcy = 11;
    if (vaultOpen) {
      pm.disc(dcx, dcy, 6.5, 0x16161a);
      for (let row = 0; row < 3; row++) {
        for (let k = -1; k <= 1; k++) {
          const gx = dcx + k * 4 + (row % 2 ? 2 : 0), gy = dcy + 3 - row * 2;
          if (row === 2 && k !== 0) continue;
          pm.hline(gx - 1, gy, 3, 0xffdc58);
          pm.hline(gx - 1, gy + 1, 3, 0xb08010);
        }
      }
      pm.disc(dcx + 12, dcy, 3, 0xa8acb4);
      pm.vline(dcx + 10, dcy - 7, 15, 0xc4c8ce);
      pm.vline(dcx + 11, dcy - 7, 15, 0x8a8e96);
    } else {
      pm.disc(dcx, dcy, 8.5, 0x3a3e46);
      pm.disc(dcx, dcy, 7, 0xa8acb4);
      pm.disc(dcx, dcy, 5.5, 0xc4c8ce);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        pm.set(Math.round(dcx + Math.cos(a) * 6.3), Math.round(dcy + Math.sin(a) * 6.3), 0x6c707a);
      }
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI;
        pm.line(dcx - Math.cos(a) * 4, dcy - Math.sin(a) * 4, dcx + Math.cos(a) * 4, dcy + Math.sin(a) * 4, 0x3a3e46);
      }
      pm.disc(dcx, dcy, 1.4, 0xd0a028);
    }
  }
  pm.blit(F.CLOCK, 38, 6);
  for (let x = cx + 20; x < cx + cw - 10; x += 60) pm.blit(F.PENDANT, x, 4);
  plant(r, 54, true);
  if (v === 1) mirror(pm);
  const sx = v === 1 ? w - 33 : 10;
  plate(pm, sx, 6, 'BANK', 0x1e3a5a, 0xffdc58, 0xd0a028);
  for (let k = 0; k < windows; k++) {
    const mx = Math.round(cx + (k + 0.5) * pitch);
    const nx = v === 1 ? w - 1 - mx : mx;
    plateNumber(pm, nx - 3, glassTop + 1, k + 1);
  }
}

function plateNumber(pm: PixMap, x: number, y: number, n: number): void {
  pm.rect(x, y, 7, 7, 0x24582a);
  pm.hline(x, y, 7, 0x44a03a);
  paintText(pm, String(n % 10), x + 2, y + 1, 0xffffff);
}

/** Water rectangle of a rooftop pool (room-local), shared with the ripple overlay. */
export function poolWater(w: number, h: number, variant: number): { x: number; y: number; w: number; h: number } {
  const th = Math.max(4, h - 2);
  const v = variant % Math.max(1, variantCount('rooftopPool'));
  const pw = Math.max(40, Math.min(w - 120, 220));
  const px = v === 0 ? Math.floor((w - pw) / 2) : 34;
  return { x: px + 2, y: 13, w: pw - 4, h: th - 14 };
}

function lounger(pm: PixMap, x: number, base: number, cushion: number, flip: boolean): void {
  const X = (dx: number): number => (flip ? x + 13 - dx : x + dx);
  for (let dx = 0; dx < 9; dx++) pm.set(X(dx), base - 4, (dx & 1) ? cushion : tint(cushion, 0.45));
  for (let dx = 0; dx < 10; dx++) pm.set(X(dx), base - 3, 0xe8ecf0);
  for (let k = 0; k < 4; k++) { pm.set(X(9 + k), base - 5 - k, cushion); pm.set(X(10 + k), base - 5 - k, 0xe8ecf0); }
  for (const dx of [1, 8]) { pm.set(X(dx), base - 2, 0x9c9ca4); pm.set(X(dx), base - 1, 0x9c9ca4); }
}

function umbrella(pm: PixMap, x: number, base: number, a: number, b2: number): void {
  pm.vline(x, 4, base - 4, 0xe8e8e8);
  const widths = [2, 5, 7, 8];
  for (let k = 0; k < widths.length; k++) {
    const half = widths[k]!;
    for (let dx = -half; dx <= half; dx++) pm.set(x + dx, 2 + k, ((dx + 16) >> 2) & 1 ? a : b2);
  }
  for (let dx = -8; dx <= 8; dx += 2) pm.set(x + dx, 6, shade(a, 0.3));
  pm.set(x, 1, 0xe8e8e8);
  pm.hline(x - 1, base - 1, 3, 0x6c6c74);
}

function rooftopPool(r: R): void {
  const { pm, w, th, base: b, v } = r;
  const wooden = pick(r, [false, true, false, true] as const, 1);
  const deck = wooden ? pick(r, [0xb8875a, 0xa8784a] as const, 2) : pick(r, [0xe6dcc4, 0xd8d4cc] as const, 2);
  const [ua, ub] = pick(r, [[0xd83a3a, 0xf4f4f4], [0x2f6fb0, 0xf4f4f4], [0xf0a020, 0x2a8a8a], [0x44a03a, 0xf0e0a0]] as const, 3);
  const cushion = pick(r, [0x3464bc, 0xd8603a, 0x2a8a8a, 0xe8c040] as const, 4);
  const glassRail = pick(r, [true, false] as const, 5);
  floorStrip(r, deck, wooden ? 'wood' : 'tile');
  // Parapet with a railing along the back edge; the sky shows above it.
  const rail = 0xd8dde2, railDark = 0x8a929c;
  pm.rect(0, th - 7, w, 3, shade(deck, 0.12));
  pm.hline(0, th - 7, w, tint(deck, 0.25));
  if (glassRail) for (let x = 0; x < w; x++) for (let y = 11; y < th - 7; y++) if (((x + y) & 3) === 0) pm.set(x, y, 0xcfe8f4);
  pm.hline(0, 9, w, rail);
  pm.hline(0, 10, w, railDark);
  if (!glassRail) pm.hline(0, 13, w, railDark);
  for (let x = 1; x < w; x += 12) pm.vline(x, 9, th - 16, railDark);
  // The pool basin in section: tiled walls and coping, water inside.
  const water = poolWater(w, th + 2, v);
  const px = water.x - 2, pw = water.w + 4;
  pm.rect(px, 11, pw, th - 11, 0xe8f0f4);
  for (let x = px; x < px + pw; x += 4) pm.vline(x, 13, th - 13, 0xc8d8e0);
  pm.hline(px - 1, 11, pw + 2, 0xffffff);
  pm.hline(px - 1, 12, pw + 2, 0xb8c8d2);
  pm.rect(water.x, water.y, water.w, water.h, 0x2a8ed0);
  pm.hline(water.x, water.y, water.w, 0x9fdcf4);
  pm.dither(water.x, water.y + 1, water.w, 1, 0x5ab8e8);
  pm.sparse(water.x, water.y + 2, water.w, water.h - 3, 0x3aa0dc);
  pm.dither(water.x, water.y + water.h - 1, water.w, 1, 0x1e74b8);
  for (let x = water.x + 6; x < water.x + water.w - 6; x += 10) pm.hline(x, water.y + water.h - 1, 5, 0x1a5a9a);
  // Chrome ladder at one end, steps at the other.
  const lx = px + 5;
  pm.vline(lx, 7, 8, 0xe8ecf0); pm.vline(lx + 3, 7, 8, 0xe8ecf0);
  pm.hline(lx, 6, 4, 0xe8ecf0);
  for (let y = 15; y < th - 2; y += 2) pm.hline(lx, y, 4, 0xb8c0c8);
  for (let k = 0; k < 3; k++) pm.rect(px + pw - 4 - k * 3, th - 2 - k * 2, 3 + k * 3, 2, 0xe8f0f4);
  // Loungers, umbrellas and palms on the deck either side.
  const left: [number, number] = [8, px - 4], right: [number, number] = [px + pw + 4, w - 10];
  if (v === 1) right[1] -= 38;
  for (const [x0, x1] of [left, right]) {
    if (x1 - x0 < 20) continue;
    let x = x0 + 2, k = 0;
    while (x + 14 <= x1) {
      if (k % 3 === 1) { umbrella(pm, x + 6, b, ua, ub); x += 14; }
      else { lounger(pm, x, b, cushion, x0 > px); x += 16; }
      k++;
    }
  }
  if (v === 1) {
    // Cabana bar with a thatched roof.
    const cx = w - 46;
    pm.rect(cx, 4, 32, 4, 0xd8b060);
    pm.dither(cx, 4, 32, 4, 0xb08a40);
    for (let x = cx; x < cx + 32; x += 2) pm.set(x, 8, 0xb08a40);
    pm.vline(cx + 2, 8, b - 8, 0x7a4a22);
    pm.vline(cx + 29, 8, b - 8, 0x7a4a22);
    pm.rect(cx + 5, b - 8, 22, 8, 0x8a5a2c);
    pm.hline(cx + 4, b - 9, 24, 0xc8a070);
    for (let x = cx + 8; x < cx + 26; x += 6) pm.set(x, b - 10, [0xff8030, 0xe85a9a, 0x8cd05c][(x >> 1) % 3]!);
    pm.blit(F.PENDANT, cx + 14, 8);
  }
  plant(r, 1, true);
  plant(r, w - 10, true);
}

/**
 * Touchdown point of a helipad of the given footprint, room-local: x is the
 * pad centre and y the row the skids rest on. The helicopter itself is an
 * animated sprite drawn over the room, so the pad art keeps this area clear.
 */
export function helipadTouchdown(w: number, h: number): { x: number; y: number } {
  const th = Math.max(4, h - 2);
  const top = 11, bot = th - 5;
  return { x: Math.floor(w / 2), y: Math.floor((top + bot) / 2) + 1 };
}

function helipad(r: R): void {
  const { pm, w, th, v } = r;
  const S = sty(r, [
    { pad: 0x50545c, ring: 0xf0c020, mark: 0xf4f4f4, edge: 0xe8e8e8, light: 0x5aff7a, truss: 0x34383f },
    { pad: 0x3e5446, ring: 0xf4f4f4, mark: 0xf0c020, edge: 0xf0c020, light: 0x5ab4ff, truss: 0x3a3e38 },
    { pad: 0x5a4e4a, ring: 0xf4f4f4, mark: 0xd82020, edge: 0xf4f4f4, light: 0xffd040, truss: 0x3a3430 },
  ] as const);
  // Steel truss deck carrying the pad.
  pm.rect(0, th - 4, w, 4, S.truss);
  pm.hline(0, th - 4, w, tint(S.truss, 0.3));
  pm.hline(0, th - 1, w, tint(S.truss, 0.3));
  for (let x = 0; x < w; x += 8) {
    pm.line(x, th - 4, x + 4, th - 1, tint(S.truss, 0.2));
    pm.line(x + 4, th - 1, x + 8, th - 4, tint(S.truss, 0.2));
  }
  // Pad surface in perspective, with perimeter dashes and lights.
  const top = 11, bot = th - 5;
  pm.rect(2, top, w - 4, bot - top + 1, S.pad);
  pm.sparse(2, top, w - 4, bot - top + 1, tint(S.pad, 0.08));
  pm.hline(2, top, w - 4, tint(S.pad, 0.15));
  pm.hline(2, bot, w - 4, tint(S.pad, 0.3));
  for (let x = 6; x < w - 6; x += 8) { pm.hline(x, top + 1, 4, S.edge); pm.hline(x, bot - 1, 4, S.edge); }
  for (let x = 4; x < w - 2; x += 12) { pm.set(x, bot, S.light); pm.set(x + 6, top, S.light); }
  // Touchdown circle (flattened by perspective) and the H.
  const cx = Math.floor(w / 2), cy = Math.floor((top + bot) / 2);
  const rx = Math.min(40, Math.floor(w / 4)), ry = (bot - top) / 2 - 0.6;
  for (let i = 0; i < 360; i++) {
    const a = (i / 360) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(a) * rx), y = Math.round(cy + Math.sin(a) * ry);
    pm.set(x, y, S.ring);
    pm.set(x + (Math.cos(a) > 0 ? -1 : 1), y, S.ring);
  }
  const hy = top + 2, hh = bot - top - 3;
  pm.rect(cx - 7, hy, 2, hh, S.mark);
  pm.rect(cx + 5, hy, 2, hh, S.mark);
  pm.rect(cx - 5, hy + Math.floor(hh / 2), 10, 1, S.mark);
  // Floodlight posts and safety railings at the ends.
  for (const x of [3, w - 5]) {
    const inward = x < cx ? 3 : -3;
    pm.vline(x, 4, top - 4, 0x8a8e96);
    pm.rect(x - 1, 3, 3, 2, 0x3a3a42);
    pm.hline(x - 1, 5, 3, 0xfff4bc);
    pm.vline(x + inward, 8, top - 8, 0x9c9ca4);
    pm.hline(Math.min(x, x + inward), 8, 4, 0x9c9ca4);
  }
  // Windsock on a mast, clear of the touchdown circle.
  const mx = v === 0 ? w - 22 : 20;
  const dir = v === 0 ? -1 : 1;
  pm.vline(mx, 1, top - 1, 0x9c9ca4);
  pm.set(mx, 0, 0xff3a2a);
  for (let k = 0; k < 12; k++) {
    const hgt = 4 - Math.floor(k / 4);
    pm.vline(mx + dir * (k + 1), 2 + Math.floor(k / 5), hgt, (k >> 2) % 2 ? 0xf4f4f4 : 0xf07018);
  }
}

// --- Second-wave facilities (Upper Story originals) -------------------------------

/** Exposed brick across part of the back wall. */
function brickWall(r: R, x0: number, x1: number, brick: number): void {
  const { pm, wallBottom } = r;
  pm.rect(x0, 3, x1 - x0, wallBottom - 3, brick);
  const mortar = tint(brick, 0.32);
  for (let y = 5, i = 0; y < wallBottom; y += 3, i++) {
    pm.hline(x0, y, x1 - x0, mortar);
    for (let x = x0 + (i % 2 ? 2 : 5); x < x1; x += 6) pm.vline(x, y - 2, 2, mortar);
  }
  pm.sparse(x0, 3, x1 - x0, wallBottom - 3, shade(brick, 0.14), 1);
  pm.hline(x0, 3, x1 - x0, shade(brick, 0.35));
}

/** Back-wall window onto the sky, optionally with curtains. */
function wallWindow(r: R, x: number, wd: number, frame: number, curtain?: number): void {
  const { pm } = r;
  pm.rect(x, 5, wd, 9, frame);
  pm.rect(x + 1, 6, wd - 2, 7, 0x9fd0f0);
  pm.dither(x + 1, 6, wd - 2, 3, 0xc4e4f8);
  pm.vline(x + (wd >> 1), 6, 7, frame);
  if (curtain !== undefined) {
    pm.rect(x - 2, 4, 3, 11, curtain);
    pm.rect(x + wd - 1, 4, 3, 11, curtain);
    pm.vline(x - 1, 4, 11, shade(curtain, 0.25));
    pm.vline(x + wd, 4, 11, shade(curtain, 0.25));
  }
}

/** Front door of a rental flat, with a brass number plate beside it. */
function flatDoor(r: R, x: number, paint: number, n: number): void {
  const { pm, base: b } = r;
  pm.rect(x, 4, 10, b - 4, shade(paint, 0.35));
  pm.rect(x + 1, 5, 8, b - 5, paint);
  pm.rect(x + 2, 7, 6, 4, shade(paint, 0.12));
  pm.rect(x + 2, 13, 6, b - 15, shade(paint, 0.12));
  pm.set(x + 7, 12, 0xd0a028);
  pm.set(x + 4, 6, 0x16161a); // peephole
  pm.rect(x + 11, 6, 5, 7, 0xd0a028);
  paintText(pm, String(n % 10), x + 12, 7, 0x45280f);
}

function radiator(r: R, x: number): void {
  const { pm, base: b } = r;
  pm.rect(x, b - 7, 11, 6, 0xd8d8d0);
  for (let k = 1; k < 11; k += 2) pm.vline(x + k, b - 7, 6, 0xb0b0a8);
  pm.hline(x, b - 7, 11, 0xf0f0e8);
  pm.set(x + 1, b - 1, 0x6c6c74);
  pm.set(x + 9, b - 1, 0x6c6c74);
}

/** Galley kitchen: counter with sink and hob, a spice shelf, fridge at one end. */
function kitchenette(r: R, x: number, len: number, cab: number, fridgeRight: boolean): void {
  const { pm, base: b } = r;
  const cx = fridgeRight ? x : x + 10;
  pm.rect(cx, b - 7, len, 7, cab);
  pm.hline(cx, b - 8, len, 0x6c6c74);
  for (let k = cx + 1; k < cx + len - 4; k += 6) { pm.rect(k, b - 6, 5, 5, shade(cab, 0.15)); pm.set(k + 2, b - 4, 0x45280f); }
  pm.rect(cx + 3, b - 9, 6, 1, 0xb8c0c8); // sink
  pm.vline(cx + 5, b - 12, 3, 0x9c9ca4);
  pm.set(cx + 6, b - 12, 0x9c9ca4);
  pm.stand(F.STOVE, cx + len - 10, b);
  pm.hline(cx, 8, len, shade(cab, 0.3));
  for (let k = cx + 1; k < cx + len - 2; k += 4) pm.rect(k, 6, 2, 2, [0xc83030, 0xe2d2a8, 0x3464bc, 0x44a03a][(k >> 2) % 4]!);
  pm.stand(F.FRIDGE, fridgeRight ? cx + len + 1 : x, b);
}

/** Folding clothes airer with the week's washing. */
function dryingRack(r: R, x: number, seed: number): void {
  const { pm, base: b } = r;
  pm.line(x, b - 1, x + 6, b - 9, 0x9c9ca4);
  pm.line(x + 12, b - 1, x + 6, b - 9, 0x9c9ca4);
  pm.hline(x + 1, b - 8, 11, 0xcfd0d4);
  for (let k = 0; k < 4; k++) pm.rect(x + 1 + k * 3, b - 7, 2, 3 + (hash32(seed + k) % 2), BOOK_COLORS[hash32(seed * 7 + k) % BOOK_COLORS.length]!);
}

function apartment(r: R): void {
  const { pm, w, base: b, v } = r;
  const S = sty(r, [
    { wall: 0xe8dcc6, brick: 0xa85a3c, floor: 0x9a6a38, style: 'wood', walls: 'plain', acc: 0x3f6fb0, door: 0x2a5a8a },
    { wall: 0xdfe6cf, brick: 0, floor: 0x7a8a6a, style: 'carpet', walls: 'paper', acc: 0xc0503a, door: 0x8a5a2c },
    { wall: 0xd8e0ec, brick: 0, floor: 0xb8bcc4, style: 'tile', walls: 'stripe', acc: 0xc9952f, door: 0x3a3a42 },
    { wall: 0xf0d8d0, brick: 0x8a4a34, floor: 0x7a4a2a, style: 'parquet', walls: 'plain', acc: 0x2a8a8a, door: 0x24582a },
    { wall: 0xe6dccc, brick: 0, floor: 0x86685a, style: 'carpet', walls: 'wainscot', acc: 0x7a4fb0, door: 0xa83030 },
    { wall: 0xe8e0f0, brick: 0, floor: 0xa06a38, style: 'wood', walls: 'block', acc: 0x4f9a5a, door: 0x6a6a72 },
  ] as const);
  shell(r, { wall: S.wall, floor: S.floor, style: S.style, wallStyle: S.walls });
  const cab = pick(r, [0xe0d4b4, 0xd8dde2, 0xc8b8a0, 0xe8e8e0] as const, 3);
  const acc2 = pick(r, ACCENTS.filter(c => c !== S.acc), 4);
  const n = 1 + (hash32(r.s * 31 + v) % 9);
  if (v === 0) {
    // Studio: entry door, bed under the window, table for two, galley kitchen.
    if (S.brick) brickWall(r, 20, 100, S.brick);
    flatDoor(r, 3, S.door, n);
    wallWindow(r, 44, 20, 0x8a8270, acc2);
    bed(r, 22, 22, S.acc, 0x6b4426);
    radiator(r, 50);
    nightstand(r, 64);
    pm.stand(F.CAFE_TABLE, 84, b, { inks: accent(0xa86c36) });
    pm.stand(F.STOOL, 79, b, { inks: accent(S.acc) });
    pm.stand(F.STOOL, 94, b, { inks: accent(S.acc) });
    pm.blit(F.PENDANT, 86, 2);
    dryingRack(r, 103, r.s);
    kitchenette(r, w - 66, 50, cab, true);
  } else {
    // One-bed: kitchen first, a sofa and TV by the window, a desk, then the door.
    kitchenette(r, 4, 44, cab, false);
    if (S.brick) brickWall(r, 62, 120, S.brick);
    wallWindow(r, 76, 22, 0x8a8270, acc2);
    pm.stand(F.SOFA, 64, b, { inks: accent(S.acc) });
    pm.stand(F.TV, 100, b);
    plant(r, 113);
    desk(r, 124, 20, 0xa86c36);
    pm.stand(F.TABLE_LAMP, 125, b - 6);
    pm.hline(133, b - 7, 6, 0x3a3a42); // laptop
    pm.set(134, b - 8, 0x68acdc);
    pm.stand(F.OFFICE_CHAIR, 144, b, { inks: accent(acc2), flip: true });
    pm.blit(F.SMALL_PICTURE, 128, 5);
    flatDoor(r, w - 20, S.door, n);
  }
}

// Gym equipment, side-on.
function treadmill(pm: PixMap, x: number, b: number, c: number): void {
  pm.hline(x, b - 3, 16, 0x3a3a42);
  pm.hline(x, b - 2, 16, 0x26262a);
  pm.set(x + 1, b - 1, 0x6c6c74);
  pm.set(x + 14, b - 1, 0x6c6c74);
  pm.vline(x + 15, b - 12, 9, 0x9c9ca4);
  pm.hline(x + 9, b - 9, 6, 0x9c9ca4);
  pm.rect(x + 13, b - 14, 5, 3, c);
  pm.set(x + 14, b - 13, 0x8cd05c);
  pm.set(x + 16, b - 13, 0xffdc58);
}

function exerciseBike(pm: PixMap, x: number, b: number, c: number): void {
  pm.hline(x, b - 1, 12, 0x3a3a42);
  pm.disc(x + 3, b - 4, 2, 0x3a3a42);
  pm.set(x + 3, b - 4, 0x9c9ca4);
  pm.line(x + 3, b - 4, x + 6, b - 9, c);
  pm.line(x + 6, b - 4, x + 10, b - 10, c);
  pm.vline(x + 6, b - 4, 3, c);
  pm.hline(x + 4, b - 10, 4, 0x16161a);
  pm.hline(x + 9, b - 11, 3, 0x16161a);
}

function weightRack(pm: PixMap, x: number, b: number, wd: number): void {
  for (const y of [b - 9, b - 4]) {
    pm.hline(x, y, wd, 0x6c6c74);
    for (let k = x + 1; k + 3 < x + wd; k += 4) {
      const big = ((k - x) >> 2) % 2;
      pm.vline(k, y - 2 - big, 2 + big, 0x26262a);
      pm.hline(k, y - 1, 3, 0x9c9ca4);
      pm.vline(k + 2, y - 2 - big, 2 + big, 0x26262a);
    }
  }
  pm.vline(x, b - 9, 9, 0x6c6c74);
  pm.vline(x + wd - 1, b - 9, 9, 0x6c6c74);
}

function benchPress(pm: PixMap, x: number, b: number, c: number): void {
  pm.rect(x + 2, b - 5, 11, 2, c);
  pm.hline(x + 2, b - 5, 11, tint(c, 0.3));
  pm.vline(x + 4, b - 3, 3, 0x6c6c74);
  pm.vline(x + 11, b - 3, 3, 0x6c6c74);
  pm.vline(x + 1, b - 12, 12, 0x9c9ca4);
  pm.vline(x + 13, b - 12, 12, 0x9c9ca4);
  pm.hline(x - 3, b - 12, 21, 0xcfd0d4);
  pm.rect(x - 3, b - 14, 2, 5, 0x26262a);
  pm.rect(x + 16, b - 14, 2, 5, 0x26262a);
}

function punchBag(pm: PixMap, x: number, c: number): void {
  pm.vline(x + 2, 2, 3, 0x9c9ca4);
  pm.rect(x, 5, 5, 11, c);
  pm.vline(x, 5, 11, tint(c, 0.3));
  pm.vline(x + 4, 5, 11, shade(c, 0.3));
  pm.hline(x, 7, 5, shade(c, 0.4));
  pm.hline(x, 14, 5, shade(c, 0.4));
}

/** Mirrored wall panel with diagonal highlights. */
function mirrorPanel(pm: PixMap, x: number, wd: number, top: number, bottom: number): void {
  pm.rect(x, top, wd, bottom - top, 0xcfe2ec);
  pm.hline(x, top, wd, 0x9c9ca4);
  pm.hline(x, bottom, wd, 0x9c9ca4);
  for (let k = x + 4; k < x + wd - 4; k += 14) pm.line(k, bottom - 1, k + 4, top + 1, 0xf0f8fc);
}

function gym(r: R): void {
  const { pm, w, base: b, v, wallBottom } = r;
  const S = sty(r, [
    { wall: 0xe8e8e2, floor: 0x3a3a42, style: 'concrete', stripe: 0xd0603a, kit: 0xc83030, name: 'FIT' },
    { wall: 0xdfe7da, floor: 0xb88a50, style: 'wood', stripe: 0x2a8a8a, kit: 0x3464bc, name: 'PEAK' },
    { wall: 0x4a5260, floor: 0x2f4f7a, style: 'concrete', stripe: 0xf0c020, kit: 0xf0c020, name: 'IRON' },
    { wall: 0xf0e6e0, floor: 0x5a5a62, style: 'tile', stripe: 0x7a4fb0, kit: 0xd06a9a, name: 'FLEX' },
  ] as const);
  shell(r, { wall: S.wall, floor: S.floor, style: S.style });
  pm.rect(2, wallBottom - 3, w - 4, 2, S.stripe);
  for (let x = 20; x < w - 20; x += 60) if (v !== 0 || x < 110 || x > 160) pm.blit(F.CEILING_LIGHT, x, 2);
  plate(pm, v === 0 ? 122 : w - textWidth(S.name) - 52, v === 0 ? 2 : 4, S.name, S.stripe, 0xffffff, tint(S.stripe, 0.4));
  if (v === 0) {
    mirrorPanel(pm, 6, 106, 4, wallBottom - 4);
    for (let k = 0; k < 4; k++) treadmill(pm, 8 + k * 24, b, S.kit);
    weightRack(pm, 118, b, 30);
    benchPress(pm, 160, b, S.kit);
    for (let k = 0; k < 3; k++) pm.stand(F.LOCKER, w - 26 + k * 6, b);
  } else {
    for (let k = 0; k < 3; k++) pm.stand(F.LOCKER, 4 + k * 6, b);
    mirrorPanel(pm, 26, 96, 4, wallBottom - 4);
    for (let k = 0; k < 6; k++) exerciseBike(pm, 26 + k * 15, b, S.kit);
    punchBag(pm, 126, S.kit);
    // Mats and a pair of exercise balls.
    for (let k = 0; k < 3; k++) pm.hline(140 + k * 14, b - 1, 12, [S.kit, S.stripe, 0x44a03a][k]!);
    pm.disc(186, b - 4, 3, S.stripe);
    pm.disc(194, b - 3, 2, S.kit);
    weightRack(pm, w - 34, b, 26);
  }
  pm.blit(F.CLOCK, v === 0 ? 196 : 104, 4);
}

const PRODUCT_COLORS = [0xc83030, 0xe07020, 0xffdc58, 0x44a03a, 0x3464bc, 0xe2d2a8, 0xd06a9a, 0xf4f4f4, 0x5c2c88, 0x8cd05c];

/** Shelving gondola stacked with packets. */
function gondola(pm: PixMap, x: number, wd: number, b: number, seed: number): void {
  pm.rect(x, b - 15, wd, 15, 0xc8ccd2);
  pm.vline(x, b - 15, 15, 0x9c9ca4);
  pm.vline(x + wd - 1, b - 15, 15, 0x9c9ca4);
  for (const y of [b - 14, b - 10, b - 6]) {
    pm.hline(x + 1, y + 3, wd - 2, 0x8a8e96);
    // Facings of packets: runs of one product, two pixels wide.
    for (let k = x + 2; k + 2 < x + wd - 1; k += 3) {
      const hv = hash32(seed + Math.floor(k / 9) * 13 + y * 7);
      const tall = (hv >> 5) % 2;
      pm.rect(k, y + 1 - tall, 2, 2 + tall, PRODUCT_COLORS[(hv >> 9) % PRODUCT_COLORS.length]!);
    }
  }
  pm.hline(x, b - 15, wd, 0xe8ecf0);
  pm.rect(x + 1, b - 2, wd - 2, 2, 0x6c6c74);
}

/** Upright chiller with glass doors. */
function chiller(pm: PixMap, x: number, wd: number, b: number, seed: number): void {
  pm.rect(x, b - 16, wd, 16, 0xe8ecf0);
  pm.hline(x + 1, b - 15, wd - 2, 0xeef6ff);
  pm.rect(x + 1, b - 13, wd - 2, 11, 0xbcd8e8);
  for (const y of [b - 12, b - 8, b - 4]) {
    for (let k = x + 2; k < x + wd - 2; k += 2) pm.vline(k, y, 2, PRODUCT_COLORS[hash32(seed + k + y * 3) % PRODUCT_COLORS.length]!);
    pm.hline(x + 1, y + 2, wd - 2, 0x9cb8c8);
  }
  for (let k = x; k < x + wd; k += 10) pm.vline(k, b - 13, 11, 0x9c9ca4);
  pm.dither(x + 1, b - 13, wd - 2, 2, 0xe0f0f8);
  pm.rect(x, b - 2, wd, 2, 0x6c6c74);
}

/** Tilted crates of fruit and vegetables. */
function produce(pm: PixMap, x: number, wd: number, b: number, seed: number): void {
  pm.rect(x, b - 6, wd, 6, 0x8a5a2c);
  for (let k = x; k < x + wd; k += 12) pm.vline(k, b - 6, 6, 0x5a3818);
  for (let k = x + 1; k < x + wd - 1; k++) {
    const crate = Math.floor((k - x) / 12);
    const c = [0xc83030, 0xe07020, 0x44a03a, 0xffdc58, 0x8cd05c, 0x5c2c88][hash32(seed + crate) % 6]!;
    pm.vline(k, b - 9, 3, (k + crate) % 3 === 0 ? shade(c, 0.25) : c);
    if (k % 2) pm.set(k, b - 10, tint(c, 0.25));
  }
}

function checkout(pm: PixMap, x: number, b: number, lane: number, c: number): void {
  pm.rect(x, b - 7, 20, 7, 0xb8bcc4);
  pm.hline(x, b - 8, 20, 0x26262a);
  pm.hline(x, b - 7, 20, 0x6c6c74);
  pm.stand(F.REGISTER, x + 13, b - 8);
  pm.vline(x + 2, 8, b - 16, 0x9c9ca4);
  pm.rect(x, 7, 5, 7, c);
  paintText(pm, String(lane % 10), x + 1, 8, 0xffffff);
}

function cart(pm: PixMap, x: number, b: number): void {
  pm.rect(x, b - 8, 9, 5, 0xcfd0d4);
  pm.rect(x + 1, b - 7, 7, 3, 0x9c9ca4);
  for (let k = x + 2; k < x + 8; k += 2) pm.vline(k, b - 7, 3, 0xcfd0d4);
  pm.line(x + 9, b - 8, x + 11, b - 10, 0x9c9ca4);
  pm.hline(x + 1, b - 3, 8, 0x9c9ca4);
  pm.set(x + 1, b - 1, 0x26262a);
  pm.set(x + 7, b - 1, 0x26262a);
}

function supermarket(r: R): void {
  const { pm, w, base: b, v } = r;
  const S = sty(r, [
    { wall: 0xf4f0e6, floor: 0xe0d8d0, band: 0x3f9a58, name: 'FRESH' },
    { wall: 0xe8eef4, floor: 0xd8dcdc, band: 0xc0503a, name: 'MARKET' },
    { wall: 0xf4ecd8, floor: 0xc8b8a0, band: 0x2f6fb0, name: 'MINI MART' },
    { wall: 0xeef2e4, floor: 0xe8e4dc, band: 0xd08a20, name: 'FARM' },
  ] as const);
  shell(r, { wall: S.wall, floor: S.floor, style: 'check', floor2: shade(S.floor, 0.12) });
  // Fluorescent tubes and the shop's colour band along the top of the wall.
  for (let x = 12; x < w - 12; x += 34) pm.hline(x, 2, 14, 0xeef6ff);
  pm.rect(2, 4, w - 4, 2, S.band);
  if (v === 0) {
    produce(pm, 4, 72, b, r.s);
    for (let x = 86; x + 40 <= w - 96; x += 46) gondola(pm, x, 40, b, x * 7 + r.s);
    checkout(pm, w - 90, b, 1, S.band);
    checkout(pm, w - 62, b, 2, S.band);
    for (let k = 0; k < 3; k++) cart(pm, w - 32 + k * 4, b);
  } else {
    checkout(pm, 6, b, 1, S.band);
    checkout(pm, 34, b, 2, S.band);
    cart(pm, 60, b);
    for (let x = 76; x + 40 <= w - 110; x += 46) gondola(pm, x, 40, b, x * 5 + r.s);
    chiller(pm, w - 106, 60, b, r.s);
    produce(pm, w - 42, 38, b, r.s + 9);
  }
  const sx = v === 0 ? 10 : w - textWidth(S.name) - 16;
  plate(pm, sx, 3, S.name, S.band, 0xffffff, tint(S.band, 0.4));
}

/** Back bar: mirror and bottle shelves, with a counter and stools in front. */
function backBar(r: R, x: number, wd: number, wood: number, stool: number, seed: number): void {
  const { pm, base: b } = r;
  pm.rect(x, 4, wd, 10, shade(wood, 0.45));
  pm.rect(x + 2, 5, wd - 4, 8, 0x8aa0b0);
  pm.dither(x + 2, 5, wd - 4, 8, 0x6a8090);
  for (const y of [8, 12]) {
    pm.hline(x + 1, y + 1, wd - 2, wood);
    for (let k = x + 3; k < x + wd - 3; k += 2) {
      const hv = hash32(seed + k * 11 + y);
      if (hv % 5 === 0) continue;
      const c = [0x2a6a3a, 0x8a4a22, 0xe2d2a8, 0x7c1820, 0x68acdc, 0xd0a028][hv % 6]!;
      pm.vline(k, y - 2, 3, c);
      pm.set(k, y - 3, shade(c, 0.4));
    }
  }
  pm.rect(x, b - 8, wd, 8, wood);
  pm.hline(x - 1, b - 9, wd + 2, tint(wood, 0.35));
  pm.hline(x, b - 7, wd, shade(wood, 0.25));
  for (let k = x + 4; k < x + wd - 4; k += 8) pm.vline(k, b - 6, 5, shade(wood, 0.2));
  pm.rect(x + 6, b - 11, 2, 2, 0xcfd0d4); // beer tap
  pm.vline(x + 7, b - 13, 2, 0xd0a028);
  for (let k = x + 4; k + 4 < x + wd; k += 11) pm.stand(F.STOOL, k, b, { inks: accent(stool) });
  for (let k = x + 8; k < x + wd - 4; k += 22) pm.blit(F.PENDANT, k, 2);
}

function poolTable(pm: PixMap, x: number, b: number, felt: number): void {
  pm.rect(x, b - 8, 30, 3, 0x6b4426);
  pm.hline(x + 1, b - 8, 28, felt);
  pm.hline(x, b - 9, 30, 0x8a5a2c);
  pm.rect(x + 2, b - 5, 2, 5, 0x5a3818);
  pm.rect(x + 26, b - 5, 2, 5, 0x5a3818);
  for (const [dx, c] of [[8, 0xffffff], [16, 0xc83030], [19, 0xffdc58], [22, 0x16161a]] as const) pm.set(x + dx, b - 10, c);
  pm.line(x + 30, b - 14, x + 18, b - 10, 0xd09a58);
}

function jukebox(pm: PixMap, x: number, b: number, c: number): void {
  pm.rect(x, b - 15, 10, 15, shade(c, 0.3));
  pm.rect(x + 1, b - 14, 8, 4, 0xffd75a);
  pm.rect(x + 2, b - 9, 6, 5, 0x16161a);
  for (let k = 0; k < 3; k++) pm.hline(x + 2, b - 8 + k * 2, 6, [0xc83030, 0x68acdc, 0x8cd05c][k]!);
  pm.hline(x, b - 15, 10, tint(c, 0.3));
}

function bar(r: R): void {
  const { pm, w, base: b, v } = r;
  const S = sty(r, [
    { wall: 0x4a3030, walls: 'panel', floor: 0x5a3818, wood: 0x8a5a2c, neon: 0xff5aa8, booth: 0x7c1820 },
    { wall: 0x6a3a2a, walls: 'block', floor: 0x3a3a42, wood: 0x6b4426, neon: 0x5ad8ff, booth: 0x24582a },
    { wall: 0x24403a, walls: 'wainscot', floor: 0x6a4a2a, wood: 0xa86c36, neon: 0xffd75a, booth: 0x5c2c88 },
    { wall: 0x26304a, walls: 'stripe', floor: 0x4a3a30, wood: 0x7a4a22, neon: 0xff8030, booth: 0xa83030 },
  ] as const);
  shell(r, { wall: S.wall, floor: S.floor, style: 'parquet', wallStyle: S.walls, lower: shade(S.wall, 0.25) });
  const neon = (x: number): void => {
    pm.rect(x - 2, 5, textWidth('BAR') + 4, 7, shade(S.wall, 0.4));
    paintText(pm, 'BAR', x, 6, S.neon);
    pm.hline(x - 1, 12, textWidth('BAR') + 2, shade(S.neon, 0.5));
  };
  if (v === 0) {
    backBar(r, 6, 110, S.wood, S.booth, r.s);
    // Booth seating around a small table.
    const bx = w - 66;
    pm.rect(bx, b - 11, 4, 11, S.booth);
    pm.rect(bx + 4, b - 5, 10, 2, S.booth);
    pm.stand(F.CAFE_TABLE, bx + 16, b, { inks: accent(S.wood) });
    pm.rect(bx + 29, b - 5, 10, 2, S.booth);
    pm.rect(bx + 39, b - 11, 4, 11, S.booth);
    pm.blit(F.PENDANT, bx + 18, 2);
    neon(bx + 16);
    plant(r, w - 14);
  } else {
    jukebox(pm, 6, b, S.booth);
    poolTable(pm, 22, b, pick(r, [0x2a7a3a, 0x2a4a8a, 0x8a2a2a] as const, 7));
    pm.blit(F.PENDANT, 34, 2);
    // Dartboard.
    pm.disc(70, 9, 3, 0x16161a);
    pm.disc(70, 9, 2, 0xc83030);
    pm.set(70, 9, 0x44a03a);
    neon(56 - 10);
    backBar(r, 80, w - 88, S.wood, S.booth, r.s + 3);
  }
}

/** Projection screen showing a chart. */
function projectionScreen(pm: PixMap, x: number, wd: number, acc: number): void {
  pm.hline(x - 1, 3, wd + 2, 0x3a3a42);
  pm.rect(x, 4, wd, 10, 0xf4f4f4);
  pm.rect(x, 13, wd, 1, 0xcfd0d4);
  for (let k = 0; k < 5; k++) pm.vline(x + 4 + k * 5, 12 - k, k + 1, k % 2 ? acc : shade(acc, 0.3));
  pm.line(x + 3, 10, x + wd - 4, 5, 0xc83030);
}

function lectern(pm: PixMap, x: number, b: number, wood: number): void {
  pm.rect(x, b - 9, 7, 9, wood);
  pm.hline(x - 1, b - 10, 9, tint(wood, 0.3));
  pm.vline(x + 6, b - 9, 9, shade(wood, 0.3));
  pm.vline(x + 5, b - 13, 3, 0x3a3a42); // microphone
  pm.set(x + 4, b - 13, 0x16161a);
}

function conference(r: R): void {
  const { pm, w, base: b, v } = r;
  const S = sty(r, [
    { wall: 0xdfe2e6, walls: 'panel', lower: 0x8a6a4a, floor: 0x5a2a3a, acc: 0x3f6fb0, seat: 0x3a3a62 },
    { wall: 0xe8e2cc, walls: 'wainscot', lower: 0x6b4426, floor: 0x2a4a6a, acc: 0xc9952f, seat: 0x7c1820 },
    { wall: 0xd8dde8, walls: 'plain', lower: 0x9aa3ad, floor: 0x4a5a3a, acc: 0x2a8a8a, seat: 0x24282c },
    { wall: 0xefe4d2, walls: 'stripe', lower: 0x8a5a2c, floor: 0x6a4a6a, acc: 0xc0503a, seat: 0x2a5a4a },
  ] as const);
  shell(r, { wall: S.wall, floor: S.floor, style: 'carpet', wallStyle: S.walls, lower: S.lower });
  const fancy = r.s % 2 === 1;
  for (let x = 100; x < w - 20; x += 64) pm.blit(fancy ? F.CHANDELIER : F.CEILING_LIGHT, x, 2);
  if (v === 0) {
    // Lecture layout: stage, screen and lectern at the left; rows of seats.
    pm.rect(2, b - 3, 80, 3, shade(S.lower, 0.1));
    pm.hline(2, b - 3, 80, tint(S.lower, 0.3));
    projectionScreen(pm, 16, 40, S.acc);
    lectern(pm, 64, b - 3, S.lower);
    pm.stand(F.TALL_PLANT, 4, b - 3);
    for (let x = 92; x + 6 < w - 22; x += 9) pm.stand(F.DINING_CHAIR_L, x, b, { inks: accent(S.seat) });
    plate(pm, w - 40, 5, 'EXPO', S.acc, 0xffffff, tint(S.acc, 0.4));
    pm.stand(F.WATER_COOLER, w - 14, b);
  } else {
    // Meeting layout: registration desk, two long tables, flip chart and screen.
    pm.rect(6, b - 7, 26, 7, S.acc);
    pm.hline(6, b - 8, 26, tint(S.acc, 0.4));
    pm.rect(9, b - 10, 4, 2, 0xf4f4f4); // name badges
    pm.rect(15, b - 10, 4, 2, 0xf4f4f4);
    plate(pm, 8, 5, 'HALL', S.acc, 0xffffff, tint(S.acc, 0.4));
    const len = Math.floor((w - 150) / 2);
    for (const tx of [44, 54 + len]) {
      for (let x = tx; x + 6 < tx + len; x += 12) pm.stand(F.OFFICE_CHAIR, x, b, { inks: accent(S.seat) });
      pm.rect(tx + 2, b - 7, len, 2, 0xf4f4f4);
      pm.rect(tx + 2, b - 5, len, 2, 0xe2e2dc);
      pm.vline(tx + 4, b - 3, 3, 0x6c6c74);
      pm.vline(tx + len - 1, b - 3, 3, 0x6c6c74);
      for (let x = tx + 8; x < tx + len - 4; x += 16) { pm.vline(x, b - 10, 3, 0xbce2f8); pm.set(x + 3, b - 8, 0xf4f4f4); }
    }
    // Flip chart on an easel.
    const fx = w - 84;
    pm.line(fx, b - 1, fx + 4, b - 15, 0x6b4426);
    pm.line(fx + 9, b - 1, fx + 5, b - 15, 0x6b4426);
    pm.rect(fx + 1, b - 16, 8, 9, 0xf4f4f4);
    pm.hline(fx + 2, b - 14, 5, S.acc);
    pm.hline(fx + 2, b - 12, 4, 0x3a3a42);
    projectionScreen(pm, w - 66, 40, S.acc);
    plant(r, w - 14, true);
  }
}

/** Coin-operated viewer on a post. */
function towerViewer(pm: PixMap, x: number, b: number, c: number, flip: boolean): void {
  pm.hline(x - 1, b - 1, 4, 0x6c6c74);
  pm.vline(x + 1, b - 9, 8, 0x6c6c74);
  pm.rect(x - 1, b - 13, 5, 4, c);
  pm.hline(x - 1, b - 13, 5, tint(c, 0.3));
  pm.set(flip ? x - 2 : x + 4, b - 12, 0x16161a);
  pm.set(flip ? x - 2 : x + 4, b - 11, 0x16161a);
  pm.set(x + 1, b - 10, 0xd0a028);
}

/** Glass pavilion with the ticket kiosk inside. */
function pavilion(r: R, x: number, wd: number, frame: number, name: string): void {
  const { pm, base: b } = r;
  pm.rect(x, 3, wd, 2, frame);
  pm.hline(x - 2, 2, wd + 4, tint(frame, 0.3));
  pm.rect(x, 5, wd, b - 5, 0xbcd8e8);
  pm.dither(x, 5, wd, b - 5, 0xd8ecf6);
  for (let k = x; k < x + wd; k += 12) pm.vline(k, 5, b - 5, frame);
  pm.vline(x + wd - 1, 5, b - 5, frame);
  pm.rect(x + 6, b - 7, 18, 7, shade(frame, 0.2));
  pm.hline(x + 5, b - 8, 20, tint(frame, 0.4));
  pm.blit(F.CEILING_LIGHT, x + 10, 5);
  plate(pm, x + Math.floor((wd - textWidth(name) - 4) / 2), 7, name, frame, 0xffffff, tint(frame, 0.4));
}

function observationDeck(r: R): void {
  const { pm, w, th, base: b, v } = r;
  const S = sty(r, [
    { deck: 0xd8d4cc, style: 'tile', frame: 0x3a5a7a, viewer: 0x2a8a8a, flag: 0xc83030, name: 'VISTA' },
    { deck: 0xb8875a, style: 'wood', frame: 0x4a4a52, viewer: 0x3464bc, flag: 0xf0c020, name: 'TOP' },
    { deck: 0xa8a8a0, style: 'concrete', frame: 0x2a5a4a, viewer: 0xd08a20, flag: 0x3f6fb0, name: 'VISTA' },
  ] as const);
  floorStrip(r, S.deck, S.style);
  // Glass balustrade along the edge; the sky shows above it.
  pm.rect(0, th - 7, w, 3, shade(S.deck, 0.12));
  pm.hline(0, th - 7, w, tint(S.deck, 0.25));
  for (let x = 0; x < w; x++) for (let y = 11; y < th - 7; y++) if (((x + y) & 3) === 0) pm.set(x, y, 0xcfe8f4);
  pm.hline(0, 9, w, 0xd8dde2);
  pm.hline(0, 10, w, 0x8a929c);
  for (let x = 1; x < w; x += 16) pm.vline(x, 9, th - 16, 0x8a929c);
  const px = v === 0 ? (w >> 1) - 40 : w - 100;
  pavilion(r, px, 80, S.frame, S.name);
  // Flagpoles at the ends.
  for (const x of [3, w - 4]) {
    pm.vline(x, 0, b, 0xcfd0d4);
    pm.rect(x + (x < 10 ? 1 : -8), 1, 7, 4, S.flag);
    pm.hline(x + (x < 10 ? 1 : -8), 3, 7, shade(S.flag, 0.3));
  }
  // Viewers, benches and planters either side of the pavilion.
  for (const [x0, x1] of [[v === 1 ? 56 : 10, px - 6], [px + 86, w - 10]] as const) {
    let x = x0 + 4, k = 0;
    while (x + 16 <= x1) {
      if (k % 3 === 1) { pm.stand(F.BENCH, x, b, { inks: accent(S.frame) }); x += 22; }
      else if (k % 3 === 2) { plant(r, x, true); x += 14; }
      else { towerViewer(pm, x + 2, b, S.viewer, x > px); x += 14; }
      k++;
    }
  }
  if (v === 1) {
    // A telescope on its tripod at the far end.
    const tx = 30;
    pm.line(tx, b - 1, tx + 3, b - 8, 0x3a3a42);
    pm.line(tx + 6, b - 1, tx + 3, b - 8, 0x3a3a42);
    pm.line(tx + 1, b - 12, tx + 9, b - 15, 0xe8e8e8);
    pm.line(tx + 1, b - 11, tx + 9, b - 14, 0xb8c0c8);
    pm.line(tx + 3, b - 8, tx + 4, b - 12, 0x3a3a42);
  }
}
