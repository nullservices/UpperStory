import { CONFIG, facilityHeight, isRoofOnly } from '../data/config';
import { pushEvent } from './core/events';
import { rngInt, rngNext } from './core/rng';
import { spend } from './money';
import { removeTenantPeople, spawnVIP } from './people';
import { pickupRoute } from './routing';
import { eventInt, eventRoll, fireStationCovers, hasOpenGenerator, helipadFloorFor, maintenanceCoversShaft, reachableSecurityCount } from './services';
import type { GameState } from './state';
import { minuteToTick } from './time';
import type { Tenant } from './tenants';

export type IncidentKind = 'fire' | 'bomb' | 'infestation' | 'vip';
export type IncidentResponse = 'rescue' | 'security' | 'search' | 'ransom' | 'exterminate';
export interface Incident {
  id: number;
  personId?: number;
  stayed?: boolean;
  /** Room condition when the VIP first reaches the suite; absent in old saves. */
  arrivalCleanliness?: number;
  stress?: number;
  kind: IncidentKind;
  tenantId: number;
  deadline: number;
  responseAt: number | null;
  response: IncidentResponse | null;
  /** Fires: next tick an unanswered fire tries to spread (absent in old saves). */
  nextSpreadTick?: number;
  /** Fires: the outbreak this fire belongs to (its first incident's id); absent = its own outbreak. */
  outbreakId?: number;
  /** Security firefighting: offices that could reach the floor when dispatched. */
  guards?: number;
  /** VIP arrival floor when flown in to a helipad. */
  arrivalFloor?: number;
}
export interface HistoryEntry {
  day: number;
  message: string;
  /** Where it happened, so the journal can jump the camera there. */
  floor?: number;
  x?: number;
}
export interface CampaignState {
  /** Rooms each burning outbreak has spread to (keyed by outbreak id); absent in old saves. */
  fireOutbreakSpread?: Record<string, number>;
  waste: number;
  weather: 'clear' | 'rain';
  lastDay: number;
  nextIncidentTick: number;
  incidents: Incident[];
  history: HistoryEntry[];
  vipApproved: boolean;
  treasureFound: boolean;
  weddingHeld: boolean;
  /** Day the TOWER population and cathedral were first met together; the wedding follows. */
  weddingBookedDay?: number;
  bankrupt: boolean;
  /** A blackout is active while `tickCount < blackoutUntilTick`. */
  blackoutUntilTick?: number;
  /** Scheduled start of the next blackout. */
  nextBlackoutTick?: number;
  /** Separate seeded stream for tower events; seeded from the game seed on first use. */
  eventRngState?: number;
}
export function newCampaign(): CampaignState {
  return { waste: 0, weather: 'clear', lastDay: 1, nextIncidentTick: CONFIG.DAY_TICKS * 3,
    incidents: [], history: [], vipApproved: false, treasureFound: false, weddingHeld: false, bankrupt: false };
}
export function recordEvent(state: GameState, message: string, where?: { floor: number; x?: number }): void {
  const entry: HistoryEntry = { day: state.calendar.day, message };
  if (where) {
    entry.floor = where.floor;
    if (where.x !== undefined) entry.x = where.x;
  }
  state.campaign.history.unshift(entry);
  state.campaign.history.length = Math.min(40, state.campaign.history.length);
  pushEvent(state, { type: 'ALERT', message });
}
/** Player-facing floor name: "floor 5", or B1..B9 below ground (index 0 = B1). */
export function floorLabel(floor: number): string {
  return floor <= 0 ? `B${1 - floor}` : `floor ${floor}`;
}
const TYPE_LABELS: Record<string, string> = {
  office: 'Office', condo: 'Condo', fastfood: 'Fast food', restaurant: 'Restaurant', shop: 'Shop',
  hotel: 'Single room', hotelTwin: 'Twin room', hotelSuite: 'Hotel suite', security: 'Security office',
  housekeeping: 'Housekeeping', skyLobby: 'Sky lobby', partyHall: 'Party hall', cinema: 'Cinema',
  medical: 'Medical center', parkingRamp: 'Parking ramp', parkingSpace: 'Parking space', recycling: 'Recycling center',
  metro: 'Metro station', cathedral: 'Cathedral', fireStation: 'Fire station', bank: 'Bank', helipad: 'Helipad',
  rooftopPool: 'Rooftop pool', maintenance: 'Maintenance office', generator: 'Backup generator', lobby: 'Lobby',
};
/** Player-facing facility name ("Fast food", "Hotel suite"). */
export function tenantTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}
function tenantSpot(tenant: Tenant): { floor: number; x: number } {
  return { floor: tenant.floor, x: tenant.x + Math.floor(tenant.sizeCells / 2) };
}
function createIncident(state: GameState, kind: IncidentKind, tenant: Tenant): Incident {
  const incident: Incident = { id: state.nextEntityId++, kind, tenantId: tenant.id,
    deadline: state.tickCount + (kind === 'vip' ? CONFIG.DAY_TICKS : kind === 'infestation' ? 1800 : kind === 'bomb' ? CONFIG.BOMB_DEADLINE_TICKS : CONFIG.FIRE_DEADLINE_TICKS),
    responseAt: null, response: null };
  if (kind === 'fire') incident.nextSpreadTick = state.tickCount + CONFIG.FIRE_SPREAD_INTERVAL_TICKS;
  state.campaign.incidents.push(incident);
  return incident;
}
export function startIncident(state: GameState, kind: IncidentKind, tenantId: number): Incident {
  const tenant = state.tenants.get(tenantId);
  if (!tenant || tenant.state !== 'open') throw new Error('Choose an open facility');
  if (state.campaign.incidents.some(i => i.tenantId === tenantId)) throw new Error('An incident is already active here');
  if (kind === 'vip' && tenant.type !== 'hotelSuite') throw new Error('VIPs require a hotel suite');
  const incident = createIncident(state, kind, tenant);
  if (kind === 'vip') {
    const helipad = helipadFloorFor(state, tenant.floor);
    const pad = helipad === null ? undefined : [...state.tenants.values()].find(t => t.type === 'helipad' && t.state === 'open' && t.floor === helipad);
    if (pad) incident.arrivalFloor = pad.floor;
    incident.personId = spawnVIP(state, tenant, pad ? tenantSpot(pad) : undefined);
  }
  const label = kind === 'vip' ? (incident.arrivalFloor !== undefined ? 'VIP arriving by helicopter for an inspection' : 'VIP inspection')
    : kind === 'bomb' ? 'Bomb threat' : kind === 'fire' ? 'Fire reported' : 'Cockroach infestation';
  recordEvent(state, `${label} on ${floorLabel(tenant.floor)}.`, tenantSpot(tenant));
  return incident;
}
function serviceAvailable(state: GameState, type: 'security' | 'housekeeping', floor: number): boolean {
  return [...state.tenants.values()].some(t => t.type === type && t.state === 'open' &&
    pickupRoute(state, t.floor, floor, type === 'security' ? 'guard' : 'housekeeper') !== null);
}

