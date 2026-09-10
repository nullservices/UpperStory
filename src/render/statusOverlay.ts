import { Container, Graphics } from 'pixi.js';
import { CONFIG } from '../data/config';
import { floorHeightPx, floorTopY, getFloor, type GameState, type Tenant } from '../sim';

/**
 * Selectable status overlays (M3): one translucent wash per open tenant —
 * red by mean day-stress, a grade heat color (red → amber → green), or a
 * white brightness by occupancy/capacity. World-space, redrawn every frame.
 * The HUD owns the mode ('none' hides everything).
 */

export type StatusMode = 'none' | 'stress' | 'grade' | 'population';

const STRESS_RED = 0xe05555;
const STRESS_FULL_AT_STRESS = 50;
const STRESS_MAX_ALPHA = 0.7;
const GRADE_ALPHA = 0.35;
const POP_WHITE = 0xffffff;
const POP_BASE_ALPHA = 0.15;
const POP_FULL_ALPHA = 0.55;

export class StatusOverlayView {
  readonly container = new Container();
  private readonly graphics = new Graphics();

  constructor() {
    this.container.eventMode = 'none';
    this.container.addChild(this.graphics);
  }

  draw(state: GameState, mode: StatusMode): void {
    const g = this.graphics;
    g.clear();
    if (mode === 'none') return;
    const cell = CONFIG.CELL_WIDTH_PX;
    for (const tenant of state.tenants.values()) {
      // The lobby is the tower's public ground floor, not a status-reporting
      // tenant, and scaffolds are invisible shells under construction.
      if (tenant.type === 'lobby' || tenant.state !== 'open') continue;
      const style = this.styleFor(state, tenant, mode);
      if (!style || style.alpha <= 0.001) continue;
      const floor = getFloor(state.tower, tenant.floor);
      const height = floor ? floorHeightPx(floor, state.tower.lobbyHeight) : CONFIG.FLOOR_HEIGHT_PX;
      g.rect(tenant.x * cell, floorTopY(tenant.floor, state.tower.lobbyHeight), tenant.sizeCells * cell, height).fill(
        style,
      );
    }
  }

  /** Wash color + alpha for one tenant in the given mode (null = nothing). */
  private styleFor(
    state: GameState,
    tenant: Tenant,
    mode: StatusMode,
  ): { color: number; alpha: number } | null {
    switch (mode) {
      case 'stress': {
        let sum = 0;
        let count = 0;
        for (const p of state.people.values()) {
          if (p.tenantId !== tenant.id) continue;
          sum += p.dayStress;
          count++;
        }
        if (count === 0) return null;
        return {
          color: STRESS_RED,
          alpha: Math.min(sum / count / STRESS_FULL_AT_STRESS, STRESS_MAX_ALPHA),
        };
      }
      case 'grade':
        return { color: gradeColor(tenant.grade), alpha: GRADE_ALPHA };
      case 'population': {
        if (tenant.capacity <= 0) return null;
        const fill = Math.min(tenant.occupancy / tenant.capacity, 1);
        return {
          color: POP_WHITE,
          alpha: POP_BASE_ALPHA + (POP_FULL_ALPHA - POP_BASE_ALPHA) * fill,
        };
      }
      case 'none':
        return null;
    }
  }
}

/** Grade heat color: 1★ red, 3★ amber, 5★ green, lerped between. */
export function gradeColor(grade: number): number {
  const g = Math.min(Math.max(grade, 0), 5);
  if (g <= 1) return 0xe05555;
  if (g < 3) return lerpRgb(0xe05555, 0xe0b000, (g - 1) / 2);
  if (g < 5) return lerpRgb(0xe0b000, 0x22cc44, (g - 3) / 2);
  return 0x22cc44;
}

function lerpRgb(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
