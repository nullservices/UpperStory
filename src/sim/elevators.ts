import { CONFIG } from '../data/config';
import { giveUp } from './people';
import {
  anyCallPending,
  callPending,
  clearCall,
  pressCall,
  queueHead,
  type QueueDir,
} from './queues';
import type { GameState } from './state';
import { getFloor, stairEscalatorCount } from './tower';

/**
 * Elevator groups, cars, calls and dispatch (ElevatorsT equivalent).
 * Dispatch is a deterministic greedy: idle cars serve the nearest pending
 * call in their service range; moving cars opportunistically collect
 * same-direction calls they pass (classic collect mode), and cars with
 * passengers first serve the nearest passenger destination.
 */

export type ElevatorKind = 'standard' | 'service' | 'express';
export type ElevatorPriority = 'normal' | 'up' | 'down';
export const SERVICE_PERIODS = [
  { start: 420, label: '07:00–10:00' }, { start: 600, label: '10:00–12:00' },
  { start: 720, label: '12:00–13:00' }, { start: 780, label: '13:00–17:00' },
  { start: 1020, label: '17:00–21:00' }, { start: 1260, label: '21:00–07:00' },
] as const;

export function activePriority(state: GameState, group: ElevatorGroup): ElevatorPriority {
  const minute = ((state.calendar.minuteOfDay - 420) % 1440 + 1440) % 1440 + 420;
  let period = 0;
  for (let i = 1; i < SERVICE_PERIODS.length; i++) if (minute >= SERVICE_PERIODS[i]!.start) period = i;
  return group.schedule?.[state.calendar.day % 3 === 0 ? 'weekend' : 'weekday'][period] ?? 'normal';
}

export function setElevatorPriority(state: GameState, groupId: number, day: 'weekday' | 'weekend', period: number, priority: ElevatorPriority): void {
  const group = state.elevatorGroups.get(groupId);
  if (!group) throw new Error('Elevator not found');
  if (!['weekday', 'weekend'].includes(day) || !Number.isInteger(period) || period < 0 || period >= SERVICE_PERIODS.length || !['normal', 'up', 'down'].includes(priority)) throw new Error('Invalid service schedule');
  group.schedule ??= { weekday: Array<ElevatorPriority>(6).fill('normal'), weekend: Array<ElevatorPriority>(6).fill('normal') };
  group.schedule[day][period] = priority;
}

export function setCarHome(state: GameState, groupId: number, carId: number, floor: number | null): void {
  const group = state.elevatorGroups.get(groupId);
  const car = group?.cars.find(c => c.id === carId);
  if (!group || !car) throw new Error('Elevator car not found');
  if (floor !== null && !group.stops.includes(floor)) throw new Error('Home floor must be a serviced stop');
  car.homeFloor = floor;
}

export function elevatorCapacity(kind: ElevatorKind): number {
  return CONFIG.ELEVATOR_CAPACITIES[kind];
}

export interface ElevatorGroup {
  id: number;
  kind: ElevatorKind;
  /** Shaft cell column; the adjacent boarding cell is x+1. */
  x: number;
  serviceLo: number;
  serviceHi: number;
  /**
   * Floors the cars may actually stop at. Standard/service: every serviced
   * floor. Express: only the lobby, B1 and sky-lobby floors.
   */
  stops: number[];
  cars: ElevatorCar[];
  schedule?: { weekday: ElevatorPriority[]; weekend: ElevatorPriority[] };
  disabledStops?: number[];
}

export interface ElevatorCar {
  id: number;
  /** Continuous position in floor units (0 = B1, 1 = lobby floor, 2.5 = between 2 and 3). */
  y: number;
  dir: 0 | 1 | -1;
  state: 'idle' | 'moving' | 'doors';
  doorsTicksLeft: number;
  targetFloor: number | null;
  passengers: number[];
  speedLevel: 1 | 2 | 3;
  /** Last floor the car was at/left — used for crossing detection. */
  lastFloor: number;
  /** Null/absent retains the current idle position. */
  homeFloor?: number | null;
}

export function carSpeed(car: ElevatorCar): number {
  return CONFIG.ELEVATOR_SPEED_LEVELS[car.speedLevel - 1]!;
}

