import { CONFIG, TENANT_DATA, isHotel } from '../data/config';
import { pushEvent } from './core/events';
import { rngInt, rngNext } from './core/rng';
import { joinQueue, leaveQueue, pressCall } from './queues';
import { pickupRoute, type RouteLeg } from './routing';
import type { GameState } from './state';
import { patienceTicks } from './stress';
import type { Tenant } from './tenants';

/**
 * The people simulation (UniPeple equivalent): per-person daily schedules,
 * trips through the tower, queue patience, external visitors (diners,
 * shoppers, hotel guests), staff (guards, housekeepers), give-ups. All
 * randomness flows through the seeded RNG.
 */

export type PersonKind =
  | 'officeWorker'
  | 'resident'
  | 'hotelGuest'
  | 'diner'
  | 'shopper'
  | 'guard'
  | 'housekeeper';
export type PersonState =
  | 'offscreen'
  | 'inTenant'
  | 'walking'
  | 'waiting'
  | 'riding'
  | 'onStairs'
  | 'onEscalator'
  | 'cleaning';

export type PersonEndState = 'offscreen' | 'inTenant' | 'cleaning';

export interface Person {
  id: number;
  vip?: boolean;
  kind: PersonKind;
  /** Home tenant (condo) / workplace (office, security, housekeeping) / hotel. */
  tenantId: number;
  /** Index into CONFIG.SCHEDULES[kind]. */
  scheduleIndex: number;
  /** True once the day's schedule wrapped — no more fires until sunrise. */
  scheduleDone: boolean;
  state: PersonState;
  /** Continuous position in cell units (x) on floor `floor`. */
  pos: { floor: number; x: number };
  /** Horizontal walk target on the current floor. */
  target: { floor: number; x: number } | null;
  /** Final trip goal. */
  destination: { floor: number; x: number } | null;
  /** What to do on arrival. */
  endState: PersonEndState;
  route: RouteLeg[] | null;
  legIndex: number;
  /** Timer shared by stair/escalator rides and activities (eating/cleaning). */
  stairsTicksLeft: number;
  waitTicks: number;
  stress: number;
  /** Accrued stress today; resets at sunrise and feeds evaluation. */
  dayStress: number;
  failedTripsToday: number;
  jitterTicks: number;
  dayTracked: number;
  /** Activity timer while 'inTenant' (eating/shopping); 0 = none. */
  activityTicksLeft: number;
  /** The commercial tenant being patronized (-1 = none); pays on arrival. */
  activityTenantId: number;
}

export function tenantCenter(state: GameState, tenantId: number): { floor: number; x: number } {
  const t = state.tenants.get(tenantId);
  if (!t) throw new Error(`tenant ${tenantId} not found`);
  return { floor: t.floor, x: t.x + t.sizeCells / 2 };
}

/** Population = everyone tracked (off-screen workers included). */
export function population(state: GameState): number {
  let total = 0;
  for (const person of state.people.values()) if (person.kind !== 'diner' && person.kind !== 'shopper') total++;
  for (const tenant of state.tenants.values()) if (tenant.state === 'open') total += tenant.reportedPopulation ?? 0;
  return total;
}

export function isStaff(kind: PersonKind): boolean {
  return kind === 'guard' || kind === 'housekeeper';
}

function kindForTenant(type: keyof typeof TENANT_DATA): PersonKind | null {
  switch (type) {
    case 'office':
      return 'officeWorker';
    case 'condo':
      return 'resident';
    case 'security':
      return 'guard';
    case 'housekeeping':
      return 'housekeeper';
    default:
      return null; // hotels fill with guests; commercial fills with visitors
  }
}

