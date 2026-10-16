import { Container, Sprite, Texture } from 'pixi.js';
import { CONFIG } from '../data/config';
import type { GameState, Tenant } from '../sim';
import { floorTopY } from '../sim/tower';
import { hash32 } from './sprites/pixmap';
import { helipadTouchdown } from './sprites/rooms';
import { HELI_W, TAIL_SIZE, TAIL_X, TAIL_Y, helicopterArt, type Livery } from './sprites/helicopter';

/**
 * Helipad traffic (purely presentational): while a VIP visit is on and an
 * open helipad exists, a helicopter flies in from off screen, descends onto
 * the pad, parks with its rotor slowing to a stop for as long as the visit
 * lasts, then spools up, lifts off and flies away. Between visits occasional
 * cosmetic flights (medevac or executive) drop in every couple of game hours,
 * wait briefly and leave. Timing runs on the pause-aware animation clock;
 * flights off screen still progress but are not drawn.
 *
 * Art-review aid: `?flyover=helicopter` keeps flights landing back to back
 * on any open helipad.
 */

const APPROACH_MS = 7000;
const SPOOLDOWN_MS = 4000;
const SPOOLUP_MS = 2600;
const DEPART_MS = 7000;
/** Shortest VIP stay on the pad (a visit that ends mid-approach still lands). */
const MIN_STAY_MS = 2500;
const COSMETIC_STAY_MS = 9000;
/** Horizontal run-in / run-out distance and cruise altitude (world px). */
const FLY_DIST = 900;
const ALTITUDE = 190;
/** Cosmetic flight cadence: one chance per slot of game minutes. */
const COSMETIC_SLOT_MIN = 120;
const COSMETIC_CHANCE = 55;
/** Rotor frame period at full speed (anim ms). */
const ROTOR_MS = 45;

const FORCED = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('flyover') === 'helicopter';

type Phase = 'approach' | 'landed' | 'spoolup' | 'depart';

interface Flight {
  livery: Livery;
  vip: boolean;
  /** +1 flies left→right (faces right), -1 the other way. */
  dir: 1 | -1;
  phase: Phase;
  since: number;
  rotorPhase: number;
  lastAnim: number;
}

interface Rect { left: number; right: number; top: number; bottom: number }

const smooth = (t: number): number => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };

export class HelicopterView {
  readonly container = new Container();
  private readonly flights = new Map<number, Flight>();
  private readonly pool: Sprite[] = [];
  private used = 0;
  private serial = 0;
  private lastSlot = -1;
  private owner: GameState | null = null;

  constructor() {
    this.container.eventMode = 'none';
  }

  draw(state: GameState, anim: number, rect: Rect | null): void {
    this.used = 0;
    if (this.owner !== state) { this.owner = state; this.flights.clear(); this.lastSlot = -1; }
    const pads: Tenant[] = [];
    for (const t of state.tenants.values()) if (t.type === 'helipad' && t.state === 'open') pads.push(t);
    for (const id of this.flights.keys()) if (!pads.some(p => p.id === id)) this.flights.delete(id);
    if (pads.length) this.update(state, pads, anim);
    const cell = CONFIG.CELL_WIDTH_PX;
    for (const pad of pads) {
      const f = this.flights.get(pad.id);
      if (!f) continue;
      // Land exactly where the room art's touchdown point is (room-local).
      const touch = helipadTouchdown(pad.sizeCells * cell, CONFIG.FLOOR_HEIGHT_PX);
      const padX = pad.x * cell + touch.x;
      const skidY = floorTopY(pad.floor, state.tower.lobbyHeight) + touch.y;
      this.drawFlight(f, anim, padX, skidY, rect);
    }
    for (let i = this.used; i < this.pool.length; i++) this.pool[i]!.visible = false;
  }

