import { floorBounds, stairLowerFloor } from '../sim/tower';
import { CanvasSource, Container, Graphics, Sprite, Text, Texture, TilingSprite } from 'pixi.js';
import { facilityHeight, isHotel, CONFIG } from '../data/config';
import { floorHeightPx, floorTopY, type Floor, type GameState, type Tenant } from '../sim';
import { PALETTE, lerpRgb } from './palette';
import { animTime } from './animClock';
import { ambient } from './ambient';
import { isLit, nightAlpha } from './dayNight';
import { cinemaScreen, isOpenAir, poolWater, roomKey, roomLook, roomTextures, roomVariant, type RoomLook } from './roomArt';
import { roomLighting } from './roomLighting';
import { towerUnpowered } from './simCompat';
import { filmFrames, rippleFrames } from './sprites/effects';
import { hash32 } from './sprites/pixmap';
import { BAND_TILE_W, emptyBandTexture, flightTexture, wellTexture } from './sprites/structure';
import { StreetView } from './street';
import { RowBuckets, visibleWorldBand } from './rowBuckets';

/** World extent of the backdrop (ground band) around the tower. */
const GROUND_LEFT = -4000;
const GROUND_WIDTH = CONFIG.FLOOR_WIDTH_CELLS * CONFIG.CELL_WIDTH_PX + 8000;
const GROUND_DEPTH = 4000;

interface RoomSprite {
  /** One sprite per texture piece (wide lobbies are cut into pieces). */
  pieces: Sprite[];
  /** Night emissive overlay per piece (null where a piece has no lamps). */
  glows: (Sprite | null)[];
  state: Tenant['state'];
  look: RoomLook;
  key: string;
  /** Animated overlay: a cinema's film or a rooftop pool's ripples. */
  film?: Sprite;
  filmFrames?: Texture[];
  filmMs?: number;
}

/** Milliseconds per cinema film frame / pool ripple frame. */
const FILM_FRAME_MS = 180;
const RIPPLE_FRAME_MS = 220;

/** Night tints (multiplied into the room art) for lit and unlit rooms. */
const LIT_WARM = 0xffd6a0;
const LIT_HOTEL = 0xd2e2ff;
const UNLIT = 0x262c4c;
/** Blackout: interiors read dark even by day. */
const BLACKOUT_LEVEL = 0.72;
/** Lights stutter for this long (anim ms) when the power first fails. */
const FLICKER_MS = 1600;

/** A cinema shows its film while it is open with an audience in; a pool always ripples. */
function filmShowing(tenant: Tenant, powered = true): boolean {
  if (tenant.type === 'rooftopPool') return tenant.state === 'open';
  return powered && tenant.state === 'open' && tenant.occupancy > 0;
}

/**
 * Cutaway tower view.
 *  - backdrop: skyline, street (trees, cars) and the tiled soil band (street.ts).
 *  - shell: floor bands, slabs, outer walls and roof caps (per structure edit).
 *  - rooms: one Graphics per tenant sharing a cached GraphicsContext per
 *    type/state/size/variant (roomArt.ts), so identical rooms share geometry
 *    and a tenant whose state or look (hotel guest/dirty, unhappy tenant)
 *    changes swaps only its own context.
 *  - transport: stair and escalator flights drawn over the rooms they cross.
 *  - labels: floor numbers at the left edge of each floor.
 */
export class TowerView {
  readonly container = new Container();
  private readonly backdrop = new Container();
  private readonly bands = new RowBuckets();
  private readonly shell = new Graphics();
  private readonly rooms = new RowBuckets();
  private readonly glows = new RowBuckets();
  private readonly films = new RowBuckets();
  private readonly playing = new Set<RoomSprite>();
  private readonly transport = new RowBuckets();
  private readonly labelLayer = new RowBuckets();
  private labels: Text[] = [];
  private labelScale = 1;
  private readonly sprites = new Map<number, RoomSprite>();
  private readonly street = new StreetView(GROUND_LEFT, GROUND_WIDTH);
  /** Soil band and its grass lip (night-tinted with the street). */
  private readonly ground: Container[] = [];
  private revision = -1;
  private tower: GameState['tower'] | null = null;
  private lightKey = '';
  private powered = true;
  /** Anim time the current outage was first seen (-1 = power on). */
  private outageSince = -1;

