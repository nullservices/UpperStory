import { Particle, ParticleContainer } from 'pixi.js';
import { CONFIG } from '../data/config';
import {
  carWorldY,
  floorHeightPx,
  floorTopY,
  getFloor,
  patienceTicks,
  type ElevatorGroup,
  type GameState,
  type Person,
} from '../sim';
import { shaftWidth } from '../sim/elevators';
import { advanceAnimClock } from './animClock';
import { builtSpan, landingKey, landingQueues } from './landingQueues';
import { roomLighting } from './roomLighting';
import { carOutOfService } from './simCompat';
import type { Camera } from './camera';
import type { Motion } from './motion';
import { hash32 } from './sprites/pixmap';
import {
  OUTFITS,
  PERSON_H,
  PERSON_W,
  POSE_IDLE,
  POSE_WALK_LEFT,
  POSE_WALK_RIGHT,
  peopleAtlas,
  personFrame,
} from './sprites/people';

/** Person frame size in world px (7x12 pixel-art frames on a 12x24 cell). */
const FIGURE_W = PERSON_W;
const FIGURE_H = PERSON_H;
/** Horizontal spacing of people queued beside an elevator shaft. */
const QUEUE_PITCH = 5;
/** Milliseconds per walk-cycle frame. */
const WALK_FRAME_MS = 120;
/** Queue length before it folds into a second, staggered row. */
const QUEUE_ROW = 18;
/** A landing side with fewer free places than this sends its queue to the other side. */
const MIN_QUEUE_SLOTS = 4;

/** Live viewport size in CSS px (camera.screenToWorld is CSS-px based). */
export interface ViewportSize {
  width: number;
  height: number;
}

/** World-space rectangle currently on screen (cull target). */
interface WorldRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * People view: every person out in the tower, drawn each frame (people move
 * constantly) through one ParticleContainer — a single batched draw call with
 * per-frame position/color uploads, no per-person display objects. Riders are
 * positioned on the car that carries them (a rider's sim pos.floor stays at
 * the boarding floor until they disembark); waiting people line up beside
 * their shaft; people on stairs/escalators walk the drawn diagonal.
 *
 * Particles are pooled: one lightweight Particle per concurrently visible
 * person, grown lazily up to CONFIG.MAX_PEOPLE. The hidden tail sits at
 * alpha 0 so the container never adds/removes children while people stream
 * through the view. People outside the visible world rect are culled when a
 * camera + viewport are provided (constructor, optional).
 */
export class PeopleView {
  private readonly atlas = peopleAtlas();
  readonly container = new ParticleContainer<Particle>({
    texture: this.atlas.texture,
    dynamicProperties: { position: true, color: true, uvs: true },
    roundPixels: true,
  });
  private readonly pool: Particle[] = [];
  /** Pool prefix written as visible on the last draw; the rest is alpha-0. */
  private written = 0;
  /** Per-frame scratch, reused to avoid allocations with large crowds. */
  private readonly riderX = new Map<number, number>();
  private readonly riderY = new Map<number, number>();
  /** Riders inside a car whose doors are shut (hidden behind them). */
  private readonly enclosed = new Set<number>();
  private readonly queues = new Map<number, number>();
  private readonly groups: ElevatorGroup[] = [];
  /** Per-frame cache: queue places free on a landing side (key*2 + 0/1). */
  private readonly slots = new Map<number, number>();

  constructor(
    private readonly camera: Camera | null = null,
    private readonly viewport: (() => ViewportSize) | null = null,
  ) {
    this.container.eventMode = 'none';
  }

