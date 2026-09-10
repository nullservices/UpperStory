import { Graphics, Text } from 'pixi.js';
import { CONFIG, TENANT_DATA, facilityHeight } from '../data/config';
import type { Tool } from '../game/controller';
import { elevatorBuildPlan } from '../game/elevatorBuild';
import {
  buildFloorError,
  escalatorPlacementError,
  floorTopY,
  topFloorIndex,
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
  private readonly errorText = new Text({
    text: '',
    style: { fontSize: 9, fill: 0xdd4444, fontFamily: 'monospace' },
  });

  constructor() {
    // Graphics extends Container: the error label rides along with it.
    this.graphics.addChild(this.errorText);
  }

  draw(
    state: GameState,
    tool: Tool | null,
    hover: HoverCell | null,
    hoverError: string | null,
    drag: DragState | null,
  ): void {
    const g = this.graphics;
    g.clear();
    this.errorText.visible = false;
    if (!tool) return;
    const cell = CONFIG.CELL_WIDTH_PX;
    const towerWidth = CONFIG.FLOOR_WIDTH_CELLS * cell;
    const nextIndex = topFloorIndex(state.tower) + 1;
    const valid = hoverError === null;

    switch (tool) {
      case 'buildBasement': {
        const floor = state.tower.floors[0]!.index - 1;
        const error = buildFloorError(state, floor);
        g.rect(0, floorTopY(floor, state.tower.lobbyHeight), towerWidth, CONFIG.FLOOR_HEIGHT_PX).fill({ color: error ? RED : GREEN, alpha: GREEN_ALPHA });
        if (error) this.showError(error, hover ? hover.cell * cell : 0, floorTopY(floor, state.tower.lobbyHeight), cell);
        break;
      }
      case 'buildFloor': {
        if (state.tower.floors.length === 0) break;
        const canBuild = buildFloorError(state, nextIndex) === null;
        g.rect(0, floorTopY(nextIndex, state.tower.lobbyHeight), towerWidth, bandHeightPx(nextIndex, state.tower.lobbyHeight)).fill(
          canBuild ? { color: GREEN, alpha: GREEN_ALPHA } : { color: RED, alpha: RED_ALPHA },
        );
        if (hoverError) this.showError(hoverError, 0, floorTopY(nextIndex, state.tower.lobbyHeight), towerWidth);
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
        if (hoverError) this.showError(hoverError, x, y, cell * plan.width);
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
        g.rect(x, y, cell, h).fill(
          ok ? { color: GREEN, alpha: GREEN_ALPHA } : { color: RED, alpha: RED_ALPHA },
        );
        if (!ok) this.showError(err, x + cell, y, cell);
        // Direction glyph, tinted with the rect's validity.
        const cx = x + cell / 2;
        const cy = y + h / 2;
        const half = 3;
        const tipY = tool === 'escalatorUp' ? cy - half : cy + half;
        const baseY = tool === 'escalatorUp' ? cy + half : cy - half;
        g.poly([cx, tipY, cx - half, baseY, cx + half, baseY]).fill({
          color: ok ? GREEN : RED,
          alpha: 1,
        });
        break;
      }
      default: {
        // Tenant tools + stairs — sim placement cells.
        if (!hover) break;
        const width =
          tool === 'stairs'
            ? cell
            : TENANT_DATA[tool].sizeCells * cell;
        const x = hover.cell * cell;
        const stairFromLobby = tool === 'stairs' && hover.floor === CONFIG.LOBBY_FLOOR_INDEX;
        const height = tool === 'stairs' ? 1 : facilityHeight(tool);
        const y = floorTopY(stairFromLobby ? hover.floor + 1 : hover.floor + height - 1, state.tower.lobbyHeight);
        const h = stairFromLobby ? bandBottomPx(hover.floor, state.tower.lobbyHeight) - y : height * bandHeightPx(hover.floor, state.tower.lobbyHeight);
        g.rect(x, y, width, h).fill(
          valid ? { color: GREEN, alpha: GREEN_ALPHA } : { color: RED, alpha: RED_ALPHA },
        );
        if (hoverError) this.showError(hoverError, x, y, width);
        break;
      }
    }
  }

  /** Error caption anchored just right of the preview rect. */
  private showError(message: string, x: number, y: number, width: number): void {
    this.errorText.text = message;
    this.errorText.position.set(x + width + 6, y + 1);
    this.errorText.visible = true;
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