export interface ResponseQuote {
  /** Why the response cannot be ordered now, or null. */
  error: string | null;
  costCents: number;
  delayTicks: number;
  /** Probability the response succeeds when it arrives (1 for paid responses). */
  successChance: number;
}

/** Cost, arrival delay and odds of a response, for previews and the command. */
export function responseQuote(state: GameState, id: number, action: IncidentResponse): ResponseQuote {
  const quote: ResponseQuote = { error: null, costCents: 0, delayTicks: 1, successChance: 1 };
  const incident = state.campaign.incidents.find(i => i.id === id);
  const tenant = incident && state.tenants.get(incident.tenantId);
  if (!incident || !tenant) return { ...quote, error: 'This incident has ended' };
  const allowed: IncidentResponse[] = incident.kind === 'fire' ? ['rescue', 'security'] : incident.kind === 'bomb' ? ['search', 'ransom'] : incident.kind === 'infestation' ? ['exterminate'] : [];
  if (!allowed.includes(action)) return { ...quote, error: 'That response does not apply' };
  if (action === 'search' || action === 'security') {
    const guards = reachableSecurityCount(state, tenant.floor);
    if (guards === 0) {
      // Nothing can be sent: no chance of success, and the one-office timing for reference.
      return { ...quote, error: 'An accessible security office is required', successChance: 0,
        delayTicks: action === 'search' ? CONFIG.BOMB_SEARCH_TICKS : CONFIG.SECURITY_FIRE_DELAY_TICKS };
    }
    if (action === 'search') quote.delayTicks = Math.max(1, Math.round(CONFIG.BOMB_SEARCH_TICKS / guards));
    else {
      quote.delayTicks = Math.max(1, Math.round(CONFIG.SECURITY_FIRE_DELAY_TICKS / (1 + 0.5 * (guards - 1))));
      quote.successChance = securityFireChance(guards);
    }
  } else if (action === 'rescue') {
    const station = fireStationCovers(state, tenant.floor);
    quote.delayTicks = station ? CONFIG.FIRE_STATION_RESCUE_DELAY_TICKS : CONFIG.FIRE_RESCUE_DELAY_TICKS;
    quote.costCents = (station ? CONFIG.FIRE_STATION_RESCUE_COST_DOLLARS : CONFIG.FIRE_RESCUE_COST_DOLLARS) * 100;
  } else quote.costCents = (action === 'ransom' ? 100_000 : 2500) * 100;
  if (incident.response !== null) return { ...quote, error: 'A response is already underway' };
  if (state.tickCount + quote.delayTicks > incident.deadline) return { ...quote, error: 'Too late: help would not arrive in time' };
  if (quote.costCents > state.money.balanceCents) return { ...quote, error: 'Not enough funds' };
  return quote;
}

