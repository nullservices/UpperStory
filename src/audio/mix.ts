import type { GameState } from '../sim/state';
import type { Tenant } from '../sim/tenants';
import { carWorldY, shaftWidth } from '../sim/elevators';
import { floorTopY } from '../sim/tower';
import { CONFIG } from '../data/config';

/**
 * Pure mixing helpers for the tower's sound: no Web Audio here, so these are
 * unit-tested directly. Everything takes plain numbers or read-only sim
 * state and returns decisions (levels, pans, whether a cue may play).
 */

export interface View { x: number; y: number; zoom: number; width: number; height: number }
export interface Rect { left: number; right: number; top: number; bottom: number }

export const clamp = (v: number, lo = 0, hi = 1): number => (v < lo ? lo : v > hi ? hi : v);
export const smoothstep = (a: number, b: number, v: number): number => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export const dbToGain = (db: number): number => Math.pow(10, db / 20);

// ---------------------------------------------------------------- preferences

export interface Preferences {
  muted: boolean;
  /** Master volume. */
  volume: number;
  /** Ambience bus: offices, crowds, street, weather, machinery. */
  ambience: number;
  /** World effects bus: bells, construction, alarms, fanfares. */
  effects: number;
  /** Interface bus: clicks, placement, error buzz. */
  interface: number;
}
export const DEFAULT_PREFERENCES: Readonly<Preferences> = { muted: false, volume: 0.5, ambience: 0.5, effects: 0.7, interface: 0.5 };

/** Merge saved JSON over the defaults, clamping levels and ignoring junk. */
export function sanitizePreferences(saved: unknown): Preferences {
  const out: Preferences = { ...DEFAULT_PREFERENCES };
  if (!saved || typeof saved !== 'object') return out;
  const record = saved as Record<string, unknown>;
  if (typeof record.muted === 'boolean') out.muted = record.muted;
  for (const key of ['volume', 'ambience', 'effects', 'interface'] as const) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = clamp(value);
  }
  return out;
}

/**
 * Bus gains from the preferences. The fixed trims keep a full-volume mix
 * comfortably under the limiter: ambience is a bed, the interface is light.
 */
export function busGains(p: Preferences): { master: number; ambience: number; effects: number; ui: number } {
  // Perceptual taper so the low half of a slider stays usable.
  const taper = (v: number): number => Math.pow(v, 1.6);
  return {
    master: p.muted ? 0 : taper(p.volume) * 2,
    ambience: taper(p.ambience) * 1.2,
    effects: taper(p.effects) * 1.6,
    ui: taper(p.interface) * 2,
  };
}

// ---------------------------------------------------------------- rate & voice limiting

/** Per-key cooldowns plus token buckets for bursty cues (bells, pops). */
export class RateLimiter {
  private readonly last = new Map<string, number>();
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  /** True (and records the play) when `key` has been quiet for `interval` seconds. */
  allow(key: string, now: number, interval: number): boolean {
    if (now - (this.last.get(key) ?? -Infinity) < interval) return false;
    this.last.set(key, now);
    return true;
  }

  /** Mark a key as just played without checking (e.g. to suppress a follow-up cue). */
  touch(key: string, now: number): void { this.last.set(key, now); }

  /** Token bucket: up to `capacity` plays at once, refilling `perSecond`. */
  bucket(key: string, now: number, capacity: number, perSecond: number): boolean {
    let b = this.buckets.get(key);
    if (!b) { b = { tokens: capacity, at: now }; this.buckets.set(key, b); }
    b.tokens = Math.min(capacity, b.tokens + Math.max(0, now - b.at) * perSecond);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  reset(): void { this.last.clear(); this.buckets.clear(); }
}

/** Voice priority: ambient detail < world effect < interface < important event. */
export const Priority = { Detail: 0, World: 1, Interface: 2, Event: 3 } as const;
export type Priority = typeof Priority[keyof typeof Priority];

/**
 * Caps concurrent one-shot sounds. A sound counts as one voice for its
 * whole duration. Low-priority detail is refused well before the cap, so
 * important cues (rating fanfare, fire alarm) always find room.
 */
export class VoicePool {
  private ends: number[] = [];
  constructor(readonly max = 24) {}