  draw(state: GameState, alpha = 1, motion?: Motion): void {
    const rect = this.visibleWorldRect();
    const H = CONFIG.FLOOR_HEIGHT_PX;
    const cell = CONFIG.CELL_WIDTH_PX;

    const riderX = this.riderX, riderY = this.riderY;
    riderX.clear(); riderY.clear();
    const enclosed = this.enclosed;
    enclosed.clear();
    const groups = this.groups;
    groups.length = 0;
    for (const group of state.elevatorGroups.values()) {
      groups.push(group);
      const carW = shaftWidth(group) * cell - 6;
      const perRow = Math.max(1, Math.floor((carW - FIGURE_W) / 4) + 1);
      for (const car of group.cars) {
        const y = motion?.carY(state, car.id, car.y, alpha) ?? carWorldY(car.y, state.tower.lobbyHeight);
        const feet = y + H - 4;
        // Riders show only while the doors stand open; a moving, idle or
        // broken car keeps them behind closed doors.
        if (car.state !== 'doors' || carOutOfService(car)) {
          for (const id of car.passengers) enclosed.add(id);
          continue;
        }
        car.passengers.forEach((id, index) => {
          const row = Math.floor(index / perRow) % 3;
          riderX.set(id, group.x * cell + 3 + (index % perRow) * 4 + (row === 1 ? 2 : 0));
          riderY.set(id, feet - FIGURE_H - row);
        });
      }
    }
    const queues = this.queues;
    queues.clear();
    this.slots.clear();
    landingQueues.clear();
    const lh = state.tower.lobbyHeight;

    let visible = 0;
    const time = state.tickCount + alpha;
    const anim = advanceAnimClock(state, alpha);
    const walkStep = Math.floor(anim / WALK_FRAME_MS);
    const frames = this.atlas.frames;
    // Vertical cull window: people standing on a floor whose band is off
    // screen are skipped before any layout work (most of a big tower's crowd).
    const cullTop = rect ? rect.top - FIGURE_H : 0;
    const cullBottom = rect ? rect.bottom + FIGURE_H : 0;
    const lobby = CONFIG.LOBBY_FLOOR_INDEX;
    for (const person of state.people.values()) {
      const st = person.state;
      if (st === 'offscreen') continue;
      if (rect && st !== 'riding' && st !== 'onStairs' && st !== 'onEscalator') {
        const f = Math.round(person.pos.floor);
        const top = floorTopY(f, lh);
        if (top > cullBottom || top + (f === lobby ? H * lh : H) < cullTop) continue;
      }
      let px = (motion?.personX(state, person, alpha) ?? person.pos.x) * cell;
      let py = personY(state, person);
      let pose = -1;
      // Out in the open people stay at full brightness (unless the power is
      // out); inside a room they take the room's lighting tint.
      let tint = roomLighting.open;
      if (person.state === 'riding') {
        if (enclosed.has(person.id)) continue;
        const rx = riderX.get(person.id);
        if (rx !== undefined) { px = rx; py = riderY.get(person.id)!; }
      } else if (person.state === 'waiting') {
        // Line up beside the shaft instead of stacking on one spot. SimTower
        // convention: people going up queue to the LEFT of the shaft, people
        // going down to the RIGHT (direction of the current route leg).
        const floor = Math.round(person.pos.floor);
        const group = shaftNear(groups, person.pos.x, floor);
        if (group) {
          const left = group.x * cell;
          const right = (group.x + shaftWidth(group)) * cell;
          const leg = person.route?.[person.legIndex];
          const goingUp = leg?.mode === 'elevator' ? leg.dir === 1 : px + FIGURE_W / 2 < (left + right) / 2;
          // Never line up inside a neighbouring shaft: use the free side.
          let before = goingUp;
          let slots = this.sideSlots(state, group, floor, before ? -1 : 1);
          if (slots < MIN_QUEUE_SLOTS) {
            const other = this.sideSlots(state, group, floor, before ? 1 : -1);
            if (other > slots) { before = !before; slots = other; }
          }
          const lk = landingKey(group.id, floor);
          const landing = landingQueues.get(lk);
          if (landing) {
            landing.count++;
            if (goingUp) landing.up++; else landing.down++;
            if (!before) landing.east++;
          } else {
            landingQueues.set(lk, { left, right, floor, y: floorTopY(floor, lh), count: 1, up: goingUp ? 1 : 0, down: goingUp ? 0 : 1, east: before ? 0 : 1 });
          }
          const key = -(lk * 2 + (before ? 1 : 2));
          const k = queues.get(key) ?? 0;
          queues.set(key, k + 1);
          // Two staggered rows fill the free floor beside the shaft; the rest
          // of a long queue stands hidden behind them (counted on the badge,
          // never drawn into a neighbouring shaft or off the tower's edge).
          if (k >= slots * 2) continue;
          const row = Math.floor(k / slots);
          const slot = k % slots;
          px = before
            ? left - FIGURE_W - 2 - slot * QUEUE_PITCH - row * 2
            : right + 2 + slot * QUEUE_PITCH + row * 2;
          py -= row;
        } else {
          const key = floor * 100000 + Math.round(px);
          const k = queues.get(key) ?? 0;
          queues.set(key, k + 1);
          if (k >= QUEUE_ROW * 2) continue;
          const row = Math.floor(k / QUEUE_ROW) % 2;
          const slot = k % QUEUE_ROW;
          px += slot * QUEUE_PITCH + row * 2;
          py -= row;
        }
      } else if (person.state === 'onStairs' || person.state === 'onEscalator') {
        const at = climbPosition(state, person);
        if (at) { px = at.x; py = at.y - FIGURE_H; }
      } else if (person.state === 'inTenant' || person.state === 'cleaning') {
        const tenant = state.tenants.get(person.activityTenantId >= 0 ? person.activityTenantId : person.tenantId);
        if (tenant && tenant.floor === Math.round(person.pos.floor)) {
          tint = roomLighting.rooms.get(tenant.id) ?? tint;
          const width = tenant.sizeCells * cell;
          const position = ((person.id * 37) % 101) / 100;
          const roam = person.id % 3 === 0 ? Math.sin(time / 28 + person.id) * 7 : Math.sin(time / 10 + person.id) * 0.6;
          if (person.id % 3 === 0) {
            // Strollers inside a room walk while they drift, idle at the turns.
            const drift = Math.cos(time / 28 + person.id);
            if (Math.abs(drift) > 0.35) pose = (drift > 0 ? POSE_WALK_RIGHT : POSE_WALK_LEFT) + ((walkStep + person.id) & 3);
          }
          px = tenant.x * cell + Math.min(width - 8, Math.max(4, 5 + position * (width - 14) + roam));
          const band = tenant.floor === CONFIG.LOBBY_FLOOR_INDEX ? H * state.tower.lobbyHeight : H;
          py = floorTopY(tenant.floor, state.tower.lobbyHeight) + band - FIGURE_H - 2;
        }
      }
      if (rect && !overlapsRect(px, py, rect)) continue;
      if (visible >= CONFIG.MAX_PEOPLE) break;
      const particle = this.particleAt(visible);
      visible++;
      particle.x = Math.round(px) - 1;
      particle.y = Math.round(py);
      const texture = frames[personFrame(person.kind, outfitOf(person), stressLevel(person), pose >= 0 ? pose : poseOf(person, walkStep))]!;
      if (particle.texture !== texture) particle.texture = texture;
      if (particle.alpha !== 1) particle.alpha = 1;
      if (particle.tint !== tint) particle.tint = tint;
    }
    // Hide the tail that was visible last frame but is gone/culled now.
    for (let i = visible; i < this.written; i++) this.pool[i]!.alpha = 0;
    this.written = visible;
  }