/** World-pixel y of a car at continuous floor-unit position y. */
export function carWorldY(y: number): number {
  return y <= 0 ? -y * CONFIG.FLOOR_HEIGHT_PX : -(y + 1) * CONFIG.FLOOR_HEIGHT_PX;
}

export function groupAt(state: GameState, floorIndex: number, x: number): ElevatorGroup | undefined {
  for (const group of state.elevatorGroups.values()) {
    if (group.x === x && group.serviceLo <= floorIndex && floorIndex <= group.serviceHi) {
      return group;
    }
  }
  return undefined;
}

// --- Placement ---

/** Human-readable reason the shaft placement would fail, or null. */
export function elevatorPlacementError(
  state: GameState,
  floorLo: number,
  floorHi: number,
  x: number,
  kind: ElevatorKind = 'standard',
  existingGroupId?: number,
): string | null {
  if (existingGroupId === undefined && state.starLevel < (kind === 'express' ? 3 : kind === 'service' ? 2 : 1)) return `Requires ${kind === 'express' ? 3 : 2} stars`;
  if (existingGroupId === undefined && state.elevatorGroups.size >= 24) return 'Maximum 24 elevator shafts';
  if (![floorLo, floorHi, x].every(Number.isInteger)) return 'Invalid shaft position';
  if (floorLo < CONFIG.MIN_FLOOR_INDEX || floorHi > CONFIG.MAX_FLOORS) return 'Floor out of range';
  if (floorLo > floorHi) return 'Drag from a lower floor upward';
  const span = floorHi - floorLo + 1;
  if (span < 2) return 'Shaft must span at least 2 floors';
  const maxSpan = kind === 'express' ? CONFIG.MAX_FLOORS - CONFIG.MIN_FLOOR_INDEX + 1 : CONFIG.MAX_SHAFT_FLOORS;
  if (span > maxSpan) return `Shaft max ${maxSpan} floors`;
  if (x < 0 || x + 1 >= CONFIG.FLOOR_WIDTH_CELLS) return 'Does not fit on the floor';
  const existing = existingGroupId === undefined ? undefined : state.elevatorGroups.get(existingGroupId);
  for (const other of state.elevatorGroups.values()) {
    if (other.id === existingGroupId) continue;
    if (floorLo <= other.serviceHi && floorHi >= other.serviceLo && x < other.x + 2 && x + 2 > other.x) {
      return 'An elevator is already here';
    }
  }
  for (let f = floorLo; f <= floorHi; f++) {
    const floor = getFloor(state.tower, f);
    if (!floor) return 'Build the floors first';
    if (existing && f >= existing.serviceLo && f <= existing.serviceHi) continue;
    if (f === CONFIG.LOBBY_FLOOR_INDEX) continue; // shafts pass through the lobby
    const sky = kind === 'express' ? skyLobbyOn(state, f) : null;
    if (sky) {
      // The express shaft must physically run through the sky lobby; its
      // cells (tenant or scaffold) are shared, never overwritten.
      if (x < sky.x || x + 1 >= sky.x + sky.sizeCells) {
        return 'The express shaft must run through the sky lobby';
      }
      for (const cx of [x, x + 1]) {
        const cell = floor.cells[cx];
        if (!cell) return 'Space is occupied';
        if (cell.content === 'empty') continue;
        if (cell.content === 'tenant' || cell.content === 'scaffold') continue;
        return 'Space is occupied';
      }
      continue;
    }
    for (const cx of [x, x + 1]) {
      const cell = floor.cells[cx];
      if (!cell || cell.content !== 'empty') return 'Space is occupied';
    }
  }
  const overlap = existing ? Math.max(0, Math.min(floorHi, existing.serviceHi) - Math.max(floorLo, existing.serviceLo) + 1) : 0;
  const cost = (span - overlap) * CONFIG.ELEVATOR_SHAFT_COST_PER_FLOOR_DOLLARS * 100;
  if (cost > state.money.balanceCents) return 'Not enough funds';
  return null;
}

