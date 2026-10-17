import { CONFIG, isHotel } from '../data/config';
import { rngInt, rngNext } from './core/rng';
import { capacityCounts, sendToActivity, spawnVisitor, type Person } from './people';
import { pickupRoute } from './routing';
import type { GameState } from './state';
import type { Tenant, TenantType } from './tenants';
import { isWeekend, minuteToTick, operatingDay } from './time';

/**
 * Second-wave venues (Upper Story originals): gym, supermarket, bar,
 * conference centre and observation deck. Each draws traffic at its own
 * hours so the elevators see more than the morning/lunch/evening rushes.
 * Every decision runs once per LEISURE_CHECK_TICKS: one pass over tenants,
 * and at most one pass over people, never a people x tenants scan.
 */

export type LeisureType = 'gym' | 'supermarket' | 'bar' | 'conference' | 'observationDeck';
const LEISURE: readonly string[] = ['gym', 'supermarket', 'bar', 'conference', 'observationDeck'];

export function isLeisureVenue(type: string): type is LeisureType {
  return LEISURE.includes(type);
}

/** Venues whose outside visitors count toward population (like shop patrons). */
export function reportsVisitorPopulation(type: TenantType): boolean {
  return type === 'supermarket' || type === 'bar' || type === 'conference' || type === 'observationDeck';
}

/** Ticket price before the pricing tier: higher decks charge more. */
export function deckTicketDollars(floor: number): number {
  return CONFIG.DECK_TICKET_DOLLARS * (1 + Math.max(0, floor) / 50);
}

/** Price of one visit in cents, or null for non-leisure tenants. */
export function leisureFeeCents(tenant: Tenant): number | null {
  let dollars: number;
  switch (tenant.type) {
    case 'gym': dollars = CONFIG.GYM_FEE_DOLLARS; break;
    case 'supermarket': dollars = CONFIG.SUPERMARKET_FEE_DOLLARS; break;
    case 'bar': dollars = CONFIG.BAR_FEE_DOLLARS; break;
    case 'conference': dollars = CONFIG.CONFERENCE_DELEGATE_DOLLARS; break;
    case 'observationDeck': dollars = deckTicketDollars(tenant.floor); break;
    default: return null;
  }
  return Math.round(dollars * CONFIG.PRICING_LEVELS[tenant.pricing]!.revenueMult * 100);
}

/** Is the gym taking members right now (and are office workers among them)? */
export function gymHours(state: GameState): { open: boolean; workers: boolean } {
  const now = state.calendar.minuteOfDay;
  if (isWeekend(state)) return { open: now >= CONFIG.GYM_WEEKEND_START_MIN && now < CONFIG.GYM_EVENING_END_MIN, workers: false };
  const morning = now >= CONFIG.GYM_MORNING_START_MIN && now < CONFIG.GYM_MORNING_END_MIN;
  const evening = now >= CONFIG.GYM_EVENING_START_MIN && now < CONFIG.GYM_EVENING_END_MIN;
  return { open: morning || evening, workers: morning };
}

function barOpen(now: number): boolean {
  return now >= CONFIG.BAR_OPEN_MIN && now < CONFIG.BAR_LAST_ENTRY_MIN;
}
function supermarketOpen(now: number): boolean {
  return now >= CONFIG.SUPERMARKET_OPEN_MIN && now < CONFIG.SUPERMARKET_CLOSE_MIN;
}
function deckOpen(now: number): boolean {
  return now >= CONFIG.DECK_OPEN_MIN && now < CONFIG.DECK_LAST_ENTRY_MIN;
}

interface Venues { gym: Tenant[]; supermarket: Tenant[]; bar: Tenant[]; conference: Tenant[]; observationDeck: Tenant[]; hotels: Tenant[]; any: boolean }

const venueCache = new WeakMap<GameState, { tick: number; venues: Venues }>();
/** Open venues (and hotels, for conference overflow), gathered once per tick. */
function openVenues(state: GameState): Venues {
  const cached = venueCache.get(state);
  if (cached?.tick === state.tickCount) return cached.venues;
  const venues: Venues = { gym: [], supermarket: [], bar: [], conference: [], observationDeck: [], hotels: [], any: false };
  for (const t of state.tenants.values()) {
    if (t.state !== 'open') continue;
    if (isLeisureVenue(t.type)) { venues[t.type].push(t); venues.any = true; } else if (isHotel(t.type)) venues.hotels.push(t);
  }
  venueCache.set(state, { tick: state.tickCount, venues });
  return venues;
}

