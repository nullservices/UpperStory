import { Application, Container, Graphics } from 'pixi.js';
import { CONFIG } from '../data/config';
import { floorHeightPx, floorTopY, getFloor, type GameState } from '../sim';
import type { Camera } from './camera';

/**
 * Day/night ambience (M3). Two independent layers:
 *  - screenTint — a screen-space dark tint + warm sunset band at the horizon
 *    (add to app.stage after camera.view so it shades the whole world).
 *  - windowLights — world-space lit window lines along tenant front edges
 *    (add to camera.view so they pan/zoom with the tower).
 * The tint alpha is a piecewise function of minute-of-day: full night before
 * 07:00 and after 01:00, a two-hour dawn ramp and a two-hour dusk ramp, and
 * daytime pure darkness-free. The day clock's minute runs 420..1860.
 */

const NIGHT_COLOR = 0x0a0f2e;
/** Warm horizon band during the dusk hour (18:00–19:00 at minute 1320–1380). */
const SUNSET_COLOR = 0xd07030;
const SUNSET_ALPHA = 0.12;
/** Lit tenant windows: warm for commerce/offices, cool for hotel rooms. */
const LIGHT_WARM = 0xffd27a;
const LIGHT_HOTEL = 0xbfe3ff;
/** Sunlit-hour start of the dusk transition (22:00 = minute 1380). */
const DUSK_START_MIN = 1320;
const DUSK_MIN = 1380;
const NIGHT_MIN = 1500;
const DAWN_START_MIN = 420;
const DAWN_MIN = 540;

/** 0 (broad daylight) .. 0.45 (full night) from a minute-of-day. */
export function nightAlpha(minuteOfDay: number): number {
  if (minuteOfDay < DAWN_START_MIN) return 0.45;
  if (minuteOfDay < DAWN_MIN) return (0.45 * (DAWN_MIN - minuteOfDay)) / (DAWN_MIN - DAWN_START_MIN);
  if (minuteOfDay < DUSK_MIN) return 0;
  if (minuteOfDay < NIGHT_MIN) return (0.45 * (minuteOfDay - DUSK_MIN)) / (NIGHT_MIN - DUSK_MIN);
  return 0.45;
}

export class DayNightView {
  /** Full-window tint rect; child of app.stage ABOVE camera.view. */
  readonly screenTint = new Container();
  /** Lit windows; child of camera.view so they follow the tower. */
  readonly windowLights = new Container();
  private readonly tintGraphics = new Graphics();
  private readonly lightsGraphics = new Graphics();

  constructor(
    private readonly app: Application,
    private readonly camera: Camera,
  ) {
    this.screenTint.eventMode = 'none';
    this.windowLights.eventMode = 'none';
    this.screenTint.addChild(this.tintGraphics);
    this.windowLights.addChild(this.lightsGraphics);
  }

  draw(state: GameState): void {
    const minute = state.calendar.minuteOfDay;
    this.drawTint(minute);
    this.drawWindowLights(state, minute);
  }

  private drawTint(minuteOfDay: number): void {
    const g = this.tintGraphics;
    g.clear();
    const night = nightAlpha(minuteOfDay);
    if (night > 0.001) {
      g.rect(0, 0, this.app.screen.width, this.app.screen.height).fill({
        color: NIGHT_COLOR,
        alpha: night * 0.7,
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

  /** 2px warm lines along open, occupied tenants' front edges once it's dark. */
  private drawWindowLights(state: GameState, minuteOfDay: number): void {
    const g = this.lightsGraphics;
    g.clear();
    const night = nightAlpha(minuteOfDay);
    if (night <= 0.001) return;
    const alpha = night * 0.9;
    const cell = CONFIG.CELL_WIDTH_PX;
    for (const tenant of state.tenants.values()) {
      if (tenant.state !== 'open' || tenant.occupancy <= 0) continue;
      const floor = getFloor(state.tower, tenant.floor);
      const height = floor ? floorHeightPx(floor, state.tower.lobbyHeight) : CONFIG.FLOOR_HEIGHT_PX;
      if (height <= 0) continue;
      const y = floorTopY(tenant.floor, state.tower.lobbyHeight) + height - 4;
      const width = tenant.sizeCells * cell - 4;
      g.rect(tenant.x * cell + 2, y, width, 2).fill({
        color: tenant.type === 'hotel' ? LIGHT_HOTEL : LIGHT_WARM,
        alpha,
      });
    }
  }
}
