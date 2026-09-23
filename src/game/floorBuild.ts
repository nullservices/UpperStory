import { buildFloorError, getFloor, topFloorIndex, type GameState } from '../sim';
import { floorBounds, floorExtensionError } from '../sim/tower';

export function floorBuildPlan(state: GameState, hover: { floor: number; cell: number } | null) {
  if (hover && hover.floor > 1 && getFloor(state.tower, hover.floor)) {
    const bounds = floorBounds(state, hover.floor);
    if (hover.cell < bounds.lo || hover.cell >= bounds.hi) {
      return { floor: hover.floor, extending: true,
        lo: hover.cell < bounds.lo ? hover.cell : bounds.hi,
        hi: hover.cell < bounds.lo ? bounds.lo : hover.cell + 1,
        error: floorExtensionError(state, hover.floor, hover.cell) };
    }
  }
  const floor = topFloorIndex(state.tower) + 1;
  return { floor, extending: false, ...floorBounds(state, floor - 1), error: buildFloorError(state, floor) };
}
