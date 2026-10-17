import { isWeekend, operatingDay } from './time';
import { hotelCheckoutCents } from './hotelEconomy';
import { recordCommercialVisit } from './commercialEconomy';
import { CONFIG, TENANT_DATA, isHotel } from '../data/config';
import { pushEvent } from './core/events';
import { rngInt, rngNext } from './core/rng';
import { joinQueue, leaveQueue, pressCall, retryJoinQueue } from './queues';
import { pickupRoute, type RouteLeg } from './routing';
import { getFloor } from './tower';
import type { GameState } from './state';
import { patienceTicks } from './stress';
import { divertWorkerToGym, leisureFeeCents, stepLeisure } from './leisure';
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
  /** Completed cleaning jobs this operating day; absent in older saves. */
  roomsCleanedToday?: number;
  /** Operating day when the shift-end return was issued. */
  housekeepingShiftEndedDay?: number;
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

/** Visitors (diners, shoppers, bank customers) are not part of the population. */
export function countsTowardPopulation(person: Person): boolean {
  return person.kind !== 'diner' && person.kind !== 'shopper';
}

/**
 * Population = everyone tracked (off-screen workers included) plus the
 * reported commercial head counts. `residents` may supply an exact count of
 * the tracked part already taken this tick, saving a pass over everyone.
 */
export function population(state: GameState, residents?: number): number {
  let total = 0;
  if (residents !== undefined) total = residents;
  else for (const person of state.people.values()) if (countsTowardPopulation(person)) total++;
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
    case 'apartment':
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
  if (tenant.type === 'office') tenant.officeLeaseUntilTick = state.tickCount + CONFIG.QUARTER_DAYS * CONFIG.DAY_TICKS;
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
      dayTracked: operatingDay(state),
      activityTicksLeft: 0,
      activityTenantId: -1,
    };
    state.people.set(id, person);
  }
}

/** Cancel transport ownership before deleting or redirecting a passenger. */
function detachFromTransport(state: GameState, personId: number): void {
  leaveQueue(state, personId);
  for (const group of state.elevatorGroups.values()) {
    for (const car of group.cars) {
      const index = car.passengers.indexOf(personId);
      if (index >= 0) car.passengers.splice(index, 1);
    }
  }
}