  constructor() {
    this.container.eventMode = 'none';
    this.buildBackdrop();
    this.container.addChild(this.backdrop, this.bands.root, this.shell, this.rooms.root, this.glows.root, this.films.root, this.transport.root, this.labelLayer.root);
  }

  draw(state: GameState): void {
    this.street.update();
    if (this.tower !== state.tower || this.revision !== state.tower.structureRevision) {
      this.tower = state.tower;
      this.revision = state.tower.structureRevision;
      this.rebuild(state);
      this.lightKey = '';
      this.applyLighting(state);
      this.animateFilms();
      this.cull();
      return;
    }
    // Between structure edits only tenant states and looks change (open ↔
    // vacant, construction, damage, guests, housekeeping, evaluation): swap
    // just those rooms' art.
    for (const tenant of state.tenants.values()) {
      const sprite = this.sprites.get(tenant.id);
      if (!sprite || sprite.state !== tenant.state || sprite.look !== roomLook(tenant)) {
        this.syncRoom(state, tenant);
        this.lightKey = '';
      } else if (sprite.film && sprite.film.visible !== filmShowing(tenant, this.powered)) {
        sprite.film.visible = filmShowing(tenant, this.powered);
      }
    }
    this.applyLighting(state);
    this.animateFilms();
    this.cull();
  }

  /** Render only the rows of rooms, bands, flights and labels on screen. */
  private cull(): void {
    // Floor numbers keep a readable screen size in the 50% overview.
    const zoom = this.container.parent?.scale.y ?? 1;
    const labelScale = zoom > 0 && zoom < 1 ? 1 / zoom : 1;
    if (labelScale !== this.labelScale) {
      this.labelScale = labelScale;
      for (const label of this.labels) label.scale.set(labelScale);
    }
    const band = visibleWorldBand(this.container, CONFIG.FLOOR_HEIGHT_PX);
    for (const layer of [this.bands, this.rooms, this.glows, this.films, this.transport, this.labelLayer]) {
      if (band) layer.cull(band.top, band.bottom);
      else layer.showAll();
    }
  }

  /** Advance every visible cinema film and pool ripple (paused with the game clock). */
  private animateFilms(): void {
    if (!this.playing.size) return;
    const now = animTime();
    for (const room of this.playing) {
      const film = room.film, frames = room.filmFrames;
      if (!film?.visible || !frames) continue;
      film.texture = frames[Math.floor(now / (room.filmMs ?? FILM_FRAME_MS)) % frames.length]!;
    }
  }