/** In-game minutes that pass per tick right now (lunch runs slow, the night fast). */
function minutesPerTick(state: GameState): number {
  const now = state.calendar.minuteOfDay;
  for (const seg of CONFIG.DAY_SEGMENTS) if (now >= seg.fromMin && now < seg.toMin) return (seg.toMin - seg.fromMin) / seg.ticks;
  return 1;
}

/** Whole draws for an expected count (integer part plus a chance at one more). */
function draws(state: GameState, expected: number): number {
  const whole = Math.floor(expected);
  return whole + (rngNext(state) < expected - whole ? 1 : 0);
}

function volume(t: Tenant): number {
  return CONFIG.PRICING_LEVELS[t.pricing]!.visitorMult;
}

function hasRoom(counts: Map<number, number>, t: Tenant): boolean {
  return (counts.get(t.id) ?? 0) < t.capacity;
}

/** Outsiders arriving from the street for a stay of `stay` ticks. */
function spawnOutsiders(state: GameState, venue: Tenant, expected: number, stay: number): void {
  const counts = capacityCounts(state);
  for (let n = draws(state, expected); n > 0 && hasRoom(counts, venue); n--) {
    if (spawnVisitor(state, 'shopper', venue, undefined, stay) === undefined) return;
  }
}

/** Ticks from now until a minute later today. */
function ticksUntil(state: GameState, minute: number): number {
  return Math.max(30, minuteToTick(minute) - state.calendar.tickOfDay);
}

/**
 * Conference bookings: decided at the first check of each weekday; delegates
 * arrive through the morning and stay until late afternoon. Event days send
 * a few extra overnight guests to hotels within reach.
 */
function stepConference(state: GameState, venue: Tenant, span: number, hotels: Tenant[]): void {
  const day = operatingDay(state);
  const now = state.calendar.minuteOfDay;
  if (venue.conferenceDay !== day) {
    venue.conferenceDay = day;
    venue.externalArrivals = 0;
    venue.conferenceDelegates = !isWeekend(state) && rngNext(state) < CONFIG.CONFERENCE_EVENT_CHANCE
      ? Math.min(venue.capacity, Math.round(venue.capacity * (0.5 + 0.5 * rngNext(state)) * volume(venue)))
      : 0;
  }
  const delegates = venue.conferenceDelegates ?? 0;
  if (delegates <= 0) return;
  if (now >= CONFIG.CONFERENCE_ARRIVE_MIN && now < CONFIG.CONFERENCE_ARRIVE_END_MIN) {
    const due = Math.min(delegates, Math.floor((now - CONFIG.CONFERENCE_ARRIVE_MIN) / (CONFIG.CONFERENCE_ARRIVE_END_MIN - CONFIG.CONFERENCE_ARRIVE_MIN) * delegates) + 1);
    const counts = capacityCounts(state);
    while ((venue.externalArrivals ?? 0) < due && hasRoom(counts, venue)) {
      const stay = ticksUntil(state, CONFIG.CONFERENCE_LEAVE_MIN + rngInt(state, -20, 20));
      if (spawnVisitor(state, 'shopper', venue, undefined, stay) === undefined) break;
      venue.externalArrivals = (venue.externalArrivals ?? 0) + 1;
    }
  }
  if (now >= CONFIG.CONFERENCE_HOTEL_START_MIN && now < CONFIG.CONFERENCE_HOTEL_END_MIN && hotels.length > 0) {
    const window = CONFIG.CONFERENCE_HOTEL_END_MIN - CONFIG.CONFERENCE_HOTEL_START_MIN;
    const expected = delegates * CONFIG.CONFERENCE_HOTEL_GUESTS_PER_DELEGATE * span / window;
    const counts = capacityCounts(state);
    for (let n = draws(state, expected); n > 0; n--) {
      const near = hotels.filter(h => Math.abs(h.floor - venue.floor) <= CONFIG.CONFERENCE_HOTEL_REACH_FLOORS && hasRoom(counts, h));
      if (near.length === 0) return;
      spawnVisitor(state, 'hotelGuest', near[rngInt(state, 0, near.length - 1)]!);
    }
  }
}

/** Send up to `expected` eligible people from `pool` to `venue`. */
function sendMembers(state: GameState, venue: Tenant, pool: Person[], expected: number, ticks: number): void {
  if (pool.length === 0) return;
  const counts = capacityCounts(state);
  for (let n = draws(state, expected); n > 0; n--) {
    if (!hasRoom(counts, venue)) return;
    const p = pool[rngInt(state, 0, pool.length - 1)]!;
    // Already sent this check, or already out: skip rather than redraw.
    if (p.activityTenantId >= 0 || (p.state !== 'inTenant' && p.state !== 'offscreen')) continue;
    if (pickupRoute(state, p.pos.floor, venue.floor, p.kind) === null) continue;
    sendToActivity(state, p, venue, ticks);
    counts.set(venue.id, (counts.get(venue.id) ?? 0) + 1);
  }
}

