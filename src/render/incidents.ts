import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { CONFIG } from '../data/config';
import { floorTopY } from '../sim/tower';
import { towerDate } from '../sim/time';
import type { GameState } from '../sim/state';
import { advanceAnimClock } from './animClock';
import { HelicopterView } from './helicopters';
import { effectAtlas } from './sprites/effects';
import { ambient } from './ambient';
import { moonArt, santaFrames, witchFrames, type FlyerFrames } from './sprites/flyers';
import { hash32 } from './sprites/pixmap';
import { WorldUxView } from './worldUx';

/**
 * Incident markers in pixel art: flickering flames with rising smoke for
 * fires, a pulsing bomb with a sparking fuse for bomb threats, scuttling
 * cockroaches for infestations and a gold frame for VIP visits. All motion
 * runs on the pause-aware animation clock, so it freezes with the game.
 * VIP visits to a tower with a helipad also fly a helicopter in and out
 * (helicopters.ts). Sprites are pooled; incidents off screen are skipped and fires share a
 * per-frame sprite budget, so a spreading fire across many rooms stays cheap.
 *
 * The world layer also carries the world-space UX readouts (money pops and
 * landing queue badges, worldUx.ts); the screen-space weather layer carries
 * rain; the seasonal flyovers (Santa at the year's end, a witch on
 * 31 October) are posed here and drawn by the sky view behind the tower.
 */

/** Sprite budget for all fires together (flames + smoke) per frame. */
const FIRE_SPRITE_BUDGET = 900;
/** Flyover timing in anim ms: one crossing every PERIOD, lasting CROSS. */
const FLYOVER_PERIOD_MS = 42_000;
const FLYOVER_CROSS_MS = 15_000;
const FLYOVER_SCALE = 2;
/** The witch flies a little larger so she reads against the night sky. */
const WITCH_SCALE = 3;
const MOON_SCALE = 2;

/**
 * Art-review aid: `?flyover=santa` / `?flyover=witch` forces a flyover
 * (continuous passes) regardless of the date.
 */
const FORCED_FLYOVER: string | null = (() => {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('flyover');
})();

/** Which seasonal visitor (if any) flies today. */
export function flyoverToday(day: number, now: Date): 'santa' | 'witch' | null {
  const date = towerDate(day);
  if (date.quarter === 4 && date.dayOfQuarter === CONFIG.QUARTER_DAYS - 1) return 'santa';
  if (now.getMonth() === 9 && now.getDate() === 31) return 'witch';
  return null;
}

interface Rect { left: number; right: number; top: number; bottom: number }

export class IncidentView {
  readonly world = new Container();
  readonly weather = new Graphics();
  private readonly frames = new Graphics();
  private readonly spriteLayer = new Container();
  private readonly ux = new WorldUxView();
  private readonly helicopters = new HelicopterView();
  private readonly pool: Sprite[] = [];
  private used = 0;
  private flyerDay = -1;
  private flyer: 'santa' | 'witch' | null = null;

  constructor() {
    this.world.eventMode = 'none';
    this.weather.eventMode = 'none';
    this.world.addChild(this.frames, this.spriteLayer, this.helicopters.container, this.ux.container);
  }

