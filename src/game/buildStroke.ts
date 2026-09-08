import { CONFIG, TENANT_DATA } from '../data/config';
import { placeEscalator, placeStair, placeTenant, type GameState } from '../sim';
import type { Tool } from './controller';

export type RowBuildTool = Exclude<Tool,
  'select' | 'demolish' | 'buildFloor' | 'lobby' | 'elevator' | 'serviceElevator' | 'expressElevator'>;

export function isRowBuildTool(tool: Tool): tool is RowBuildTool {
  return !['select', 'demolish', 'buildFloor', 'lobby', 'elevator', 'serviceElevator', 'expressElevator'].includes(tool);
}

/** A row is aligned to the first placement and stays on its starting floor. */
export class BuildStroke {
  private visited = new Set<number>();
  private previous = 0;
  readonly width: number;
  placed = 0;
  error: string | null = null;

  constructor(readonly tool: RowBuildTool, readonly floor: number, readonly anchor: number) {
    this.width = tool === 'stairs' || tool === 'escalatorUp' || tool === 'escalatorDown'
      ? 1 : TENANT_DATA[tool].sizeCells;
  }

  extend(state: GameState, cell: number): void {
    const bounded = Math.min(CONFIG.FLOOR_WIDTH_CELLS - 1, Math.max(0, cell));
    const next = Math.trunc((bounded - this.anchor) / this.width);
    const direction = next >= this.previous ? 1 : -1;
    for (let slot = this.previous; ; slot += direction) {
      if (!this.visited.has(slot)) {
        this.visited.add(slot);
        const x = this.anchor + slot * this.width;
        try {
          if (this.tool === 'stairs') placeStair(state, this.floor, x);
          else if (this.tool === 'escalatorUp' || this.tool === 'escalatorDown') {
            placeEscalator(state, this.floor, x, this.tool === 'escalatorUp' ? 'up' : 'down');
          } else placeTenant(state, this.tool, this.floor, x);
          this.placed++;
          this.error = null;
        } catch (error) {
          this.error = error instanceof Error ? error.message : String(error);
        }
      }
      if (slot === next) break;
    }
    this.previous = next;
  }
}
