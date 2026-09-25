import { CONFIG } from '../data/config';
import type { GameState } from './state';

/**
 * Per-floor per-direction waiting queues for elevators (uniElv equivalent).
 * Keyed by `${floor}:${dir}`; arrays keep arrival order (deterministic).
 * Capacity and shaft-specific counts follow each person's active route, keeping
 * existing save data compatible without combining separate shaft capacities.
 */

export type QueueDir = 'up' | 'down';

export function queueKey(floor: number, dir: QueueDir): string {
  return `${floor}:${dir}`;
}

/** Join the back of a queue. Returns false (queue full) without joining. */
export function joinQueue(
  state: GameState,
  personId: number,
  floor: number,
  dir: QueueDir,
): boolean {
  const key = queueKey(floor, dir);
  const queue = (state.queues[key] ??= []);
  if (queue.includes(personId)) return true;
  const groupId = queuedGroup(state, personId);
  if (queue.filter(id => queuedGroup(state, id) === groupId).length >= CONFIG.QUEUE_MAX_PER_SIDE) return false;
  queue.push(personId);
  return true;
}

/** Remove a person from whichever queue they are in (if any). */
export function leaveQueue(state: GameState, personId: number): void {
  for (const key of Object.keys(state.queues)) {
    const queue = state.queues[key]!;
    const i = queue.indexOf(personId);
    if (i >= 0) {
      queue.splice(i, 1);
      // A cancelled final trip must not leave an empty hall call behind.
      // Other shafts share this bucket, so retain the call while anyone waits.
      if (queue.length === 0) {
        const [floor, dir] = key.split(':');
        clearCall(state, Number(floor), dir as QueueDir);
      }
      return;
    }
  }
}

function queuedGroup(state: GameState, personId: number): number | undefined {
  const person = state.people.get(personId);
  const leg = person?.route?.[person.legIndex];
  return leg?.mode === 'elevator' ? leg.groupId : undefined;
}

export function queueLength(state: GameState, floor: number, dir: QueueDir, groupId?: number): number {
  const queue = state.queues[queueKey(floor, dir)] ?? [];
  return groupId === undefined ? queue.length : queue.filter(id => queuedGroup(state, id) === groupId).length;
}

/** Queue in arrival order (person ids). */
export function queueHead(state: GameState, floor: number, dir: QueueDir): number[] {
  return state.queues[queueKey(floor, dir)] ?? [];
}

// --- Elevator call buttons (owned here so people and elevators share them
//     without an import cycle) ---

/** Press the up/down call button on a floor (lobby uses the same buttons). */
export function pressCall(state: GameState, floor: number, dir: QueueDir): void {
  const calls = state.floorCalls.get(floor) ?? { up: false, down: false };
  calls[dir] = true;
  state.floorCalls.set(floor, calls);
}

export function clearCall(state: GameState, floor: number, dir: QueueDir): void {
  const calls = state.floorCalls.get(floor);
  if (!calls) return;
  calls[dir] = false;
}

export function callPending(state: GameState, floor: number, dir: QueueDir): boolean {
  return state.floorCalls.get(floor)?.[dir] === true;
}

/** Any call (either direction) pending on a floor. */
export function anyCallPending(state: GameState, floor: number): boolean {
  const calls = state.floorCalls.get(floor);
  return !!calls && (calls.up || calls.down);
}