/** The open/constructing sky-lobby tenant on a floor, if any. */
function skyLobbyOn(state: GameState, floorIndex: number): { x: number; sizeCells: number } | null {
  for (const tenant of state.tenants.values()) {
    if (tenant.type === 'skyLobby' && tenant.floor === floorIndex) {
      return { x: tenant.x, sizeCells: tenant.sizeCells };
    }
  }
  return null;
}

/** Express stops: lobby, B1 and every sky-lobby floor in the span. */
function stopsFor(
  state: GameState,
  kind: ElevatorKind,
  lo: number,
  hi: number,
): number[] {
  const stops: number[] = [];
  for (let f = lo; f <= hi; f++) {
    if (kind !== 'express') {
      stops.push(f);
      continue;
    }
    if (f === CONFIG.LOBBY_FLOOR_INDEX || f <= CONFIG.BASEMENT_FLOOR_INDEX || skyLobbyOn(state, f)) {
      stops.push(f);
    }
  }
  return stops;
}

/** Stop changes affect new routes; trips already planned finish normally. */
export function setElevatorStop(state: GameState, groupId: number, floor: number, enabled: boolean): void {
  const group = state.elevatorGroups.get(groupId);
  if (!group) throw new Error('Elevator not found');
  if (!stopsFor(state, group.kind, group.serviceLo, group.serviceHi).includes(floor)) throw new Error('This shaft cannot stop on that floor');
  if (group.stops.includes(floor) === enabled) return;
  if (!enabled && group.stops.length <= 2) throw new Error('Keep at least two stops in service');
  group.disabledStops = enabled ? (group.disabledStops ?? []).filter(f => f !== floor) : [...(group.disabledStops ?? []), floor];
  group.stops = stopsFor(state, group.kind, group.serviceLo, group.serviceHi).filter(f => !group.disabledStops!.includes(f));
  for (const car of group.cars) if (car.homeFloor === floor && !enabled) car.homeFloor = null;
  state.tower.structureRevision++;
}

/** Place a shaft spanning floors [lo, hi], deducting cost. Throws if invalid. */
export function placeElevatorGroup(
  state: GameState,
  floorLo: number,
  floorHi: number,
  x: number,
  kind: ElevatorKind = 'standard',
): ElevatorGroup {
  const error = elevatorPlacementError(state, floorLo, floorHi, x, kind);
  if (error) throw new Error(error);
  const span = floorHi - floorLo + 1;
  const cost = span * CONFIG.ELEVATOR_SHAFT_COST_PER_FLOOR_DOLLARS * 100;
  if (!spendHelper(state, cost)) throw new Error('Not enough funds');
  return makeGroup(state, floorLo, floorHi, x, kind);
}

function makeGroup(
  state: GameState,
  floorLo: number,
  floorHi: number,
  x: number,
  kind: ElevatorKind,
): ElevatorGroup {
  const id = state.nextEntityId++;
  const car: ElevatorCar = {
    id: state.nextEntityId++,
    y: floorLo,
    dir: 0,
    state: 'idle',
    doorsTicksLeft: 0,
    targetFloor: null,
    passengers: [],
    speedLevel: 1,
    lastFloor: floorLo,
  };
  const group: ElevatorGroup = {
    id,
    kind,
    x,
    serviceLo: floorLo,
    serviceHi: floorHi,
    stops: stopsFor(state, kind, floorLo, floorHi),
    cars: [car],
  };
  state.elevatorGroups.set(id, group);
  paintCells(state, group);
  state.tower.structureRevision++;
  return group;
}

/** Write the shaft + boarding cells for every serviced floor above the lobby. */
function paintCells(state: GameState, group: ElevatorGroup): void {
  for (let f = group.serviceLo; f <= group.serviceHi; f++) {
    if (f === CONFIG.LOBBY_FLOOR_INDEX) continue; // the lobby hosts the doors
    const floor = getFloor(state.tower, f)!;
    // Tenant cells (sky lobbies) are shared with the shaft — never overwrite.
    if (floor.cells[group.x]?.content === 'empty') {
      floor.cells[group.x] = { content: 'elevatorShaft', tenantId: -1 };
    }
    if (floor.cells[group.x + 1]?.content === 'empty') {
      floor.cells[group.x + 1] = { content: 'elevatorLobby', tenantId: -1 };
    }
  }
}

