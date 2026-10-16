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
}

export const landingQueues = new Map<number, LandingQueue>();

/** Stable key for one shaft landing. */
export function landingKey(groupId: number, floor: number): number {
  return groupId * 4096 + floor + 512;
}

/**
 * Which side of the shaft a landing's badge sits on: over the longer queue
 * (people stand there, so the badge reads as "this many waiting"), unless
 * that side is blocked (e.g. by a neighbouring shaft's landing door).
 */
export function badgeSide(q: LandingQueue, blocked: (side: -1 | 1) => boolean): -1 | 1 {
  const preferred: -1 | 1 = q.down > q.up ? 1 : -1;
  if (!blocked(preferred)) return preferred;
  const other: -1 | 1 = preferred === 1 ? -1 : 1;
  return blocked(other) ? preferred : other;
}