  active(now: number): number {
    this.ends = this.ends.filter(end => end > now);
    return this.ends.length;
  }

  acquire(now: number, duration: number, priority: Priority): boolean {
    const used = this.active(now);
    const limit = priority === Priority.Detail ? this.max * 0.5
      : priority === Priority.World ? this.max * 0.8
        : priority === Priority.Interface ? this.max : this.max + 8;
    if (used >= limit) return false;
    this.ends.push(now + duration);
    return true;
  }

  clear(): void { this.ends = []; }
}

// ---------------------------------------------------------------- space

/** World rect (zoom-1 px) under the screen. */
export function visibleRect(view: View): Rect {
  const z = view.zoom || 1;
  return { left: -view.x / z, right: (view.width - view.x) / z, top: -view.y / z, bottom: (view.height - view.y) / z };
}

/** Zoomed-out views sound a little further away; device pixel ratio cancels out. */
export function zoomDistance(zoom: number, dpr = 1): number {
  return clamp(0.55 + 0.45 * (zoom / (dpr || 1)), 0.55, 1);
}

/**
 * Pan and level for a sound at screen point (sx, sy): full level on screen,
 * falling off smoothly with the distance outside it (inaudible a couple of
 * screens away). Pan follows the horizontal position, never hard-left/right.
 */
export function spatial(sx: number, sy: number, view: View, dpr = 1): { pan: number; gain: number } {
  const w = Math.max(1, view.width), h = Math.max(1, view.height);
  const dx = sx < 0 ? -sx : sx > w ? sx - w : 0;
  const dy = sy < 0 ? -sy : sy > h ? sy - h : 0;
  const d = Math.hypot(dx, dy) / Math.max(w, h);
  const falloff = 1 / (1 + (d / 0.35) * (d / 0.35));
  const gain = falloff < 0.04 ? 0 : falloff * zoomDistance(view.zoom, dpr);
  return { pan: clamp((sx / w) * 2 - 1, -1, 1) * 0.75, gain };
}

/** Same as `spatial` for a world-space point. */
export function spatialWorld(wx: number, wy: number, view: View, dpr = 1): { pan: number; gain: number } {
  return spatial(view.x + wx * view.zoom, view.y + wy * view.zoom, view, dpr);
}

/** World box of a tenant's floor band (left..right, top..bottom). */
export function tenantBox(t: Tenant, lobbyHeight: number): Rect {
  const cell = CONFIG.CELL_WIDTH_PX, fh = CONFIG.FLOOR_HEIGHT_PX;
  const top = floorTopY(t.floor, lobbyHeight);
  return { left: t.x * cell, right: (t.x + t.sizeCells) * cell, top, bottom: top + (t.floor === CONFIG.LOBBY_FLOOR_INDEX ? fh * lobbyHeight : fh) };
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

// ---------------------------------------------------------------- time of day

/** Hour of day (0..24) from the calendar minute (420..1860). */
export const hourOf = (minuteOfDay: number): number => (minuteOfDay % 1440) / 60;
/** 0 at night, 1 in daylight, with dawn/dusk ramps. */
export const daylight = (h: number): number => smoothstep(5.5, 7.5, h) * (1 - smoothstep(18.5, 20.5, h));
/** Office working hours. */
export const workHours = (h: number): number => smoothstep(7.5, 9, h) * (1 - smoothstep(17, 19, h));
/** Bird song: a dawn chorus with a smaller evening encore. */
export const birdSong = (h: number): number => Math.max(
  smoothstep(5.5, 7, h) * (1 - smoothstep(9, 11.5, h)),
  0.35 * smoothstep(16.5, 17.5, h) * (1 - smoothstep(18.5, 19.5, h)),
  0.15 * daylight(h),
);
/** Meal-time lift for restaurants and fast food. */
export const mealTimes = (h: number): number => 0.45 + 0.55 * Math.max(
  smoothstep(11, 12, h) * (1 - smoothstep(13.5, 14.5, h)),
  smoothstep(17.5, 18.5, h) * (1 - smoothstep(21, 22.5, h)),
);

// ---------------------------------------------------------------- ambience

const COMMERCIAL = new Set(['fastfood', 'restaurant', 'shop', 'cinema', 'partyHall', 'bank', 'rooftopPool']);
const DINING = new Set(['fastfood', 'restaurant', 'partyHall']);

export interface Site { x: number; y: number }

/** Ambience levels (0..1 before bus gain) and positions derived from the view. */
export interface AmbienceMix {
  office: number; officePan: number;
  crowd: number; crowdPan: number;
  /** Share of the crowd that is dining (cutlery clinks). */
  dining: number;
  traffic: number;
  night: number;
  birds: number;
  rain: number;
  machine: number; machinePan: number;
  motor: number; motorPan: number; motorCars: number;
  /** World points of visible construction sites (up to 6). */
  construction: Site[];
  /** 0..1: how much of the street is in earshot. */
  ground: number;
  blackout: boolean;
  /** An open helipad exists somewhere (helicopter traffic is possible). */
  helipad: boolean;
}

export const SILENT_MIX: Readonly<AmbienceMix> = {
  office: 0, officePan: 0, crowd: 0, crowdPan: 0, dining: 0, traffic: 0, night: 0, birds: 0, rain: 0,
  machine: 0, machinePan: 0, motor: 0, motorPan: 0, motorCars: 0, construction: [], ground: 0, blackout: false, helipad: false,
};

export function blackoutOn(state: GameState): boolean {
  return state.tickCount < (state.campaign.blackoutUntilTick ?? 0);
}

/**
 * What the camera "hears": each layer is weighted by how much of the screen
 * its sources cover (offices and shops in view, shafts, the street line) and
 * by the time of day. Read-only on the sim state.
 */
export function ambienceMix(state: GameState, view: View, dpr = 1): AmbienceMix {
  const rect = visibleRect(view);
  const lh = state.tower.lobbyHeight;
  const cellArea = CONFIG.CELL_WIDTH_PX * CONFIG.FLOOR_HEIGHT_PX;
  const screenCells = Math.max(1, ((rect.right - rect.left) * (rect.bottom - rect.top)) / cellArea);
  const near = zoomDistance(view.zoom, dpr);
  const h = hourOf(state.calendar.minuteOfDay);
  const day = daylight(h);
  const weekend = (state.calendar.day - 1) % CONFIG.QUARTER_DAYS === 2;
  const blackout = blackoutOn(state);
  const midX = (rect.left + rect.right) / 2, halfW = Math.max(1, (rect.right - rect.left) / 2);
  const panOf = (x: number): number => clamp((x - midX) / halfW, -1, 1) * 0.6;

  let officeCells = 0, officeX = 0, crowdCells = 0, crowdX = 0, diningCells = 0;
  const construction: Site[] = [];
  let helipad = false;
  for (const t of state.tenants.values()) {
    if (t.type === 'helipad' && t.state === 'open') helipad = true;
    const box = tenantBox(t, lh);
    const area = overlap(box, rect);
    if (area <= 0) continue;
    const cells = area / cellArea;
    const cx = (Math.max(box.left, rect.left) + Math.min(box.right, rect.right)) / 2;
    if (t.state === 'constructing') {
      if (construction.length < 6) construction.push({ x: cx, y: (box.top + box.bottom) / 2 });
      continue;
    }
    if (t.state !== 'open') continue;
    const busy = t.capacity > 0 ? clamp(t.occupancy / t.capacity) : 0;
    if (t.type === 'office') {
      const w = cells * (0.25 + 0.75 * busy);
      officeCells += w; officeX += cx * w;
    } else if (COMMERCIAL.has(t.type)) {
      const w = cells * (0.15 + 0.85 * busy) * (DINING.has(t.type) ? mealTimes(h) : 1);
      crowdCells += w; crowdX += cx * w;
      if (DINING.has(t.type)) diningCells += w;
    }
  }

  let shaftArea = 0, shaftX = 0, moving = 0, motorX = 0;
  for (const group of state.elevatorGroups.values()) {
    const left = group.x * CONFIG.CELL_WIDTH_PX, right = (group.x + shaftWidth(group)) * CONFIG.CELL_WIDTH_PX;
    const top = floorTopY(group.serviceHi, lh), bottom = floorTopY(group.serviceLo, lh) + CONFIG.FLOOR_HEIGHT_PX;
    const area = overlap({ left, right, top, bottom }, rect) / cellArea;
    if (area > 0) { shaftArea += area; shaftX += area * (left + right) / 2; }
    for (const car of group.cars) {
      if (car.state !== 'moving' || car.outOfService) continue;
      const cy = carWorldY(car.y, lh);
      if (cy >= rect.top - 48 && cy <= rect.bottom + 48 && right >= rect.left && left <= rect.right) { moving++; motorX += (left + right) / 2; }
    }
  }

  // Street line (world y = 0) in screen px; full level while on screen.
  const groundY = view.y;
  const off = groundY < 0 ? -groundY : groundY > view.height ? groundY - view.height : 0;
  const ground = 1 / (1 + Math.pow(off / Math.max(1, view.height * 0.6), 2));
  const raining = state.campaign.weather === 'rain';
  const power = blackout ? 0.25 : 1;

  return {
    office: clamp(officeCells / (screenCells * 0.12)) * near * (0.12 + 0.88 * workHours(h)) * (weekend ? 0.35 : 1) * power,
    officePan: officeCells > 0 ? panOf(officeX / officeCells) : 0,
    crowd: clamp(crowdCells / (screenCells * 0.08)) * near * (0.2 + 0.8 * smoothstep(7, 9, h) * (1 - smoothstep(22, 24, h))),
    crowdPan: crowdCells > 0 ? panOf(crowdX / crowdCells) : 0,
    dining: crowdCells > 0 ? diningCells / crowdCells : 0,
    traffic: ground * (0.25 + 0.75 * day) * (raining ? 1.15 : 1),
    night: ground * (1 - day) * (raining ? 0.2 : 1),
    birds: ground * birdSong(h) * (raining ? 0 : 1),
    rain: raining ? 0.55 + 0.45 * ground : 0,
    machine: blackout ? 0 : clamp(shaftArea / 60) * near,
    machinePan: shaftArea > 0 ? panOf(shaftX / shaftArea) : 0,
    motor: blackout ? 0 : clamp(moving / 4) * near,
    motorPan: moving > 0 ? panOf(motorX / moving) : 0,
    motorCars: moving,
    construction,
    ground,
    blackout,
    helipad,
  };
}

// ---------------------------------------------------------------- scheduling

/** Probability that a Poisson process at `rate` per second fires within `dt`. */
export const chance = (rate: number, dt: number): number => 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt));

