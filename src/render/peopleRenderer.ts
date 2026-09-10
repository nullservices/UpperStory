import { Particle, ParticleContainer, Texture } from 'pixi.js';
import { CONFIG } from '../data/config';
import {
  carWorldY,
  floorHeightPx,
  floorTopY,
  getFloor,
  patienceTicks,
  type GameState,
  type Person,
} from '../sim';
import type { Camera } from './camera';
import type { Motion } from './motion';
import { PERSON_COLORS } from './palette';

/** Person figure size in world px (4 wide, 8 tall on a 12x20 cell). */
const FIGURE_W = 4;
const FIGURE_H = 8;
/** Color an impatient waiter blends toward (matches the call lamp red). */
const STRESS_RED = 0xe05555;

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
 * the boarding floor until they disembark).
 *
 * Particles are pooled: one lightweight Particle per concurrently visible
 * person, grown lazily up to CONFIG.MAX_PEOPLE. The hidden tail sits at
 * alpha 0 so the container never adds/removes children while people stream
 * through the view. People outside the visible world rect are culled when a
 * camera + viewport are provided (constructor, optional).
 */
export class PeopleView {
  private readonly figureTexture = createFigureTexture();
  readonly container = new ParticleContainer<Particle>({
    texture: this.figureTexture,
    dynamicProperties: { position: true, color: true },
  });
  private readonly pool: Particle[] = [];
  /** Pool prefix written as visible on the last draw; the rest is alpha-0. */
  private written = 0;

  constructor(
    private readonly camera: Camera | null = null,
    private readonly viewport: (() => ViewportSize) | null = null,
  ) {
    this.container.eventMode = 'none';
  }

  draw(state: GameState, alpha = 1, motion?: Motion): void {
    const rect = this.visibleWorldRect();

    const riders = new Map<number, { x: number; y: number }>();
    for (const group of state.elevatorGroups.values()) {
      for (const car of group.cars) {
        const y = motion?.carY(state, car.id, car.y, alpha) ?? carWorldY(car.y, state.tower.lobbyHeight);
        car.passengers.forEach((id, index) => riders.set(id, {
          x: group.x * CONFIG.CELL_WIDTH_PX + 3 + (index % 5) * 3,
          y: y + 6 + Math.floor(index / 5) % 2,
        }));
      }
    }
    let visible = 0;
    const time = state.tickCount + alpha;
    for (const person of state.people.values()) {
      if (person.state === 'offscreen') continue;
      const rider = riders.get(person.id);
      let px = (motion?.personX(state, person, alpha) ?? person.pos.x) * CONFIG.CELL_WIDTH_PX;
      let py = personY(state, person);
      if (person.state === 'riding' && rider) { px = rider.x; py = rider.y; }
      if (person.state === 'inTenant' || person.state === 'cleaning') {
        const tenant = state.tenants.get(person.activityTenantId >= 0 ? person.activityTenantId : person.tenantId);
        if (tenant && tenant.floor === Math.round(person.pos.floor)) {
          const width = tenant.sizeCells * CONFIG.CELL_WIDTH_PX;
          const position = ((person.id * 37) % 101) / 100;
          const roam = person.id % 3 === 0 ? Math.sin(time / 28 + person.id) * 7 : Math.sin(time / 10 + person.id) * 0.6;
          px = tenant.x * CONFIG.CELL_WIDTH_PX + Math.min(width - 7, Math.max(4, 5 + position * (width - 13) + roam));
          py = floorTopY(tenant.floor, state.tower.lobbyHeight) + (tenant.floor === 1 ? 20 * state.tower.lobbyHeight : 20) - FIGURE_H - 3;
        }
      }
      if (rect && !overlapsRect(px, py, rect)) continue;
      if (visible >= CONFIG.MAX_PEOPLE) break;
      const particle = this.particleAt(visible);
      visible++;
      particle.x = px;
      const bob = person.state === 'walking' ? Math.sin(time * Math.PI + person.id) * 0.7 : 0;
      particle.y = py - bob;
      particle.tint = colorFor(person);
      if (particle.alpha !== 1) particle.alpha = 1;
    }
    // Hide the tail that was visible last frame but is gone/culled now.
    for (let i = visible; i < this.written; i++) this.pool[i]!.alpha = 0;
    this.written = visible;
  }

  /** Particle at `index`, growing the pool (never beyond MAX_PEOPLE). */
  private particleAt(index: number): Particle {
    while (this.pool.length <= index && this.pool.length < CONFIG.MAX_PEOPLE) {
      const p = new Particle({
        texture: this.figureTexture,
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

/** Does the 4x8 figure box at (px, py) intersect the visible world rect? */
function overlapsRect(px: number, py: number, rect: WorldRect): boolean {
  return (
    px + FIGURE_W > rect.left &&
    px < rect.right &&
    py + FIGURE_H > rect.top &&
    py < rect.bottom
  );
}

/** World y (top of the 8px figure) for a visible person. */
function personY(
  state: GameState,
  p: Person,
): number {
  if (p.state === 'riding') {
    // The car itself is where the person is; pos.floor is only the boarding
    // floor until disembarkation (spec formula used as a safety fallback).
    const y = p.pos.floor;
    return carWorldY(y, state.tower.lobbyHeight) + 4;
  }
  const floorIndex = Math.round(p.pos.floor);
  const floor = getFloor(state.tower, floorIndex);
  const height = floor ? floorHeightPx(floor, state.tower.lobbyHeight) : CONFIG.FLOOR_HEIGHT_PX;
  return floorTopY(floorIndex, state.tower.lobbyHeight) + height - FIGURE_H - 2;
}

/** Kind color; waiting people blend toward red as their patience runs out. */
function colorFor(p: Person): number {
  const base = PERSON_COLORS[p.kind];
  if (p.state !== 'waiting') return base;
  const patience = patienceTicks(p.stress);
  const t = Math.min(p.waitTicks / patience, 1);
  return lerpRgb(base, STRESS_RED, t);
}

function lerpRgb(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const gg = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (gg << 8) | bl;
}

/** One shared pixel silhouette keeps crowds batched while giving them heads and legs. */
function createFigureTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = FIGURE_W; canvas.height = FIGURE_H;
  const context = canvas.getContext('2d');
  if (!context) return Texture.WHITE;
  context.fillStyle = '#ffffff';
  context.fillRect(1, 0, 2, 2);
  context.fillRect(0, 2, 4, 3);
  context.fillRect(1, 5, 1, 3);
  context.fillRect(3, 5, 1, 3);
  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'nearest';
  return texture;
}
