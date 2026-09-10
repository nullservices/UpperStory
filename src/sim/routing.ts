import { CONFIG } from '../data/config';
// Type-only import: keeps routing free of runtime cycles (elevators→people→routing).
import type { ElevatorGroup } from './elevators';
import type { PersonKind } from './people';
import { queueLength } from './queues';
import type { GameState } from './state';
import { getFloor } from './tower';

/** Mirrors people.ts's isStaff without a runtime import cycle. */
function isStaff(kind: PersonKind): boolean {
  return kind === 'guard' || kind === 'housekeeper';
}

/**
 * Per-trip route selection (RouteT equivalent: PickupRoute/PickupDRoute).
 * Preference order: stairs (short hops) → escalators → direct elevator →
 * lobby transfer. Returns null when the tower offers no way — the person
 * gives up (the game's canonical "your elevators suck" signal).
 *
 * Walk legs are implicit: people.ts walks to each leg's boarding position.
 */

export interface RouteLeg {
  mode: 'elevator' | 'stair' | 'escalator';
  from: number;
  to: number;
  dir: 1 | -1;
  groupId?: number;
  /** Column for stair/escalator legs. */
  x?: number;
}

export interface RoutingTables {
  /** structureRevision this table was built for. */
  revision: number;
  /** floor → group ids serving it (insertion order). */
  groupsServing: Map<number, number[]>;
  /** floor → up/down escalator hops available from that floor. */
  escalatorLinks: Map<number, { up: { x: number; to: number }[]; down: { x: number; to: number }[] }>;
}

export function emptyRoutingTables(): RoutingTables {
  return { revision: -1, groupsServing: new Map(), escalatorLinks: new Map() };
}

/** Rebuild routing tables when the tower structure changed (engine calls this). */
export function checkRouting(state: GameState): void {
  if (state.routing.revision !== state.tower.structureRevision) rebuildRouting(state);
}

export function rebuildRouting(state: GameState): void {
  const rt = emptyRoutingTables();
  rt.revision = state.tower.structureRevision;

  for (const group of state.elevatorGroups.values()) {
    for (const f of group.stops) {
      const list = rt.groupsServing.get(f) ?? [];
      list.push(group.id);
      rt.groupsServing.set(f, list);
    }
  }

  // Lobby landings share the lobby's cells, so the installed link map is
  // authoritative rather than the painted cell content.
  for (const [key, dir] of state.escalators) {
      const [floorIndex, x] = key.split(':').map(Number) as [number, number];
      if (dir === 'up') {
        // Rides from this floor up to floor.index+1.
        const links = rt.escalatorLinks.get(floorIndex) ?? { up: [], down: [] };
        links.up.push({ x, to: floorIndex + 1 });
        rt.escalatorLinks.set(floorIndex, links);
      } else {
        // Rides down from the upper floor (floor.index+1) to this floor.
        const upperLinks = rt.escalatorLinks.get(floorIndex + 1) ?? { up: [], down: [] };
        upperLinks.down.push({ x, to: floorIndex });
        rt.escalatorLinks.set(floorIndex + 1, upperLinks);
      }
  }

  state.routing = rt;
}

// --- Stairs ---

function stairAt(state: GameState, floorIndex: number, x: number): boolean {
  const cell = getFloor(state.tower, floorIndex)?.cells[x];
  return cell?.content === 'stair' && (cell.transportX ?? x) === x;
}

/** Adjacent floors a,b linked by a stair at column c (lobby = ground level). */
function stairLink(state: GameState, c: number, a: number, b: number): boolean {
  if (Math.abs(a - b) !== 1) return false;
  if (b === CONFIG.LOBBY_FLOOR_INDEX) return stairAt(state, a, c);
  if (a === CONFIG.LOBBY_FLOOR_INDEX) return stairAt(state, b, c);
  return stairAt(state, a, c) && stairAt(state, b, c);
}

/**
 * Stair route within a short hop: a single stair column must connect the
 * span contiguously (or reach the lobby floor as the ground connection).
 */
