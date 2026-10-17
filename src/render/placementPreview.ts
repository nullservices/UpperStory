import { Graphics } from 'pixi.js';
import { CONFIG, TENANT_DATA, facilityHeight } from '../data/config';
import type { Tool } from '../game/controller';
import { elevatorBuildPlan } from '../game/elevatorBuild';
import { floorBuildPlan } from '../game/floorBuild';
import {
  escalatorPlacementError,
  floorTopY,
  type GameState,
} from '../sim';

/** World-cell position the pointer is over (floor index + cell x). */
export interface HoverCell {
  floor: number;
  cell: number;
}

/** One shaft/cell-wide tool drag in progress (elevator placement). */
export interface DragState {
  fromFloor: number;
  cell: number;
}

const GREEN = 0x22cc44;
const GREEN_ALPHA = 0.35;
const RED = 0xcc2233;
const RED_ALPHA = 0.4;
const WHITE = 0xffffff;

/**
 * Translucent "here is what placing would do" overlay. Redrawn every frame
 * from the controller's tool + hover state, so it tracks the pointer without
 * any own listeners. Lives on top of the TowerView.
 */
export class PlacementPreview {
  readonly graphics = new Graphics();

  /** Placement errors are explained by the UI's cursor tooltip; this only tints the footprint. */
  draw(
    state: GameState,
    tool: Tool | null,
    hover: HoverCell | null,
    hoverError: string | null,
    drag: DragState | null,
  ): void {
    const g = this.graphics;
    g.clear();
    if (!tool) return;
    const cell = CONFIG.CELL_WIDTH_PX;
    const valid = hoverError === null;

    switch (tool) {
      case 'buildBasement':
      case 'buildFloor': {
        if (state.tower.floors.length === 0) break;
        const plan = floorBuildPlan(state, hover, tool === 'buildBasement');
        g.rect(plan.lo * cell, floorTopY(plan.floor, state.tower.lobbyHeight), (plan.hi - plan.lo) * cell, bandHeightPx(plan.floor, state.tower.lobbyHeight)).fill(
          !plan.error ? { color: GREEN, alpha: GREEN_ALPHA } : { color: RED, alpha: RED_ALPHA },
        );
        break;
      }
      case 'select':
      case 'demolish': {
        if (!hover) break;
        const color = tool === 'select' ? WHITE : RED;
        g.rect(hover.cell * cell, floorTopY(hover.floor, state.tower.lobbyHeight), cell, bandHeightPx(hover.floor, state.tower.lobbyHeight))
          .stroke({ width: 1, color, alpha: 0.9 });
        break;
      }
      case 'elevator':
      case 'serviceElevator':
      case 'expressElevator': {
        if (!hover) break;
        const kind = tool === 'expressElevator' ? 'express' : tool === 'serviceElevator' ? 'service' : 'standard';
        const plan = elevatorBuildPlan(state, drag?.fromFloor ?? hover.floor, hover.floor, drag?.cell ?? hover.cell, kind);
        const x = plan.x * cell;
        const y = floorTopY(plan.hi, state.tower.lobbyHeight);
        const h = bandBottomPx(plan.lo, state.tower.lobbyHeight) - y;
        g.rect(x, y, cell * plan.width, h).fill(
          valid ? { color: GREEN, alpha: GREEN_ALPHA } : { color: RED, alpha: RED_ALPHA },
        );
        break;
      }
      case 'escalatorUp':
      case 'escalatorDown': {
        if (!hover) break;
        const x = hover.cell * cell;
        const y = floorTopY(hover.floor + 1, state.tower.lobbyHeight);
        const h = bandBottomPx(hover.floor, state.tower.lobbyHeight) - y;
        const err = hoverError ?? escalatorPlacementError(state, hover.floor, hover.cell);
        const ok = err === null;
        g.rect(x, y, cell * 8, h).fill(
          ok ? { color: GREEN, alpha: GREEN_ALPHA } : { color: RED, alpha: RED_ALPHA },
        );
        // Direction glyph, tinted with the rect's validity: a stepped pixel
        // arrow (7x4) like the rest of the pixel art, not a smooth triangle.
        const cx = x + cell * 4;
        const cy = Math.round(y + h / 2);
        const up = tool === 'escalatorUp';
        for (let row = 0; row < 4; row++) {
          const half = up ? row : 3 - row;
          g.rect(cx - half - 1, cy - 2 + row, half * 2 + 1, 1).fill({ color: ok ? GREEN : RED, alpha: 1 });
        }
        break;
      }
      default: {
        // Tenant tools + stairs — sim placement cells.
        if (!hover) break;
        const width =
          tool === 'stairs'
            ? cell * 8
            : TENANT_DATA[tool].sizeCells * cell;
        const x = hover.cell * cell;
        const stairFromLobby = tool === 'stairs' && hover.floor === CONFIG.LOBBY_FLOOR_INDEX;
        const height = tool === 'stairs' ? 1 : facilityHeight(tool);
        const y = floorTopY(stairFromLobby ? hover.floor + 1 : hover.floor + height - 1, state.tower.lobbyHeight);
        const h = stairFromLobby ? bandBottomPx(hover.floor, state.tower.lobbyHeight) - y : height * bandHeightPx(hover.floor, state.tower.lobbyHeight);
        g.rect(x, y, width, h).fill(
          valid ? { color: GREEN, alpha: GREEN_ALPHA } : { color: RED, alpha: RED_ALPHA },
        );
        break;
      }
    }
  }
}

/** Height of a floor band that may not exist yet (index-driven, like sim). */
function bandHeightPx(index: number, lobbyHeight: number): number {
  return index === CONFIG.LOBBY_FLOOR_INDEX
    ? CONFIG.FLOOR_HEIGHT_PX * lobbyHeight
    : CONFIG.FLOOR_HEIGHT_PX;
}

/** World y of the bottom edge of floor `index`'s band. */
function bandBottomPx(index: number, lobbyHeight: number): number {
  return floorTopY(index, lobbyHeight) + bandHeightPx(index, lobbyHeight);
}