function securityFireChance(guards: number): number {
  return Math.min(CONFIG.SECURITY_FIRE_MAX_CHANCE, CONFIG.SECURITY_FIRE_BASE_CHANCE + CONFIG.SECURITY_FIRE_CHANCE_PER_OFFICE * (guards - 1));
}

export function respondToIncident(state: GameState, id: number, action: IncidentResponse): void {
  const incident = state.campaign.incidents.find(i => i.id === id);
  const tenant = incident && state.tenants.get(incident.tenantId);
  if (!incident || !tenant) throw new Error('This incident has ended');
  if (incident.response !== null) throw new Error('A response is already underway');
  const quote = responseQuote(state, id, action);
  if (quote.error) throw new Error(quote.error);
  if (!spend(state, quote.costCents)) throw new Error('Not enough funds');
  incident.response = action;
  incident.responseAt = state.tickCount + quote.delayTicks;
  if (action === 'security') incident.guards = reachableSecurityCount(state, tenant.floor);
  const message = action === 'search' ? 'Security is searching for the bomb.'
    : action === 'security' ? 'Security guards are fighting the fire.'
      : action === 'rescue' ? (quote.costCents === CONFIG.FIRE_STATION_RESCUE_COST_DOLLARS * 100 ? 'Firefighters from your fire station are on the way.' : 'Fire rescue is on the way.')
        : action === 'ransom' ? 'Ransom paid.' : 'Pest control dispatched.';
  recordEvent(state, message, tenantSpot(tenant));
}
function damage(state: GameState, tenantId: number): void {
  const tenant = state.tenants.get(tenantId);
  if (!tenant || tenant.type === 'lobby') return;
  removeTenantPeople(state, tenant.id);
  tenant.state = 'damaged';
  tenant.occupancy = 0;
  tenant.reportedPopulation = 0;
  state.tower.structureRevision++;
}