  draw(state: GameState, width: number, height: number, alpha: number): void {
    const g = this.frames;
    g.clear();
    this.used = 0;
    const time = state.tickCount + alpha;
    const anim = advanceAnimClock(state, alpha);
    const fx = effectAtlas();
    const H = CONFIG.FLOOR_HEIGHT_PX;
    const rect = this.visibleRect();
    const fires = state.campaign.incidents.filter(i => i.kind === 'fire').length;
    // Fewer flames per room when many rooms burn at once.
    const flameCap = Math.max(4, Math.min(24, Math.floor(FIRE_SPRITE_BUDGET / Math.max(1, fires) / 1.8)));
    for (const incident of state.campaign.incidents) {
      const tenant = state.tenants.get(incident.tenantId);
      if (!tenant) continue;
      const x = tenant.x * CONFIG.CELL_WIDTH_PX;
      const y = floorTopY(tenant.floor, state.tower.lobbyHeight);
      const w = tenant.sizeCells * CONFIG.CELL_WIDTH_PX;
      if (rect && (x + w < rect.left || x > rect.right || y + H < rect.top - 40 || y > rect.bottom)) continue;
      const floorY = y + H - 2;
      if (incident.kind === 'fire') {
        if (this.used >= FIRE_SPRITE_BUDGET) continue;
        const count = Math.max(2, Math.min(flameCap, Math.floor(w / 10)));
        const pitch = (w - 10) / count;
        for (let i = 0; i < count; i++) {
          const fxp = Math.round(x + 2 + i * pitch + (hash32(i + tenant.id) % 3));
          const frame = (Math.floor(anim / 90) + i * 3) % fx.flames.length;
          this.put(fx.flames[frame]!, fxp, floorY - 14, 1);
          // Smaller back-row flames licking up the wall.
          if (i % 2 === 0) this.put(fx.flames[(frame + 2) % fx.flames.length]!, fxp + 4, floorY - 19, 0.85);
        }
        // Smoke puffs rising out of the room and drifting, growing, fading.
        const puffs = Math.max(2, Math.floor(count / 2));
        for (let k = 0; k < puffs; k++) {
          const phase = ((anim / 2200) + k * 0.37 + (hash32(k * 7 + tenant.id) % 100) / 100) % 1;
          const size = Math.min(fx.smoke.length - 1, Math.floor(phase * fx.smoke.length));
          const sx = Math.round(x + 4 + ((k + 0.5) / puffs) * (w - 16) + phase * 8);
          const sy = Math.round(y + 2 - phase * 34);
          this.put(fx.smoke[size]!, sx, sy, 0.75 * (1 - phase));
        }
        // Scorched glow along the floor.
        g.rect(x + 1, floorY - 2, w - 2, 2).fill({ color: 0xff6a1a, alpha: 0.5 + 0.2 * Math.sin(anim / 120 + tenant.id) });
      } else if (incident.kind === 'bomb') {
        const pulse = (Math.floor(anim / 300) % 2) === 0;
        const color = pulse ? 0xe02424 : 0x801010;
        g.rect(x, y + 2, w, 1).fill(color);
        g.rect(x, floorY - 1, w, 1).fill(color);
        g.rect(x, y + 2, 1, floorY - y - 2).fill(color);
        g.rect(x + w - 1, y + 2, 1, floorY - y - 2).fill(color);
        g.rect(x + 1, y + 3, w - 2, floorY - y - 4).fill({ color: 0xe02424, alpha: pulse ? 0.16 : 0.06 });
        const bomb = fx.bomb[Math.floor(anim / 150) % fx.bomb.length]!;
        this.put(bomb, Math.round(x + w / 2 - 5), floorY - 12, 1);
      } else if (incident.kind === 'infestation') {
        g.rect(x + 1, y + 2, w - 2, floorY - y - 2).fill({ color: 0x5a5020, alpha: 0.12 + Math.sin(time / 5) * 0.04 });
        const count = Math.max(3, Math.min(14, Math.floor(w / 14)));
        for (let k = 0; k < count; k++) {
          const seed = hash32(k * 31 + tenant.id);
          const speed = 0.006 + (seed % 7) * 0.002;
          const travel = w - 10;
          let pos = ((anim * speed + (seed % 997)) % (travel * 2));
          const back = pos > travel;
          if (back) pos = travel * 2 - pos;
          const onWall = seed % 3 === 0;
          const ry = onWall ? y + 6 + (seed >> 4) % 10 : floorY - 3 - ((seed >> 3) % 2);
          const sprite = this.put(fx.roach[Math.floor(anim / 80 + k) % fx.roach.length]!, Math.round(x + 4 + pos), ry, 1);
          sprite.scale.x = back ? -1 : 1;
          if (back) sprite.x += 6;
        }
      } else if (incident.kind === 'vip') {
        const glint = Math.floor(anim / 200) % 4;
        g.rect(x, y + 1, w, 2).fill(0xd1ac54);
        g.rect(x, floorY - 2, w, 2).fill(0xd1ac54);
        g.rect(x, y + 1, 2, floorY - y - 1).fill(0xd1ac54);
        g.rect(x + w - 2, y + 1, 2, floorY - y - 1).fill(0xd1ac54);
        g.rect(x + 2 + glint * Math.floor((w - 8) / 3), y + 1, 4, 1).fill(0xfff4bc);
      }
    }
    for (let i = this.used; i < this.pool.length; i++) this.pool[i]!.visible = false;
    this.helicopters.draw(state, anim, rect);
    this.ux.draw(state);

    const sky = this.weather; sky.clear();
    if (state.campaign.weather === 'rain' && height > 103) {
      sky.rect(0, 94, width, height - 94).fill({ color: 0x5c7580, alpha: 0.12 });
      for (let i = 0; i < 90; i++) {
        const x = (i * 127 + time * 3) % width;
        const y = 94 + (i * 83 + time * 13) % (height - 103);
        sky.moveTo(x, y).lineTo(x - 3, y + 9).stroke({ width: 1, color: 0xc7dbe0, alpha: 0.35 });
      }
    }
    this.drawFlyover(state, anim, width, height);
  }