  private update(state: GameState, pads: Tenant[], anim: number): void {
    const vipFor = (pad: Tenant): boolean => state.campaign.incidents.some(i =>
      i.kind === 'vip' && (i.arrivalFloor === undefined || i.arrivalFloor === pad.floor));
    // Cosmetic cadence on game time: each slot may carry one flight.
    const gameMinute = state.calendar.day * 1440 + state.calendar.minuteOfDay;
    const slot = Math.floor(gameMinute / COSMETIC_SLOT_MIN);
    const roll = hash32(slot * 7919 + 17);
    const due = slot !== this.lastSlot && roll % 100 < COSMETIC_CHANCE &&
      gameMinute - slot * COSMETIC_SLOT_MIN >= (roll >>> 8) % (COSMETIC_SLOT_MIN - 30);
    for (const pad of pads) {
      const vip = vipFor(pad);
      let f = this.flights.get(pad.id);
      if (!f) {
        if (!vip && !due && !FORCED) continue;
        const seed = hash32(++this.serial * 131 + pad.id);
        const livery: Livery = vip ? (seed % 2 ? 'executive' : 'charter') : seed % 3 === 0 ? 'executive' : 'medevac';
        f = { livery, vip, dir: seed & 4 ? 1 : -1, phase: 'approach', since: anim, rotorPhase: 0, lastAnim: anim };
        this.flights.set(pad.id, f);
        if (!vip) this.lastSlot = slot;
        continue;
      }
      if (vip && f.phase !== 'depart' && f.phase !== 'spoolup') f.vip = true;
      const age = anim - f.since;
      if (f.phase === 'approach' && age >= APPROACH_MS) this.enter(f, 'landed', anim);
      else if (f.phase === 'landed') {
        const leave = f.vip ? !vip && age >= MIN_STAY_MS : age >= COSMETIC_STAY_MS;
        if (leave) this.enter(f, 'spoolup', anim);
      } else if (f.phase === 'spoolup' && age >= SPOOLUP_MS) this.enter(f, 'depart', anim);
      else if (f.phase === 'depart' && age >= DEPART_MS) this.flights.delete(pad.id);
    }
    if (due) this.lastSlot = slot;
  }

  private enter(f: Flight, phase: Phase, anim: number): void {
    f.phase = phase;
    f.since = anim;
  }

  private drawFlight(f: Flight, anim: number, padX: number, skidY: number, rect: Rect | null): void {
    const age = anim - f.since;
    let x = padX, alt = 0, speed = 1;
    if (f.phase === 'approach') {
      const t = age / APPROACH_MS;
      // Run in at altitude, flaring and descending over the second half.
      const run = 1 - Math.pow(1 - Math.min(1, t / 0.8), 2);
      x = padX - f.dir * FLY_DIST * (1 - run);
      alt = ALTITUDE * (1 - smooth((t - 0.4) / 0.6));
    } else if (f.phase === 'landed') {
      speed = Math.max(0, 1 - age / SPOOLDOWN_MS);
    } else if (f.phase === 'spoolup') {
      speed = Math.min(1, age / (SPOOLUP_MS * 0.8));
    } else {
      const t = age / DEPART_MS;
      // Lift straight up first, then accelerate away while climbing.
      alt = ALTITUDE * smooth(t / 0.55);
      x = padX + f.dir * FLY_DIST * Math.pow(Math.max(0, (t - 0.2) / 0.8), 2);
    }
    // Rotor phase integrates speed, so the blades visibly slow to a stop.
    const dt = Math.max(0, Math.min(100, anim - f.lastAnim));
    f.lastAnim = anim;
    f.rotorPhase += (dt * speed) / ROTOR_MS;

    const left = Math.round(x - HELI_W / 2);
    const top = Math.round(skidY - 13 - alt);
    if (rect && (left + HELI_W < rect.left || left > rect.right || top + 14 < rect.top || top > rect.bottom)) return;
    const art = helicopterArt();
    const flip = f.dir === -1;
    const step = Math.floor(f.rotorPhase);
    // Fast: blurred frames; slowing: alternate blade positions; stopped: still.
    const rotor = speed <= 0 ? 0 : speed < 0.3 ? (step % 2 === 0 ? 0 : 2) : 1 + (step % 3);
    const tail = speed <= 0 ? 0 : speed < 0.3 ? step % 2 : 1 + (step % 2);
    this.put(art.body[f.livery], left, top, HELI_W, flip, 1);
    this.put(art.rotor[rotor]!, left, top, HELI_W, flip, rotor === 0 ? 1 : 0.85);
    this.put(art.tail[tail]!, left + (flip ? HELI_W - TAIL_X - TAIL_SIZE : TAIL_X), top + TAIL_Y, TAIL_SIZE, flip, 1);
    // Anti-collision beacon on the fin, blinking while the engine runs.
    if (speed > 0 && Math.floor(anim / 450) % 2 === 0) {
      const beacon = this.put(Texture.WHITE, left + (flip ? HELI_W - 2 : 1), top + 2, 1, false, 1);
      beacon.width = 1; beacon.height = 1;
      beacon.tint = f.livery === 'medevac' ? 0x5aa0ff : 0xff3030;
    }
  }

  /** Pooled sprite at (x, y); `flip` mirrors it inside its `w`-wide box. */
  private put(texture: Texture, x: number, y: number, w: number, flip: boolean, alpha: number): Sprite {
    let s = this.pool[this.used];
    if (!s) {
      s = new Sprite();
      s.roundPixels = true;
      this.pool.push(s);
      this.container.addChild(s);
    }
    this.used++;
    s.texture = texture;
    s.scale.set(flip ? -1 : 1, 1);
    s.position.set(flip ? x + w : x, y);
    s.tint = 0xffffff;
    s.alpha = alpha;
    s.visible = true;
    return s;
  }
}
