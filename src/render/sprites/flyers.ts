import type { Texture } from 'pixi.js';
import { PixMap, frameTexture, mix } from './pixmap';

/**
 * Seasonal sky visitors (original pixel art): Santa's sleigh with three
 * reindeer for the end of the year, and a witch on a broom for Halloween.
 * Two frames each (galloping legs / fluttering cape), facing right. The
 * witch carries a moon-lit rim and crosses a full moon so she reads at night.
 */

export interface FlyerFrames {
  frames: Texture[];
  w: number;
  h: number;
}

const BROWN = 0x7a4a22, BROWN_D = 0x4a2a12, ANTLER = 0xc8a070;

function reindeer(pm: PixMap, x: number, y: number, frame: number, nose: number): void {
  // Body, neck, head with antlers; legs alternate per frame.
  pm.rect(x, y + 3, 9, 4, BROWN);
  pm.hline(x, y + 3, 9, 0x9a6232);
  pm.hline(x + 1, y + 6, 7, BROWN_D);
  pm.set(x - 1, y + 3, 0xf0e8d8); // tail
  pm.rect(x + 8, y + 1, 2, 3, BROWN);
  pm.rect(x + 9, y, 3, 2, BROWN);
  pm.set(x + 12, y + 1, nose);
  pm.set(x + 10, y, 0x16161a);
  pm.set(x + 9, y - 1, ANTLER); pm.set(x + 8, y - 2, ANTLER); pm.set(x + 10, y - 2, ANTLER); pm.set(x + 9, y - 3, ANTLER);
  if (frame === 0) {
    pm.line(x + 1, y + 7, x - 1, y + 9, BROWN_D);
    pm.line(x + 7, y + 7, x + 9, y + 9, BROWN_D);
  } else {
    pm.vline(x + 2, y + 7, 2, BROWN_D);
    pm.vline(x + 6, y + 7, 2, BROWN_D);
    pm.set(x + 3, y + 9, BROWN_D); pm.set(x + 7, y + 9, BROWN_D);
  }
}

function santaFrame(pm: PixMap, ox: number, frame: number): void {
  // Sleigh at the back (left), reindeer team pulling to the right.
  const sy = 6;
  pm.rect(ox + 2, sy + 4, 18, 6, 0xc8281e);
  pm.hline(ox + 2, sy + 4, 18, 0xe85a4a);
  pm.rect(ox, sy + 1, 4, 9, 0xc8281e);
  pm.hline(ox, sy + 1, 4, 0xe85a4a);
  pm.hline(ox + 2, sy + 7, 18, 0xffdc58);
  pm.hline(ox + 1, sy + 12, 22, 0xd0a028);
  pm.set(ox + 23, sy + 11, 0xd0a028); pm.set(ox + 24, sy + 10, 0xd0a028);
  pm.set(ox + 5, sy + 11, 0xd0a028); pm.set(ox + 16, sy + 11, 0xd0a028);
  // Sack of presents.
  pm.rect(ox + 4, sy, 6, 5, 0x8a5a2c);
  pm.hline(ox + 5, sy - 1, 4, 0x8a5a2c);
  pm.set(ox + 6, sy + 1, 0x44a03a); pm.set(ox + 8, sy + 2, 0x3464bc);
  // Santa: hat with bobble, face, beard, red coat, belt.
  pm.rect(ox + 12, sy - 4, 5, 2, 0xc8281e);
  pm.set(ox + 11, sy - 3, 0xc8281e);
  pm.set(ox + 10, sy - 3, 0xffffff);
  pm.hline(ox + 12, sy - 2, 6, 0xffffff);
  pm.rect(ox + 13, sy - 1, 4, 2, 0xf2bc94);
  pm.set(ox + 16, sy - 1, 0x16161a);
  pm.rect(ox + 12, sy + 1, 6, 2, 0xffffff);
  pm.rect(ox + 12, sy + 3, 6, 2, 0xc8281e);
  pm.hline(ox + 12, sy + 3, 6, 0x16161a);
  pm.set(ox + 18, sy + 2, 0xc8281e); pm.set(ox + 19, sy + 2, 0xf2bc94);
  // Reins to the team.
  pm.line(ox + 19, sy + 2, ox + 34, sy + 2, 0x5a3418);
  for (let k = 0; k < 3; k++) {
    const rx = ox + 28 + k * 15;
    reindeer(pm, rx, sy - 1 + ((k + frame) % 2), (k + frame) % 2, k === 2 ? 0xff2a2a : 0x2a1a10);
    if (k > 0) pm.line(rx - 4, sy + 3, rx, sy + 3, 0x5a3418);
  }
}

const MOONLIGHT = 0xd8e6ff;

