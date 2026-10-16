import { sprite, shade, tint, type Inks } from './pixmap';

/**
 * Original furniture and prop sprites, authored at world-pixel scale (a cell
 * is 12 px, a floor band 24 px; furniture stands on the room's floor strip,
 * so most pieces are 6-14 px tall). Accent slots A/a/q (main, dark, light)
 * and Z/z (second accent) are recoloured per room variant via `accent()`.
 */

/** Ink overrides for the A/a/q accent ramp (and optional Z/z second ramp). */
export function accent(main: number, second?: number): Inks {
  const inks: Inks = { A: main, a: shade(main, 0.32), q: tint(main, 0.3) };
  if (second !== undefined) { inks.Z = second; inks.z = shade(second, 0.32); }
  return inks;
}

// --- Offices ----------------------------------------------------------------

/** Beige 90s CRT on its stand, with keyboard in front. */
export const CRT = sprite([
  '.TTTTTTT.',
  'TtvvvvvtT',
  'TtvcCcvtT',
  'TtvccvvtT',
  'TtvvvvvtT',
  'TttttttTT',
  '..TTtTT..',
]);

/** Swivel office chair seen side-on, facing left. */
export const OFFICE_CHAIR = sprite([
  '....qA',
  '....Aa',
  '....Aa',
  '....Aa',
  '.qqqAa',
  '.aaaaa',
  '...K..',
  '..KKK.',
  '.K.K.K',
]);

export const PLANT = sprite([
  '..l.E..',
  '.lElEl.',
  'lEEeElE',
  '.EeElEe',
  'EElEeEE',
  '.eEeEe.',
  '..eEe..',
  '.mNNNn.',
  '.oNNNn.',
  '..nNn..',
]);

export const TALL_PLANT = sprite([
  '...l.E...',
  '..lEElEl.',
  '.lEEeElEE',
  'lEeElEeEe',
  '.EElEElE.',
  'EEeEEeEEe',
  '.eEelEEe.',
  '..eEeEe..',
  '...eb....',
  '....b....',
  '....b....',
  '..mNNNn..',
  '..oNNNn..',
  '..oNNNn..',
  '...nNn...',
]);

export const WATER_COOLER = sprite([
  '.CcC.',
  'CcccB',
  'cCccB',
  '.cBB.',
  'wwwwG',
  'wBwRG',
  'wwwwG',
  'wwwwG',
  'wGGwG',
  'wwwwG',
  'GgggK',
]);

export const COPIER = sprite([
  '.GGGGGGG..',
  'wwwwwwwwwG',
  'wKKKKKKKwG',
  'wwwwwwwEwG',
  'GGGGGGGGGg',
  'wwwwwwwwwG',
  'wGGGGGGGwG',
  'wwwwwwwwwG',
  'wGGGGGGGwG',
  'GggggggggK',
]);

export const CLOCK = sprite([
  '.kkk.',
  'kWWWk',
  'kWkWk',
  'kWWkk',
  '.kkk.',
]);

/** Framed landscape: A = sky, Z = ground. */
export const PICTURE = sprite([
  'nnnnnnnnnn',
  'nAAAAAAYAn',
  'nAAAAAAAAn',
  'nAAZZAAAAn',
  'nZZZZZZZAn',
  'nzzzzzzzzn',
  'nnnnnnnnnn',
]);

export const SMALL_PICTURE = sprite([
  'yyyyyy',
  'yAAAYy',
  'yAZAAy',
  'yZZZZy',
  'yyyyyy',
]);

export const WHITEBOARD = sprite([
  'GGGGGGGGGGGGGG',
  'GWWWWWWWWWWWWG',
  'GWBBWWRRRWWWWG',
  'GWWWWWWWWBBBWG',
  'GWEEEEWWWWWWWG',
  'GWWWWWWWWWWWWG',
  'GGGGGGGGGGGGGG',
  '...........kRB',
]);

export const BLINDS = sprite([
  'GGGGGGGGGGGG',
  'GCcCcCcCcCcG',
  'GwwwwwwwwwwG',
  'GcCcCcCcCcCG',
  'GwwwwwwwwwwG',
  'GCcCcCcCcCcG',
  'GwwwwwwwwwwG',
  'GcCcCcCcCcCG',
  'GGGGGGGGGGGG',
]);

// --- Homes ------------------------------------------------------------------

export const SOFA = sprite([
  '..qqqqqqqqqqqqqqqqqq..',
  '..AAAAAAAAAAAAAAAAAA..',
  'qqAAAAAAAAAAAAAAAAAAqq',
  'AAaaaaaaaaaaaaaaaaaaAA',
  'AAqqqqqqqqqqqqqqqqqqAA',
  'AAAAAAAAAAAAAAAAAAAAAA',
  'aaaaaaaaaaaaaaaaaaaaaa',
  '.b..................b.',
]);

