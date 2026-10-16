import type { Texture } from 'pixi.js';
import { PixMap, frameTexture, shade, tint } from './pixmap';

/**
 * Helipad helicopters (original pixel art), facing right: a body per livery
 * (executive red, navy charter, medevac white with a red cross) and separate
 * main-rotor and tail-rotor frames, so the rotor can spin up, blur and slow
 * to a stop independently of the airframe. Everything lives on one atlas.
 *
 * Geometry (body texture, 58x14): the main-rotor row is row 0 (left empty
 * on the body; the rotor frames are 58x1 and drawn on it), the mast hub sits
 * at x 27, the tail rotor centres on (1, 4), the skids are the bottom row.
 */

export const HELI_W = 58;
export const HELI_H = 14;
/** Tail rotor frame size and its top-left on the body. */
export const TAIL_SIZE = 5;
export const TAIL_X = -1;
export const TAIL_Y = 2;

export type Livery = 'executive' | 'charter' | 'medevac';
export const LIVERIES: readonly Livery[] = ['executive', 'charter', 'medevac'];

const LIVERY_COLOR: Record<Livery, number> = {
  executive: 0xc83030,
  charter: 0x2a3f6a,
  medevac: 0xf0f0f0,
};

export interface HeliArt {
  body: Record<Livery, Texture>;
  /** Main rotor: [0] stopped blades, [1..3] spinning (blurred) frames. */
  rotor: Texture[];
  /** Tail rotor: [0] stopped, [1..2] spinning. */
  tail: Texture[];
}

function paintBody(pm: PixMap, ox: number, oy: number, livery: Livery): void {
  const body = LIVERY_COLOR[livery];
  const medevac = livery === 'medevac';
  const set = (x: number, y: number, c: number): void => pm.set(ox + x, oy + y, c);
  const rect = (x: number, y: number, w: number, h: number, c: number): void => { pm.rect(ox + x, oy + y, w, h, c); };
  // Mast and engine cowling.
  rect(26, 1, 3, 1, 0x3a3a42);
  rect(27, 1, 1, 2, 0x3a3a42);
  rect(20, 2, 12, 2, shade(body, 0.15));
  rect(22, 2, 6, 1, tint(body, 0.2));
  // Cabin.
  rect(16, 4, 20, 7, body);
  rect(14, 5, 2, 5, body);
  rect(36, 5, 4, 5, body);
  rect(16, 4, 20, 1, tint(body, 0.35));
  rect(36, 5, 3, 1, tint(body, 0.35));
  // Windscreen and cabin window with a glint.
  rect(33, 5, 6, 4, 0x68acdc);
  set(34, 5, 0xbce2f8); set(35, 6, 0xbce2f8);
  rect(26, 5, 5, 4, 0x68acdc);
  set(27, 5, 0xbce2f8);
  rect(16, 10, 24, 1, shade(body, 0.35));
  // Tail boom and fin.
  rect(2, 6, 12, 1, body);
  rect(2, 7, 12, 1, shade(body, 0.3));
  rect(1, 3, 1, 5, body);
  rect(2, 4, 1, 2, body);
  if (medevac) {
    // Red cross on the cabin door and a red stripe down the boom.
    rect(19, 6, 5, 1, 0xd82020);
    rect(21, 5, 1, 3, 0xd82020);
    rect(4, 6, 8, 1, 0xd82020);
  } else {
    rect(16, 8, 24, 1, tint(body, 0.55));
    rect(4, 6, 8, 1, tint(body, 0.25));
  }
  // Skids on struts.
  set(19, 11, 0x26262a); set(19, 12, 0x26262a);
  set(33, 11, 0x26262a); set(33, 12, 0x26262a);
  rect(14, 13, 26, 1, 0x26262a);
  set(13, 12, 0x26262a); set(40, 12, 0x26262a);
}

function paintRotor(pm: PixMap, ox: number, oy: number, frame: number): void {
  if (frame === 0) {
    // Stopped: a long dark blade pair across the hub.
    pm.hline(ox + 2, oy, 54, 0x26262a);
    pm.hline(ox + 24, oy, 6, 0x3a3a42);
    return;
  }
  // Spinning: foreshortened blades with a light blur, cycling lengths.
  const half = frame === 1 ? 27 : frame === 2 ? 16 : 22;
  for (let x = 27 - half; x <= 27 + half; x++) {
    const d = Math.abs(x - 27);
    const blur = ((x + frame) % 3) === 0 ? 0xc8ccd4 : 0x8a8e96;
    pm.set(ox + x, oy, d > half - 4 ? blur : 0x4a4a52);
  }
  pm.set(ox + 27, oy, 0x26262a);
}

function paintTail(pm: PixMap, ox: number, oy: number, frame: number): void {
  const c = 0x3a3a42;
  if (frame === 0) { pm.vline(ox + 2, oy, 5, c); return; }
  if (frame === 1) { pm.hline(ox, oy + 2, 5, 0x8a8e96); pm.set(ox + 2, oy + 2, c); return; }
  pm.line(ox, oy, ox + 4, oy + 4, 0x8a8e96);
  pm.line(ox + 4, oy, ox, oy + 4, 0x8a8e96);
  pm.set(ox + 2, oy + 2, c);
}

let art: HeliArt | null = null;

export function helicopterArt(): HeliArt {
  if (art) return art;
  // Row 0: bodies; row 1: rotor strips; row 2: tail frames (1 px gutters).
  const pm = new PixMap((HELI_W + 1) * LIVERIES.length, HELI_H + 1 + 4 * 2 + TAIL_SIZE + 1);
  LIVERIES.forEach((livery, i) => paintBody(pm, i * (HELI_W + 1), 0, livery));
  const rotorY = HELI_H + 1;
  for (let f = 0; f < 4; f++) paintRotor(pm, 0, rotorY + f * 2, f);
  const tailY = rotorY + 8;
  for (let f = 0; f < 3; f++) paintTail(pm, f * (TAIL_SIZE + 1), tailY, f);
  const texture = pm.texture();
  const body = {} as Record<Livery, Texture>;
  LIVERIES.forEach((livery, i) => { body[livery] = frameTexture(texture, i * (HELI_W + 1), 0, HELI_W, HELI_H); });
  art = {
    body,
    rotor: [0, 1, 2, 3].map(f => frameTexture(texture, 0, rotorY + f * 2, HELI_W, 1)),
    tail: [0, 1, 2].map(f => frameTexture(texture, f * (TAIL_SIZE + 1), tailY, TAIL_SIZE, TAIL_SIZE)),
  };
  return art;
}
