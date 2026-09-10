import { CONFIG } from '../data/config';
import { recordEvent } from './campaign';
import { rngInt } from './core/rng';
import { spend } from './money';
import type { GameState } from './state';

export type CellContent =
  | 'empty'
  | 'tenant'
  | 'stair'
  | 'escalator'
  | 'elevatorShaft'
  | 'elevatorLobby'
  | 'facility'
  | 'scaffold';

export interface GridCell {
  content: CellContent;
  /** Entity id when content is 'tenant'/'scaffold'/'facility'; -1 otherwise. */
  tenantId: number;
}

export interface Floor {
  /** 0 = B1, 1 = ground/lobby floor, 2..MAX_FLOORS above ground. */
  index: number;
  cells: GridCell[];
}

export interface Tower {
  lobbyHeight: 1 | 2 | 3;
  /** Sorted ascending by index. */
  floors: Floor[];
  /** Bumped by EVERY structural mutation; render/dirty-checking keys off this. */
  structureRevision: number;
}

export function createTower(): Tower {
  return { floors: [], structureRevision: 0, lobbyHeight: 1 };
}

export function emptyCell(): GridCell {
  return { content: 'empty', tenantId: -1 };
}

export function getFloor(tower: Tower, index: number): Floor | undefined {
  return tower.floors.find((f) => f.index === index);
}

/** Highest built floor index, or -1 for an empty tower. */
export function topFloorIndex(tower: Tower): number {
  const top = tower.floors[tower.floors.length - 1];
  return top ? top.index : -1;
}

/** Pure structural add (no money). Throws on out-of-range or duplicate. */
function addFloor(tower: Tower, index: number): Floor {
  if (index < CONFIG.MIN_FLOOR_INDEX || index > CONFIG.MAX_FLOORS) {
    throw new Error(`Floor ${index} out of range`);
  }
  if (getFloor(tower, index)) {
    throw new Error(`Floor ${index} already exists`);
  }
  const floor: Floor = {
    index,
    cells: Array.from({ length: CONFIG.FLOOR_WIDTH_CELLS }, () => emptyCell()),
  };
  tower.floors.push(floor);
  tower.floors.sort((a, b) => a.index - b.index);
  tower.structureRevision++;
  return floor;
}

/** Cost in dollars for building floor `index` (B1/lobby floor are free). */
export function floorCostDollars(index: number): number {
  if (index < 0) return 15_000 + Math.abs(index) * 5_000;
  if (index <= CONFIG.LOBBY_FLOOR_INDEX) return 0;
  return (
    CONFIG.FLOOR_COST_BASE_DOLLARS +
    CONFIG.FLOOR_COST_STEP_DOLLARS * (index - CONFIG.LOBBY_FLOOR_INDEX - 1)
  );
}

/** Human-readable reason the build would fail, or null if it is allowed. */
export function buildFloorError(state: GameState, index: number): string | null {
  if (index < CONFIG.MIN_FLOOR_INDEX || index > CONFIG.MAX_FLOORS) {
    return 'Floor out of range';
  }
  if (getFloor(state.tower, index)) return 'Floor already exists';
  if (index < 0 && !getFloor(state.tower, index + 1)) return 'Build the basement above first';
  if (index > CONFIG.LOBBY_FLOOR_INDEX && !getFloor(state.tower, index - 1)) {
    return 'Build lower floors first';
  }
  if (floorCostDollars(index) * 100 > state.money.balanceCents) {
    return 'Not enough funds';
  }
  return null;
}

/** Build an empty floor, deducting its cost. Throws Error(reason) if invalid. */
export function buildFloor(state: GameState, index: number): Floor {
  const error = buildFloorError(state, index);
  if (error) throw new Error(error);
  const cost = floorCostDollars(index) * 100;
  if (cost > 0 && !spend(state, cost)) throw new Error('Not enough funds');
  const floor = addFloor(state.tower, index);
  if (index < 0 && !state.campaign.treasureFound && rngInt(state, 0, 7) === 0) {
    state.campaign.treasureFound = true;
    state.money.balanceCents += 1_000_000 * 100;
    recordEvent(state, 'Excavation uncovered hidden treasure worth $1,000,000.');
  }
  return floor;
}

/** Only the top floor may be demolished, and only when completely empty. */
export function demolishFloor(state: GameState, index: number): void {
  const tower = state.tower;
  if (index === 0 || index === CONFIG.LOBBY_FLOOR_INDEX) {
    throw new Error('The lobby floor cannot be demolished');
  }
  if (index > 0 ? topFloorIndex(tower) !== index : tower.floors[0]?.index !== index) {
    throw new Error('Only the top floor can be demolished');
  }
  const floor = getFloor(tower, index);
  if (!floor) throw new Error('Floor does not exist');
  if (floor.cells.some((c) => c.content !== 'empty')) {
    throw new Error('Remove everything on this floor first');
  }
  tower.floors = tower.floors.filter((f) => f.index !== index);
  tower.structureRevision++;
}

