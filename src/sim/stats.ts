import { CONFIG, isHotel } from '../data/config';
import { population } from './people';
import type { GameState } from './state';
import type { TenantType } from './tenants';
import { minuteToTick } from './time';

/**
 * Tower statistics history for the graphs window (Tower › Statistics).
 *
 * Recording is read-only with respect to the simulation (never touches the
 * RNG or any sim field) and cheap:
 *  - every tick: count PERSON_GAVE_UP events in this tick's event list;
 *  - every SAMPLE_TICKS ticks: total people queued for lifts and the share of
 *    busy cars (O(queues + cars), no people scan);
 *  - once a day at the 15:00 evaluation: one people scan for stress;
 *  - once a day just before midnight: one tenant scan for takings by trade;
 *  - at the date change (right after daily settlement): one sample.
 *
 * History is bounded: the last DAILY_KEEP days are kept day by day, older
 * days are merged into quarter buckets (3 days), and older quarters into year
 * buckets (12 days); the year tier halves its resolution past YEAR_KEEP.
 */

/** One history point. Covers `span` days ending on `day`. */
export interface StatsSample {
  /** Last settled day covered by this point. */
  day: number;
  /** Days merged into this point (1 = a single day). */
  span: number;
  /** Population at the date change. */
  pop: number;
  /** Funds after settlement, cents. */
  funds: number;
  /** Income / upkeep / net per day, cents. */
  income: number;
  upkeep: number;
  net: number;
  stars: number;
  /** Average stress of people in the tower at 15:00 (0..100). */
  stress: number;
  /** Share of those people at stress 50+ (0..100). */
  stressed: number;
  /** People who gave up on a trip, per day. */
  giveUps: number;
  /** Most people queued for lifts at once during the day. */
  waitPeak: number;
  /** Average people queued for lifts across the day. */
  waitAvg: number;
  /** Share of lift cars moving or loading, averaged across the day (0..100). */
  util: number;
  offices: number;
  officesVacant: number;
  condos: number;
  condosVacant: number;
  hotelRooms: number;
  /** Booked hotel rooms ÷ open rooms at the date change (0..100). */
  hotelOcc: number;
  /** Open facilities by trade. */
  food: number;
  retail: number;
  leisure: number;
  services: number;
  /** Takings by trade (sales, meals, nights), cents per day. */
  revHotel: number;
  revFood: number;
  revRetail: number;
  revLeisure: number;
}

export type StatsField = Exclude<keyof StatsSample, 'day' | 'span'>;

/** How a field combines when days merge into a coarser bucket. */
const MERGE: Record<StatsField, 'last' | 'mean'> = {
  pop: 'last', funds: 'last', stars: 'last',
  income: 'mean', upkeep: 'mean', net: 'mean',
  stress: 'mean', stressed: 'mean', giveUps: 'mean',
  waitPeak: 'mean', waitAvg: 'mean', util: 'mean',
  offices: 'last', officesVacant: 'last', condos: 'last', condosVacant: 'last',
  hotelRooms: 'last', hotelOcc: 'mean',
  food: 'last', retail: 'last', leisure: 'last', services: 'last',
  revHotel: 'mean', revFood: 'mean', revRetail: 'mean', revLeisure: 'mean',
};
const FIELDS = Object.keys(MERGE) as StatsField[];

/** Running tallies for the calendar day in progress. */
export interface StatsToday {
  giveUps: number;
  waitPeak: number;
  waitSum: number;
  utilSum: number;
  samples: number;
  /** Day whose 15:00 stress was taken, and the reading. */
  stressDay: number;
  stress: number;
  stressed: number;
  /** Day whose pre-midnight takings were taken, and the takings (cents). */
  revenueDay: number;
  revHotel: number;
  revFood: number;
  revRetail: number;
  revLeisure: number;
}

export interface StatsState {
  /** Daily samples, oldest first (at most DAILY_KEEP). */
  days: StatsSample[];
  /** Quarter buckets older than `days`, oldest first. */
  quarters: StatsSample[];
  /** Year buckets older than `quarters`, oldest first. */
  years: StatsSample[];
  /** Calendar day the tallies in `today` belong to. */
  lastDay: number;
  today: StatsToday;
  /** Peak lift queue per clock hour (index 0 = midnight) for the operating day in progress (07:00 to 07:00). */
  hours: number[];
  /** The same for the last completed operating day. */
  lastHours: number[];
}

export const STATS_LIMITS = { DAILY_KEEP: 96, QUARTER_KEEP: 96, YEAR_KEEP: 96, SAMPLE_TICKS: 8 } as const;

