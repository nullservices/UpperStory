import { CONFIG } from '../data/config';
import { floorCostDollars, type GameState } from '../sim';
import { toolCostDollars } from '../ui/toolPalette';
import type { ElevatorDrag, Tool } from './controller';
import { elevatorBuildPlan } from './elevatorBuild';
import { floorBuildPlan } from './floorBuild';

/**
 * What the next click (or the current elevator drag) at `hover` would charge,
 * in dollars, or null for tools without a price (Inspect, Bulldoze).
 * Mirrors the sim's own charges so the cursor tip matches the receipt.
 */
export function placementCostDollars(
  state: GameState,
  tool: Tool | null,
  hover: { floor: number; cell: number } | null,
  drag: ElevatorDrag | null = null,
): number | null {
  if (!tool || !hover || tool === 'select' || tool === 'demolish') return null;
  switch (tool) {
    case 'buildFloor':
    case 'buildBasement': {
      const plan = floorBuildPlan(state, hover, tool === 'buildBasement');
      return plan.extending ? Math.max(0, plan.hi - plan.lo) * 500 : floorCostDollars(plan.floor);
    }
    case 'elevator':
    case 'serviceElevator':
    case 'expressElevator': {
      const kind = tool === 'serviceElevator' ? 'service' : tool === 'expressElevator' ? 'express' : 'standard';
      const plan = elevatorBuildPlan(state, drag?.fromFloor ?? hover.floor, hover.floor, drag?.cell ?? hover.cell, kind);
      const group = plan.groupId === undefined ? undefined : state.elevatorGroups.get(plan.groupId);
      if (!group) return CONFIG.ELEVATOR_PRICES[kind].shaft;
      const overlap = Math.max(0, Math.min(plan.hi, group.serviceHi) - Math.max(plan.lo, group.serviceLo) + 1);
      return (plan.hi - plan.lo + 1 - overlap) * CONFIG.ELEVATOR_SHAFT_COST_PER_FLOOR_DOLLARS;
    }
    default:
      return toolCostDollars(state, tool);
  }
}