  /**
   * Night and blackout lighting in the pixel style: instead of translucent
   * overlay boxes, each room's art is re-tinted (warm interior when lit,
   * deep blue-grey when dark) and lit rooms show their lamp layer at full
   * brightness, so lamps and the pools of light under them glow. Empty
   * floor space, the shell and the stairs darken with the unlit rooms.
   * During a blackout without a working generator everything goes dark
   * after a short flicker. Re-tinted only when the light bucket, the lit set
   * or the flicker state changes.
   */
  private applyLighting(state: GameState): void {
    const night = Math.round((nightAlpha(ambient.minuteOfDay) / 0.45) * 32) / 32;
    const unpowered = towerUnpowered(state);
    let flicker = 0;
    if (unpowered) {
      const now = animTime();
      if (this.outageSince < 0) this.outageSince = now;
      const t = (now - this.outageSince) / FLICKER_MS;
      // Mostly on at first, failing more often until the lights stay off.
      if (t < 1) flicker = (hash32(Math.floor(now / 70)) % 100) / 100 > t * 1.1 ? 1 : 2;
    } else {
      this.outageSince = -1;
    }
    const powered = !unpowered || flicker === 1;
    const darkLevel = powered ? night : Math.max(night, BLACKOUT_LEVEL);
    let hash = 0;
    if (night > 0) {
      for (const tenant of state.tenants.values()) hash = (Math.imul(hash, 31) + tenant.id * 2 + (isLit(tenant) ? 1 : 0)) | 0;
    }
    const key = `${night}|${darkLevel}|${powered ? 1 : 0}|${hash}`;
    if (key === this.lightKey) return;
    this.lightKey = key;
    if (this.powered !== powered) {
      this.powered = powered;
      for (const tenant of state.tenants.values()) {
        const film = this.sprites.get(tenant.id)?.film;
        if (film) film.visible = filmShowing(tenant, powered);
      }
    }
    const unlitTint = lerpRgb(0xffffff, UNLIT, darkLevel * 0.84);
    this.bands.root.tint = unlitTint;
    this.transport.root.tint = unlitTint;
    roomLighting.structure = unlitTint;
    // The soil band outside follows the night like the street (moonlit, not black).
    const groundTint = lerpRgb(0xffffff, UNLIT, night * 0.55);
    for (const ground of this.ground) ground.tint = groundTint;
    this.shell.tint = lerpRgb(0xffffff, UNLIT, darkLevel * 0.6);
    // People out in corridors and lobbies stay readable at night; only a
    // power cut darkens them too.
    roomLighting.open = powered ? 0xffffff : unlitTint;
    roomLighting.rooms.clear();
    for (const tenant of state.tenants.values()) {
      const lit = powered && night > 0 && isLit(tenant);
      const tint = lit
        ? lerpRgb(0xffffff, isHotel(tenant.type) ? LIT_HOTEL : LIT_WARM, night * 0.5)
        : unlitTint;
      roomLighting.rooms.set(tenant.id, tint);
      const sprite = this.sprites.get(tenant.id);
      if (!sprite) continue;
      for (const piece of sprite.pieces) piece.tint = tint;
      for (const glow of sprite.glows) {
        if (!glow) continue;
        glow.visible = lit;
        glow.alpha = night;
      }
    }
  }

  private rebuild(state: GameState): void {
    const floors = new Map<number, Floor>();
    for (const floor of state.tower.floors) floors.set(floor.index, floor);
    this.drawShell(state, floors);
    const alive = new Set<number>();
    for (const tenant of state.tenants.values()) {
      alive.add(tenant.id);
      this.syncRoom(state, tenant);
    }
    for (const [id, sprite] of this.sprites) {
      if (alive.has(id)) continue;
      for (const piece of sprite.pieces) piece.destroy();
      for (const glow of sprite.glows) glow?.destroy();
      sprite.film?.destroy();
      this.playing.delete(sprite);
      this.sprites.delete(id);
    }
    this.drawTransport(state, floors);
    this.drawLabels(state);
  }