export const ARMCHAIR = sprite([
  '..qqqqq..',
  '..AAAAA..',
  'qqAAAAAqq',
  'AAaaaaaAA',
  'AAqqqqqAA',
  'AAAAAAAAA',
  'aaaaaaaaa',
  '.b.....b.',
]);

export const TV = sprite([
  'kkkkkkkkkkk',
  'kKKKKKKKKKk',
  'kKcCccccKgk',
  'kKcccccvKwk',
  'kKcccvvvKgk',
  'kKKKKKKKKwk',
  'kkkkkkkkkkk',
  'bnnnnnnnnnb',
  'bNmmmmmmmNb',
  'bNbbbbbbbNb',
  'bnnnnnnnnnb',
]);

export const FRIDGE = sprite([
  '.wwwwww.',
  'wWWWWWWG',
  'WwwwwwkG',
  'WwwwwwkG',
  'WwwwwwwG',
  'GGGGGGGg',
  'WwwwwwwG',
  'WwwwwwkG',
  'WwwwwwkG',
  'WwwwwwwG',
  'WwwwwwwG',
  'WwwwwwwG',
  'GggggggK',
  '.K....K.',
]);

export const STOVE = sprite([
  'KK.KK.KK.',
  'wwwwwwwwG',
  'wGkwGkwwG',
  'GGGGGGGGg',
  'wkkkkkkwG',
  'wkRoRoowG',
  'wkkkkkkwG',
  'wwwwwwwwG',
  'GggggggGK',
]);

export const TABLE_LAMP = sprite([
  '.YYY.',
  'YLLLY',
  'yYYYy',
  '..K..',
  '..K..',
]);

export const FLOOR_LAMP = sprite([
  '.YYYY.',
  'YLLLLY',
  'yyYYyy',
  '..K...',
  '..K...',
  '..K...',
  '..K...',
  '..K...',
  '..K...',
  '..K...',
  '.KKK..',
]);

export const BOOKS = sprite([
  'RBYEuRBEyRuB',
  'RBYEuRBEyRuB',
  'RBYEuRBEyRuB',
]);

export const SUITCASE = sprite([
  '..kkk..',
  '.k...k.',
  'aAAAAAa',
  'aAyAyAa',
  'aAAAAAa',
  'aAAAAAa',
  'aaaaaaa',
]);

export const TOWELS = sprite([
  '..WWwW.',
  'WWwWWWw',
  'wwGwwGw',
]);

export const CHANDELIER = sprite([
  '.....y.....',
  '.....y.....',
  '..yyyyyyy..',
  '.yYLYLYLYy.',
  '..y.y.y.y..',
  '..L.L.L.L..',
]);

export const PENDANT = sprite([
  '..k..',
  '..k..',
  '.yyy.',
  'yYYYy',
  '.LLL.',
]);

export const CEILING_LIGHT = sprite([
  'GwwwwwG',
  '.LLLLL.',
]);

// --- Commerce ----------------------------------------------------------------

export const REGISTER = sprite([
  '..kkk.',
  '..kEk.',
  'KKKKKK',
  'KwGwGK',
  'KKKKKK',
]);

export const STOOL = sprite([
  'AAAA',
  'aaaa',
  '.G..',
  '.G..',
  'GGG.',
]);

/** Small square cafe table. */
export const CAFE_TABLE = sprite([
  'qqqqqqqqq',
  'AAAAAAAAA',
  '....G....',
  '....G....',
  '....G....',
  '...GGG...',
]);

/** Restaurant table with a long white cloth and a candle. */
export const DINING_TABLE = sprite([
  '......Y.......',
  '......L.......',
  '..W..yWy..W...',
  'WWWWWWWWWWWWWW',
  'WwwwwwwwwwwwwW',
  'WwwwwwwwwwwwwW',
  'wGwwwwwwwwwwGw',
  'w............w',
]);

export const DINING_CHAIR_L = sprite([
  'b...',
  'n...',
  'n...',
  'nAAA',
  'naaa',
  'n..n',
  'n..n',
]);

export const DINING_CHAIR_R = sprite([
  '...b',
  '...n',
  '...n',
  'AAAn',
  'aaan',
  'n..n',
  'n..n',
]);

export const WINE_RACK = sprite([
  'bbbbbbbbbbbb',
  'bEbRbEbRbEbb',
  'bebrbebrbebb',
  'bbbbbbbbbbbb',
  'bRbEbRbEbRbb',
  'brbebrbebrbb',
  'bbbbbbbbbbbb',
]);

/** Clothes rail with hanging garments (A/Z accents). */
export const CLOTHES_RACK = sprite([
  'GGGGGGGGGGGGGGGG',
  'G.k.k.k.k.k.k.kG',
  'GAAZZqqAAZZqqAAG',
  'GAAZZqqAAZZqqAAG',
  'GAAZZqqAAZZqqAAG',
  'GaAzZAqaAzZAqaAG',
  'G.Aa.Zz.Aa.Zz..G',
  'G..............G',
  'G..............G',
  'GG............GG',
]);

