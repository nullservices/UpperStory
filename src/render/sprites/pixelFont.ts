import type { Texture } from 'pixi.js';
import { GridAtlas, PixMap, frameTexture, sprite, type PixelSprite } from './pixmap';

/**
 * A tiny original 3x5 pixel font for world-space readouts (money pops,
 * landing queue counts, wall signage). Glyphs are authored with '#' ink so
 * callers colour them per use; the atlas bakes each glyph white with a 1 px
 * dark outline (5x7 frames) so a Sprite tint recolours the face only.
 */

const GLYPHS: Record<string, readonly string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '-': ['...', '...', '###', '...', '...'],
  '$': ['.##', '##.', '.#.', '.##', '##.'],
  '.': ['...', '...', '...', '...', '.#.'],
  ',': ['...', '...', '...', '.#.', '#..'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  F: ['###', '#..', '##.', '#..', '#..'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  E: ['###', '#..', '##.', '#..', '###'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  S: ['###', '#..', '###', '..#', '###'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  P: ['###', '#.#', '###', '#..', '#..'],
  L: ['#..', '#..', '#..', '#..', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  ' ': ['...', '...', '...', '...', '...'],
};

export const GLYPH_W = 3;
export const GLYPH_H = 5;
/** Advance per glyph including the 1 px gap. */
export const GLYPH_ADVANCE = 4;

const parsed = new Map<string, PixelSprite>();
function glyph(ch: string): PixelSprite | undefined {
  let s = parsed.get(ch);
  if (!s) {
    const rows = GLYPHS[ch];
    if (!rows) return undefined;
    s = sprite(rows);
    parsed.set(ch, s);
  }
  return s;
}

/** Paint `text` into a PixMap at (x, y) in `color` (no outline). */
export function paintText(pm: PixMap, text: string, x: number, y: number, color: number): void {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const g = glyph(ch);
    if (g) pm.blit(g, cx, y, { inks: { '#': color } });
    cx += GLYPH_ADVANCE;
  }
}

/** Width in pixels of `text` painted with paintText. */
export function textWidth(text: string): number {
  return Math.max(0, text.length * GLYPH_ADVANCE - 1);
}

export interface GlyphAtlas {
  /** White glyph with dark outline, 5x7, keyed by character. */
  frames: Map<string, Texture>;
  /** Frame size (glyph plus outline). */
  w: number;
  h: number;
}

let atlas: GlyphAtlas | null = null;

/** Outlined glyph frames for tinted Sprites (built once). */
export function glyphAtlas(): GlyphAtlas {
  if (atlas) return atlas;
  const chars = Object.keys(GLYPHS);
  const fw = GLYPH_W + 2, fh = GLYPH_H + 2;
  const grid = new GridAtlas(fw, fh, chars.length);
  const cells: [string, number, number][] = [];
  for (const ch of chars) {
    const at = grid.alloc();
    const g = glyph(ch)!;
    // Outline: the glyph stamped dark at the 8 neighbours, then the face.
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx || dy) grid.pm.blit(g, at.x + 1 + dx, at.y + 1 + dy, { inks: { '#': 0x16161a } });
    }
    grid.pm.blit(g, at.x + 1, at.y + 1, { inks: { '#': 0xffffff } });
    cells.push([ch, at.x, at.y]);
  }
  const texture = grid.pm.texture();
  const frames = new Map<string, Texture>();
  for (const [ch, x, y] of cells) frames.set(ch, frameTexture(texture, x, y, fw, fh));
  atlas = { frames, w: fw, h: fh };
  return atlas;
}
