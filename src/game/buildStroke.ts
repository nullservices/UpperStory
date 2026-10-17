import { CONFIG, TENANT_DATA } from '../data/config';
import type { GameState } from '../sim';
import { placeEscalatorRecorded, placeStairRecorded, placeTenantRecorded, type UndoPart } from '../sim/undo';
import type { Tool } from './controller';

export type RowBuildTool = Exclude<Tool,
  'select' | 'demolish' | 'buildFloor' | 'buildBasement' | 'elevator' | 'serviceElevator' | 'expressElevator'>;

export function isRowBuildTool(tool: Tool): tool is RowBuildTool {
  return !['select', 'demolish', 'buildFloor', 'buildBasement', 'elevator', 'serviceElevator', 'expressElevator'].includes(tool);
}

/** A row is aligned to the first placement and stays on its starting floor. */
export class BuildStroke {
  private visited = new Set<number>();
  private previous = 0;
  readonly width: number;
  placed = 0;
  /** Total charged for this row so far (cents). */
  spentCents = 0;
  error: string | null = null;
  /** What each placement created and cost, for Undo (in build order). */
  readonly parts: UndoPart[] = [];

  constructor(readonly tool: RowBuildTool, readonly floor: number, readonly anchor: number) {
    this.width = tool === 'stairs' || tool === 'escalatorUp' || tool === 'escalatorDown'
      ? 8 : TENANT_DATA[tool].sizeCells;
  }

  extend(state: GameState, cell: number): void {
    const bounded = Math.min(CONFIG.FLOOR_WIDTH_CELLS - 1, Math.max(0, cell));
    const next = Math.trunc((bounded - this.anchor) / this.width);
    const direction = next >= this.previous ? 1 : -1;
    for (let slot = this.previous; ; slot += direction) {
      if (!this.visited.has(slot)) {
        this.visited.add(slot);
        const x = this.anchor + slot * this.width;
        const before = state.money.balanceCents;
        try {
          let part: UndoPart;
          if (this.tool === 'stairs') part = placeStairRecorded(state, this.floor, x);
          else if (this.tool === 'escalatorUp' || this.tool === 'escalatorDown') {
            part = placeEscalatorRecorded(state, this.floor, x, this.tool === 'escalatorUp' ? 'up' : 'down');
          } else part = placeTenantRecorded(state, this.tool, this.floor, x);
          this.parts.push(part);
          this.placed++;
          this.spentCents += Math.max(0, before - state.money.balanceCents);
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