/** Shaft-type bell: two-tone pitches (Hz), timbre and length. */
export function bellVoice(kind: 'standard' | 'service' | 'express', goingUp: boolean): { notes: [number, number]; bright: number; decay: number } {
  const base: [number, number] = kind === 'express' ? [1318.5, 1046.5] : kind === 'service' ? [784, 659.3] : [1046.5, 880];
  return {
    notes: goingUp ? [base[1], base[0]] : base,
    bright: kind === 'express' ? 1 : kind === 'service' ? 0.25 : 0.6,
    decay: kind === 'express' ? 1.6 : kind === 'service' ? 0.7 : 1.15,
  };
}

// ---------------------------------------------------------------- helicopter (mirrors render/helicopters.ts)

export const HELI = { APPROACH_MS: 7000, SPOOLDOWN_MS: 4000, SPOOLUP_MS: 2600, DEPART_MS: 7000, MIN_STAY_MS: 2500, COSMETIC_STAY_MS: 9000, FLY_DIST: 900, ALTITUDE: 190, SLOT_MIN: 120, CHANCE: 55 };
export type HeliPhase = 'approach' | 'landed' | 'spoolup' | 'depart';
export interface HeliFlight { vip: boolean; dir: 1 | -1; phase: HeliPhase; since: number }