function clearCells(state: GameState, group: ElevatorGroup): void {
  for (let f = group.serviceLo; f <= group.serviceHi; f++) {
    if (f === CONFIG.LOBBY_FLOOR_INDEX) continue;
    const floor = getFloor(state.tower, f);
    if (!floor) continue;
    for (const cx of [group.x, group.x + 1]) {
      const content = floor.cells[cx]?.content;
      if (content === 'elevatorShaft' || content === 'elevatorLobby') {
        floor.cells[cx] = { content: 'empty', tenantId: -1 };
      }
    }
  }
}

/** Add a car to a group (cost per car, max 8). Throws if invalid. */
export function addElevatorCar(state: GameState, groupId: number): void {
  const group = state.elevatorGroups.get(groupId);
  if (!group) throw new Error('Elevator not found');
  if (group.cars.length >= CONFIG.MAX_CARS_PER_SHAFT) throw new Error('Max cars reached');
  const cost = CONFIG.ELEVATOR_CAR_COST_DOLLARS * 100;
  if (cost > state.money.balanceCents) throw new Error('Not enough funds');
  state.money.balanceCents -= cost;
  group.cars.push({
    id: state.nextEntityId++,
    y: group.serviceLo,
    dir: 0,
    state: 'idle',
    doorsTicksLeft: 0,
    targetFloor: null,
    passengers: [],
    speedLevel: 1,
    lastFloor: group.serviceLo,
  });
  state.tower.structureRevision++;
}

/** Remove a car (no refund). A group always keeps at least one car. */
export function removeElevatorCar(state: GameState, groupId: number, carId: number): void {
  const group = state.elevatorGroups.get(groupId);
  if (!group) throw new Error('Elevator not found');
  if (group.cars.length <= 1) throw new Error('A shaft needs at least one car');
  const car = group.cars.find((c) => c.id === carId);
  if (!car) throw new Error('Car not found');
  if (car.passengers.length > 0) throw new Error('Car is occupied');
  group.cars.splice(group.cars.indexOf(car), 1);
  state.tower.structureRevision++;
}

/** Speed upgrade for one car (3 levels, cost per upgrade). Throws if invalid. */
export function upgradeCarSpeed(state: GameState, groupId: number, carId: number): void {
  const group = state.elevatorGroups.get(groupId);
  const car = group?.cars.find((c) => c.id === carId);
  if (!car) throw new Error('Car not found');
  if (car.speedLevel >= CONFIG.ELEVATOR_SPEED_LEVELS.length) throw new Error('Max speed');
  const cost = CONFIG.ELEVATOR_SPEED_UPGRADE_COST_DOLLARS * 100;
  if (cost > state.money.balanceCents) throw new Error('Not enough funds');
  state.money.balanceCents -= cost;
  car.speedLevel = (car.speedLevel + 1) as 1 | 2 | 3;
  state.tower.structureRevision++;
}

/** Validate resizing without changing the shaft, for both previews and commands. */
export function elevatorServiceRangeError(state: GameState, groupId: number, lo: number, hi: number): string | null {
  const group = state.elevatorGroups.get(groupId);
  if (!group) return 'Elevator not found';
  const error = elevatorPlacementError(state, lo, hi, group.x, group.kind, groupId);
  if (error) return error;
  if (group.disabledStops?.length && stopsFor(state, group.kind, lo, hi).filter(f => !group.disabledStops!.includes(f)).length < 2) return 'Keep at least two stops in service';
  // Extensions preserve every active route and car. Shrinks must not strand riders.
  if (lo > group.serviceLo || hi < group.serviceHi) {
    if (group.cars.some(car => car.state !== 'idle' || car.passengers.length > 0)) {
      return 'Wait for the elevators to empty and stop';
    }
    if ([...state.people.values()].some(p => p.route?.slice(p.legIndex).some(leg =>
      leg.mode === 'elevator' && leg.groupId === groupId &&
      (leg.from < lo || leg.from > hi || leg.to < lo || leg.to > hi)))) {
      return 'People still need the floors being removed';
    }
  }
  return null;
}