/** Spawn the occupants of a newly completed tenant (workers/residents/staff). */
export function spawnTenantPeople(state: GameState, tenant: Tenant): void {
  const kind = kindForTenant(tenant.type);
  if (!kind) return;
  const schedule = CONFIG.SCHEDULES[kind];
  const now = state.calendar.minuteOfDay;
  let initialScheduleIndex = 0;
  while (
    initialScheduleIndex < schedule.length - 1 &&
    schedule[initialScheduleIndex]!.atMin <= now
  ) {
    initialScheduleIndex++;
  }
  // If even the final entry already passed today, stay put until sunrise.
  let scheduleDone = false;
  if (
    schedule.length > 0 &&
    initialScheduleIndex === schedule.length - 1 &&
    schedule[initialScheduleIndex]!.atMin <= now
  ) {
    scheduleDone = true;
  }
  for (let i = 0; i < tenant.capacity; i++) {
    const id = state.nextEntityId++;
    const atHome = kind !== 'officeWorker';
    const person: Person = {
      id,
      kind,
      tenantId: tenant.id,
      scheduleIndex: initialScheduleIndex,
      scheduleDone,
      state: atHome ? 'inTenant' : 'offscreen',
      pos: atHome
        ? { floor: tenant.floor, x: tenant.x + 1 + i }
        : { floor: CONFIG.LOBBY_FLOOR_INDEX, x: 0 },
      target: null,
      destination: null,
      endState: 'inTenant',
      route: null,
      legIndex: 0,
      stairsTicksLeft: 0,
      waitTicks: 0,
      stress: 0,
      dayStress: 0,
      failedTripsToday: 0,
      jitterTicks: rngInt(state, -CONFIG.ARRIVAL_JITTER_TICKS, CONFIG.ARRIVAL_JITTER_TICKS),
      dayTracked: state.calendar.day,
      activityTicksLeft: 0,
      activityTenantId: -1,
    };
    state.people.set(id, person);
  }
}

/** Remove every person attached to a tenant (demolish or vacancy). */
export function removeTenantPeople(state: GameState, tenantId: number): void {
  for (const [id, p] of state.people) {
    if (p.tenantId === tenantId) {
      leaveQueue(state, id);
      for (const group of state.elevatorGroups.values()) for (const car of group.cars) car.passengers = car.passengers.filter(pid => pid !== id);
      state.people.delete(id);
    } else if (p.activityTenantId === tenantId) giveUp(state, p);
  }
}

// --- Visitors ---

function weightedPick(state: GameState, tenants: Tenant[]): Tenant {
  const weights = tenants.map(
    (t) => CONFIG.PRICING_LEVELS[t.pricing]!.visitorMult,
  );
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rngNext(state) * total;
  for (let i = 0; i < tenants.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return tenants[i]!;
  }
  return tenants[tenants.length - 1]!;
}

/**
 * People currently patronizing a commercial tenant — in transit included.
 * (Occupancy alone lags one tick and misses walkers, oversubscribing rooms.)
 */