/** Remove every person attached to a tenant (demolish or vacancy). */
export function removeTenantPeople(state: GameState, tenantId: number): void {
  for (const [id, p] of state.people) {
    if (p.tenantId === tenantId) {
      detachFromTransport(state, id);
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
export function capacityCounts(state: GameState): Map<number, number> {
  const cached = patronCache.get(state);
  if (cached?.tick === state.tickCount) return cached.counts;
  const counts = new Map<number, number>();
  for (const person of state.people.values()) {
    const id = person.kind === 'hotelGuest' ? person.tenantId : person.activityTenantId;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    // Hotel guests at the pool also count against the pool's capacity.
    if (person.kind === 'hotelGuest' && person.activityTenantId >= 0) counts.set(person.activityTenantId, (counts.get(person.activityTenantId) ?? 0) + 1);
  }
  patronCache.set(state, { tick: state.tickCount, counts });
  return counts;
}
/** `stay` overrides a preferred shopper's visit length (default: a bank visit). */
export function spawnVisitor(state: GameState, kind: PersonKind, preferred?: Tenant, origin?: { floor: number; x: number }, stay?: number): number | undefined {
  if (state.people.size >= CONFIG.MAX_PEOPLE) return;
  const counts = capacityCounts(state);
  const open = (type: string): Tenant[] =>
    [...state.tenants.values()].filter(
      (t) => t.type === type && t.state === 'open' && (counts.get(t.id) ?? 0) < t.capacity
        && (t.type !== 'fastfood' || t.externalDemand === undefined || (t.externalArrivals ?? 0) < t.externalDemand),
    );
  let target: Tenant | null = null;
  let activityTicks = 0;
  if (kind === 'diner') {
    const eateries = preferred
      ? open('fastfood').filter(t => t.id === preferred.id)
      : [...open('restaurant'), ...open('fastfood').filter(t => t.externalDemand === undefined)];
    if (eateries.length === 0) return;
    target = weightedPick(state, eateries);
    activityTicks = CONFIG.EAT_TICKS;
  } else if (kind === 'shopper' && preferred) {
    // Bank customers: a visit to one particular branch.
    if ((counts.get(preferred.id) ?? 0) >= preferred.capacity) return;
    target = preferred;
    activityTicks = stay ?? CONFIG.BANK_VISIT_TICKS;
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
    pos: origin ? { ...origin } : { floor: CONFIG.LOBBY_FLOOR_INDEX, x: rngInt(state, 0, 10) },
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
    dayTracked: operatingDay(state),
    activityTicksLeft: activityTicks,
    activityTenantId: kind === 'hotelGuest' ? -1 : target.id,
  };
  state.people.set(id, person);
  if (kind === 'diner' && target.type === 'fastfood') target.externalArrivals = (target.externalArrivals ?? 0) + 1;
  counts.set(target.id, (counts.get(target.id) ?? 0) + 1);
  beginTrip(state, person);
  return id;
}

/** A VIP arrives at the lobby, or at `origin` (a helipad) when given. */
export function spawnVIP(state: GameState, tenant: Tenant, origin?: { floor: number; x: number }): number | undefined {
  const id = spawnVisitor(state, 'hotelGuest', tenant, origin);
  const person = id === undefined ? undefined : state.people.get(id);
  if (person) person.vip = true;
  return id;
}

/** Spawn external traffic for the current time of day (lunch rush etc.). */
function spawnExternalVisitors(state: GameState): void {
  if (state.people.size >= CONFIG.MAX_PEOPLE) return;
  const now = state.calendar.minuteOfDay;
  if (now >= 720 && now < 780) {
    // Each business releases its own demand gradually through lunch. Rain and
    // pricing already scale these budgets when the business opens.
    for (const tenant of state.tenants.values()) {
      if (state.people.size >= CONFIG.MAX_PEOPLE) return;
      if (tenant.type !== 'fastfood' || tenant.state !== 'open' || tenant.externalDemand === undefined) continue;
      const due = Math.min(tenant.externalDemand, Math.floor((now - 720) / 60 * tenant.externalDemand) + 1);
      if ((tenant.externalArrivals ?? 0) < due) spawnVisitor(state, 'diner', tenant);
    }
  }
  // Banks serve weekday customers during business hours, rain or shine.
  if (!isWeekend(state) && now >= CONFIG.BANK_OPEN_MIN && now < CONFIG.BANK_CLOSE_MIN) {
    for (const tenant of state.tenants.values()) {
      if (tenant.type !== 'bank' || tenant.state !== 'open') continue;
      if (rngNext(state) < CONFIG.BANK_CUSTOMER_RATE) spawnVisitor(state, 'shopper', tenant);
    }
  }
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
  // Keep the departure entry so workers already inside in older saves can leave.
  if (p.kind === 'officeWorker' && isWeekend(state) && entry.action !== 'goHome') return null;
  return entry.action;
}

// --- Money hooks ---

function chargePatron(state: GameState, p: Person): void {
  const tenant = state.tenants.get(p.activityTenantId);
  if (!tenant) return;
  const fee = leisureFeeCents(tenant);
  if (fee !== null) {
    // Leisure venues: every paying visit counts; outsiders also feed population.
    tenant.visitsToday = (tenant.visitsToday ?? 0) + 1;
    if (p.kind === 'shopper' || p.kind === 'diner') tenant.paidExternalVisits = (tenant.paidExternalVisits ?? 0) + 1;
    tenant.dailyRevenue += fee;
    return;
  }
  if (recordCommercialVisit(tenant, p.kind === 'officeWorker', operatingDay(state))) return;
  const pricing = CONFIG.PRICING_LEVELS[tenant.pricing]!;
  const base =
    tenant.type === 'bank' ? CONFIG.BANK_FEE_DOLLARS : tenant.type === 'rooftopPool' ? CONFIG.POOL_FEE_DOLLARS
    : tenant.type === 'cinema' ? 25 : tenant.type === 'partyHall' ? 75 : tenant.type === 'fastfood'
      ? CONFIG.FASTFOOD_MEAL_DOLLARS
      : tenant.type === 'restaurant'
        ? CONFIG.RESTAURANT_MEAL_DOLLARS
        : CONFIG.SHOP_SALE_DOLLARS;
  tenant.visitsToday = (tenant.visitsToday ?? 0) + (p.kind === 'officeWorker' ? 0 : 1);
  tenant.dailyRevenue += Math.round(base * pricing.revenueMult * 100);
}

// --- Trip management ---

/** Send someone already in the tower to a venue for `ticks` (they pay on arrival). */
export function sendToActivity(state: GameState, p: Person, venue: Tenant, ticks: number): void {
  p.destination = tenantCenter(state, venue.id);
  p.endState = 'inTenant';
  p.activityTicksLeft = ticks;
  p.activityTenantId = venue.id;
  beginTrip(state, p);
}

/** Re-plan the rest of a journey from where the person now stands. */
export function resumeTrip(state: GameState, p: Person): void {
  beginTrip(state, p);
}

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
  if (p.destination && p.pos.floor === p.destination.floor && p.pos.x !== p.destination.x) {
    p.target = { ...p.destination };
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
    if (hotel) hotel.dailyRevenue += hotelCheckoutCents(hotel);
    p.route = null;
    p.target = null;
    p.destination = null;
    p.activityTicksLeft = 0;
    state.people.delete(p.id);
    return;
  }
  if (p.endState === 'cleaning') {
    if (state.calendar.minuteOfDay >= CONFIG.HOUSEKEEPER_LAST_START_MIN) {
      p.activityTenantId = -1;
      applyAction(state, p, 'goHome');
      return;
    }
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
  detachFromTransport(state, p.id);
  p.stress = Math.min(Math.max(p.stress + CONFIG.STRESS_GIVEUP, 0), CONFIG.STRESS_MAX);
  p.dayStress += CONFIG.STRESS_GIVEUP;
  p.failedTripsToday++;
  pushEvent(state, { type: 'PERSON_GAVE_UP', personId: p.id, floor: p.pos.floor });
  p.route = null;
  p.target = null;
  p.destination = null;
  p.activityTicksLeft = 0;
  p.activityTenantId = -1;
  if (p.kind === 'diner' || p.kind === 'shopper' || p.kind === 'hotelGuest') {
    if (p.vip) {
      const visit = state.campaign.incidents.find(incident => incident.personId === p.id);
      if (visit) visit.stress = CONFIG.STRESS_MAX;
    }
    state.people.delete(p.id); // visitors just leave
    return;
  }
  if (p.kind === 'officeWorker') {
    // Stays tracked, offscreen — tries again tomorrow morning.
    p.state = 'offscreen';
    p.pos = { floor: CONFIG.LOBBY_FLOOR_INDEX, x: 0 };
    return;
  }
  // Residents and staff retreat to their tenant.
  p.state = 'inTenant';
  const t = state.tenants.get(p.tenantId);
  p.pos = t ? { floor: t.floor, x: t.x + 1 } : p.pos;
}

// --- Schedule action handlers ---

/** Office worker ranks by id, built at most once per people step. */
let officeRanks: Map<number, number> | null = null;

/** Position of a worker in their office's id-ordered roster. */
function officeRosterRank(state: GameState, p: Person): number {
  if (!officeRanks) {
    officeRanks = new Map();
    const nextRank = new Map<number, number>();
    const workers = [...state.people.values()].filter(other => other.kind === 'officeWorker').sort((a, b) => a.id - b.id);
    for (const worker of workers) {
      const rank = nextRank.get(worker.tenantId) ?? 0;
      officeRanks.set(worker.id, rank);
      nextRank.set(worker.tenantId, rank + 1);
    }
  }
  return officeRanks.get(p.id) ?? 0;
}

function applyAction(state: GameState, p: Person, action: ScheduleAction): void {
  // A schedule call ends any pool, gym or other leisure visit in progress.
  if ((p.kind === 'resident' || p.kind === 'hotelGuest' || p.kind === 'officeWorker') && p.activityTenantId >= 0) {
    p.activityTenantId = -1;
    p.activityTicksLeft = 0;
  }
  switch (action) {
    case 'gotoOffice': {
      // Workers already inside (an early gym session) walk on from there.
      if (p.state !== 'inTenant') p.pos = { floor: CONFIG.LOBBY_FLOOR_INDEX, x: 0 };
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
        if (divertWorkerToGym(state, p)) return; // an after-work session first
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
      if (p.state === 'offscreen') return;
      // Five workers per six-person office buy weekday fast-food lunches.
      // Stable roster order keeps participation consistent across save/load.
      if (isWeekend(state) || officeRosterRank(state, p) % 6 === 5) return;
      const eateries = [...state.tenants.values()].filter(
        (t) =>
          t.type === 'fastfood' &&
          t.state === 'open' &&
          pickupRoute(state, p.pos.floor, t.floor, p.kind) !== null &&
          (capacityCounts(state).get(t.id) ?? 0) < t.capacity,
      );
      if (eateries.length === 0) {
        // Take a break at the office when no reachable eatery has space.
        p.destination = tenantCenter(state, p.tenantId);
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
      if (p.state === 'offscreen') return;
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
      if ((p.roomsCleanedToday ?? 0) >= CONFIG.HOUSEKEEPER_ROOMS_PER_DAY ||
          state.calendar.minuteOfDay >= CONFIG.HOUSEKEEPER_LAST_START_MIN) {
        p.activityTenantId = -1;
        applyAction(state, p, 'goHome');
        return;
      }
      // A housekeeping office sends at most one cleaner to each floor.
      // Other offices may help on that floor, but never in the same room.
      // Gather occupied rooms and other cleaners' assignments in one pass.
      const occupiedHotels = new Set<number>();
      const claimedRooms = new Set<number>();
      const claimedFloors = new Set<number>();
      for (const other of state.people.values()) {
        if (other.kind === 'hotelGuest' && other.state === 'inTenant') occupiedHotels.add(other.tenantId);
        if (other.id === p.id || other.kind !== 'housekeeper' || other.activityTenantId < 0 || other.state === 'offscreen') continue;
        const assigned = state.tenants.get(other.activityTenantId);
        if (assigned?.state !== 'open') continue;
        claimedRooms.add(assigned.id);
        if (other.tenantId === p.tenantId) claimedFloors.add(assigned.floor);
      }
      let dirtiest: Tenant | null = null;
      for (const t of state.tenants.values()) {
        if (!isHotel(t.type) || t.state !== 'open' || occupiedHotels.has(t.id)) continue;
        if (claimedRooms.has(t.id) || claimedFloors.has(t.floor)) continue;
        if (pickupRoute(state, p.pos.floor, t.floor, 'housekeeper') === null) continue;
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

// --- Rooftop pool (Upper Story original) ---

/** Residents and hotel guests swim in the evening, and all day at weekends. */
function stepPoolVisits(state: GameState): void {
  if (state.tickCount % CONFIG.POOL_CHECK_TICKS !== 0) return;
  const now = state.calendar.minuteOfDay;
  const opens = isWeekend(state) ? CONFIG.POOL_WEEKEND_START_MIN : CONFIG.POOL_EVENING_START_MIN;
  if (now < opens || now >= CONFIG.POOL_CLOSE_MIN) return;
  const pools: Tenant[] = [];
  for (const t of state.tenants.values()) if (t.type === 'rooftopPool' && t.state === 'open') pools.push(t);
  if (pools.length === 0) return;
  const eligible: Person[] = [];
  for (const p of state.people.values()) {
    if ((p.kind === 'resident' || p.kind === 'hotelGuest') && !p.vip && p.state === 'inTenant' &&
        p.activityTicksLeft === 0 && p.activityTenantId < 0) eligible.push(p);
  }
  if (eligible.length === 0) return;
  const counts = capacityCounts(state);
  for (const pool of pools) {
    for (let i = 0; i < CONFIG.POOL_VISITORS_PER_CHECK; i++) {
      if ((counts.get(pool.id) ?? 0) >= pool.capacity) break;
      const p = eligible[rngInt(state, 0, eligible.length - 1)]!;
      if (p.activityTenantId >= 0 || p.state !== 'inTenant') continue;
      if (pickupRoute(state, p.pos.floor, pool.floor, p.kind) === null) continue;
      p.destination = tenantCenter(state, pool.id);
      p.endState = 'inTenant';
      p.activityTicksLeft = CONFIG.POOL_VISIT_TICKS;
      p.activityTenantId = pool.id;
      counts.set(pool.id, (counts.get(pool.id) ?? 0) + 1);
      beginTrip(state, p);
    }
  }
}

// --- Occupancy ---

/**
 * Count a person toward the occupancy of the tenant they stand in (the lobby
 * included). The people step counts everyone as it finishes with them, so
 * occupancy reflects where people are at the end of the step.
 */
function countOccupant(state: GameState, p: Person): void {
  if (p.state !== 'inTenant' && p.state !== 'cleaning') return;
  const cell = getFloor(state.tower, Math.round(p.pos.floor))?.cells[Math.round(p.pos.x)];
  if (!cell || cell.tenantId < 0) return;
  const tenant = state.tenants.get(cell.tenantId);
  if (tenant && !(isHotel(tenant.type) && isStaff(p.kind))) tenant.occupancy++;
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
  const day = operatingDay(state);
  officeRanks = null; // rosters only change outside this step
  spawnExternalVisitors(state);
  stepPoolVisits(state);
  stepLeisure(state);
  stepHotels(state); // reads last step's occupancy before it is recounted
  for (const tenant of state.tenants.values()) tenant.occupancy = 0;
  // Guests inside each hotel (cleaners must wait for an empty room). Built on
  // first use, then kept current as each guest is processed. Within this loop
  // people only change during their own turn, so the count stays exact.
  let guestsInside: Map<number, number> | null = null;
  const hotelHasGuestInside = (hotelId: number): boolean => {
    if (!guestsInside) {
      guestsInside = new Map();
      for (const other of state.people.values()) {
        if (other.kind === 'hotelGuest' && other.state === 'inTenant') guestsInside.set(other.tenantId, (guestsInside.get(other.tenantId) ?? 0) + 1);
      }
    }
    return (guestsInside.get(hotelId) ?? 0) > 0;
  };
  for (const p of state.people.values()) {
    // Only the person being processed can leave the simulation in their turn.
    const sizeBefore = state.people.size;
    const guestWasInside = p.kind === 'hotelGuest' && p.state === 'inTenant';
    // Daily rollover: fresh stress counters, fresh arrival jitter, and the
    // day's schedule restarts from its first entry.
    if (p.dayTracked !== day) {
      p.dayTracked = day;
      p.dayStress = 0;
      p.roomsCleanedToday = 0;
      p.scheduleIndex = 0;
      p.scheduleDone = false;
      p.jitterTicks = rngInt(state, -CONFIG.ARRIVAL_JITTER_TICKS, CONFIG.ARRIVAL_JITTER_TICKS);
    }
    // Finish the current vertical leg before sending staff home. Walking and
    // queued assignments can be redirected immediately without teleporting.
    if (p.kind === 'housekeeper' && state.calendar.minuteOfDay >= CONFIG.HOUSEKEEPER_SHIFT_END_MIN &&
        p.housekeepingShiftEndedDay !== day && !['riding', 'onStairs', 'onEscalator'].includes(p.state)) {
      detachFromTransport(state, p.id);
      p.activityTenantId = -1;
      p.stairsTicksLeft = 0;
      p.scheduleDone = true;
      p.housekeepingShiftEndedDay = day;
      applyAction(state, p, 'goHome');
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
            // Workers return to work, residents and guests to their rooms
            // (after a pool visit); external customers leave the tower.
            // Workers who stopped at the gym after work leave from there.
            const returnsHome = (p.kind === 'officeWorker' && state.calendar.minuteOfDay < CONFIG.GYM_EVENING_START_MIN) ||
              p.kind === 'resident' || p.kind === 'hotelGuest';
            p.destination = returnsHome
              ? tenantCenter(state, p.tenantId)
              : { floor: CONFIG.LOBBY_FLOOR_INDEX, x: 0 };
            p.endState = returnsHome ? 'inTenant' : 'offscreen';
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
          // Departing visitors are deleted on arrival without changing state.
          if (p.state !== 'walking' || !state.people.has(p.id)) break;
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
            // A full hall queue leaves later arrivals waiting beside it; they
            // join as places free up and give up only when patience runs out.
            joinQueue(state, p.id, leg.from, leg.dir > 0 ? 'up' : 'down');
            pressCall(state, leg.from, leg.dir > 0 ? 'up' : 'down');
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
        const leg = p.route?.[p.legIndex];
        // Overflow waiters retry on staggered ticks; rush hours hold thousands.
        if (leg?.mode === 'elevator' && (state.tickCount + p.id) % 8 === 0) {
          const dir = leg.dir > 0 ? 'up' : 'down';
          if (retryJoinQueue(state, p.id, leg.from, dir)) pressCall(state, leg.from, dir);
        }
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
        const canClean = hotel && isHotel(hotel.type) && hotel.state === 'open' && !hotelHasGuestInside(hotel.id);
        if (canClean) {
          const wasDirty = hotel.cleanliness < 100;
          hotel.cleanliness = Math.min(
            100,
            hotel.cleanliness + CONFIG.HOUSEKEEPER_CLEAN_PER_TICK,
          );
          if (wasDirty && hotel.cleanliness >= 100) p.roomsCleanedToday = (p.roomsCleanedToday ?? 0) + 1;
        }
        if (p.stairsTicksLeft <= 0 || !canClean || hotel.cleanliness >= 100) {
          p.state = 'inTenant';
          p.stairsTicksLeft = 0;
          p.activityTenantId = -1;
          if (state.calendar.minuteOfDay >= 480 && state.calendar.minuteOfDay < 1080) applyAction(state, p, 'goWork');
        }
        break;
      }
      case 'riding':
        break; // the elevator moves the person
    }
    const present = state.people.size === sizeBefore;
    if (guestsInside && p.kind === 'hotelGuest') {
      const inside = present && p.state === 'inTenant';
      if (inside !== guestWasInside) {
        const map: Map<number, number> = guestsInside;
        map.set(p.tenantId, (map.get(p.tenantId) ?? 0) + (inside ? 1 : -1));
      }
    }
    if (present) countOccupant(state, p);
  }
}