/** Extend an operating shaft; only added floors are charged. Shrinks have no refund. */
export function setElevatorServiceRange(state: GameState, groupId: number, lo: number, hi: number): void {
  const error = elevatorServiceRangeError(state, groupId, lo, hi);
  if (error) throw new Error(error);
  const group = state.elevatorGroups.get(groupId)!;
  if (lo === group.serviceLo && hi === group.serviceHi) return;
  const overlap = Math.max(0, Math.min(hi, group.serviceHi) - Math.max(lo, group.serviceLo) + 1);
  spendHelper(state, (hi - lo + 1 - overlap) * CONFIG.ELEVATOR_SHAFT_COST_PER_FLOOR_DOLLARS * 100);
  clearCells(state, group);
  group.serviceLo = lo;
  group.serviceHi = hi;
  const available = stopsFor(state, group.kind, lo, hi);
  if (group.disabledStops) group.disabledStops = group.disabledStops.filter(f => available.includes(f));
  group.stops = available.filter(f => !group.disabledStops?.includes(f));
  for (const car of group.cars) if (car.homeFloor != null && !group.stops.includes(car.homeFloor)) car.homeFloor = null;
  for (const car of group.cars) {
    if (car.y < lo || car.y > hi) {
      car.y = Math.max(lo, Math.min(hi, car.y));
      car.lastFloor = Math.round(car.y);
      car.targetFloor = null;
      car.dir = 0;
    }
  }
  paintCells(state, group);
  state.tower.structureRevision++;
}

/** Demolish a whole shaft: cells cleared, waiting people give up. */
export function demolishElevatorGroup(state: GameState, groupId: number): void {
  const group = state.elevatorGroups.get(groupId);
  if (!group) throw new Error('Elevator not found');
  for (const car of group.cars) {
    if (car.passengers.length > 0) throw new Error('Elevators are occupied');
  }
  // Waiting people whose route used this shaft give up.
  for (const p of [...state.people.values()]) {
    if (p.state !== 'waiting') continue;
    const leg = p.route?.[p.legIndex];
    if (leg?.mode === 'elevator' && leg.groupId === groupId) giveUp(state, p);
  }
  clearCells(state, group);
  state.elevatorGroups.delete(groupId);
  state.tower.structureRevision++;
}

// --- Escalators ---

/** Human-readable reason an escalator placement would fail, or null. */
export function escalatorPlacementError(
  state: GameState,
  floorIndex: number,
  x: number,
): string | null {
  if (x < 0 || x >= CONFIG.FLOOR_WIDTH_CELLS) return 'Does not fit on the floor';
  const lower = getFloor(state.tower, floorIndex);
  const upper = getFloor(state.tower, floorIndex + 1);
  if (!lower || !upper) return 'Build both floors first';
  if (!state.escalators.has(`${floorIndex}:${x}`) && stairEscalatorCount(state) >= CONFIG.MAX_STAIRS_ESCALATORS) return 'Maximum 64 stairs and escalators combined';
  // The lower cell may already be an escalator: chains share landing cells.
  if (lower.index !== CONFIG.LOBBY_FLOOR_INDEX) {
    const lowerCell = lower.cells[x];
    if (!lowerCell || (lowerCell.content !== 'empty' && lowerCell.content !== 'escalator')) {
      return 'Space is occupied';
    }
  }
  if (upper.index !== CONFIG.LOBBY_FLOOR_INDEX) {
    const upperCell = upper.cells[x];
    if (!upperCell || (upperCell.content !== 'empty' && upperCell.content !== 'escalator')) {
      return 'Space is occupied';
    }
  }
  if (CONFIG.ESCALATOR_COST_DOLLARS * 100 > state.money.balanceCents) return 'Not enough funds';
  return null;
}