export function stepLeisure(state: GameState): void {
  if (state.tickCount % CONFIG.LEISURE_CHECK_TICKS !== 0) return;
  const venues = openVenues(state);
  if (!venues.any || state.people.size >= CONFIG.MAX_PEOPLE) return;
  const now = state.calendar.minuteOfDay;
  const span = minutesPerTick(state) * CONFIG.LEISURE_CHECK_TICKS; // in-game minutes per check
  const rain = state.campaign.weather === 'rain' ? 0.5 : 1;

  // Outsiders: bar crowds, neighbourhood shoppers, tourists, delegates.
  if (barOpen(now)) for (const bar of venues.bar) spawnOutsiders(state, bar, CONFIG.BAR_EXTERNAL_PER_MIN * span * volume(bar), CONFIG.BAR_VISIT_TICKS);
  if (supermarketOpen(now)) {
    for (const shop of venues.supermarket) spawnOutsiders(state, shop, CONFIG.SUPERMARKET_EXTERNAL_PER_MIN * span * volume(shop) * rain, CONFIG.SUPERMARKET_VISIT_TICKS);
  }
  if (deckOpen(now)) {
    const crowd = (isWeekend(state) ? 1.5 : 1) * rain;
    for (const deck of venues.observationDeck) spawnOutsiders(state, deck, CONFIG.DECK_TOURISTS_PER_MIN * span * volume(deck) * crowd, CONFIG.DECK_VISIT_TICKS);
  }
  for (const venue of venues.conference) stepConference(state, venue, span, venues.hotels);

  // Members already in the tower: residents, hotel guests, early office workers.
  const gym = venues.gym.length > 0 ? gymHours(state) : { open: false, workers: false };
  const shopping = venues.supermarket.length > 0 && supermarketOpen(now);
  const drinking = venues.bar.length > 0 && barOpen(now);
  if (!gym.open && !shopping && !drinking) return;
  const residents: Person[] = [], guests: Person[] = [], workers: Person[] = [];
  for (const p of state.people.values()) {
    if (p.vip || p.activityTenantId >= 0 || p.activityTicksLeft !== 0) continue;
    if (p.state === 'inTenant') {
      if (p.kind === 'resident') residents.push(p);
      else if (p.kind === 'hotelGuest') guests.push(p);
    } else if (gym.workers && p.kind === 'officeWorker' && p.state === 'offscreen' && !p.scheduleDone) workers.push(p);
  }
  if (gym.open) {
    for (const venue of venues.gym) {
      const expected = CONFIG.GYM_MEMBERS_PER_CHECK * volume(venue);
      sendMembers(state, venue, residents, expected / (gym.workers ? 2 : 1), CONFIG.GYM_VISIT_TICKS);
      if (gym.workers) sendMembers(state, venue, workers, expected, CONFIG.GYM_VISIT_TICKS);
    }
  }
  if (shopping) {
    const shoppers = residents.concat(guests);
    for (const venue of venues.supermarket) sendMembers(state, venue, shoppers, CONFIG.SUPERMARKET_SHOPPERS_PER_CHECK * volume(venue), CONFIG.SUPERMARKET_VISIT_TICKS);
  }
  if (drinking) {
    const drinkers = residents.concat(guests);
    for (const venue of venues.bar) sendMembers(state, venue, drinkers, CONFIG.BAR_GUESTS_PER_CHECK * volume(venue), CONFIG.BAR_VISIT_TICKS);
  }
}

/**
 * Called as an office worker heads home: some stop at a reachable gym first
 * and leave the tower from there. Returns true when the worker was diverted.
 */
export function divertWorkerToGym(state: GameState, p: Person): boolean {
  if (isWeekend(state) || state.calendar.minuteOfDay >= CONFIG.GYM_EVENING_END_MIN) return false;
  const gyms = openVenues(state).gym;
  if (gyms.length === 0) return false;
  const gym = gyms[rngInt(state, 0, gyms.length - 1)]!;
  if (rngNext(state) >= CONFIG.GYM_WORKER_EVENING_CHANCE * volume(gym)) return false;
  if (!hasRoom(capacityCounts(state), gym) || pickupRoute(state, p.pos.floor, gym.floor, p.kind) === null) return false;
  sendToActivity(state, p, gym, CONFIG.GYM_VISIT_TICKS);
  const counts = capacityCounts(state);
  counts.set(gym.id, (counts.get(gym.id) ?? 0) + 1);
  return true;
}