/** Spawn an external visitor on a trip to a suitable tenant (or do nothing). */
const patronCache = new WeakMap<GameState, { tick: number; counts: Map<number, number> }>();
function capacityCounts(state: GameState): Map<number, number> {
  const cached = patronCache.get(state);
  if (cached?.tick === state.tickCount) return cached.counts;
  const counts = new Map<number, number>();
  for (const person of state.people.values()) {
    const id = person.kind === 'hotelGuest' ? person.tenantId : person.activityTenantId;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  patronCache.set(state, { tick: state.tickCount, counts });
  return counts;
}
function spawnVisitor(state: GameState, kind: PersonKind, preferred?: Tenant): number | undefined {
  const counts = capacityCounts(state);
  const open = (type: string): Tenant[] =>
    [...state.tenants.values()].filter(
      (t) => t.type === type && t.state === 'open' && (counts.get(t.id) ?? 0) < t.capacity,
    );
  let target: Tenant | null = null;
  let activityTicks = 0;
  if (kind === 'diner') {
    const eateries = [...open('restaurant'), ...open('fastfood')];
    if (eateries.length === 0) return;
    target = weightedPick(state, eateries);
    activityTicks = CONFIG.EAT_TICKS;
  } else if (kind === 'shopper') {
    const shops = [...open('shop'), ...(state.calendar.minuteOfDay >= 720 ? open('cinema') : []), ...(state.calendar.minuteOfDay >= 1080 ? open('partyHall') : [])];
    if (shops.length === 0) return;
    target = weightedPick(state, shops);
    activityTicks = target.type === 'cinema' ? 600 : target.type === 'partyHall' ? 900 : CONFIG.SHOP_TICKS;
    if (target.type === 'cinema' && rngNext(state) < Math.min(0.9, (target.movieAge ?? 0) / 20)) return;
  } else {
    const hotels = preferred ? [preferred] : [...open('hotel'), ...open('hotelTwin'), ...open('hotelSuite')];
    if (hotels.length === 0) return;
    target = hotels[rngInt(state, 0, hotels.length - 1)]!;
  }
  const id = state.nextEntityId++;
  const person: Person = {
    id,
    kind,
    tenantId: target.id,
    scheduleIndex: 0,
    // Hotel guests with a checkout already passed today stay until tomorrow.
    scheduleDone: kind === 'hotelGuest',
    state: 'walking',
    pos: { floor: CONFIG.LOBBY_FLOOR_INDEX, x: rngInt(state, 0, 10) },
    target: null,
    destination: tenantCenter(state, target.id),
    endState: 'inTenant',
    route: null,
    legIndex: 0,
    stairsTicksLeft: 0,
    waitTicks: 0,
    stress: 0,
    dayStress: 0,
    failedTripsToday: 0,
    jitterTicks: 0,
    dayTracked: state.calendar.day,
    activityTicksLeft: activityTicks,
    activityTenantId: kind === 'hotelGuest' ? -1 : target.id,
  };
  state.people.set(id, person);
  counts.set(target.id, (counts.get(target.id) ?? 0) + 1);
  beginTrip(state, person);
  return id;
}

export function spawnVIP(state: GameState, tenant: Tenant): number | undefined {
  const id = spawnVisitor(state, 'hotelGuest', tenant);
  const person = id === undefined ? undefined : state.people.get(id);
  if (person) person.vip = true;
  return id;
}

/** Spawn external traffic for the current time of day (lunch rush etc.). */
function spawnExternalVisitors(state: GameState): void {
  if (state.people.size >= CONFIG.MAX_PEOPLE) return;
  const now = state.calendar.minuteOfDay;
  if (state.campaign.weather === 'rain' && rngNext(state) < 0.5) return;
  if (now >= 720 && now < 780 && rngNext(state) < CONFIG.DINER_SPAWN_RATE) {
    spawnVisitor(state, 'diner');
  }
  if (
    now >= CONFIG.SHOPPER_WINDOW_MIN &&
    now < 1380 &&
    rngNext(state) < CONFIG.SHOPPER_SPAWN_RATE
  ) {
    spawnVisitor(state, 'shopper');
    if ([...state.tenants.values()].some(t => t.type === 'metro' && t.state === 'open')) spawnVisitor(state, 'shopper');
  }
  if (
    now >= CONFIG.GUEST_WINDOW_MIN &&
    now < CONFIG.GUEST_WINDOW_MAX &&
    rngNext(state) < CONFIG.HOTEL_GUEST_SPAWN_RATE
  ) {
    spawnVisitor(state, 'hotelGuest');
  }
}

// --- Schedule ---

type ScheduleAction =
  | 'gotoOffice'
  | 'gotoLobby'
  | 'goHome'
  | 'gotoLunch'
  | 'returnToOffice'
  | 'gotoRandom'
  | 'goWork'
  | 'leave';

function scheduleCheck(state: GameState, p: Person): ScheduleAction | null {
  if (p.scheduleDone) return null;
  const schedule = CONFIG.SCHEDULES[p.kind];
  const entry = schedule[p.scheduleIndex];
  if (!entry) return null;
  if (state.calendar.minuteOfDay < entry.atMin + p.jitterTicks) return null;
  p.scheduleIndex = (p.scheduleIndex + 1) % schedule.length;
  if (p.scheduleIndex === 0) p.scheduleDone = true; // day's entries exhausted
  return entry.action;
}

// --- Money hooks ---

function chargePatron(state: GameState, p: Person): void {
  const tenant = state.tenants.get(p.activityTenantId);
  if (!tenant) return;
  const pricing = CONFIG.PRICING_LEVELS[tenant.pricing]!;
  const base =
    tenant.type === 'cinema' ? 25 : tenant.type === 'partyHall' ? 75 : tenant.type === 'fastfood'
      ? CONFIG.FASTFOOD_MEAL_DOLLARS
      : tenant.type === 'restaurant'
        ? CONFIG.RESTAURANT_MEAL_DOLLARS
        : CONFIG.SHOP_SALE_DOLLARS;
  tenant.visitsToday = (tenant.visitsToday ?? 0) + (p.kind === 'officeWorker' ? 0 : 1);
  tenant.dailyRevenue += Math.round(base * pricing.revenueMult * 100);
}

// --- Trip management ---

function beginTrip(state: GameState, p: Person): void {
  const dest = p.destination;
  if (!dest) {
    arrive(state, p);
    return;
  }
  const route = pickupRoute(state, p.pos.floor, dest.floor, p.kind);
  if (route === null) {
    giveUp(state, p);
    return;
  }
  p.route = route;
  p.legIndex = 0;
  p.state = 'walking';
  p.target = null;
  continueTrip(state, p);
}

/** Point the person at the next transport boarding position (or arrival). */
function continueTrip(state: GameState, p: Person): void {
  const leg = p.route?.[p.legIndex];
  if (leg) {
    if (leg.mode === 'elevator') {
      const group = state.elevatorGroups.get(leg.groupId!);
      if (!group) {
        giveUp(state, p);
        return;
      }
      p.target = { floor: leg.from, x: group.x + 1 };
    } else {
      p.target = { floor: leg.from, x: leg.x ?? 0 };
    }
    return;
  }
  arrive(state, p);
}

function arrive(state: GameState, p: Person): void {
  // Patrons pay when their activity starts (arrival at the eatery/shop).
  if (p.endState === 'inTenant' && p.activityTenantId >= 0 && p.state !== 'inTenant') {
    chargePatron(state, p);
  }
  // Hotel guests pay at checkout (arrival back at the lobby edge) and leave
  // the simulation entirely.
  if (p.endState === 'offscreen' && p.kind === 'hotelGuest' && p.state !== 'offscreen') {
    const hotel = state.tenants.get(p.tenantId);
    if (hotel) hotel.dailyRevenue += CONFIG.HOTEL_RATE_NIGHTLY_DOLLARS * 100;
    p.route = null;
    p.target = null;
    p.destination = null;
    p.activityTicksLeft = 0;
    state.people.delete(p.id);
    return;
  }
  if (p.endState === 'cleaning') {
    p.state = 'cleaning';
    p.stairsTicksLeft = CONFIG.CLEAN_TICKS;
  } else if (p.endState === 'offscreen') {
    // Visitors leave the simulation entirely once they're back at the lobby.
    if (p.kind === 'diner' || p.kind === 'shopper') {
      p.route = null;
      p.target = null;
      p.destination = null;
      p.activityTicksLeft = 0;
      state.people.delete(p.id);
      return;
    }
    p.state = 'offscreen';
    p.pos = { floor: CONFIG.LOBBY_FLOOR_INDEX, x: 0 };
  } else {
    p.state = 'inTenant';
    if (p.destination) p.pos = p.destination;
  }
  p.route = null;
  p.target = null;
  p.destination = null;
  p.waitTicks = 0;
}

/** Give up: leave the queue, complain, and retreat. */
export function giveUp(state: GameState, p: Person): void {
  leaveQueue(state, p.id);
  p.stress = Math.min(Math.max(p.stress + CONFIG.STRESS_GIVEUP, 0), CONFIG.STRESS_MAX);
  p.dayStress += CONFIG.STRESS_GIVEUP;
  p.failedTripsToday++;
  pushEvent(state, { type: 'PERSON_GAVE_UP', personId: p.id, floor: p.pos.floor });
  p.route = null;
  p.target = null;
  p.destination = null;
  p.activityTicksLeft = 0;
  p.activityTenantId = -1;
  if (p.kind === 'diner' || p.kind === 'shopper') {
    state.people.delete(p.id); // visitors just leave
    return;
  }
  if (p.kind === 'officeWorker') {
    // Stays tracked, offscreen — tries again tomorrow morning.
    p.state = 'offscreen';
    p.pos = { floor: CONFIG.LOBBY_FLOOR_INDEX, x: 0 };
    return;
  }
  // Residents, staff and guests retreat to their tenant.
  p.state = 'inTenant';
  const t = state.tenants.get(p.tenantId);
  p.pos = t ? { floor: t.floor, x: t.x + 1 } : p.pos;
}

// --- Schedule action handlers ---

function applyAction(state: GameState, p: Person, action: ScheduleAction): void {
  switch (action) {
    case 'gotoOffice': {
      p.pos = { floor: CONFIG.LOBBY_FLOOR_INDEX, x: 0 };
      p.destination = tenantCenter(state, p.tenantId);
      p.endState = 'inTenant';
      beginTrip(state, p);
      return;
    }
    case 'gotoLobby': {
      p.destination = { floor: CONFIG.LOBBY_FLOOR_INDEX, x: 2 };
      p.endState = 'inTenant';
      beginTrip(state, p);
      return;
    }
    case 'goHome': {
      if (p.kind === 'officeWorker') {
        if (p.state === 'offscreen') return; // already out
        p.destination = { floor: CONFIG.LOBBY_FLOOR_INDEX, x: 0 };
        p.endState = 'offscreen';
      } else if (p.kind === 'guard' || p.kind === 'housekeeper') {
        // Staff live in their office — they return there for the night.
        p.destination = tenantCenter(state, p.tenantId);
        p.endState = 'inTenant';
      } else if (p.kind === 'resident') {
        p.destination = tenantCenter(state, p.tenantId);
        p.endState = 'inTenant';
      } else {
        return; // guests handle checkout via 'leave'
      }
      beginTrip(state, p);
      return;
    }
    case 'gotoLunch': {
      const eateries = [...state.tenants.values()].filter(
        (t) =>
          (t.type === 'restaurant' || t.type === 'fastfood') &&
          t.state === 'open' &&
          (capacityCounts(state).get(t.id) ?? 0) < t.capacity,
      );
      if (eateries.length === 0) {
        // No food in the tower: hang around the lobby instead.
        p.destination = { floor: CONFIG.LOBBY_FLOOR_INDEX, x: rngInt(state, 2, 20) };
        p.activityTicksLeft = CONFIG.EAT_TICKS;
        p.activityTenantId = -1;
      } else {
        const eatery = eateries[rngInt(state, 0, eateries.length - 1)]!;
        p.destination = tenantCenter(state, eatery.id);
        p.activityTicksLeft = CONFIG.EAT_TICKS;
        p.activityTenantId = eatery.id;
      }
      p.endState = 'inTenant';
      beginTrip(state, p);
      return;
    }
    case 'returnToOffice': {
      p.destination = tenantCenter(state, p.tenantId);
      p.endState = 'inTenant';
      p.activityTicksLeft = 0;
      p.activityTenantId = -1;
      beginTrip(state, p);
      return;
    }
    case 'gotoRandom': {
      const top = state.tower.floors.length > 0
        ? state.tower.floors[state.tower.floors.length - 1]!.index
        : CONFIG.LOBBY_FLOOR_INDEX;
      p.destination = {
        floor: rngInt(state, CONFIG.LOBBY_FLOOR_INDEX + 1, top),
        x: rngInt(state, 2, CONFIG.FLOOR_WIDTH_CELLS - 3),
      };
      p.endState = 'inTenant';
      beginTrip(state, p);
      return;
    }
    case 'goWork': {
      // Housekeeper: head for the dirtiest open hotel, if any.
      let dirtiest: Tenant | null = null;
      for (const t of state.tenants.values()) {
        if (!isHotel(t.type) || t.state !== 'open') continue;
        if (!dirtiest || t.cleanliness < dirtiest.cleanliness) dirtiest = t;
      }
      if (!dirtiest || dirtiest.cleanliness >= 100) {
        p.destination = tenantCenter(state, p.tenantId);
        p.endState = 'inTenant';
        p.activityTenantId = -1;
      } else {
        p.destination = tenantCenter(state, dirtiest.id);
        p.endState = 'cleaning';
        p.activityTenantId = dirtiest.id;
      }
      beginTrip(state, p);
      return;
    }
    case 'leave': {
      p.destination = { floor: CONFIG.LOBBY_FLOOR_INDEX, x: 0 };
      p.endState = 'offscreen';
      beginTrip(state, p);
      return;
    }
  }
}

// --- Occupancy ---

/**
 * Refresh per-tenant occupancy: people currently inside each tenant (the
 * lobby included). Called at the end of the people step.
 */
function refreshOccupancy(state: GameState): void {
  for (const tenant of state.tenants.values()) tenant.occupancy = 0;
  const floors = new Map<number, { cells: { tenantId: number }[] }>();
  for (const floor of state.tower.floors) floors.set(floor.index, floor);
  for (const p of state.people.values()) {
    if (p.state !== 'inTenant' && p.state !== 'cleaning') continue;
    const floor = floors.get(Math.round(p.pos.floor));
    const cell = floor?.cells[Math.round(p.pos.x)];
    if (!cell || cell.tenantId < 0) continue;
    const tenant = state.tenants.get(cell.tenantId);
    if (tenant) tenant.occupancy++;
  }
}

// --- Hotel cleanliness ---

function stepHotels(state: GameState): void {
  for (const tenant of state.tenants.values()) {
    if (!isHotel(tenant.type) || tenant.state !== 'open') continue;
    if (tenant.occupancy > 0) {
      tenant.cleanliness = Math.max(
        0,
        tenant.cleanliness - CONFIG.HOTEL_CLEAN_DECAY_PER_TICK * tenant.occupancy,
      );
    }
  }
}

// --- Simulation step ---

export function stepPeople(state: GameState): void {
  const day = state.calendar.day;
  spawnExternalVisitors(state);
  stepHotels(state);
  for (const p of state.people.values()) {
    // Daily rollover: fresh stress counters, fresh arrival jitter, and the
    // day's schedule restarts from its first entry.
    if (p.dayTracked !== day) {
      p.dayTracked = day;
      p.dayStress = 0;
      p.scheduleIndex = 0;
      p.scheduleDone = false;
      p.jitterTicks = rngInt(state, -CONFIG.ARRIVAL_JITTER_TICKS, CONFIG.ARRIVAL_JITTER_TICKS);
    }
    switch (p.state) {
      case 'offscreen': {
        const action = scheduleCheck(state, p);
        if (!action) break;
        applyAction(state, p, action);
        break;
      }
      case 'inTenant': {
        if (p.activityTicksLeft > 0) {
          p.activityTicksLeft--;
          if (p.activityTicksLeft === 0) {
            // Finished eating/shopping: leave the tower.
            p.destination = { floor: CONFIG.LOBBY_FLOOR_INDEX, x: 0 };
            p.endState = 'offscreen';
            p.activityTenantId = -1;
            beginTrip(state, p);
            break;
          }
        }
        const action = scheduleCheck(state, p);
        if (action) applyAction(state, p, action);
        break;
      }
      case 'walking': {
        if (!p.target) {
          continueTrip(state, p);
          if (p.state !== 'walking') break;
          if (!p.target) {
            arrive(state, p);
            break;
          }
        }
        const target = p.target!;
        const dx = target.x - p.pos.x;
        const step = CONFIG.PERSON_WALK_CELLS_PER_TICK;
        if (Math.abs(dx) <= step) {
          p.pos.x = target.x;
          const leg = p.route?.[p.legIndex];
          if (leg?.mode === 'elevator') {
            pressCall(state, leg.from, leg.dir > 0 ? 'up' : 'down');
            const joined = joinQueue(state, p.id, leg.from, leg.dir > 0 ? 'up' : 'down');
            if (!joined) {
              giveUp(state, p);
              break;
            }
            p.state = 'waiting';
            p.waitTicks = 0;
            p.target = null;
          } else if (leg?.mode === 'stair') {
            p.state = 'onStairs';
            p.stairsTicksLeft = CONFIG.STAIR_TICKS_PER_FLOOR * Math.abs(leg.to - leg.from);
            p.target = null;
          } else if (leg?.mode === 'escalator') {
            p.state = 'onEscalator';
            p.stairsTicksLeft = CONFIG.ESCALATOR_TICKS_PER_FLOOR * Math.abs(leg.to - leg.from);
            p.target = null;
          } else {
            arrive(state, p);
          }
        } else {
          p.pos.x += Math.sign(dx) * step;
        }
        break;
      }
      case 'waiting': {
        p.waitTicks++;
        if (p.waitTicks > patienceTicks(p.stress)) giveUp(state, p);
        break;
      }
      case 'onStairs':
      case 'onEscalator': {
        p.stairsTicksLeft--;
        if (p.stairsTicksLeft <= 0) {
          const leg = p.route?.[p.legIndex];
          if (leg) {
            p.pos = { floor: leg.to, x: leg.x ?? 0 };
            p.legIndex++;
          }
          p.state = 'walking';
          p.target = null;
        }
        break;
      }
      case 'cleaning': {
        p.stairsTicksLeft--;
        const hotel = state.tenants.get(p.activityTenantId);
        if (hotel && isHotel(hotel.type)) {
          hotel.cleanliness = Math.min(
            100,
            hotel.cleanliness + CONFIG.HOUSEKEEPER_CLEAN_PER_TICK,
          );
        }
        if (p.stairsTicksLeft <= 0) {
          p.state = 'inTenant';
          p.stairsTicksLeft = 0;
          p.activityTenantId = -1;
        }
        break;
      }
      case 'riding':
        break; // the elevator moves the person
    }
  }
  refreshOccupancy(state);
}
