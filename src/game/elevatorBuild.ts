import { elevatorPlacementError, elevatorServiceRangeError, placeElevatorGroup, setElevatorServiceRange, type ElevatorKind } from '../sim/elevators';
import type { GameState } from '../sim/state';

/** Shared by pointer previews and commits so extensions use the same rules. */
export function elevatorBuildPlan(state: GameState, from: number, to: number, x: number, kind: ElevatorKind) {
  const start = [...state.elevatorGroups.values()].find(g => from >= g.serviceLo && from <= g.serviceHi && x >= g.x && x < g.x + 2);
  if (start) x = start.x;
  let lo = Math.min(from, to);
  let hi = Math.max(from, to);
  const group = start ?? [...state.elevatorGroups.values()].find(g =>
    g.x === x && lo <= g.serviceHi + 1 && hi >= g.serviceLo - 1);
  if (group) {
    lo = Math.min(lo, group.serviceLo);
    hi = Math.max(hi, group.serviceHi);
  } else if (lo === hi) hi++;
  const error = group && group.kind !== kind ? 'Select the matching elevator type to extend this shaft'
    : group ? elevatorServiceRangeError(state, group.id, lo, hi)
    : elevatorPlacementError(state, lo, hi, x, kind);
  return { lo, hi, x, groupId: group?.id, error };
}

export function buildElevator(state: GameState, from: number, to: number, x: number, kind: ElevatorKind): void {
  const plan = elevatorBuildPlan(state, from, to, x, kind);
  if (plan.error) throw new Error(plan.error);
  if (plan.groupId !== undefined) setElevatorServiceRange(state, plan.groupId, plan.lo, plan.hi);
  else placeElevatorGroup(state, plan.lo, plan.hi, plan.x, kind);
}
