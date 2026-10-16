import { CONFIG, TENANT_DATA, isHotel } from '../data/config';
import { elevatorCapacity, type ElevatorKind } from './elevators';
import { population, type PersonKind, type PersonState } from './people';
import type { GameState } from './state';
import type { TenantState, TenantType } from './tenants';
import { formatTimeOfDay, formatTowerDate, towerDate, type TowerDate } from './time';

/**
 * Read-only tower snapshot for comparing runs (playthrough bot, balance
 * passes, and eventually measurements taken from the original game). Pure:
 * never mutates state, never touches the RNG, and only reports plain data.
 */

export interface TenantStateCounts {
  total: number;
  constructing: number;
  open: number;
  vacant: number;
  damaged: number;
}

export interface ElevatorKindMetrics {
  shafts: number;
  cars: number;
  /** Cars that are moving or have their doors open. */
  activeCars: number;
  passengers: number;
  /** Passengers / (cars × capacity), 0..1. */
  loadFactor: number;
}

export interface TowerMetrics {
  day: number;
  tickCount: number;
  date: TowerDate;
  dateLabel: string;
  time: string;
  stars: number;
  fundsCents: number;
  dailyIncomeCents: number;
  dailyUpkeepCents: number;
  quarterIncomeCents: number;
  quarterUpkeepCents: number;
  population: number;
  /** People objects the sim is tracking (visitors included). */
  trackedPeople: number;
  floors: { count: number; top: number; bottom: number };
  tenants: Partial<Record<TenantType, TenantStateCounts>>;
  tenantStates: TenantStateCounts;
  /** Occupancy of open fixed-capacity rooms: people inside ÷ capacity. */
  occupancy: { inside: number; capacity: number; ratio: number };
  /** Open hotel rooms: guests booked (inside or travelling), cleanliness. */
  hotels: { rooms: number; beds: number; guests: number; averageCleanliness: number; dirtyRooms: number };
  stress: { average: number; averageDay: number; max: number; over50: number };
  peopleByState: Partial<Record<PersonState, number>>;
  peopleByKind: Partial<Record<PersonKind, number>>;
  failedTrips: { total: number; people: number };
  queues: { waiting: number; nonEmpty: number; longest: number; longestKey: string | null };
  elevators: {
    shafts: number;
    cars: number;
    activeCars: number;
    passengers: number;
    /** Share of cars moving or loading, 0..1. */
    utilization: number;
    loadFactor: number;
    byKind: Partial<Record<ElevatorKind, ElevatorKindMetrics>>;
  };
  campaign: { activeIncidents: number; waste: number; vipApproved: boolean; weddingHeld: boolean; bankrupt: boolean };
}

function emptyCounts(): TenantStateCounts {
  return { total: 0, constructing: 0, open: 0, vacant: 0, damaged: 0 };
}

function countState(counts: TenantStateCounts, state: TenantState): void {
  counts.total++;
  counts[state]++;
}

