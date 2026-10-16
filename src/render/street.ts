import { Container, Graphics, Sprite } from 'pixi.js';
import { ambient } from './ambient';
import { animTime } from './animClock';
import { nightAlpha } from './dayNight';
import { PALETTE, lerpRgb } from './palette';
import { lampTexture, streetCarTexture, treeTexture } from './sprites/streetArt';

/**
 * Street level outside the tower (world space, behind the tower shell): a
 * hazy city skyline on the horizon, street trees and lamp posts on the grass
 * verge, an asphalt strip with parked cars and a few cars drifting along it.
 * Everything but the moving cars is built once; trees, lamps and cars are
 * pixel sprites (sprites/streetArt.ts) and only the cars' x changes per frame,
 * on the pause-aware animation clock (traffic stops while the game is paused).
 * The night level only re-tints containers and fades the lit-window layer.
 */

const CAR_COLORS = [0xc8382e, 0x2f5fb0, 0xe8e2d0, 0x3f8a4a, 0xe0b030, 0x5a5a66];
const CAR_COUNT = 18;

interface MovingCar {
  sprite: Sprite;
  speed: number;
}

export class StreetView {
  readonly container = new Container();
  private readonly skyline = new Container();
  private readonly cityLights = new Graphics();
  private readonly street = new Container();
  private readonly cars: MovingCar[] = [];
  private lastMs = -1;
  private nightKey = -1;

  constructor(private readonly left: number, private readonly width: number) {
    this.container.eventMode = 'none';
    let seed = 1234567;
    const rand = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const far = new Graphics(), near = new Graphics(), verge = new Graphics(), road = new Graphics();
    const parked = new Container();
    this.buildSkyline(far, 0xbcd2e6, 0xa9c1d9, 70, 230, rand);
    this.buildSkyline(near, 0x9cb5cf, 0x8ba5c1, 40, 150, rand);
    this.skyline.addChild(far, near);
    this.buildStreet(verge, road, parked, rand);
    const carLayer = new Container();
    for (let i = 0; i < CAR_COUNT; i++) {
      const sprite = new Sprite(streetCarTexture(CAR_COLORS[i % CAR_COLORS.length]!));
      sprite.anchor.set(0.5, 1);
      sprite.roundPixels = true;
      const rightward = i % 2 === 0;
      sprite.scale.x = rightward ? 1 : -1;
      sprite.position.set(left + rand() * width, rightward ? 0 : -1);
      this.cars.push({ sprite, speed: (rightward ? 1 : -1) * (24 + rand() * 30) });
      carLayer.addChild(sprite);
    }
    this.street.addChild(verge, parked, road, carLayer);
    this.container.addChild(this.skyline, this.cityLights, this.street);
  }

  /** Per frame: drift the cars and follow the night level. */
  update(): void {
    const now = animTime();
    const dt = this.lastMs < 0 ? 0 : Math.min(0.1, (now - this.lastMs) / 1000);
    this.lastMs = now;
    const right = this.left + this.width;
    for (const car of this.cars) {
      let x = car.sprite.x + car.speed * dt;
      if (x > right) x -= this.width;
      else if (x < this.left) x += this.width;
      car.sprite.x = x;
    }
    const night = Math.round((nightAlpha(ambient.minuteOfDay) / 0.45) * 24) / 24;
    if (night === this.nightKey) return;
    this.nightKey = night;
    this.skyline.tint = lerpRgb(0xffffff, 0x2c3558, night * 0.85);
    this.street.tint = lerpRgb(0xffffff, 0x6a7090, night * 0.6);
    this.cityLights.alpha = night;
  }

  /** One silhouette row of towers with set-backs, spires and window grids. */
  private buildSkyline(g: Graphics, body: number, edge: number, minH: number, maxH: number, rand: () => number): void {
    const lights = this.cityLights;
    let x = this.left;
    while (x < this.left + this.width) {
      const w = Math.round(28 + rand() * 60);
      const h = Math.round(minH + Math.pow(rand(), 1.6) * (maxH - minH));
      g.rect(x, -h, w, h).fill(body);
      g.rect(x + w - 3, -h, 3, h).fill(edge);
      if (rand() < 0.4) {
        // Set-back upper block.
        const sw = Math.round(w * (0.4 + rand() * 0.3)), sh = Math.round(10 + rand() * 30);
        g.rect(x + Math.round((w - sw) / 2), -h - sh, sw, sh).fill(body);
        if (rand() < 0.5) g.rect(x + Math.round(w / 2), -h - sh - 10, 1, 10).fill(edge);
      } else if (rand() < 0.3) {
        g.rect(x + 4, -h - 4, 6, 4).fill(edge);
      }
      // Faint window rows by day; a sparse grid of lit windows at night.
      for (let wy = -h + 6; wy < -6; wy += 6) {
        g.rect(x + 3, wy, w - 7, 2).fill({ color: edge, alpha: 0.55 });
        for (let wx = x + 4; wx < x + w - 5; wx += 5) {
          if (rand() < 0.22) lights.rect(wx, wy, 2, 2).fill(rand() < 0.8 ? 0xffe28a : 0xcfe8ff);
        }
      }
      x += w + (rand() < 0.3 ? Math.round(rand() * 20) : 0);
    }
  }

  private buildStreet(g: Graphics, road: Graphics, parkedLayer: Container, rand: () => number): void {
    const left = this.left, width = this.width, right = left + width;
    // Grass verge behind the curb, with tufts.
    g.rect(left, -6, width, 4).fill(PALETTE.grass);
    g.rect(left, -6, width, 1).fill(PALETTE.grassLight);
    for (let x = left; x < right; x += 7) g.rect(x, -7, 2, 1).fill(PALETTE.grass);
    // Street trees and lamp posts along the verge.
    let x = left + 20;
    while (x < right) {
      if (rand() < 0.7) parkedLayer.addChild(tree(x, -5, rand));
      else parkedLayer.addChild(lamp(this.cityLights, x, -5));
      x += Math.round(60 + rand() * 140);
    }
    // Parked cars at the curb.
    for (let px = left + 50; px < right; px += Math.round(150 + rand() * 300)) {
      const parked = new Sprite(streetCarTexture(CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)]!));
      parked.anchor.set(0.5, 1);
      parked.roundPixels = true;
      parked.position.set(px, -2);
      parked.scale.x = rand() < 0.5 ? 1 : -1;
      parkedLayer.addChild(parked);
    }
    // Curb and asphalt, with dashed lane marks.
    road.rect(left, -3, width, 1).fill(0xc9c4b8);
    road.rect(left, -2, width, 2).fill(0x5a5c64);
    for (let lx = left; lx < right; lx += 16) road.rect(lx, -1, 7, 1).fill(0xd9d2b4);
  }
}

function tree(x: number, base: number, rand: () => number): Sprite {
  const s = new Sprite(treeTexture(Math.floor(rand() * 3)));
  s.anchor.set(0.5, 1);
  s.roundPixels = true;
  s.position.set(x, base);
  return s;
}

function lamp(lights: Graphics, x: number, base: number): Sprite {
  const s = new Sprite(lampTexture());
  s.anchor.set(0.5, 1);
  s.roundPixels = true;
  s.position.set(x, base);
  lights.circle(x, base - 18, 5).fill({ color: 0xffe9a8, alpha: 0.35 });
  lights.rect(x - 2, base - 19, 5, 1).fill(0xfff6c8);
  return s;
}
