import { Graphics, Text } from 'pixi.js';
import { CONFIG, TENANT_DATA } from '../data/config';
import type { Tool } from '../game/controller';
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
      case 'buildFloor': {
        if (state.tower.floors.length === 0) break;
        const canBuild = buildFloorError(state, nextIndex) === null;
        g.rect(0, floorTopY(nextIndex), towerWidth, bandHeightPx(nextIndex)).fill(
          canBuild ? { color: GREEN, alpha: GREEN_ALPHA } : { color: RED, alpha: RED_ALPHA },
        );
        if (hoverError) this.showError(hoverError, 0, floorTopY(nextIndex), towerWidth);
        break;
      }
      case 'select':
      case 'demolish': {
        if (!hover) break;
        const color = tool === 'select' ? WHITE : RED;
        g.rect(hover.cell * cell, floorTopY(hover.floor), cell, bandHeightPx(hover.floor))
          .stroke({ width: 1, color, alpha: 0.9 });
        break;
      }
      case 'elevator':
      case 'serviceElevator':
      case 'expressElevator': {
        if (!hover) break;
        const x = (drag?.cell ?? hover.cell) * cell;
        const y = floorTopY(drag ? Math.max(drag.fromFloor, hover.floor) : hover.floor);
        const h = drag
          ? bandBottomPx(Math.min(drag.fromFloor, hover.floor)) - y
          : bandHeightPx(hover.floor);
        // Pre-drag the hint is always "too short" (a shaft needs 2+ floors),
        // which is the caption the controller computes for a single band.
        g.rect(x, y, cell * 2, h).fill(
          valid ? { color: GREEN, alpha: GREEN_ALPHA } : { color: RED, alpha: RED_ALPHA },
        );
        if (hoverError) this.showError(hoverError, x, y, cell * 2);
        break;
      }
      case 'escalatorUp':
      case 'escalatorDown': {
        if (!hover) break;
        const x = hover.cell * cell;
        const y = floorTopY(hover.floor + 1);
        const h = bandBottomPx(hover.floor) - y;
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
        const y = floorTopY(hover.floor);
        const h = bandHeightPx(hover.floor);
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
function bandHeightPx(index: number): number {
  return index === CONFIG.LOBBY_FLOOR_INDEX
    ? CONFIG.FLOOR_HEIGHT_PX * CONFIG.LOBBY_HEIGHT_FLOORS
    : CONFIG.FLOOR_HEIGHT_PX;
}

/** World y of the bottom edge of floor `index`'s band. */
function bandBottomPx(index: number): number {
  return floorTopY(index) + bandHeightPx(index);
}
