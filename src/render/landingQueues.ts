import { CONFIG } from '../data/config';
import { getFloor, type GameState } from '../sim';

/**
 * Per-frame landing queue tallies, published by the people view (which
 * already walks every waiting person to lay out the queues) and read by the
 * world UX layer for its queue-count badges. Purely presentational.
 */
export interface LandingQueue {
  /** World x of the shaft's left edge. */
  left: number;
  /** World x of the shaft's right edge. */
  right: number;
  /** Floor index of the landing. */
  floor: number;
  /** World y of the landing's band top. */
  y: number;
  count: number;
  /** People queued left of the shaft (going up). */
  up: number;
  /** People queued right of the shaft (going down). */
  down: number;
  /** People standing on the right-hand side (a walled side sends its queue across). */
  east: number;
}

export const landingQueues = new Map<number, LandingQueue>();

/** Stable key for one shaft landing. */
export function landingKey(groupId: number, floor: number): number {
  return groupId * 4096 + floor + 512;
}

/**
 * Which side of the shaft a landing's badge sits on: over the longer line
 * (people stand there, so the badge reads as "this many waiting"), unless
 * that side is blocked (e.g. by a neighbouring shaft's landing door).
 */
export function badgeSide(q: LandingQueue, blocked: (side: -1 | 1) => boolean): -1 | 1 {
  const preferred: -1 | 1 = q.east * 2 > q.count ? 1 : -1;
  if (!blocked(preferred)) return preferred;
  const other: -1 | 1 = preferred === 1 ? -1 : 1;
  return blocked(other) ? preferred : other;
}

/** Built span of a floor in cells (the lobby's is its lobby room; found without copying the tenant map). */
export function builtSpan(state: GameState, floor: number): { lo: number; hi: number } {
  if (floor === CONFIG.LOBBY_FLOOR_INDEX) {
    for (const t of state.tenants.values()) if (t.type === 'lobby') return { lo: t.x, hi: t.x + t.sizeCells };
    return { lo: 0, hi: 0 };
  }
  const f = getFloor(state.tower, floor);
  return f ? { lo: f.builtLo ?? 0, hi: f.builtHi ?? CONFIG.FLOOR_WIDTH_CELLS } : { lo: 0, hi: 0 };
}
