import { buildFloorError, getFloor, topFloorIndex, type GameState } from '../sim';
import { floorBounds, floorExtensionError } from '../sim/tower';

export function floorBuildPlan(state: GameState, hover: { floor: number; cell: number } | null, basement = false) {
  if (hover && (basement ? hover.floor <= 0 : hover.floor > 1) && getFloor(state.tower, hover.floor)) {
    const bounds = floorBounds(state, hover.floor);
    if (hover.cell < bounds.lo || hover.cell >= bounds.hi) {
      return { floor: hover.floor, extending: true,
        lo: bounds.lo === bounds.hi ? hover.cell : hover.cell < bounds.lo ? hover.cell : bounds.hi,
        hi: bounds.lo === bounds.hi ? hover.cell + 1 : hover.cell < bounds.lo ? bounds.lo : hover.cell + 1,
        error: floorExtensionError(state, hover.floor, hover.cell) };
    }
  }
  const floor = basement ? state.tower.floors[0]!.index - 1 : topFloorIndex(state.tower) + 1;
  return { floor, extending: false, ...floorBounds(state, basement ? floor + 1 : floor - 1), error: buildFloorError(state, floor) };
}