function witchFrame(pm: PixMap, ox: number, frame: number): void {
  const by = 17;
  // Broom: straw bristles at the back, the stick forward.
  pm.line(ox + 6, by, ox + 30, by - 2, 0x9a6232);
  pm.line(ox + 7, by + 1, ox + 29, by - 1, 0x5a3418);
  for (let k = 0; k < 7; k++) pm.line(ox + 6, by - 1 + Math.floor(k / 2), ox, by - 3 + k, k % 2 ? 0xf0c868 : 0xc89a48);
  pm.vline(ox + 6, by - 2, 4, 0xc8281e); // binding
  // Robe and fluttering cape (lifted purples so they read on a night sky).
  pm.rect(ox + 12, by - 7, 6, 6, 0x4a2c6a);
  pm.vline(ox + 17, by - 7, 6, 0x6a40a0);
  pm.rect(ox + 13, by - 2, 4, 3, 0x4a2c6a);
  const cape = frame === 0 ? [[11, by - 6], [9, by - 5], [7, by - 4], [6, by - 3]] : [[11, by - 6], [9, by - 6], [7, by - 6], [5, by - 5]];
  for (const [cx, cy] of cape) pm.vline(ox + cx!, cy!, 3, 0x7a3cb0);
  for (const [cx, cy] of cape) pm.set(ox + cx! + 1, cy! + 1, 0x7a3cb0);
  // Boots with a buckle, hands, face, hat with an orange band.
  pm.rect(ox + 17, by, 3, 1, 0x16161a);
  pm.set(ox + 18, by, 0xffdc58);
  pm.rect(ox + 19, by - 4, 2, 1, 0x9ae06a);
  pm.rect(ox + 15, by - 10, 3, 3, 0x9ae06a);
  pm.set(ox + 18, by - 9, 0x9ae06a);
  pm.set(ox + 19, by - 8, 0x9ae06a); // nose
  pm.set(ox + 17, by - 9, 0x16161a);
  pm.hline(ox + 11, by - 11, 10, 0x26203a);
  pm.rect(ox + 14, by - 13, 4, 2, 0x26203a);
  pm.rect(ox + 15, by - 15, 2, 2, 0x26203a);
  pm.set(ox + 14, by - 16 + frame, 0x26203a);
  pm.set(ox + 13, by - 17 + frame * 2, 0x26203a);
  pm.hline(ox + 14, by - 12, 4, 0xff8a28);
  pm.vline(ox + 12, by - 10, 4, 0x8a8a96); // grey hair
  pm.vline(ox + 13, by - 9, 2, 0x8a8a96);
  // A black cat riding at the back, with bright glowing eyes.
  pm.rect(ox + 7, by - 4, 4, 2, 0x16161a);
  pm.rect(ox + 7, by - 6, 3, 2, 0x16161a);
  pm.set(ox + 7, by - 7, 0x16161a); pm.set(ox + 9, by - 7, 0x16161a);
  pm.set(ox + 8, by - 5, 0xfff04a); pm.set(ox + 9, by - 5, 0xfff04a);
  pm.line(ox + 6, by - 3, ox + 4, by - 6 + frame, 0x16161a);
}

/**
 * Moon-lit rim: every opaque pixel whose top or right neighbour is
 * transparent is lifted toward a cool moonlight, outlining the silhouette.
 * Glowing details (eyes, buckle) stay as painted.
 */
function moonRim(pm: PixMap): void {
  const keep = new Set([0xfff04a, 0xffdc58, 0xff8a28]);
  const edge: [number, number, number][] = [];
  for (let y = 0; y < pm.h; y++) {
    for (let x = 0; x < pm.w; x++) {
      const c = pm.get(x, y);
      if (c < 0 || keep.has(c)) continue;
      if (pm.get(x, y - 1) < 0 || pm.get(x + 1, y) < 0) edge.push([x, y, c]);
    }
  }
  for (const [x, y, c] of edge) pm.set(x, y, mix(c, MOONLIGHT, 0.55));
}

function build(w: number, h: number, paint: (pm: PixMap, ox: number, frame: number) => void, post?: (pm: PixMap) => void): FlyerFrames {
  const pm = new PixMap(w * 2 + 1, h);
  paint(pm, 0, 0);
  paint(pm, w + 1, 1);
  post?.(pm);
  const texture = pm.texture();
  return { frames: [frameTexture(texture, 0, 0, w, h), frameTexture(texture, w + 1, 0, w, h)], w, h };
}

let santa: FlyerFrames | null = null;
let witch: FlyerFrames | null = null;

export function santaFrames(): FlyerFrames {
  santa ??= build(72, 20, (pm, ox, frame) => santaFrame(pm, ox, frame));
  return santa;
}

export function witchFrames(): FlyerFrames {
  witch ??= build(32, 21, (pm, ox, frame) => witchFrame(pm, ox, frame), moonRim);
  return witch;
}

export interface MoonArt {
  moon: Texture;
  halo: Texture;
  /** Size of both textures (square). */
  size: number;
}

let moon: MoonArt | null = null;

/** A full moon with soft craters, plus a dithered halo disc drawn faintly behind it. */
export function moonArt(): MoonArt {
  if (moon) return moon;
  const size = 48, c = size / 2 - 0.5;
  const disc = new PixMap(size, size);
  disc.disc(c, c, 14, 0xf6f0cc);
  // Terminator shade on the lower left, craters, a bright upper-right limb.
  disc.map((col, x, y) => ((x - c) + (y - c) * -1 < -14 ? mix(col, 0xc8c098, 0.6) : col));
  for (const [x, y, r] of [[19, 17, 2.4], [28, 26, 3], [22, 29, 1.6], [30, 18, 1.4], [17, 25, 1.2]] as const) {
    for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) {
      for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
        const col = disc.get(xx, yy);
        if (col >= 0 && (xx - x) ** 2 + (yy - y) ** 2 <= r * r) disc.set(xx, yy, mix(col, 0xb8b088, 0.45));
      }
    }
  }
  const halo = new PixMap(size, size);
  halo.disc(c, c, 23, 0xd8e6ff);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d > 18 && ((x + y) & 1) === 1) halo.clear(x, y);
    }
  }
  moon = { moon: disc.texture(), halo: halo.texture(), size };
  return moon;
}