function newToday(): StatsToday {
  return {
    giveUps: 0, waitPeak: 0, waitSum: 0, utilSum: 0, samples: 0,
    stressDay: -1, stress: 0, stressed: 0,
    revenueDay: -1, revHotel: 0, revFood: 0, revRetail: 0, revLeisure: 0,
  };
}

export function createStats(day = 1): StatsState {
  return { days: [], quarters: [], years: [], lastDay: day, today: newToday(), hours: new Array<number>(24).fill(0), lastHours: [] };
}

/** Trade a tenant is charted under, or null for structure (lobbies). */
export function tradeOf(type: TenantType): 'office' | 'condo' | 'hotel' | 'food' | 'retail' | 'leisure' | 'services' | null {
  if (type === 'lobby' || type === 'skyLobby') return null;
  if (type === 'office' || type === 'condo') return type;
  if (isHotel(type)) return 'hotel';
  if (type === 'fastfood' || type === 'restaurant') return 'food';
  if (type === 'shop') return 'retail';
  if (type === 'cinema' || type === 'partyHall' || type === 'rooftopPool') return 'leisure';
  return 'services';
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Called every tick by the engine (after progression). */
export function stepStats(state: GameState): void {
  let stats = state.stats;
  // Absent in older saves (and malformed if hand-edited): start a fresh history.
  if (!stats?.today || !Array.isArray(stats.days) || !Array.isArray(stats.quarters) || !Array.isArray(stats.years) || !Array.isArray(stats.hours)) {
    stats = state.stats = createStats(state.calendar.day);
  }
  const today = stats.today;

  for (const event of state.events) if (event.type === 'PERSON_GAVE_UP') today.giveUps++;

  if (state.calendar.tickOfDay === 0) {
    stats.lastHours = stats.hours;
    stats.hours = new Array<number>(24).fill(0);
  }
  if (state.tickCount % STATS_LIMITS.SAMPLE_TICKS === 0) sampleTransport(state, stats);

  const day = state.calendar.day;
  if (state.evaluationDay === day && today.stressDay !== day) sampleStress(state, today, day);
  if (state.calendar.tickOfDay === minuteToTick(1440) - 1 && today.revenueDay !== day) sampleRevenue(state, today, day);

  if (day !== stats.lastDay) {
    if (day > stats.lastDay) recordDay(state, stats, day - 1);
    stats.today = newToday();
    stats.lastDay = day;
  }
}

function sampleTransport(state: GameState, stats: StatsState): void {
  const today = stats.today;
  let waiting = 0;
  for (const key in state.queues) waiting += state.queues[key]!.length;
  let cars = 0;
  let busy = 0;
  for (const group of state.elevatorGroups.values()) {
    for (const car of group.cars) {
      cars++;
      if (car.state !== 'idle') busy++;
    }
  }
  today.samples++;
  today.waitSum += waiting;
  if (waiting > today.waitPeak) today.waitPeak = waiting;
  const hour = Math.floor((state.calendar.minuteOfDay % 1440) / 60);
  if (waiting > (stats.hours[hour] ?? 0)) stats.hours[hour] = waiting;
  today.utilSum += cars > 0 ? busy / cars : 0;
}

function sampleStress(state: GameState, today: StatsToday, day: number): void {
  let sum = 0;
  let count = 0;
  let high = 0;
  for (const person of state.people.values()) {
    if (person.state === 'offscreen') continue;
    sum += person.stress;
    count++;
    if (person.stress >= 50) high++;
  }
  today.stressDay = day;
  today.stress = count ? round1(sum / count) : 0;
  today.stressed = count ? round1((high / count) * 100) : 0;
}

/** Takings by trade on the last tick before settlement clears them. */
function sampleRevenue(state: GameState, today: StatsToday, day: number): void {
  let hotel = 0, food = 0, retail = 0, leisure = 0;
  for (const tenant of state.tenants.values()) {
    if (!tenant.dailyRevenue) continue;
    const trade = tradeOf(tenant.type);
    if (trade === 'hotel') hotel += tenant.dailyRevenue;
    else if (trade === 'food') food += tenant.dailyRevenue;
    else if (trade === 'retail') retail += tenant.dailyRevenue;
    else if (trade === 'leisure') leisure += tenant.dailyRevenue;
  }
  today.revenueDay = day;
  today.revHotel = hotel;
  today.revFood = food;
  today.revRetail = retail;
  today.revLeisure = leisure;
}

function recordDay(state: GameState, stats: StatsState, settledDay: number): void {
  const today = stats.today;
  const counts = { offices: 0, officesVacant: 0, condos: 0, condosVacant: 0, hotelRooms: 0, food: 0, retail: 0, leisure: 0, services: 0 };
  const hotelIds = new Set<number>();
  for (const tenant of state.tenants.values()) {
    const trade = tradeOf(tenant.type);
    if (trade === null) continue;
    if (tenant.state === 'vacant') {
      if (trade === 'office') counts.officesVacant++;
      else if (trade === 'condo') counts.condosVacant++;
    }
    if (tenant.state !== 'open') continue;
    if (trade === 'office') counts.offices++;
    else if (trade === 'condo') counts.condos++;
    else if (trade === 'hotel') { counts.hotelRooms++; hotelIds.add(tenant.id); }
    else counts[trade]++;
  }
  let booked = 0;
  if (hotelIds.size > 0) {
    const seen = new Set<number>();
    for (const person of state.people.values()) {
      if (person.kind === 'hotelGuest' && hotelIds.has(person.tenantId) && !seen.has(person.tenantId)) {
        seen.add(person.tenantId);
        booked++;
      }
    }
  }
  const money = state.money;
  const stressTaken = today.stressDay >= 0;
  const revenueTaken = today.revenueDay >= 0;
  stats.days.push({
    day: settledDay,
    span: 1,
    pop: population(state),
    funds: money.balanceCents,
    income: money.dailyIncomeCents,
    upkeep: money.dailyUpkeepCents,
    net: money.dailyIncomeCents - money.dailyUpkeepCents,
    stars: state.starLevel,
    stress: stressTaken ? today.stress : 0,
    stressed: stressTaken ? today.stressed : 0,
    giveUps: today.giveUps,
    waitPeak: today.waitPeak,
    waitAvg: today.samples ? round1(today.waitSum / today.samples) : 0,
    util: today.samples ? round1((today.utilSum / today.samples) * 100) : 0,
    ...counts,
    hotelOcc: counts.hotelRooms ? round1((booked / counts.hotelRooms) * 100) : 0,
    revHotel: revenueTaken ? today.revHotel : 0,
    revFood: revenueTaken ? today.revFood : 0,
    revRetail: revenueTaken ? today.revRetail : 0,
    revLeisure: revenueTaken ? today.revLeisure : 0,
  });
  compactStats(stats);
}

/** Merge consecutive samples (oldest first) into one bucket. */
export function mergeSamples(samples: readonly StatsSample[]): StatsSample {
  const last = samples[samples.length - 1]!;
  const span = samples.reduce((total, s) => total + s.span, 0);
  const merged = { day: last.day, span } as StatsSample;
  for (const field of FIELDS) {
    if (MERGE[field] === 'last') merged[field] = last[field];
    else merged[field] = round1(samples.reduce((total, s) => total + s[field] * s.span, 0) / span);
  }
  return merged;
}

const quarterIndex = (day: number): number => Math.floor((day - 1) / CONFIG.QUARTER_DAYS);
const yearIndex = (day: number): number => Math.floor((day - 1) / (CONFIG.QUARTER_DAYS * 4));

/** Move the oldest group (same calendar period as the oldest sample) out of `from`. */
function rollOver(from: StatsSample[], to: StatsSample[], period: (day: number) => number): void {
  const key = period(from[0]!.day);
  let n = 0;
  while (n < from.length && period(from[n]!.day) === key) n++;
  to.push(mergeSamples(from.splice(0, n)));
}

/** Keep history bounded: days → quarters → years → coarser years. */
export function compactStats(stats: StatsState): void {
  while (stats.days.length > STATS_LIMITS.DAILY_KEEP) rollOver(stats.days, stats.quarters, quarterIndex);
  while (stats.quarters.length > STATS_LIMITS.QUARTER_KEEP) rollOver(stats.quarters, stats.years, yearIndex);
  if (stats.years.length > STATS_LIMITS.YEAR_KEEP) {
    // Halve the oldest tier's resolution (pairs of buckets).
    const halved: StatsSample[] = [];
    for (let i = 0; i < stats.years.length; i += 2) halved.push(mergeSamples(stats.years.slice(i, i + 2)));
    stats.years = halved;
  }
}

/** Every recorded point, oldest first, coarse buckets before daily ones. */
export function statsHistory(stats: StatsState | undefined): StatsSample[] {
  if (!stats) return [];
  return [...stats.years, ...stats.quarters, ...stats.days];
}