  /**
   * Queue places that fit on `side` of `group`'s landing before the edge of
   * the built floor or another shaft serving `floor` (cached per frame).
   */
  private sideSlots(state: GameState, group: ElevatorGroup, floor: number, side: -1 | 1): number {
    const key = landingKey(group.id, floor) * 2 + (side === 1 ? 1 : 0);
    let slots = this.slots.get(key);
    if (slots === undefined) {
      const cell = CONFIG.CELL_WIDTH_PX;
      const bounds = builtSpan(state, floor);
      // Free run of floor from the shaft edge outward, up to a full queue row.
      const edge = side === -1 ? group.x * cell : (group.x + shaftWidth(group)) * cell;
      let room = Math.max(0, side === -1 ? edge - bounds.lo * cell : bounds.hi * cell - edge);
      for (const other of this.groups) {
        if (other === group || floor < other.serviceLo || floor > other.serviceHi) continue;
        const gl = other.x * cell, gr = (other.x + shaftWidth(other)) * cell;
        const gap = side === -1 ? edge - gr : gl - edge;
        if (gap >= 0 && gap < room) room = gap;
      }
      slots = Math.min(QUEUE_ROW, Math.max(0, Math.floor((room - FIGURE_W - 4) / QUEUE_PITCH) + 1));
      this.slots.set(key, slots);
    }
    return slots;
  }

  /** Particle at `index`, growing the pool (never beyond MAX_PEOPLE). */
  private particleAt(index: number): Particle {
    while (this.pool.length <= index && this.pool.length < CONFIG.MAX_PEOPLE) {
      const p = new Particle({
        texture: this.atlas.frames[0]!,
        scaleX: 1,
        scaleY: 1,
        alpha: 0,
      });
      this.container.addParticle(p);
      this.pool.push(p);
    }
    const p = this.pool[index];
    if (!p) throw new Error('people particle pool exhausted'); // guarded by the MAX_PEOPLE break
    return p;
  }

  /**
   * World rect under the screen viewport, or null when no camera/viewport
   * were given (draw everything — the pre-cull behavior).
   */
  private visibleWorldRect(): WorldRect | null {
    if (!this.camera || !this.viewport) return null;
    const vp = this.viewport();
    // Zoom is positive and there is no rotation, so screen (0,0) is the
    // world top-left and (w,h) the world bottom-right.
    const tl = this.camera.screenToWorld(0, 0);
    const br = this.camera.screenToWorld(vp.width, vp.height);
    return { left: tl.x, right: br.x, top: tl.y, bottom: br.y };
  }
}