function burnable(state: GameState, t: Tenant): boolean {
  return t.state === 'open' && t.type !== 'lobby' && t.type !== 'skyLobby' && !state.campaign.incidents.some(i => i.tenantId === t.id);
}

/**
 * An unanswered fire reaches rooms touching it on its own floor(s) and the
 * rooms directly above. New fires start their own clocks, so a chain grows by
 * at most one ring per spread interval, and the active-fire cap bounds it.
 */
function spreadFire(state: GameState, tenant: Tenant, source: Incident): void {
  const c = state.campaign;
  let active = c.incidents.filter(i => i.kind === 'fire').length;
  if (active >= CONFIG.FIRE_MAX_ACTIVE) return;
  // Each outbreak may only claim a few rooms beyond where it started.
  const outbreak = source.outbreakId ?? source.id;
  c.fireOutbreakSpread ??= {};
  let spread = c.fireOutbreakSpread[outbreak] ?? 0;
  if (spread >= CONFIG.FIRE_CHAIN_MAX_SPREAD) return;
  const top = tenant.floor + facilityHeight(tenant.type) - 1;
  const candidates: Tenant[] = [];
  for (const t of state.tenants.values()) {
    if (t.id === tenant.id || !burnable(state, t)) continue;
    const tLo = t.floor;
    const tHi = t.floor + facilityHeight(t.type) - 1;
    const sameFloor = tLo <= top && tHi >= tenant.floor && t.x <= tenant.x + tenant.sizeCells && t.x + t.sizeCells >= tenant.x;
    const above = tLo <= top + 1 && tHi >= top + 1 && t.x < tenant.x + tenant.sizeCells && t.x + t.sizeCells > tenant.x;
    if (sameFloor || above) candidates.push(t);
  }
  let ignited = 0;
  for (const t of candidates) {
    if (ignited >= CONFIG.FIRE_SPREAD_MAX_PER_STEP || active >= CONFIG.FIRE_MAX_ACTIVE || spread >= CONFIG.FIRE_CHAIN_MAX_SPREAD) break;
    if (eventRoll(state) >= CONFIG.FIRE_SPREAD_CHANCE) continue;
    createIncident(state, 'fire', t).outbreakId = outbreak;
    recordEvent(state, `Fire spread to ${floorLabel(t.floor)}.`, tenantSpot(t));
    ignited++;
    active++;
    spread++;
  }
  c.fireOutbreakSpread[outbreak] = spread;
  // Forget outbreaks with no fire still burning.
  for (const key of Object.keys(c.fireOutbreakSpread)) {
    const id = Number(key);
    if (!c.incidents.some(i => i.kind === 'fire' && (i.outbreakId ?? i.id) === id)) delete c.fireOutbreakSpread[key];
  }
}

/** Ticks from now until `minutes` game minutes have passed. */
function ticksForMinutes(state: GameState, minutes: number): number {
  const now = state.calendar.minuteOfDay;
  const end = minuteToTick(now + minutes);
  return Math.max(1, (end - state.calendar.tickOfDay + CONFIG.DAY_TICKS) % CONFIG.DAY_TICKS);
}

/** Daily rolls (from 2★): schedule a blackout and per-car breakdowns. */
function rollDailyEvents(state: GameState): void {
  const c = state.campaign;
  if (state.starLevel < 2) return;
  const chance = c.weather === 'rain' ? CONFIG.BLACKOUT_CHANCE_RAIN : CONFIG.BLACKOUT_CHANCE_CLEAR;
  if (c.nextBlackoutTick === undefined && eventRoll(state) < chance) {
    c.nextBlackoutTick = state.tickCount + eventInt(state, 1, CONFIG.DAY_TICKS - 1);
  }
  for (const group of state.elevatorGroups.values()) {
    let covered: boolean | null = null;
    for (const car of group.cars) {
      if (car.outOfService || car.breakdownAtTick !== undefined) continue;
      covered ??= maintenanceCoversShaft(state, group);
      const p = (covered ? CONFIG.MAINTENANCE_BREAKDOWN_FACTOR : 1) / CONFIG.ELEVATOR_BREAKDOWN_MEAN_DAYS;
      if (eventRoll(state) < p) car.breakdownAtTick = state.tickCount + eventInt(state, 1, CONFIG.DAY_TICKS - 1);
    }
  }
}

