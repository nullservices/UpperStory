import type { Texture } from 'pixi.js';
import type { PersonKind } from '../../sim';
import { GridAtlas, frameTexture, shade, sprite, type Inks, type PixelSprite } from './pixmap';

/**
 * Pixel people: 7x12 frames (the figure itself is ~5 px wide) in one atlas
 * so the whole crowd renders as a single ParticleContainer batch. Every
 * person kind has several outfits (picked per person id), a front-facing
 * idle pose and a 4-frame side-on walk cycle in both directions, each baked
 * in three stress levels (own clothes, pink, red), the classic read of an
 * impatient crowd.
 */

export const PERSON_W = 7;
export const PERSON_H = 12;

export const POSE_IDLE = 0;
/** Walk frames: POSE_WALK_RIGHT + (0..3), POSE_WALK_LEFT + (0..3). */
export const POSE_WALK_RIGHT = 1;
export const POSE_WALK_LEFT = 5;
const POSES = 9;
export const STRESS_LEVELS = 3;
export const OUTFITS = 4;

type HairStyle = 'short' | 'long' | 'cap' | 'bun';

interface Outfit {
  hair: number;
  style: HairStyle;
  skin: number;
  top: number;
  accent: number;
  bottom: number;
  skirt?: boolean;
  shoes?: number;
}

const SKIN = [0xf2c4a0, 0xe0a87c, 0xb87850, 0x8a5434];
const HAIR = { black: 0x221812, brown: 0x5a3418, blond: 0xd8b060, grey: 0xa8a8a8, red: 0x9a3a1a };

const KINDS: PersonKind[] = ['officeWorker', 'resident', 'hotelGuest', 'diner', 'shopper', 'guard', 'housekeeper'];