  /** Create or update one tenant's room graphic. */
  private syncRoom(state: GameState, tenant: Tenant): void {
    const cell = CONFIG.CELL_WIDTH_PX, H = CONFIG.FLOOR_HEIGHT_PX;
    const lobbyFloors = state.tower.lobbyHeight;
    const floorsTall = tenant.floor === CONFIG.LOBBY_FLOOR_INDEX && (tenant.type === 'lobby' || facilityHeight(tenant.type) === 1)
      ? lobbyFloors
      : facilityHeight(tenant.type);
    const w = tenant.sizeCells * cell;
    const h = floorsTall * H;
    const topFloor = tenant.floor + facilityHeight(tenant.type) - 1;
    const x = tenant.x * cell;
    const y = tenant.floor === CONFIG.LOBBY_FLOOR_INDEX ? floorTopY(tenant.floor, lobbyFloors) : floorTopY(topFloor, lobbyFloors);
    const variant = roomVariant(tenant);
    const look = roomLook(tenant);
    const key = roomKey(tenant.type, tenant.state, w, h, variant, look);
    let sprite = this.sprites.get(tenant.id);
    if (!sprite) {
      sprite = { pieces: [], glows: [], state: tenant.state, look, key: '' };
      this.sprites.set(tenant.id, sprite);
    }
    const textures = roomTextures(tenant.type, tenant.state, w, h, variant, look);
    if (sprite.key !== key) {
      while (sprite.pieces.length > textures.length) sprite.pieces.pop()!.destroy();
      for (let i = 0; i < textures.length; i++) {
        const existing = sprite.pieces[i];
        if (existing) {
          existing.texture = textures[i]!.texture;
        } else {
          const piece = new Sprite(textures[i]!.texture);
          piece.roundPixels = true;
          sprite.pieces.push(piece);
        }
      }
      for (const glow of sprite.glows) glow?.destroy();
      sprite.glows = textures.map(piece => {
        if (!piece.glow) return null;
        const glow = new Sprite(piece.glow);
        glow.roundPixels = true;
        glow.visible = false;
        return glow;
      });
    }
    const room = sprite;
    textures.forEach((piece, i) => {
      const sprite = room.pieces[i]!;
      sprite.position.set(x + piece.x, y);
      this.rooms.add(sprite, y, h);
      const glow = room.glows[i];
      if (glow) {
        glow.position.set(x + piece.x, y);
        this.glows.add(glow, y, h);
      }
    });
    sprite.state = tenant.state;
    sprite.look = look;
    sprite.key = key;
    const overlay = tenant.type === 'cinema'
      ? { rect: cinemaScreen(w, h), frames: filmFrames, ms: FILM_FRAME_MS }
      : tenant.type === 'rooftopPool' && tenant.state === 'open'
        ? { rect: poolWater(w, h, variant), frames: rippleFrames, ms: RIPPLE_FRAME_MS }
        : null;
    if (overlay) {
      const r = overlay.rect;
      sprite.filmFrames = overlay.frames(r.w, r.h);
      sprite.filmMs = overlay.ms;
      if (!sprite.film) {
        sprite.film = new Sprite(sprite.filmFrames[0]!);
        sprite.film.roundPixels = true;
        this.playing.add(sprite);
      }
      sprite.film.position.set(x + r.x, y + r.y);
      this.films.add(sprite.film, y, h);
      sprite.film.visible = filmShowing(tenant, this.powered);
    } else if (sprite.film) {
      sprite.film.destroy();
      sprite.film = undefined;
      sprite.filmFrames = undefined;
      this.playing.delete(sprite);
    }
  }

  private buildBackdrop(): void {
    const soil = new TilingSprite({ texture: soilTexture(), width: GROUND_WIDTH, height: GROUND_DEPTH });
    soil.position.set(GROUND_LEFT, 0);
    const g = new Graphics();
    // Street level sits on y = 0 (where the lobby stands); soil lip below it.
    g.rect(GROUND_LEFT, 0, GROUND_WIDTH, 2).fill(PALETTE.grassDark);
    this.backdrop.addChild(this.street.container, soil, g);
    this.ground.push(soil, g);
  }