/** Shaft (serving `floor`) whose span the cell-x position touches, if any. */
function shaftNear(groups: ElevatorGroup[], x: number, floor: number): ElevatorGroup | undefined {
  for (const group of groups) {
    if (floor < group.serviceLo || floor > group.serviceHi) continue;
    if (x >= group.x - 1.5 && x <= group.x + shaftWidth(group) + 1.5) return group;
  }
  return undefined;
}

/**
 * Feet position of a person mid-flight on stairs or an escalator, following
 * the diagonal the tower view draws from the lower slab (left) up across the
 * upper band (right); the climber steps off where it crosses the upper slab.
 */
function climbPosition(state: GameState, p: Person): { x: number; y: number } | null {
  const leg = p.route?.[p.legIndex];
  if (!leg || leg.x === undefined) return null;
  const lower = Math.min(leg.from, leg.to);
  const lowFloor = getFloor(state.tower, lower);
  if (!lowFloor || !getFloor(state.tower, lower + 1)) return null;
  const lh = state.tower.lobbyHeight;
  const ticks = p.state === 'onStairs' ? CONFIG.STAIR_TICKS_PER_FLOOR : CONFIG.ESCALATOR_TICKS_PER_FLOOR;
  const total = ticks * Math.max(1, Math.abs(leg.to - leg.from));
  const t = Math.min(1, Math.max(0, 1 - p.stairsTicksLeft / total));
  const up = leg.to > leg.from ? t : 1 - t;
  const bottom = floorTopY(lower, lh) + floorHeightPx(lowFloor, lh) - 2;
  const top = floorTopY(lower + 1, lh) + 2;
  const landing = floorTopY(lower, lh) - 2;
  const reach = (bottom - landing) / Math.max(1, bottom - top);
  const width = 8 * CONFIG.CELL_WIDTH_PX - 4;
  return {
    x: leg.x * CONFIG.CELL_WIDTH_PX + 2 + up * reach * width - FIGURE_W / 2,
    y: bottom - up * (bottom - landing),
  };
}

/** Does the figure box at (px, py) intersect the visible world rect? */
function overlapsRect(px: number, py: number, rect: WorldRect): boolean {
  return (
    px + FIGURE_W > rect.left &&
    px < rect.right &&
    py + FIGURE_H > rect.top &&
    py < rect.bottom
  );
}

/** World y (top of the figure) for a visible person standing on its floor slab. */
function personY(
  state: GameState,
  p: Person,
): number {
  if (p.state === 'riding') {
    // The car itself is where the person is; pos.floor is only the boarding
    // floor until disembarkation (spec formula used as a safety fallback).
    return carWorldY(p.pos.floor, state.tower.lobbyHeight) + CONFIG.FLOOR_HEIGHT_PX - 4 - FIGURE_H;
  }
  const floorIndex = Math.round(p.pos.floor);
  const floor = getFloor(state.tower, floorIndex);
  const height = floor ? floorHeightPx(floor, state.tower.lobbyHeight) : CONFIG.FLOOR_HEIGHT_PX;
  return floorTopY(floorIndex, state.tower.lobbyHeight) + height - FIGURE_H - 2;
}

/** Outfit for a person: stable per id, so everyone keeps their clothes. */
function outfitOf(p: Person): number {
  return hash32(p.id) % OUTFITS;
}

/**
 * Stress level 0 (own clothes) / 1 (pink) / 2 (red) as a waiting person's
 * patience runs out (the classic stressed-crowd read).
 */
function stressLevel(p: Person): number {
  if (p.state !== 'waiting') return 0;
  const t = p.waitTicks / patienceTicks(p.stress);
  return t < 0.4 ? 0 : t < 0.75 ? 1 : 2;
}

/** Idle (front-facing) or a side-on walk frame in the direction of travel. */
function poseOf(p: Person, walkStep: number): number {
  let dir = 0;
  if (p.state === 'walking') {
    const dx = (p.target?.x ?? p.destination?.x ?? p.pos.x) - p.pos.x;
    dir = dx > 0.01 ? 1 : dx < -0.01 ? -1 : 0;
  } else if (p.state === 'onStairs' || p.state === 'onEscalator') {
    const leg = p.route?.[p.legIndex];
    // Flights rise left to right: climbing faces right, descending left.
    dir = leg && leg.to < leg.from ? -1 : 1;
    if (p.state === 'onEscalator') return (dir > 0 ? POSE_WALK_RIGHT : POSE_WALK_LEFT) + 1;
  }
  if (dir === 0) return POSE_IDLE;
  const frame = (walkStep + p.id) & 3;
  return (dir > 0 ? POSE_WALK_RIGHT : POSE_WALK_LEFT) + frame;
}