const OUTFIT_TABLE: Record<PersonKind, Outfit[]> = {
  // Business suits: navy, charcoal, brown; a skirt suit.
  officeWorker: [
    { hair: HAIR.black, style: 'short', skin: SKIN[0]!, top: 0x24345e, accent: 0xf4f4f4, bottom: 0x1e2a4c },
    { hair: HAIR.brown, style: 'short', skin: SKIN[1]!, top: 0x46464e, accent: 0xc83030, bottom: 0x38383e },
    { hair: HAIR.blond, style: 'long', skin: SKIN[0]!, top: 0x5a3a5a, accent: 0xf4f4f4, bottom: 0x3e2a3e, skirt: true },
    { hair: HAIR.grey, style: 'short', skin: SKIN[2]!, top: 0x5a4430, accent: 0xe8d8a8, bottom: 0x40301e },
  ],
  // Residents in casual clothes.
  resident: [
    { hair: HAIR.brown, style: 'short', skin: SKIN[1]!, top: 0xc83a30, accent: 0xc83a30, bottom: 0x3a5a8a },
    { hair: HAIR.black, style: 'long', skin: SKIN[3]!, top: 0xe0b030, accent: 0xe0b030, bottom: 0x6a4a2a, skirt: true },
    { hair: HAIR.red, style: 'short', skin: SKIN[0]!, top: 0x3a8a4a, accent: 0x3a8a4a, bottom: 0xb8a070 },
    { hair: HAIR.grey, style: 'bun', skin: SKIN[1]!, top: 0x8a5ab0, accent: 0x8a5ab0, bottom: 0x4a3a5a, skirt: true },
  ],
  // Hotel guests: tourists and travellers.
  hotelGuest: [
    { hair: HAIR.blond, style: 'short', skin: SKIN[0]!, top: 0xe87a30, accent: 0xffd060, bottom: 0xd8c8a0 },
    { hair: HAIR.black, style: 'long', skin: SKIN[2]!, top: 0x68b0d8, accent: 0xf4f4f4, bottom: 0xf0f0f0, skirt: true },
    { hair: HAIR.brown, style: 'cap', skin: SKIN[1]!, top: 0xf0f0f0, accent: 0x3464bc, bottom: 0x5a6a8a },
    { hair: HAIR.grey, style: 'short', skin: SKIN[0]!, top: 0x8ab048, accent: 0xf4f4f4, bottom: 0x6a5a40 },
  ],
  // Diners dressed for an evening out.
  diner: [
    { hair: HAIR.black, style: 'short', skin: SKIN[1]!, top: 0x1c1c22, accent: 0xf4f4f4, bottom: 0x1c1c22 },
    { hair: HAIR.blond, style: 'long', skin: SKIN[0]!, top: 0xb01830, accent: 0xb01830, bottom: 0xb01830, skirt: true },
    { hair: HAIR.brown, style: 'bun', skin: SKIN[2]!, top: 0x1e6a5a, accent: 0xd0a028, bottom: 0x1e6a5a, skirt: true },
    { hair: HAIR.grey, style: 'short', skin: SKIN[3]!, top: 0x6a4a2a, accent: 0xe8d8a8, bottom: 0x3a2a1a },
  ],
  // Shoppers in bright colours.
  shopper: [
    { hair: HAIR.brown, style: 'long', skin: SKIN[0]!, top: 0xe060a0, accent: 0xe060a0, bottom: 0x3a5a8a, skirt: true },
    { hair: HAIR.black, style: 'cap', skin: SKIN[2]!, top: 0x30a0a0, accent: 0xc83030, bottom: 0x3a3a42 },
    { hair: HAIR.blond, style: 'short', skin: SKIN[1]!, top: 0xf0d040, accent: 0xf0d040, bottom: 0x4a6a3a },
    { hair: HAIR.red, style: 'long', skin: SKIN[0]!, top: 0x7a50c0, accent: 0xf4f4f4, bottom: 0x2a2a32 },
  ],
  // Security guards: navy uniform, peaked cap, gold badge.
  guard: [
    { hair: 0x1a2650, style: 'cap', skin: SKIN[1]!, top: 0x1e3070, accent: 0xf0c020, bottom: 0x18244a },
    { hair: 0x1a2650, style: 'cap', skin: SKIN[3]!, top: 0x1e3070, accent: 0xf0c020, bottom: 0x18244a },
    { hair: 0x1a2650, style: 'cap', skin: SKIN[0]!, top: 0x1e3070, accent: 0xf0c020, bottom: 0x18244a },
    { hair: 0x1a2650, style: 'cap', skin: SKIN[2]!, top: 0x1e3070, accent: 0xf0c020, bottom: 0x18244a },
  ],
  // Housekeepers: pale blue dresses with white aprons.
  housekeeper: [
    { hair: HAIR.black, style: 'bun', skin: SKIN[1]!, top: 0x80b8e0, accent: 0xffffff, bottom: 0x80b8e0, skirt: true },
    { hair: HAIR.brown, style: 'bun', skin: SKIN[0]!, top: 0x80b8e0, accent: 0xffffff, bottom: 0x80b8e0, skirt: true },
    { hair: HAIR.blond, style: 'short', skin: SKIN[2]!, top: 0x80b8e0, accent: 0xffffff, bottom: 0x5a7a9a },
    { hair: HAIR.grey, style: 'bun', skin: SKIN[3]!, top: 0x80b8e0, accent: 0xffffff, bottom: 0x80b8e0, skirt: true },
  ],
};

// Head rows (0-2) per hair style, front and side-on (facing right).
const HEAD_FRONT: Record<HairStyle, string[]> = {
  short: ['..HHH..', '..sss..', '..sss..'],
  long: ['..HHH..', '.HsssH.', '.HsssH.'],
  cap: ['.HHHHH.', '..sss..', '..sss..'],
  bun: ['..HHH..', '.Hsss..', '..sss..'],
};
const HEAD_SIDE: Record<HairStyle, string[]> = {
  short: ['..HHH..', '..Hss..', '..sss..'],
  long: ['..HHH..', '.HHss..', '.Hsss..'],
  cap: ['..HHHH.', '..Hss..', '..sss..'],
  bun: ['.HHHH..', '..Hss..', '..sss..'],
};

const BODY_FRONT = ['.JJXJJ.', '.JJXJJ.', '.JjXjJ.', '.sJjJs.', '..JjJ..'];
const LEGS_FRONT = ['..PPP..', '..P.P..', '..P.P..', '..F.F..'];
const SKIRT_FRONT = ['.PPPPP.', '..PPP..', '..s.s..', '..F.F..'];