  private drawShell(state: GameState, floors: Map<number, Floor>): void {
    const g = this.shell;
    g.clear();
    this.bands.clear();
    const cell = CONFIG.CELL_WIDTH_PX;
    const lobbyFloors = state.tower.lobbyHeight;
    // Open-air roof facilities leave their band out so the sky shows through.
    const openAir = new Map<number, [number, number][]>();
    for (const tenant of state.tenants.values()) {
      if (!isOpenAir(tenant.type)) continue;
      const list = openAir.get(tenant.floor) ?? [];
      list.push([tenant.x, tenant.x + tenant.sizeCells]);
      openAir.set(tenant.floor, list);
    }
    for (const floor of state.tower.floors) {
      const b = floorBounds(state, floor.index);
      if (b.hi <= b.lo) continue;
      const left = b.lo * cell, width = (b.hi - b.lo) * cell;
      const y = floorTopY(floor.index, lobbyFloors), h = floorHeightPx(floor, lobbyFloors);
      const under = floor.index <= CONFIG.BASEMENT_FLOOR_INDEX;
      const holes = (openAir.get(floor.index) ?? []).sort((p, q) => p[0] - q[0]);
      // Unfurnished floor space: a pixel tile (bare wall, concrete floor,
      // a structural column every 8 cells) aligned to the world grid.
      for (const [lo, hi] of subtract(b.lo, b.hi, holes)) {
        const bandLeft = lo * cell;
        const band = new TilingSprite({ texture: emptyBandTexture(under), width: (hi - lo) * cell, height: h - 2 });
        band.position.set(bandLeft, y);
        band.tilePosition.set(-(((bandLeft % BAND_TILE_W) + BAND_TILE_W) % BAND_TILE_W), 0);
        band.roundPixels = true;
        this.bands.add(band, y, h);
      }
      // Floor slab (2 px; the ceiling rows of every room and band double it
      // to a 4 px slab) and the outer walls.
      g.rect(left - 2, y + h - 2, width + 4, 1).fill(PALETTE.slabLight);
      g.rect(left - 2, y + h - 1, width + 4, 1).fill(PALETTE.slab);
      g.rect(left - 2, y, 2, h).fill(PALETTE.shell);
      g.rect(left + width, y, 2, h).fill(PALETTE.shell);
      if (under) continue;
      // Roof cap over every stretch not covered by the floor above.
      const above = floors.get(floor.index + 1);
      const ab = above ? floorBounds(state, above.index) : { lo: 0, hi: 0 };
      const segments: [number, number][] = ab.hi <= ab.lo
        ? [[b.lo, b.hi]]
        : [[b.lo, Math.min(b.hi, ab.lo)], [Math.max(b.lo, ab.hi), b.hi]];
      for (const [lo, hi] of segments.flatMap(([a, z]) => subtract(a, z, holes))) {
        if (hi <= lo) continue;
        const capLeft = lo === b.lo ? lo * cell - 3 : lo * cell;
        const capRight = hi === b.hi ? hi * cell + 3 : hi * cell;
        g.rect(capLeft, y - 3, capRight - capLeft, 3).fill(PALETTE.roof);
        g.rect(capLeft, y - 3, capRight - capLeft, 1).fill(PALETTE.roofLight);
      }
    }
  }

  /**
   * Stairs and escalators: one diagonal flight per link, spanning the lower
   * floor's band and the upper floor's band (the person climbs from the lower
   * slab and steps off where the flight crosses the upper slab). Where the
   * other band is a furnished room the flight stays inside its own cells.
   */
  private drawTransport(state: GameState, floors: Map<number, Floor>): void {
    const g = this.transport;
    g.clear();
    const cell = CONFIG.CELL_WIDTH_PX;
    for (const floor of state.tower.floors) {
      floor.cells.forEach((c, index) => {
        if (c.content !== 'stair' || (c.transportX ?? index) !== index) return;
        const lower = stairLowerFloor(floor.index);
        this.flight(g, state, floors, floor.index, lower, index, (c.transportWidth ?? 1) * cell, false, 'up');
      });
    }
    for (const [key, dir] of state.escalators) {
      const [lowerText, xText] = key.split(':');
      const lower = Number(lowerText), x = Number(xText);
      const cellFloor = lower + 1 === CONFIG.LOBBY_FLOOR_INDEX ? lower : lower + 1;
      const width = (floors.get(cellFloor)?.cells[x]?.transportWidth ?? 1) * cell;
      this.flight(g, state, floors, cellFloor, lower, x, width, true, dir);
    }
  }