// --- Stairs ---

/** Escalator landing cells are shared; count installed links, not their cells. */
export function stairEscalatorCount(state: GameState): number {
  let count = state.escalators.size;
  for (const floor of state.tower.floors) for (const cell of floor.cells) if (cell.content === 'stair') count++;
  return count;
}

/** Human-readable reason a stair placement would fail, or null. */
export function stairPlacementError(state: GameState, floorIndex: number, x: number): string | null {
  if (floorIndex === CONFIG.LOBBY_FLOOR_INDEX) floorIndex++;
  const floor = getFloor(state.tower, floorIndex);
  if (!floor) return 'Build this floor first';
  if (floorIndex <= CONFIG.LOBBY_FLOOR_INDEX) return 'Stairs start above the lobby';
  if (x < 0 || x >= CONFIG.FLOOR_WIDTH_CELLS) return 'Does not fit on the floor';
  const cell = floor.cells[x];
  if (!cell || cell.content !== 'empty') return 'Space is occupied';
  if (stairEscalatorCount(state) >= CONFIG.MAX_STAIRS_ESCALATORS) return 'Maximum 64 stairs and escalators combined';
  // Stairwell continuity: stair below (or the lobby floor beneath).
  const below = getFloor(state.tower, floorIndex - 1);
  if (below && below.index !== CONFIG.LOBBY_FLOOR_INDEX && below.cells[x]?.content !== 'stair') {
    return 'Needs a stair directly below';
  }
  if (CONFIG.STAIR_COST_DOLLARS * 100 > state.money.balanceCents) return 'Not enough funds';
  return null;
}

/** Place a stair cell, deducting its cost. Throws Error(reason) if invalid. */
export function placeStair(state: GameState, floorIndex: number, x: number): void {
  const error = stairPlacementError(state, floorIndex, x);
  if (error) throw new Error(error);
  if (!spend(state, CONFIG.STAIR_COST_DOLLARS * 100)) throw new Error('Not enough funds');
  const floor = getFloor(state.tower, floorIndex === CONFIG.LOBBY_FLOOR_INDEX ? floorIndex + 1 : floorIndex)!;
  floor.cells[x] = { content: 'stair', tenantId: -1 };
  state.tower.structureRevision++;
}

// --- World-coordinate grid math (shared by sim and controller) ---

/**
 * World y of a floor band's TOP edge. World coordinates: ground level is y=0,
 * basement extends downward (positive y), floors extend upward (negative y).
 * Lobby floor (index 1) spans one to three floor bands and ends at y=0.
 * Upper floors are offset by the selected lobby height.
 */
export function floorTopY(index: number, lobbyHeight: number = CONFIG.LOBBY_HEIGHT_FLOORS): number {
  if (index <= CONFIG.BASEMENT_FLOOR_INDEX) return index === 0 ? 0 : -index * CONFIG.FLOOR_HEIGHT_PX;
  return (
    -CONFIG.FLOOR_HEIGHT_PX * lobbyHeight -
    CONFIG.FLOOR_HEIGHT_PX * (index - 1)
  );
}

/** World-pixel height of a floor band at zoom 1 (lobby is taller). */
export function floorHeightPx(floor: Floor, lobbyHeight: number = CONFIG.LOBBY_HEIGHT_FLOORS): number {
  return floor.index === CONFIG.LOBBY_FLOOR_INDEX
    ? CONFIG.FLOOR_HEIGHT_PX * lobbyHeight
    : CONFIG.FLOOR_HEIGHT_PX;
}

/** Floor index whose band contains world y (clamped to B1 for deep y). */
export function floorIndexAtWorldY(y: number, lobbyHeight: number = CONFIG.LOBBY_HEIGHT_FLOORS): number {
  const h = CONFIG.FLOOR_HEIGHT_PX;
  // Deep underground clamps to B1: the tower has no floors below the basement.
  if (y >= 0) return (Math.max(CONFIG.MIN_FLOOR_INDEX, -Math.floor(y / h)) || 0);
  if (y >= -h * lobbyHeight) return CONFIG.LOBBY_FLOOR_INDEX;
  return (
    CONFIG.LOBBY_FLOOR_INDEX +
    Math.ceil((-h * lobbyHeight - y) / h)
  );
}

/** Cell index for world x, clamped to the floor width. */
export function cellIndexAtWorldX(x: number): number {
  const cell = Math.floor(x / CONFIG.CELL_WIDTH_PX);
  return Math.min(Math.max(cell, 0), CONFIG.FLOOR_WIDTH_CELLS - 1);
}