  /** Santa's sleigh or the witch crossing the sky a few times a day. */
  private drawFlyover(state: GameState, anim: number, width: number, height: number): void {
    if (this.flyerDay !== state.calendar.day) {
      this.flyerDay = state.calendar.day;
      this.flyer = flyoverToday(state.calendar.day, new Date());
    }
    const who = FORCED_FLYOVER === 'santa' || FORCED_FLYOVER === 'witch' ? FORCED_FLYOVER : this.flyer;
    ambient.moon = null;
    const flyer = ambient.flyer;
    flyer.visible = false;
    flyer.sparkleCount = 0;
    if (!who) return;
    const pass = Math.floor(anim / FLYOVER_PERIOD_MS);
    // Below the HUD toolbars (about 75 CSS px), high in the sky band.
    const skyBase = 100 + Math.max(0, Math.min(height, 500) - 300) * 0.1;
    const witch = who === 'witch';
    const moonSize = MOON_SCALE * moonArt().size;
    const moonX = Math.round(width * 0.68 - moonSize / 2);
    const moonY = Math.round(skyBase - 16);
    // Halloween: a full moon hangs on her path all day, drawn by the sky
    // behind the tower.
    if (witch) ambient.moon = { x: moonX, y: moonY, size: moonSize };
    const phase = anim % FLYOVER_PERIOD_MS;
    if (phase > FLYOVER_CROSS_MS) return;
    const art: FlyerFrames = witch ? witchFrames() : santaFrames();
    const scale = witch ? WITCH_SCALE : FLYOVER_SCALE;
    const w = art.w * scale, h = art.h * scale;
    const t = phase / FLYOVER_CROSS_MS;
    const x = Math.round(-w + t * (width + w * 2));
    // The witch's path crosses the moon's face (silhouette against it).
    const base = witch
      ? moonY + moonSize / 2 - h * 0.55 + ((hash32(pass) % 21) - 10)
      : skyBase + (hash32(pass) % 70);
    const y = Math.round(base + Math.sin(t * Math.PI * 4) * 6);
    const frame = art.frames[Math.floor(anim / 160) % art.frames.length]!;
    // The sky view draws the flyer (behind the tower) from this pose.
    flyer.visible = true;
    flyer.texture = frame;
    flyer.x = x; flyer.y = y; flyer.w = w; flyer.h = h;
    const spark = (sx: number, sy: number, color: number, alpha: number): void => {
      let dot = flyer.sparkles[flyer.sparkleCount];
      if (!dot) { dot = [0, 0, 0, 0]; flyer.sparkles.push(dot); }
      dot[0] = Math.round(sx); dot[1] = Math.round(sy); dot[2] = color; dot[3] = alpha;
      flyer.sparkleCount++;
    };
    if (witch) {
      // Sparkles shed by the broom bristles, trailing behind her.
      for (let k = 1; k < 9; k++) {
        if (((Math.floor(anim / 110) + k) % 3) === 0) continue;
        spark(x + scale * 2 - k * 7, y + h * 0.78 + Math.sin(t * 24 + k * 1.7) * 4, k % 2 ? 0xffc84a : 0xb8ff7a, 1 - k / 9);
      }
    } else {
      // A trail of twinkling sparkles behind the sleigh.
      for (let k = 1; k < 8; k++) {
        if (((Math.floor(anim / 120) + k) & 1) === 0) spark(x - k * 9, y + h * 0.55 + Math.sin(t * 20 + k) * 3, 0xfff4bc, 1 - k / 8);
      }
    }
  }

  /** World rect under the browser viewport (null outside a browser). */
  private visibleRect(): Rect | null {
    if (typeof window === 'undefined' || !this.world.parent) return null;
    const tl = this.world.toLocal({ x: 0, y: 0 });
    const br = this.world.toLocal({ x: window.innerWidth, y: window.innerHeight });
    return { left: tl.x, right: br.x, top: tl.y, bottom: br.y };
  }

  private put(texture: Texture, x: number, y: number, alpha: number): Sprite {
    let sprite = this.pool[this.used];
    if (!sprite) {
      sprite = new Sprite();
      sprite.roundPixels = true;
      this.pool.push(sprite);
      this.spriteLayer.addChild(sprite);
    }
    this.used++;
    sprite.texture = texture;
    sprite.position.set(x, y);
    sprite.scale.x = 1;
    sprite.alpha = alpha;
    sprite.visible = true;
    return sprite;
  }
}