  private flight(
    g: RowBuckets, state: GameState, floors: Map<number, Floor>,
    cellFloor: number, lower: number, column: number, width: number,
    escalator: boolean, dir: string,
  ): void {
    const lobbyFloors = state.tower.lobbyHeight;
    const lowFloor = floors.get(lower), highFloor = floors.get(lower + 1);
    if (!lowFloor || !highFloor) return;
    const x = column * CONFIG.CELL_WIDTH_PX;
    const lowTop = floorTopY(lower, lobbyFloors), lowH = floorHeightPx(lowFloor, lobbyFloors);
    const highTop = floorTopY(lower + 1, lobbyFloors), highH = floorHeightPx(highFloor, lobbyFloors);
    const otherFloor = cellFloor === lower ? highFloor : lowFloor;
    const otherFree = otherFloor.index === CONFIG.LOBBY_FLOOR_INDEX || isTransportOrEmpty(otherFloor, column, width / CONFIG.CELL_WIDTH_PX);
    // Reserved stairwell background on the band(s) that hold the cells.
    for (const f of escalator ? [lowFloor, highFloor] : [cellFloor === lower ? lowFloor : highFloor]) {
      if (f.index === CONFIG.LOBBY_FLOOR_INDEX) continue;
      const top = floorTopY(f.index, lobbyFloors), h = floorHeightPx(f, lobbyFloors);
      const well = new Sprite(wellTexture(width, h - 2));
      well.position.set(x, top);
      well.roundPixels = true;
      g.add(well, top, h);
    }
    const span = otherFree
      ? { top: highTop + 2, bottom: lowTop + lowH - 2 }
      : cellFloor === lower
        ? { top: lowTop + 2, bottom: lowTop + lowH - 2 }
        : { top: highTop + 2, bottom: highTop + highH - 2 };
    const rise = span.bottom - span.top;
    if (rise <= 0 || width < 6) return;
    // Pixel-art flight (sprites/structure.ts), cached per size and kind; its
    // bottom row sits on the lower landing, the handrail rides 9 px above.
    const flight = new Sprite(flightTexture(width, rise, escalator, dir));
    flight.position.set(x, span.bottom - rise - 10);
    flight.roundPixels = true;
    g.add(flight, flight.y, rise + 10);
  }

  private drawLabels(state: GameState): void {
    this.labelLayer.clear();
    this.labels = [];
    for (const floor of state.tower.floors) {
      const b = floorBounds(state, floor.index);
      if (b.hi <= b.lo) continue;
      const name = floor.index <= 0 ? `B${1 - floor.index}` : floor.index === 1 ? '1F' : `${floor.index}F`;
      const text = new Text({
        text: name,
        resolution: 4,
        style: {
          fontSize: 9,
          fill: 0xffffff,
          fontFamily: 'Tahoma, Verdana, sans-serif',
          fontWeight: 'bold',
          stroke: { color: floor.index <= 0 ? 0x4a3018 : 0x1d3a6a, width: 2.5 },
        },
      });
      text.anchor.set(1, 0.5);
      text.scale.set(this.labelScale);
      const y = floorTopY(floor.index, state.tower.lobbyHeight);
      text.position.set(b.lo * CONFIG.CELL_WIDTH_PX - 5, Math.round(y + floorHeightPx(floor, state.tower.lobbyHeight) - CONFIG.FLOOR_HEIGHT_PX / 2));
      this.labels.push(text);
      this.labelLayer.add(text, text.y - 8, 16);
    }
  }
}

/** [lo, hi) minus sorted, non-overlapping holes, as the remaining runs. */
function subtract(lo: number, hi: number, holes: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let at = lo;
  for (const [a, b] of holes) {
    if (b <= at || a >= hi) continue;
    if (a > at) out.push([at, a]);
    at = Math.max(at, b);
  }
  if (at < hi) out.push([at, hi]);
  return out;
}

/** True when every cell in [column, column+cells) is free floor or transport. */
function isTransportOrEmpty(floor: Floor, column: number, cells: number): boolean {
  for (let c = column; c < column + cells; c++) {
    const content = floor.cells[c]?.content;
    if (content !== 'empty' && content !== 'stair' && content !== 'escalator') return false;
  }
  return true;
}

/** 64x32 tileable soil: tan base with darker clods and light grains. */
function soilTexture(): Texture {
  if (typeof document === 'undefined') return Texture.WHITE;
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Texture.WHITE;
  const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = hex(PALETTE.soil);
  ctx.fillRect(0, 0, 64, 32);
  let seed = 7;
  const rand = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(rand() * 64), y = Math.floor(rand() * 32);
    ctx.fillStyle = hex(rand() < 0.6 ? PALETTE.soilDark : PALETTE.soilLight);
    ctx.fillRect(x, y, rand() < 0.3 ? 2 : 1, 1);
  }
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(rand() * 60), y = Math.floor(rand() * 30);
    ctx.fillStyle = hex(PALETTE.soilDeep);
    ctx.fillRect(x, y, 3, 2);
    ctx.fillStyle = hex(PALETTE.soilLight);
    ctx.fillRect(x, y, 1, 1);
  }
  const texture = new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: 'nearest' }) });
  return texture;
}