export const FLOWER_BUCKET = sprite([
  'R.p.Y.R',
  'lRlpYlR',
  'ElElElE',
  '.eEeEe.',
  'GGGGGGG',
  'GwwwwwG',
  'GwwwwwG',
  'GGGGGGG',
]);

export const MANNEQUIN = sprite([
  '.kk.',
  '.ww.',
  'AAAA',
  'AAAA',
  'AaaA',
  '.AA.',
  '.ZZ.',
  '.Z.Z',
  '.Z.Z',
  '.G..',
  'GGG.',
]);

// --- Services ----------------------------------------------------------------

export const RED_CROSS = sprite([
  'wWWWWWWWw',
  'WWWWRWWWW',
  'WWWRRRWWW',
  'WWRRRRRWW',
  'WWWRRRWWW',
  'WWWWRWWWW',
  'wwwwwwwwG',
]);

export const BADGE = sprite([
  '...yYy...',
  '..yYYYy..',
  '.yYvvvYy.',
  'yYvvYvvYy',
  'yYvYYYvYy',
  '.yYvvvYy.',
  '..yYvYy..',
  '...yYy...',
]);

export const WASHER = sprite([
  'GwwwwwwwwwG',
  'wKKwwwwRwEw',
  'GGGGGGGGGGG',
  'wwwkkkkkwww',
  'wwkgcccgkww',
  'wkgcCcccgkw',
  'wkgcccccgkw',
  'wkgcccccgkw',
  'wwkgcccgkww',
  'wwwkkkkkwww',
  'wwwwwwwwwww',
  'GgggggggggK',
]);

export const LINEN_CART = sprite([
  'GGGGGGGGGGGGGGGG',
  'GWWWWWwBBBBBBcGG',
  'GWwWWWwBcBBBBcGG',
  'GWWWWWwBBBBcBcGG',
  'GGGGGGGGGGGGGGGG',
  'GppppWWWWWppppGG',
  'GpppWWWwWWppppGG',
  'GGGGGGGGGGGGGGGG',
  '.KK..........KK.',
  '.KK..........KK.',
]);

export const LOCKER = sprite([
  'GGGGGG',
  'wgggwG',
  'wkkkwG',
  'wgggwG',
  'wwwwwG',
  'wwwwwG',
  'wwwkwG',
  'wwwkwG',
  'wwwwwG',
  'wwwwwG',
  'wwwwwG',
  'wwwwwG',
  'GgggGK',
]);

export const IV_STAND = sprite([
  'CC.',
  'Cc.',
  '.G.',
  '.G.',
  '.G.',
  '.G.',
  '.G.',
  '.G.',
  '.G.',
  'GGG',
]);

// --- Basement -----------------------------------------------------------------

/** A parked car side-on facing right (A body colour). */
export const CAR = sprite([
  '..........kkkkkkkkkkkk............',
  '.........kqCCckkCCCcqqk...........',
  '........kqCCcckkCCccccqk..........',
  '.......kqqccccckkcccccAAk.........',
  '..kkkkkqqqqqqqqqqqqqqqqqqkkkkkk...',
  '.kqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqk.',
  'kAAAAAAAAAAAAAAAAkAAAAAAAAAAAAAAYk',
  'RAAAAAAAAAAAAAAAAkAAAAAAAAAAAAAAAk',
  'kaaakkkkkaaaaaaaaaaaaaaakkkkkaaaak',
  '.kkkkKgGKkkkkkkkkkkkkkkkKgGKkkkkk.',
  '....KgwGgK............KgwGgK......',
  '.....KKKK..............KKKK.......',
]);

export const RECYCLE_BIN = sprite([
  'aaaaaaaaaaaaaaaaaaaaaa',
  'aqqqqqqqqqqqqqqqqqqqqa',
  '.AAAAAAAAAAAAAAAAAAAA.',
  '.AAAAAAAAWWWAAAAAAAAa.',
  '.AAAAAAAWAAAWAAAAAAAa.',
  '.AAAAAAAAAWWAAAAAAAAa.',
  '.AAAAAAAWAAAWAAAAAAAa.',
  '.AAAAAAAAWWWAAAAAAAAa.',
  '.AAAAAAAAAAAAAAAAAAAa.',
  '.aaaaaaaaaaaaaaaaaaaa.',
  '..kk..............kk..',
  '..kk..............kk..',
]);

export const PEW = sprite([
  'n...........n',
  'nNNNNNNNNNNNn',
  'nnnnnnnnnnnnn',
  'mmmmmmmmmmmmm',
  'bnnnnnnnnnnnb',
  'b...........b',
  'b...........b',
]);

export const BENCH = sprite([
  'nNNNNNNNNNNNNNn',
  'bnnnnnnnnnnnnnb',
  '.G...........G.',
  '.G...........G.',
]);

export const CINEMA_SEAT = sprite([
  '.qAAq',
  'qAAAA',
  'AAAAA',
  'aaaaa',
]);