// Side-on torso (rows 3-7) and legs (rows 8-11) for the 4 walk frames.
const BODY_SIDE = [
  ['..JJX..', '.JJJJ..', '.sJjJ..', '..JjJ..', '..JjJ..'],
  ['..JJX..', '..JJJ..', '..JjJ..', '..sjJ..', '..JjJ..'],
  ['..JJX..', '..JJJJ.', '..JjJs.', '..JjJ..', '..JjJ..'],
  ['..JJX..', '..JJJ..', '..JjJ..', '..sjJ..', '..JjJ..'],
];
const LEGS_SIDE = [
  ['..PPP..', '..O.P..', '.O...P.', '.F...FF'],
  ['..PPP..', '...PO..', '...PO..', '...FF..'],
  ['..PPP..', '..P.O..', '.P...O.', '.F...FF'],
  ['..PPP..', '...OP..', '...OP..', '...FF..'],
];
const SKIRT_SIDE = [
  ['.PPPP..', '..s.s..', '.s...s.', '.F...FF'],
  ['.PPPP..', '..PPP..', '...ss..', '...FF..'],
  ['.PPPP..', '..s.s..', '.s...s.', '.F...FF'],
  ['.PPPP..', '..PPP..', '...ss..', '...FF..'],
];

function frameSprite(o: Outfit, pose: number): PixelSprite {
  if (pose === POSE_IDLE) {
    return sprite([...HEAD_FRONT[o.style], ...BODY_FRONT, ...(o.skirt ? SKIRT_FRONT : LEGS_FRONT)]);
  }
  const step = (pose - 1) % 4;
  const rows = [...HEAD_SIDE[o.style], ...BODY_SIDE[step]!, ...(o.skirt ? SKIRT_SIDE[step]! : LEGS_SIDE[step]!)];
  if (o.style === 'long') rows[3] = '.H' + rows[3]!.slice(2);
  return sprite(rows);
}

const STRESS_TOP = [0, 0xf27aa6, 0xe02424];
const STRESS_BOTTOM = [0, 0xd8608c, 0xb01818];

function inksFor(o: Outfit, stress: number): Inks {
  const top = stress ? STRESS_TOP[stress]! : o.top;
  const bottom = stress ? STRESS_BOTTOM[stress]! : o.bottom;
  const acc = stress && o.accent === o.top ? top : o.accent;
  return {
    H: o.hair, s: o.skin,
    J: top, j: shade(top, 0.25), X: acc,
    P: bottom, O: shade(bottom, 0.35),
    F: o.shoes ?? 0x18181c,
  };
}

export interface PeopleAtlas {
  texture: Texture;
  /** frames[((kind * OUTFITS + outfit) * STRESS_LEVELS + stress) * POSES + pose] */
  frames: Texture[];
}

let atlas: PeopleAtlas | null = null;

export function peopleAtlas(): PeopleAtlas {
  if (atlas) return atlas;
  const count = KINDS.length * OUTFITS * STRESS_LEVELS * POSES;
  const grid = new GridAtlas(PERSON_W, PERSON_H, count);
  const cells: { x: number; y: number }[] = [];
  for (const kind of KINDS) {
    for (const outfit of OUTFIT_TABLE[kind]) {
      for (let stress = 0; stress < STRESS_LEVELS; stress++) {
        const inks = inksFor(outfit, stress);
        for (let pose = 0; pose < POSES; pose++) {
          const at = grid.alloc();
          cells.push(at);
          const left = pose >= POSE_WALK_LEFT;
          const s = frameSprite(outfit, left ? pose - 4 : pose);
          grid.pm.blit(s, at.x, at.y, { inks, flip: left });
        }
      }
    }
  }
  const texture = grid.pm.texture();
  const frames = cells.map(c => frameTexture(texture, c.x, c.y, PERSON_W, PERSON_H));
  atlas = { texture, frames };
  return atlas;
}

const KIND_INDEX: Record<PersonKind, number> = Object.fromEntries(KINDS.map((k, i) => [k, i])) as Record<PersonKind, number>;

/** Frame index for a person's kind/outfit/stress/pose. */
export function personFrame(kind: PersonKind, outfit: number, stress: number, pose: number): number {
  return ((KIND_INDEX[kind] * OUTFITS + (outfit % OUTFITS)) * STRESS_LEVELS + stress) * POSES + pose;
}