function stairRoute(state: GameState, from: number, to: number): RouteLeg[] | null {
  const span = Math.abs(to - from);
  if (span === 0 || span > CONFIG.STAIR_MAX_FLOORS) return null;
  const dir: 1 | -1 = to > from ? 1 : -1;
  const fromFloor = getFloor(state.tower, from);
  if (!fromFloor) return null;
  const candidateColumns: number[] = [];
  const candidateFloor = from === CONFIG.LOBBY_FLOOR_INDEX ? getFloor(state.tower, from + 1) ?? fromFloor : fromFloor;
  candidateFloor.cells.forEach((cell, x) => {
    if (cell.content === 'stair' && (cell.transportX ?? x) === x) candidateColumns.push(x);
  });
  for (const c of candidateColumns) {
    let ok = true;
    for (let f = from; f !== to; f += dir) {
      if (!stairLink(state, c, f, f + dir)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const legs: RouteLeg[] = [];
    for (let f = from; f !== to; f += dir) {
      legs.push({ mode: 'stair', from: f, to: f + dir, dir, x: c });
    }
    return legs;
  }
  return null;
}

// --- Escalators ---

interface EscHop {
  x: number;
  floor: number;
}

/** Escalator route via 1-way hops, bounded depth. */
function escalatorRoute(state: GameState, from: number, to: number): RouteLeg[] | null {
  const span = Math.abs(to - from);
  if (span === 0 || span > CONFIG.ESCALATOR_MAX_FLOORS) return null;
  const dir: 1 | -1 = to > from ? 1 : -1;
  const targetDir = dir === 1 ? 'up' : 'down';
  // BFS over floors; queue entries carry the hop path.
  const queue: { floor: number; path: EscHop[] }[] = [{ floor: from, path: [] }];
  const visited = new Set<number>([from]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.path.length >= CONFIG.ESCALATOR_MAX_FLOORS) continue;
    const links = state.routing.escalatorLinks.get(cur.floor);
    const hops = links?.[targetDir] ?? [];
    for (const hop of hops) {
      if (visited.has(hop.to)) continue;
      visited.add(hop.to);
      const path = [...cur.path, { x: hop.x, floor: hop.to }];
      if (hop.to === to) {
        const legs: RouteLeg[] = [];
        let f = from;
        for (const step of path) {
          legs.push({ mode: 'escalator', from: f, to: step.floor, dir, x: step.x });
          f = step.floor;
        }
        return legs;
      }
      queue.push({ floor: hop.to, path });
    }
  }
  return null;
}

// --- Elevators ---

function nearestCarDistance(group: ElevatorGroup, floor: number): number {
  let best = Infinity;
  for (const car of group.cars) {
    best = Math.min(best, Math.abs(car.y - floor));
  }
  return best;
}

/** Score a group for serving a trip from `from` toward `to` (lower wins). */
function groupScore(state: GameState, group: ElevatorGroup, from: number, to: number): number {
  const dir: 'up' | 'down' = to > from ? 'up' : 'down';
  const car = group.cars[0];
  const speed = car ? CONFIG.ELEVATOR_SPEED_LEVELS[car.speedLevel - 1]! : CONFIG.ELEVATOR_SPEED_LEVELS[0]!;
  let score =
    nearestCarDistance(group, from) / speed +
    group.cars.length * 0.3 +
    queueLength(state, from, dir) * 0.15;
  // Staff prefer service shafts when both exist.
  if (group.kind === 'service') score -= 2;
  return score;
}

function bestGroup(
  state: GameState,
  from: number,
  to: number,
  candidates: ElevatorGroup[],
): ElevatorGroup | null {
  let best: ElevatorGroup | null = null;
  let bestScore = Infinity;
  for (const group of candidates) {
    const score = groupScore(state, group, from, to);
    if (score < bestScore) {
      best = group;
      bestScore = score;
    }
  }
  return best;
}

function servingGroups(
  state: GameState,
  floor: number,
  kind: PersonKind,
): ElevatorGroup[] {
  const ids = state.routing.groupsServing.get(floor) ?? [];
  const groups: ElevatorGroup[] = [];
  for (const id of ids) {
    const group = state.elevatorGroups.get(id);
    if (!group) continue;
    // Standard and express shafts serve everyone; service shafts serve staff only.
    if (group.kind === 'standard' || group.kind === 'express' || isStaff(kind)) {
      groups.push(group);
    }
  }
  return groups;
}

/** Pick the best route from floor `from` to floor `to`, or null. */
export function pickupRoute(
  state: GameState,
  from: number,
  to: number,
  kind: PersonKind,
): RouteLeg[] | null {
  if (from === to) return [];

  const stairs = stairRoute(state, from, to);
  if (stairs) return stairs;

  const escalators = escalatorRoute(state, from, to);
  if (escalators) return escalators;

  // Direct elevator: a group serving both floors.
  const both = servingGroups(state, from, kind).filter((g) =>
    servingGroups(state, to, kind).some((h) => h.id === g.id),
  );
  const direct = bestGroup(state, from, to, both);
  if (direct) {
    return [
      { mode: 'elevator', from, to, dir: to > from ? 1 : -1, groupId: direct.id },
    ];
  }

  // Transfer (PickupDRoute equivalent): from→S, S→to, where S is the lobby
  // or a sky lobby. Sky transfers are the classic two-stage express pattern.
  const transferFloors = [CONFIG.LOBBY_FLOOR_INDEX, ...skyLobbyFloors(state)];
  for (const s of transferFloors) {
    if (s === from || s === to) continue;
    const downCandidates = servingGroups(state, from, kind).filter((g) =>
      servingGroups(state, s, kind).some((h) => h.id === g.id),
    );
    const upCandidates = servingGroups(state, s, kind).filter((g) =>
      servingGroups(state, to, kind).some((h) => h.id === g.id),
    );
    const down = bestGroup(state, from, s, downCandidates);
    const up = bestGroup(state, s, to, upCandidates);
    if (down && up) {
      return [
        { mode: 'elevator', from, to: s, dir: s > from ? 1 : -1, groupId: down.id },
        { mode: 'elevator', from: s, to, dir: to > s ? 1 : -1, groupId: up.id },
      ];
    }
  }

  return null;
}

/** Floors hosting a sky lobby tenant. */
function skyLobbyFloors(state: GameState): number[] {
  const floors: number[] = [];
  for (const tenant of state.tenants.values()) {
    if (tenant.type === 'skyLobby' && !floors.includes(tenant.floor)) {
      floors.push(tenant.floor);
    }
  }
  return floors;
}