function round(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function towerMetrics(state: GameState): TowerMetrics {
  const tenants: Partial<Record<TenantType, TenantStateCounts>> = {};
  const tenantStates = emptyCounts();
  let hotelRooms = 0;
  let hotelBeds = 0;
  let cleanlinessSum = 0;
  let dirtyRooms = 0;
  let inside = 0;
  let capacity = 0;
  for (const tenant of state.tenants.values()) {
    countState((tenants[tenant.type] ??= emptyCounts()), tenant.state);
    countState(tenantStates, tenant.state);
    if (tenant.state === 'open' && isHotel(tenant.type)) {
      hotelRooms++;
      hotelBeds += tenant.capacity;
      cleanlinessSum += tenant.cleanliness;
      if (tenant.cleanliness < CONFIG.DIRTY_HOTEL_THRESHOLD) dirtyRooms++;
    }
    if (tenant.state === 'open' && TENANT_DATA[tenant.type].capacity > 0) {
      inside += Math.min(tenant.occupancy, tenant.capacity);
      capacity += tenant.capacity;
    }
  }

  const peopleByState: Partial<Record<PersonState, number>> = {};
  const peopleByKind: Partial<Record<PersonKind, number>> = {};
  let stressSum = 0;
  let dayStressSum = 0;
  let stressMax = 0;
  let over50 = 0;
  let failedTotal = 0;
  let failedPeople = 0;
  for (const person of state.people.values()) {
    peopleByState[person.state] = (peopleByState[person.state] ?? 0) + 1;
    peopleByKind[person.kind] = (peopleByKind[person.kind] ?? 0) + 1;
    stressSum += person.stress;
    dayStressSum += person.dayStress;
    stressMax = Math.max(stressMax, person.stress);
    if (person.stress >= 50) over50++;
    failedTotal += person.failedTripsToday;
    if (person.failedTripsToday > 0) failedPeople++;
  }
  const tracked = state.people.size;

  let waiting = 0;
  let nonEmpty = 0;
  let longest = 0;
  let longestKey: string | null = null;
  for (const key of Object.keys(state.queues).sort()) {
    const length = state.queues[key]!.length;
    waiting += length;
    if (length > 0) nonEmpty++;
    if (length > longest) { longest = length; longestKey = key; }
  }

  const byKind: Partial<Record<ElevatorKind, ElevatorKindMetrics>> = {};
  let cars = 0;
  let activeCars = 0;
  let passengers = 0;
  let seats = 0;
  for (const group of state.elevatorGroups.values()) {
    const entry = (byKind[group.kind] ??= { shafts: 0, cars: 0, activeCars: 0, passengers: 0, loadFactor: 0 });
    entry.shafts++;
    for (const car of group.cars) {
      entry.cars++;
      if (car.state !== 'idle') entry.activeCars++;
      entry.passengers += car.passengers.length;
    }
  }
  for (const kind of Object.keys(byKind) as ElevatorKind[]) {
    const entry = byKind[kind]!;
    const kindSeats = entry.cars * elevatorCapacity(kind);
    entry.loadFactor = kindSeats > 0 ? round(entry.passengers / kindSeats) : 0;
    cars += entry.cars;
    activeCars += entry.activeCars;
    passengers += entry.passengers;
    seats += kindSeats;
  }

  const floors = state.tower.floors;
  const money = state.money;
  return {
    day: state.calendar.day,
    tickCount: state.tickCount,
    date: towerDate(state.calendar.day),
    dateLabel: formatTowerDate(state.calendar.day),
    time: formatTimeOfDay(state.calendar.minuteOfDay),
    stars: state.starLevel,
    fundsCents: money.balanceCents,
    dailyIncomeCents: money.dailyIncomeCents,
    dailyUpkeepCents: money.dailyUpkeepCents,
    quarterIncomeCents: money.quarterIncomeCents,
    quarterUpkeepCents: money.quarterUpkeepCents,
    population: population(state),
    trackedPeople: tracked,
    floors: {
      count: floors.length,
      top: floors.length ? floors[floors.length - 1]!.index : CONFIG.LOBBY_FLOOR_INDEX,
      bottom: floors.length ? floors[0]!.index : CONFIG.LOBBY_FLOOR_INDEX,
    },
    tenants,
    tenantStates,
    occupancy: { inside, capacity, ratio: capacity > 0 ? round(inside / capacity) : 0 },
    hotels: {
      rooms: hotelRooms,
      beds: hotelBeds,
      guests: peopleByKind.hotelGuest ?? 0,
      averageCleanliness: hotelRooms > 0 ? round(cleanlinessSum / hotelRooms, 1) : 0,
      dirtyRooms,
    },
    stress: {
      average: tracked ? round(stressSum / tracked, 2) : 0,
      averageDay: tracked ? round(dayStressSum / tracked, 2) : 0,
      max: round(stressMax, 2),
      over50,
    },
    peopleByState,
    peopleByKind,
    failedTrips: { total: failedTotal, people: failedPeople },
    queues: { waiting, nonEmpty, longest, longestKey },
    elevators: {
      shafts: state.elevatorGroups.size,
      cars,
      activeCars,
      passengers,
      utilization: cars > 0 ? round(activeCars / cars) : 0,
      loadFactor: seats > 0 ? round(passengers / seats) : 0,
      byKind,
    },
    campaign: {
      activeIncidents: state.campaign.incidents.length,
      waste: round(state.campaign.waste, 2),
      vipApproved: state.campaign.vipApproved,
      weddingHeld: state.campaign.weddingHeld,
      bankrupt: state.campaign.bankrupt,
    },
  };
}

/** Flatten a snapshot into scalar columns (CSV rows, diffs between runs). */
export function flattenMetrics(metrics: TowerMetrics): Record<string, string | number | boolean> {
  const row: Record<string, string | number | boolean> = {};
  const visit = (prefix: string, value: unknown): void => {
    if (value === null || value === undefined) { row[prefix] = ''; return; }
    if (typeof value === 'object') {
      for (const key of Object.keys(value as object).sort()) visit(prefix ? `${prefix}.${key}` : key, (value as Record<string, unknown>)[key]);
      return;
    }
    row[prefix] = value as string | number | boolean;
  };
  visit('', metrics);
  return row;
}