function stepBlackout(state: GameState): void {
  const c = state.campaign;
  if (c.blackoutUntilTick !== undefined && state.tickCount >= c.blackoutUntilTick) {
    delete c.blackoutUntilTick;
    recordEvent(state, 'Power has been restored.');
  }
  if (c.nextBlackoutTick !== undefined && state.tickCount >= c.nextBlackoutTick) {
    delete c.nextBlackoutTick;
    const minutes = eventInt(state, CONFIG.BLACKOUT_MIN_MINUTES, CONFIG.BLACKOUT_MAX_MINUTES);
    c.blackoutUntilTick = state.tickCount + ticksForMinutes(state, minutes);
    recordEvent(state, hasOpenGenerator(state)
      ? 'Blackout in the city. Your backup generator keeps the tower running.'
      : 'Blackout! Elevators have stopped until the power returns.');
  }
}

export function stepCampaign(state: GameState): void {
  const c = state.campaign;
  if (c.lastDay !== state.calendar.day) {
    c.lastDay = state.calendar.day;
    const recycling = [...state.tenants.values()].filter(t => t.type === 'recycling' && t.state === 'open').length;
    c.waste = Math.max(0, Math.min(100, c.waste + state.people.size / 500 - recycling * 10));
    c.weather = rngNext(state) < 0.2 ? 'rain' : 'clear';
    if (c.weather === 'rain') recordEvent(state, 'Rain is reducing outside shopping and dining traffic.');
    if (state.money.balanceCents < 0 && !c.bankrupt) {
      c.bankrupt = true;
      recordEvent(state, 'The tower is in debt. Restore a positive balance to resume construction.');
    } else if (state.money.balanceCents >= 0) c.bankrupt = false;
    rollDailyEvents(state);
  }
  stepBlackout(state);
  for (const incident of [...c.incidents]) {
    if (!c.incidents.includes(incident)) continue;
    const tenant = state.tenants.get(incident.tenantId);
    const vip = incident.personId === undefined ? undefined : state.people.get(incident.personId);
    if (vip) {
      if (vip.state === 'inTenant' && tenant) {
        incident.arrivalCleanliness ??= tenant.cleanliness;
        incident.stayed = true;
      }
      incident.stress = Math.max(incident.stress ?? 0, vip.stress + vip.failedTripsToday * 50);
    }
    let result: string | null = null;
    if (!tenant || tenant.state !== 'open') result = 'Incident closed: facility is no longer open.';
    else if (incident.responseAt !== null && state.tickCount >= incident.responseAt && incident.responseAt <= incident.deadline) {
      if (incident.response === 'security' && eventRoll(state) >= securityFireChance(incident.guards ?? 1)) {
        // The guards could not contain it: the fire keeps burning and may spread.
        incident.response = null;
        incident.responseAt = null;
        delete incident.guards;
        recordEvent(state, `Security could not put out the fire on ${floorLabel(tenant.floor)}. Call fire rescue or try again.`, tenantSpot(tenant));
        continue;
      }
      if (incident.kind === 'infestation') tenant.cleanliness = 100;
      result = incident.kind === 'fire' ? 'Fire extinguished. The facility is safe.' : incident.kind === 'bomb' ? 'Bomb threat resolved.' : 'Infestation cleared.';
    } else if (incident.kind === 'infestation' && tenant.cleanliness >= 90 && serviceAvailable(state, 'housekeeping', tenant.floor)) {
      result = 'Housekeeping cleared the infestation.';
    } else if (state.tickCount >= incident.deadline) {
      if (incident.kind === 'vip') {
        const guests = [...state.people.values()].filter(p => p.tenantId === tenant.id);
        const connected = pickupRoute(state, incident.arrivalFloor ?? 1, tenant.floor, 'hotelGuest') !== null;
        const happy = incident.stayed === true && (incident.stress ?? 0) < 50 && connected && (incident.arrivalCleanliness ?? tenant.cleanliness) >= 70 && tenant.grade >= 2 && guests.every(p => p.stress < 50 && p.failedTripsToday === 0);
        c.vipApproved ||= happy;
        result = happy ? 'The VIP approved your tower. A favorable inspection is recorded.' : 'The VIP was disappointed. Improve suite cleanliness, access and service before the next visit.';
      } else {
        damage(state, tenant.id);
        if (incident.kind === 'fire' || incident.kind === 'bomb') {
          // The closest open room on the same floor (never a lobby or sky lobby).
          let neighbor: Tenant | undefined;
          let nearest = Infinity;
          for (const t of state.tenants.values()) {
            if (t.id === tenant.id || t.floor !== tenant.floor || t.state !== 'open' || t.type === 'lobby' || t.type === 'skyLobby') continue;
            if (Math.abs(t.x - tenant.x) > tenant.sizeCells + t.sizeCells) continue;
            const gap = Math.max(t.x - (tenant.x + tenant.sizeCells), tenant.x - (t.x + t.sizeCells), 0);
            if (gap < nearest) { nearest = gap; neighbor = t; }
          }
          if (neighbor) damage(state, neighbor.id);
        }
        result = incident.kind === 'infestation' ? 'Infestation forced the facility to close. Inspect it to renovate.' : 'The incident damaged the tower. Inspect damaged rooms to repair them.';
      }
    } else if (incident.kind === 'fire' && incident.response === null) {
      incident.nextSpreadTick ??= state.tickCount + CONFIG.FIRE_SPREAD_INTERVAL_TICKS;
      if (state.tickCount >= incident.nextSpreadTick) {
        incident.nextSpreadTick = state.tickCount + CONFIG.FIRE_SPREAD_INTERVAL_TICKS;
        if (!fireStationCovers(state, tenant.floor)) spreadFire(state, tenant, incident);
      }
    }
    if (result) {
      c.incidents.splice(c.incidents.indexOf(incident), 1);
      recordEvent(state, result, tenant ? tenantSpot(tenant) : undefined);
    }
  }
  if (state.tickCount < c.nextIncidentTick) return;
  c.nextIncidentTick = state.tickCount + rngInt(state, 3, 6) * CONFIG.DAY_TICKS;
  const open = [...state.tenants.values()].filter(t => t.state === 'open' && t.type !== 'lobby' && t.type !== 'skyLobby' && !c.incidents.some(i => i.tenantId === t.id));
  if (!open.length || state.starLevel < 2) return;
  const suite = open.find(t => t.type === 'hotelSuite');
  if (suite && !c.vipApproved && state.starLevel >= 3) { startIncident(state, 'vip', suite.id); return; }
  const dirty = open.find(t => t.cleanliness < 40);
  // Dirty rooms invite pests, but not every time: fires and bombs still occur.
  if (dirty && eventRoll(state) < CONFIG.INFESTATION_PICK_CHANCE) { startIncident(state, 'infestation', dirty.id); return; }
  const target = open[rngInt(state, 0, open.length - 1)]!;
  startIncident(state, state.starLevel >= 3 && rngNext(state) < 0.35 ? 'bomb' : 'fire', target.id);
}

/** Roof facilities (pool, helipad) on `floor` overlapping [lo, hi). */
export function roofFacilityUnder(state: GameState, floor: number, lo: number, hi: number): Tenant | undefined {
  for (const t of state.tenants.values()) {
    if (isRoofOnly(t.type) && t.floor === floor && t.x < hi && t.x + t.sizeCells > lo) return t;
  }
  return undefined;
}