/** Place a 1-way escalator spanning floors f..f+1 at column x. Throws if invalid. */
export function placeEscalator(
  state: GameState,
  floorIndex: number,
  x: number,
  dir: 'up' | 'down',
): void {
  const error = escalatorPlacementError(state, floorIndex, x);
  if (error) throw new Error(error);
  if (!spendHelper(state, CONFIG.ESCALATOR_COST_DOLLARS * 100)) throw new Error('Not enough funds');
  if (floorIndex !== CONFIG.LOBBY_FLOOR_INDEX) {
    const lowerCell = getFloor(state.tower, floorIndex)!.cells[x];
    if (lowerCell?.content !== 'escalator') {
      getFloor(state.tower, floorIndex)!.cells[x] = { content: 'escalator', tenantId: -1 };
    }
  }
  const upperCell = getFloor(state.tower, floorIndex + 1)!.cells[x];
  if (upperCell?.content !== 'escalator') {
    getFloor(state.tower, floorIndex + 1)!.cells[x] = { content: 'escalator', tenantId: -1 };
  }
  state.escalators.set(`${floorIndex}:${x}`, dir);
  state.tower.structureRevision++;
}

function spendHelper(state: GameState, cents: number): boolean {
  if (state.money.balanceCents < cents) return false;
  state.money.balanceCents -= cents;
  return true;
}

// --- Simulation step ---

export function stepElevators(state: GameState): void {
  for (const group of state.elevatorGroups.values()) {
    for (const car of group.cars) {
      stepCar(state, group, car);
    }
  }
}

function stepCar(state: GameState, group: ElevatorGroup, car: ElevatorCar): void {
  if (car.state === 'doors') {
    car.doorsTicksLeft--;
    if (car.doorsTicksLeft <= 0) completeDoors(state, group, car);
    return;
  }
  if (car.state === 'idle') {
    const target = pickTarget(state, group, car);
    if (target === null) return;
    car.targetFloor = target;
    const delta = target - car.y;
    if (Math.abs(delta) <= 1e-9) {
      // Already at the call floor: face the pending call's direction so the
      // right queue boards (delta alone would default to -1 and stall).
      car.dir = callPending(state, target, 'up') ? 1 : car.dir;
      car.dir = callPending(state, target, 'down') ? -1 : car.dir;
      arrive(state, group, car);
    } else {
      car.dir = delta > 0 ? 1 : -1;
      car.state = 'moving';
    }
    return;
  }
  // moving
  const speed = carSpeed(car);
  const target = car.targetFloor;
  if (target === null) {
    car.state = 'idle';
    return;
  }
  const dist = target - car.y;
  if (Math.abs(dist) <= speed) {
    car.y = target;
    arrive(state, group, car);
    return;
  }
  car.y += Math.sign(dist) * speed;
  // Riders move with the car.
  for (const pid of car.passengers) {
    const p = state.people.get(pid);
    if (p) p.pos = { floor: car.y, x: group.x + 0.5 };
  }
  // Opportunistic collect: a car with spare capacity stops for a pending
  // same-direction call on a floor it crosses.
  if (car.passengers.length < elevatorCapacity(group.kind)) {
    const crossed = car.dir > 0 ? Math.floor(car.y) : Math.ceil(car.y);
    if (crossed !== car.lastFloor) {
      car.lastFloor = crossed;
      const dir: QueueDir = car.dir > 0 ? 'up' : 'down';
      if (
        (group.stops.includes(crossed) || hasCommittedPickup(state, group, crossed)) &&
        callPending(state, crossed, dir)
      ) {
        car.y = crossed;
        arrive(state, group, car);
      }
    }
  }
}

/** Nearest target: passenger destinations first, then pending calls. */
function pickTarget(state: GameState, group: ElevatorGroup, car: ElevatorCar): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  const consider = (floor: number): void => {
    if (floor < group.serviceLo || floor > group.serviceHi) return;
    const d = Math.abs(car.y - floor);
    if (d < bestDist || (d === bestDist && best !== null && floor < best)) {
      best = floor;
      bestDist = d;
    }
  };
  if (car.passengers.length > 0) {
    for (const pid of car.passengers) {
      const p = state.people.get(pid);
      const leg = p?.route?.[p.legIndex];
      if (leg?.mode === 'elevator') consider(leg.to);
    }
    return best;
  }
  for (let f = group.serviceLo; f <= group.serviceHi; f++) {
    if (!anyCallPending(state, f) || (!group.stops.includes(f) && !hasCommittedPickup(state, group, f))) continue;
    const priority = activePriority(state, group);
    const penalty = priority !== 'normal' && !callPending(state, f, priority) ? group.serviceHi - group.serviceLo + 1 : 0;
    const distance = Math.abs(car.y - f) + penalty;
    if (distance < bestDist) { best = f; bestDist = distance; }
  }
  if (best !== null) return best;
  return car.homeFloor != null && group.stops.includes(car.homeFloor) && Math.abs(car.y - car.homeFloor) > 1e-9 ? car.homeFloor : null;
}