/** Same integer hash as the sprite code, so cosmetic flights line up with the art. */
export function hash32(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * A copy of the helicopter view's flight schedule (VIP visits plus the
 * cosmetic flights every couple of game hours), run on the same pause-aware
 * animation clock so the rotor sound follows the drawn helicopter.
 */
export class HeliTracker {
  readonly flights = new Map<number, HeliFlight>();
  private serial = 0;
  private lastSlot = -1;
  private owner: GameState | null = null;

  update(state: GameState, anim: number, forced = false): void {
    if (this.owner !== state) { this.owner = state; this.flights.clear(); this.lastSlot = -1; }
    const pads: Tenant[] = [];
    for (const t of state.tenants.values()) if (t.type === 'helipad' && t.state === 'open') pads.push(t);
    for (const id of this.flights.keys()) if (!pads.some(p => p.id === id)) this.flights.delete(id);
    if (!pads.length) return;
    const gameMinute = state.calendar.day * 1440 + state.calendar.minuteOfDay;
    const slot = Math.floor(gameMinute / HELI.SLOT_MIN);
    const roll = hash32(slot * 7919 + 17);
    const due = slot !== this.lastSlot && roll % 100 < HELI.CHANCE && gameMinute - slot * HELI.SLOT_MIN >= (roll >>> 8) % (HELI.SLOT_MIN - 30);
    for (const pad of pads) {
      const vip = state.campaign.incidents.some(i => i.kind === 'vip' && (i.arrivalFloor === undefined || i.arrivalFloor === pad.floor));
      let f = this.flights.get(pad.id);
      if (!f) {
        if (!vip && !due && !forced) continue;
        const seed = hash32(++this.serial * 131 + pad.id);
        f = { vip, dir: seed & 4 ? 1 : -1, phase: 'approach', since: anim };
        this.flights.set(pad.id, f);
        if (!vip) this.lastSlot = slot;
        continue;
      }
      if (vip && f.phase !== 'depart' && f.phase !== 'spoolup') f.vip = true;
      const age = anim - f.since;
      if (f.phase === 'approach' && age >= HELI.APPROACH_MS) { f.phase = 'landed'; f.since = anim; }
      else if (f.phase === 'landed' && (f.vip ? !vip && age >= HELI.MIN_STAY_MS : age >= HELI.COSMETIC_STAY_MS)) { f.phase = 'spoolup'; f.since = anim; }
      else if (f.phase === 'spoolup' && age >= HELI.SPOOLUP_MS) { f.phase = 'depart'; f.since = anim; }
      else if (f.phase === 'depart' && age >= HELI.DEPART_MS) this.flights.delete(pad.id);
    }
    if (due) this.lastSlot = slot;
  }
}

/** Rotor speed (0..1) and offset from the pad (world px) for a flight at `anim`. */
export function heliPose(f: HeliFlight, anim: number): { speed: number; dx: number; alt: number } {
  const age = anim - f.since;
  if (f.phase === 'approach') {
    const t = age / HELI.APPROACH_MS;
    const run = 1 - Math.pow(1 - Math.min(1, t / 0.8), 2);
    return { speed: 1, dx: -f.dir * HELI.FLY_DIST * (1 - run), alt: HELI.ALTITUDE * (1 - smoothstep(0, 1, (t - 0.4) / 0.6)) };
  }
  if (f.phase === 'landed') return { speed: Math.max(0, 1 - age / HELI.SPOOLDOWN_MS), dx: 0, alt: 0 };
  if (f.phase === 'spoolup') return { speed: Math.min(1, age / (HELI.SPOOLUP_MS * 0.8)), dx: 0, alt: 0 };
  const t = age / HELI.DEPART_MS;
  return { speed: 1, dx: f.dir * HELI.FLY_DIST * Math.pow(Math.max(0, (t - 0.2) / 0.8), 2), alt: HELI.ALTITUDE * smoothstep(0, 1, t / 0.55) };
}
