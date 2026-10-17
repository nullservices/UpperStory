import { Application, Container, Graphics, Sprite } from 'pixi.js';
import { animTime } from './animClock';
import { ambient } from './ambient';
import { nightAlpha, twilight } from './dayNight';
import { PALETTE, lerpRgb } from './palette';
import { cloudArt } from './sprites/clouds';
import { moonArt } from './sprites/flyers';

/** Puffy clouds as screen fractions: x, y, size (picks the shape and drift speed). */
const CLOUDS: readonly [number, number, number][] = [
  [0.22, 0.2, 1.1], [0.47, 0.12, 0.7], [0.71, 0.26, 1], [0.9, 0.1, 0.65], [0.36, 0.38, 0.55], [0.06, 0.33, 0.6],
];

/**
 * Screen-space sky stays continuous while the tower is panned: a bright blue
 * gradient with pixel-art clouds by day (baked near-white sprites drawn at
 * an integer scale and tinted for dawn, dusk and night), a warm horizon at dawn and dusk, and a
 * starry navy sky at night. Redrawn only when the size or the (quantized)
 * light level changes. Clouds drift slowly on the pause-aware animation
 * clock (they stop whenever the game is paused), each cloud a retained
 * sprite that only moves per frame. On a witch day the Halloween full moon
 * (placed by the incident view through `ambient.moon`) hangs behind them.
 */

/** Cloud drift in screen px per second of animation time. */
const CLOUD_DRIFT = 4;
/** Integer screen scale of the cloud pixel art (keeps it crisp). */
const CLOUD_SCALE = 2;

/** Cloud shape for a layout size: large, medium or small. */
function cloudShape(size: number): number {
  return size >= 0.9 ? 0 : size >= 0.65 ? 1 : 2;
}

export class SkyView {
  private graphics = new Graphics();
  private readonly cloudLayer = new Container();
  private readonly clouds: Sprite[] = [];
  private readonly moonHalo = new Sprite();
  private readonly moon = new Sprite();
  /** Seasonal flyover posed by the incident view (ambient.flyer), in front of clouds and moon. */
  private readonly flyer = new Sprite();
  private readonly sparkles = new Graphics();
  private key = '';
  constructor(private app: Application) {
    this.graphics.eventMode = 'none';
    this.cloudLayer.eventMode = 'none';
    const art = moonArt();
    this.moonHalo.texture = art.halo;
    this.moon.texture = art.moon;
    for (const m of [this.moonHalo, this.moon]) {
      m.roundPixels = true;
      m.visible = false;
      this.cloudLayer.addChild(m);
    }
    const shapes = cloudArt();
    for (let i = 0; i < CLOUDS.length; i++) {
      const cloud = new Sprite(shapes[cloudShape(CLOUDS[i]![2])]!.texture);
      cloud.roundPixels = true;
      cloud.scale.set(CLOUD_SCALE);
      this.clouds.push(cloud);
      this.cloudLayer.addChild(cloud);
    }
    this.flyer.roundPixels = true;
    this.flyer.visible = false;
    this.cloudLayer.addChild(this.sparkles, this.flyer);
    app.stage.addChildAt(this.graphics, 0);
    app.stage.addChildAt(this.cloudLayer, 1);
  }
  draw(): void {
    const { width, height } = this.app.screen;
    this.driftClouds(width, height);
    const minute = ambient.minuteOfDay;
    const night = Math.round((nightAlpha(minute) / 0.45) * 32) / 32;
    this.placeMoon(night);
    this.placeFlyer();
    const glow = Math.round(twilight(minute) * 32) / 32;
    // The gradient runs from the top of the screen down to the street line,
    // so the warm dawn/dusk glow sits on the real horizon (not behind the
    // soil); quantized so panning redraws it only every few pixels.
    const horizon = Math.round(Math.min(height * 1.6, Math.max(height * 0.45, ambient.horizonY ?? height)) / 8) * 8;
    const key = `${width}:${height}:${night}:${glow}:${horizon}`;
    if (key === this.key) return;
    this.key = key;
    const g = this.graphics; g.clear();
    const bands = 48;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const day = lerpRgb(PALETTE.skyTop, PALETTE.skyBottom, t);
      const dark = lerpRgb(PALETTE.nightSkyTop, PALETTE.nightSkyBottom, t);
      let color = lerpRgb(day, dark, night);
      if (glow > 0) color = lerpRgb(color, PALETTE.duskGlow, glow * 0.75 * t * t);
      g.rect(0, Math.floor((i * horizon) / bands), width, Math.ceil(horizon / bands) + 1).fill(color);
      if (i === bands - 1 && horizon < height) g.rect(0, horizon, width, height - horizon).fill(color);
    }
    if (night > 0.4) {
      const alpha = Math.min(1, (night - 0.4) / 0.6);
      let seed = 11;
      const rand = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      for (let i = 0; i < 140; i++) {
        const x = Math.floor(rand() * width), y = Math.floor(rand() * height * 0.75);
        const big = rand() < 0.15;
        g.rect(x, y, big ? 2 : 1, big ? 2 : 1).fill({ color: 0xffffff, alpha: alpha * (0.4 + rand() * 0.6) });
      }
    }
    // Clouds are baked near white; tint them warm at dusk and slate at night.
    const cloud = lerpRgb(lerpRgb(PALETTE.cloud, 0xffd2b0, glow * 0.6), 0x3a4670, night * 0.85);
    for (const sprite of this.clouds) sprite.tint = cloud;
  }

  /** Show the Halloween moon where the incident view placed it (or hide it). */
  private placeMoon(night: number): void {
    const at = ambient.moon;
    this.moon.visible = this.moonHalo.visible = at !== null;
    if (!at) return;
    const scale = at.size / moonArt().size;
    for (const m of [this.moonHalo, this.moon]) {
      m.position.set(at.x, at.y);
      m.scale.set(scale);
    }
    // Paler by day, bright with a soft halo at night.
    this.moonHalo.alpha = 0.1 + 0.2 * night;
    this.moon.alpha = 0.5 + 0.5 * night;
  }

  /** Draw the seasonal flyer where the incident view posed it (or hide it). */
  private placeFlyer(): void {
    const f = ambient.flyer;
    const g = this.sparkles;
    g.clear();
    this.flyer.visible = f.visible && f.texture !== null;
    if (!this.flyer.visible) return;
    this.flyer.texture = f.texture!;
    this.flyer.position.set(f.x, f.y);
    this.flyer.width = f.w;
    this.flyer.height = f.h;
    for (let i = 0; i < f.sparkleCount; i++) {
      const [x, y, color, alpha] = f.sparkles[i]!;
      g.rect(x, y, 2, 2).fill({ color, alpha });
    }
  }

  /** Place the clouds: their layout fractions plus a wrapped drift. */
  private driftClouds(width: number, height: number): void {
    const shift = (animTime() / 1000) * CLOUD_DRIFT;
    const span = width + 280;
    for (let i = 0; i < CLOUDS.length; i++) {
      const [fx, fy, s] = CLOUDS[i]!;
      const x = ((width * fx + shift * (0.6 + s * 0.4) + 140) % span + span) % span - 140;
      const art = cloudArt()[cloudShape(s)]!;
      // (x, y) is the cloud's base centre, as in the layout fractions.
      this.clouds[i]!.position.set(
        Math.round(x - (art.w * CLOUD_SCALE) / 2),
        Math.round(height * fy - (art.h - 6) * CLOUD_SCALE),
      );
    }
  }
}
