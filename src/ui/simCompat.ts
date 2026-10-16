import type { ElevatorCar, GameState } from '../sim';

/**
 * Read-side helpers for the shared simulation contracts in
 * docs/feature-plan.md (blackouts, broken cars, loans, located history).
 * They read optional fields structurally so older saves (without them)
 * degrade cleanly.
 */

export interface HistoryEntry { day: number; message: string; floor?: number; x?: number }

export function blackoutActive(state: GameState): boolean {
  return state.tickCount < ((state.campaign as { blackoutUntilTick?: number }).blackoutUntilTick ?? 0);
}

export function blackoutTicksLeft(state: GameState): number {
  return Math.max(0, ((state.campaign as { blackoutUntilTick?: number }).blackoutUntilTick ?? 0) - state.tickCount);
}

export function carOutOfService(car: ElevatorCar): boolean {
  return (car as { outOfService?: boolean }).outOfService === true;
}

export function loanBalanceCents(state: GameState): number {
  return (state.money as { loanCents?: number }).loanCents ?? 0;
}

export function historyEntries(state: GameState): readonly HistoryEntry[] {
  return state.campaign.history as readonly HistoryEntry[];
}

/** True when a history entry carries a location the camera can jump to. */
export function hasLocation(entry: HistoryEntry): entry is HistoryEntry & { floor: number; x: number } {
  return typeof entry.floor === 'number' && typeof entry.x === 'number';
}

