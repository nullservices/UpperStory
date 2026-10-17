import { Application, Container, Graphics } from 'pixi.js';
import type { GameState, Tenant } from '../sim';
import { ambient } from './ambient';
import type { Camera } from './camera';

/**
 * Day/night ambience (M3). Two independent layers:
 *  - screenTint — a light screen-space dusk wash + warm sunset band at the
 *    horizon (add to app.stage after camera.view so it shades the world).
 *  - windowLights — a world-space layer kept for main.ts wiring; room
 *    lighting itself now lives in the tower view (floorRenderer.ts), which
 *    re-tints each room's pixel art (warm when lit, dark blue-grey when not)
 *    and shows a baked lamp/emissive layer, using `isLit` below.
 * The darkness level is a piecewise function of minute-of-day: full night
 * before 07:00 and after 01:00, a short half-lit dawn (bright by 07:20) and a
 * two-hour dusk ramp, and daytime darkness-free. The day clock's minute runs 420..1860.
 * The sky view reads the same clock (via ambient) for its own gradient.
 */

const NIGHT_COLOR = 0x0a0f2e;
/** Fraction of the night level applied as a whole-screen wash. */
const SCREEN_WASH = 0.3;
/** Warm horizon band during the dusk hour (18:00–19:00 at minute 1320–1380). */
const SUNSET_COLOR = 0xd07030;
const SUNSET_ALPHA = 0.12;
/** Sunlit-hour start of the dusk transition (22:00 = minute 1380). */
const DUSK_START_MIN = 1320;
const DUSK_MIN = 1380;
const NIGHT_MIN = 1500;
/** The day clock opens at 07:00 in a half-lit dawn that is bright by 07:20. */
const DAWN_START_MIN = 420;
const DAWN_MIN = 440;
const DAWN_START_LEVEL = 0.5;

/**
 * Art-review aid: `?lightMinute=720` pins the lighting (not the sim clock) to
 * a minute-of-day so day, dusk and night art can be inspected on demand.
 */
const PREVIEW_MINUTE: number | null = (() => {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('lightMinute');
  const value = raw === null ? NaN : Number(raw);
  return Number.isFinite(value) ? value : null;
})();

/** 0 (broad daylight) .. 0.45 (full night) from a minute-of-day. */
export function nightAlpha(minuteOfDay: number): number {
  if (minuteOfDay < DAWN_START_MIN) return 0.45;
  if (minuteOfDay < DAWN_MIN) return (0.45 * DAWN_START_LEVEL * (DAWN_MIN - minuteOfDay)) / (DAWN_MIN - DAWN_START_MIN);
  if (minuteOfDay < DUSK_MIN) return 0;
  if (minuteOfDay < NIGHT_MIN) return (0.45 * (minuteOfDay - DUSK_MIN)) / (NIGHT_MIN - DUSK_MIN);
  return 0.45;
}

/** 0..1 strength of the warm dawn/dusk horizon glow. */
export function twilight(minuteOfDay: number): number {
  if (minuteOfDay >= 405 && minuteOfDay < 470) return Math.sin((Math.PI * (minuteOfDay - 405)) / 65);
  if (minuteOfDay >= DUSK_START_MIN - 30 && minuteOfDay < NIGHT_MIN + 20) {
    return Math.sin((Math.PI * (minuteOfDay - (DUSK_START_MIN - 30))) / (NIGHT_MIN + 20 - (DUSK_START_MIN - 30)));
  }
  return 0;
}

/** Lobbies, parking and the metro keep their lights on all night. */
function alwaysLit(tenant: Tenant): boolean {
  return tenant.type === 'lobby' || tenant.type === 'skyLobby' || tenant.type === 'parkingRamp' ||
    tenant.type === 'parkingSpace' || tenant.type === 'metro' || tenant.type === 'fireStation' ||
    tenant.type === 'helipad' || tenant.type === 'generator';
}

export class DayNightView {
  /** Full-window tint rect; child of app.stage ABOVE camera.view. */
  readonly screenTint = new Container();
  /** Room lighting; child of camera.view so it follows the tower. */
  readonly windowLights = new Container();
  private readonly tintGraphics = new Graphics();

  constructor(
    private readonly app: Application,
    private readonly camera: Camera,
  ) {
    this.screenTint.eventMode = 'none';
    this.windowLights.eventMode = 'none';
    this.screenTint.addChild(this.tintGraphics);
  }

  draw(state: GameState): void {
    const minute = PREVIEW_MINUTE ?? state.calendar.minuteOfDay;
    ambient.minuteOfDay = minute;
    ambient.horizonY = this.camera.y;
    this.drawTint(minute);
  }

  private drawTint(minuteOfDay: number): void {
    const g = this.tintGraphics;
    g.clear();
    const night = nightAlpha(minuteOfDay);
    if (night > 0.001) {
      g.rect(0, 0, this.app.screen.width, this.app.screen.height).fill({
        color: NIGHT_COLOR,
        alpha: night * SCREEN_WASH,
      });
    }
    // Sunset band: fades in through the hour before 22:00 and back out while
    // the night tint ramps up (22:00–01:00), so the horizon warms at dusk.
    if (minuteOfDay >= DUSK_START_MIN && minuteOfDay < NIGHT_MIN) {
      const fadeIn = Math.min(Math.max((minuteOfDay - DUSK_START_MIN) / 60, 0), 1);
      const fadeOut = Math.min(Math.max((NIGHT_MIN - minuteOfDay) / 120, 0), 1);
      const alpha = SUNSET_ALPHA * fadeIn * fadeOut;
      if (alpha > 0.001) {
        // World y=0 (ground line) sits at camera.y in screen space.
        const horizonY = this.camera.y;
        g.rect(0, horizonY - 6, this.app.screen.width, 14).fill({
          color: SUNSET_COLOR,
          alpha,
        });
      }
    }
  }
}

/** Is this room lit after dark (people inside, or an always-staffed space)? */
export function isLit(tenant: Tenant): boolean {
  if (tenant.state !== 'open') return false;
  return alwaysLit(tenant) || tenant.occupancy > 0;
}