function hasCommittedPickup(state: GameState, group: ElevatorGroup, floor: number): boolean {
  return (['up', 'down'] as const).some(dir => queueHead(state, floor, dir).some(id => {
    const person = state.people.get(id);
    const leg = person?.route?.[person.legIndex];
    return leg?.mode === 'elevator' && leg.groupId === group.id && leg.from === floor;
  }));
}

/** Car reached its target floor: open doors, clear the served call. */
function arrive(state: GameState, group: ElevatorGroup, car: ElevatorCar): void {
  car.state = 'doors';
  car.doorsTicksLeft = CONFIG.ELEVATOR_DOOR_TICKS;
  car.targetFloor = null;
  const floor = Math.round(car.y);
  car.lastFloor = floor;
  for (const pid of car.passengers) {
    const p = state.people.get(pid);
    if (p) p.pos = { floor, x: group.x + 0.5 };
  }
  // An empty car travels toward a call, then serves the requested direction.
  if (car.passengers.length === 0) {
    const priority = activePriority(state, group);
    if (priority !== 'normal' && callPending(state, floor, priority)) car.dir = priority === 'up' ? 1 : -1;
    else if (car.dir >= 0 && callPending(state, floor, 'up')) car.dir = 1;
    else if (callPending(state, floor, 'down')) car.dir = -1;
    else if (callPending(state, floor, 'up')) car.dir = 1;
  }
  const dir: QueueDir | null = car.dir > 0 ? 'up' : car.dir < 0 ? 'down' : null;
  if (dir) clearCall(state, floor, dir);
  else {
    clearCall(state, floor, 'up');
    clearCall(state, floor, 'down');
  }
}

/** Doors finished: disembark, then board from the queue head. */
function completeDoors(state: GameState, group: ElevatorGroup, car: ElevatorCar): void {
  const floor = Math.round(car.y);

  // Disembark passengers whose leg ends here.
  for (const pid of [...car.passengers]) {
    const p = state.people.get(pid);
    const leg = p?.route?.[p.legIndex];
    if (p && leg?.mode === 'elevator' && leg.to === floor) {
      car.passengers.splice(car.passengers.indexOf(pid), 1);
      p.state = 'walking';
      p.pos = { floor, x: group.x + 1 };
      p.legIndex++;
      p.target = null; // people.ts continues the trip next tick
      p.waitTicks = 0;
    }
  }

  // Board: people whose current leg matches this group and direction.
  const dir: QueueDir | null = car.dir > 0 ? 'up' : car.dir < 0 ? 'down' : null;
  let boarded = 0;
  if (dir) {
    const queue = queueHead(state, floor, dir);
    for (const pid of [...queue]) {
      if (car.passengers.length >= elevatorCapacity(group.kind)) break;
      const p = state.people.get(pid);
      const leg = p?.route?.[p.legIndex];
      if (
        p &&
        leg?.mode === 'elevator' &&
        leg.groupId === group.id &&
        leg.dir === (dir === 'up' ? 1 : -1)
      ) {
        queue.splice(queue.indexOf(pid), 1);
        car.passengers.push(pid);
        p.state = 'riding';
        p.pos = { floor, x: group.x + 0.5 };
        p.waitTicks = 0;
        boarded++;
      }
    }
    // Leftover waiters re-press the call so another car comes.
    if (queue.length > 0) pressCall(state, floor, dir);
  }

  if (boarded === 0 && car.passengers.length === 0) car.dir = 0;
  car.state = 'idle';
}
