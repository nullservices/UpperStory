import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/data/config';
import {
  buildFloor,
  deserializeGame,
  placeElevatorGroup,
  placeTenant,
  placementError,
  population,
  rebuildRouting,
  serializeGame,
  stepDailySettlement,
  stepEvaluation,
  tick,
  type GameState,
  type TenantType,
} from '../../src/sim';
import { deckTicketDollars, gymHours, leisureFeeCents } from '../../src/sim/leisure';
import { apartmentQuarterRentCents } from '../../src/sim/money';
import { noisePenalty } from '../../src/sim/noise';
import { newTestGame, setClock, tickN } from '../helpers/simHarness';

function fixture(top = 10): GameState {
  const state = newTestGame(33);
  state.starLevel = 5;
  state.money.balanceCents = 100_000_000_00;
  for (let f = 2; f <= top; f++) buildFloor(state, f);
  const group = placeElevatorGroup(state, 1, top, 10);
  for (const car of group.cars) car.breakdownAtTick = Number.MAX_SAFE_INTEGER;
  rebuildRouting(state);
  return state;
}
function build(state: GameState, type: TenantType, floor: number, x: number) {
  const tenant = placeTenant(state, type, floor, x);
  if (tenant.state === 'constructing') {
    tenant.constructionTicksLeft = 1;
    tick(state);
  }
  return tenant;
}
/** Jump to 07:00 on the next weekday (every third day is the weekend). */
function tickUntil(state: GameState, minute: number): void {
  while (state.calendar.minuteOfDay < minute) tick(state);
}
function toWeekdayMorning(state: GameState): void {
  state.calendar.day += state.calendar.day % 3 === 2 ? 2 : 1;
  setClock(state, 420);
}

describe('apartments', () => {
  it('house three residents and pay quarterly rent in daily shares by pricing tier', () => {
    const state = fixture();
    const apt = build(state, 'apartment', 3, 30);
    expect(apt.state).toBe('open');
    expect([...state.people.values()].filter(p => p.tenantId === apt.id && p.kind === 'resident')).toHaveLength(3);
    expect(apt.sold).toBeUndefined();
    const income = (): number => {
      for (const t of state.tenants.values()) if (t.id !== apt.id) t.state = 'damaged';
      stepDailySettlement(state, 1);
      return state.money.dailyIncomeCents;
    };
    const average = income();
    expect(average).toBe(Math.floor(apartmentQuarterRentCents(apt) / CONFIG.QUARTER_DAYS));
    expect(apartmentQuarterRentCents(apt)).toBe(CONFIG.APARTMENT_QUARTER_RENT_DOLLARS * 100);
    apt.pricing = 3;
    expect(income()).toBeGreaterThan(average);
  });

  it('go vacant when unhappy (rent stops) and refill when conditions recover', () => {
    const state = fixture();
    const apt = build(state, 'apartment', 3, 30);
    for (let d = 0; d < CONFIG.EVAL_VACANCY_DAYS; d++) {
      for (const p of state.people.values()) if (p.tenantId === apt.id) p.dayStress = 300;
      stepEvaluation(state);
    }
    expect(apt.state).toBe('vacant');
    expect([...state.people.values()].some(p => p.tenantId === apt.id)).toBe(false);
    stepDailySettlement(state, 1);
    for (let d = 0; d < CONFIG.EVAL_REPOPULATE_DAYS; d++) stepEvaluation(state);
    expect(apt.state).toBe('open');
    expect([...state.people.values()].filter(p => p.tenantId === apt.id)).toHaveLength(3);
  });

  it('hear a nearby bar', () => {
    const state = fixture();
    const apt = build(state, 'apartment', 3, 30);
    expect(noisePenalty(state, apt)).toBe(0);
    build(state, 'bar', 3, 50);
    expect(noisePenalty(state, apt)).toBeGreaterThan(0);
    const hotel = build(state, 'hotel', 4, 70);
    expect(noisePenalty(state, hotel)).toBeGreaterThan(0);
  });
});

describe('gym', () => {
  it('opens before and after work on weekdays, all day at weekends', () => {
    const state = fixture();
    toWeekdayMorning(state);
    const at = (m: number) => { setClock(state, m); return gymHours(state); };
    expect(at(450)).toEqual({ open: true, workers: true });
    expect(at(720).open).toBe(false);
    expect(at(1140)).toEqual({ open: true, workers: false });
    expect(at(1300).open).toBe(false);
    while (state.calendar.day % 3 !== 0) tick(state);
    expect(at(800).open).toBe(true);
  });

  it('residents and office workers work out in the morning and pay per visit', () => {
    const state = fixture();
    const gym = build(state, 'gym', 6, 16);
    for (let f = 2; f <= 5; f++) build(state, 'office', f, 16);
    build(state, 'apartment', 7, 16);
    build(state, 'condo', 8, 16);
    toWeekdayMorning(state);
    const kinds = new Set<string>();
    for (let i = 0; i < 160; i++) {
      tick(state);
      for (const p of state.people.values()) if (p.activityTenantId === gym.id) kinds.add(p.kind);
    }
    expect(kinds.has('officeWorker')).toBe(true);
    expect(kinds.has('resident')).toBe(true);
    expect(gym.visitsToday ?? 0).toBeGreaterThan(0);
    expect(gym.dailyRevenue).toBe((gym.visitsToday ?? 0) * CONFIG.GYM_FEE_DOLLARS * 100);
    // Morning members still get to work.
    tickN(state, 700); // well into the working day
    const workers = [...state.people.values()].filter(p => p.kind === 'officeWorker');
    expect(workers.filter(p => p.state === 'inTenant' && p.activityTenantId < 0).length).toBeGreaterThan(workers.length * 0.8);
  });

  it('some workers stop at the gym on their way home, then leave the tower', () => {
    const state = fixture();
    const gym = build(state, 'gym', 6, 16);
    for (let f = 2; f <= 5; f++) { build(state, 'office', f, 16); build(state, 'office', f, 26); }
    toWeekdayMorning(state);
    setClock(state, 1075);
    let seen = 0;
    for (let i = 0; i < 100; i++) {
      tick(state);
      seen = Math.max(seen, [...state.people.values()].filter(p => p.kind === 'officeWorker' && p.activityTenantId === gym.id).length);
    }
    expect(seen).toBeGreaterThan(0);
    tickN(state, CONFIG.GYM_VISIT_TICKS + 400);
    expect([...state.people.values()].filter(p => p.kind === 'officeWorker').every(p => p.state === 'offscreen')).toBe(true);
  });
});

describe('supermarket and bar', () => {
  it('residents, hotel guests and neighbours shop in the daytime', () => {
    const state = fixture();
    const market = build(state, 'supermarket', 2, 60);
    build(state, 'apartment', 4, 30);
    build(state, 'hotelTwin', 5, 30);
    toWeekdayMorning(state);
    setClock(state, 700);
    const kinds = new Set<string>();
    for (let i = 0; i < 900; i++) {
      tick(state);
      if (i % 5 === 0) for (const p of state.people.values()) if (p.activityTenantId === market.id) kinds.add(p.kind);
    }
    expect(kinds.has('resident')).toBe(true);
    expect(kinds.has('shopper')).toBe(true);
    expect(market.dailyRevenue).toBe((market.visitsToday ?? 0) * CONFIG.SUPERMARKET_FEE_DOLLARS * 100);
    // Neighbourhood shoppers count toward population like shop patrons.
    const before = population(state);
    stepDailySettlement(state, state.calendar.day);
    expect(market.reportedPopulation ?? 0).toBeGreaterThan(0);
    expect(population(state)).toBeGreaterThan(before);
  });

  it('bars fill only in the evening and late night', () => {
    const state = fixture();
    const bar = build(state, 'bar', 3, 60);
    build(state, 'condo', 4, 30);
    toWeekdayMorning(state);
    bar.visitsToday = 0;
    setClock(state, 800);
    tickN(state, 300);
    expect(bar.visitsToday ?? 0).toBe(0);
    setClock(state, 1150);
    tickN(state, 300);
    expect(bar.visitsToday ?? 0).toBeGreaterThan(5);
    expect(bar.dailyRevenue).toBe((bar.visitsToday ?? 0) * CONFIG.BAR_FEE_DOLLARS * 100);
  });

  it('grades venues on a day of visits, not on 15:00 occupancy', () => {
    const state = fixture();
    const bar = build(state, 'bar', 3, 60);
    for (const p of state.people.values()) p.dayStress = 0;
    bar.lastDayVisits = CONFIG.VENUE_TARGET_VISITS.bar;
    stepEvaluation(state);
    expect(bar.grade).toBeGreaterThanOrEqual(4);
    bar.lastDayVisits = 2;
    stepEvaluation(state);
    expect(bar.grade).toBeLessThanOrEqual(1);
  });
});

describe('conference centre', () => {
  it('weekday delegates arrive in the morning, pay, and leave late afternoon', () => {
    const state = fixture();
    const hall = build(state, 'conference', 4, 60);
    toWeekdayMorning(state);
    // Force an event today.
    hall.conferenceDay = state.calendar.day;
    hall.conferenceDelegates = 60;
    hall.externalArrivals = 0;
    setClock(state, 500);
    tickN(state, 250);
    expect(hall.externalArrivals).toBeGreaterThanOrEqual(58); // the last arrive at 10:00
    tickUntil(state, 900);
    const inside = [...state.people.values()].filter(p => p.activityTenantId === hall.id).length;
    expect(inside).toBeGreaterThan(50);
    expect(hall.dailyRevenue).toBe((hall.visitsToday ?? 0) * CONFIG.CONFERENCE_DELEGATE_DOLLARS * 100);
    // By evening they have gone.
    tickN(state, 700); // past 18:00 in real ticks: their stay is counted in ticks
    expect([...state.people.values()].filter(p => p.activityTenantId === hall.id)).toHaveLength(0);
  });

  it('extra hotel demand comes only on event days', () => {
    const run = (delegates: number): number => {
      const state = fixture();
      const hall = build(state, 'conference', 4, 60);
      for (let x = 30; x < 330; x += 20) build(state, 'hotel', 6, x);
      toWeekdayMorning(state);
      hall.conferenceDay = state.calendar.day;
      hall.conferenceDelegates = delegates;
      hall.externalArrivals = delegates;
      setClock(state, CONFIG.CONFERENCE_HOTEL_START_MIN);
      const firstNew = state.nextEntityId;
      state.campaign.weather = 'clear';
      const saved = CONFIG.HOTEL_GUEST_SPAWN_RATE;
      (CONFIG as { HOTEL_GUEST_SPAWN_RATE: number }).HOTEL_GUEST_SPAWN_RATE = 0;
      try {
        tickN(state, 400);
      } finally {
        (CONFIG as { HOTEL_GUEST_SPAWN_RATE: number }).HOTEL_GUEST_SPAWN_RATE = saved;
      }
      return [...state.people.values()].filter(p => p.kind === 'hotelGuest' && p.id >= firstNew).length;
    };
    expect(run(0)).toBe(0);
    expect(run(80)).toBeGreaterThan(3);
  });
});

describe('observation deck', () => {
  it('is roof only, limited to one, and prices tickets by height', () => {
    const state = fixture(12);
    expect(placementError(state, 'observationDeck', 6, 100)).toContain('Roof only');
    expect(placementError(state, 'observationDeck', 12, 100)).toBeNull();
    const deck = build(state, 'observationDeck', 12, 100);
    expect(placementError(state, 'observationDeck', 12, 200)).toContain('Maximum 1');
    expect(deckTicketDollars(0)).toBe(CONFIG.DECK_TICKET_DOLLARS);
    expect(deckTicketDollars(50)).toBe(CONFIG.DECK_TICKET_DOLLARS * 2);
    expect(leisureFeeCents(deck)).toBe(Math.round(deckTicketDollars(12) * 100));
    deck.pricing = 3;
    expect(leisureFeeCents(deck)).toBeGreaterThan(Math.round(deckTicketDollars(12) * 100));
  });

  it('draws tourists through the day and counts them as population', () => {
    const state = fixture(12);
    const deck = build(state, 'observationDeck', 12, 16);
    toWeekdayMorning(state);
    state.campaign.weather = 'clear';
    setClock(state, 800);
    tickN(state, 800);
    expect(deck.visitsToday ?? 0).toBeGreaterThan(10);
    expect(deck.dailyRevenue).toBe((deck.visitsToday ?? 0) * Math.round(deckTicketDollars(12) * 100));
    stepDailySettlement(state, state.calendar.day);
    expect(deck.reportedPopulation).toBeGreaterThan(10);
    expect(deck.lastDayVisits).toBeGreaterThan(10);
  });
});

describe('saves', () => {
  it('round-trip the new facilities and their counters', () => {
    const state = fixture(12);
    const types: TenantType[] = ['apartment', 'gym', 'supermarket', 'bar', 'conference'];
    types.forEach((type, i) => build(state, type, 2 + i, 60));
    const deck = build(state, 'observationDeck', 12, 100);
    const hall = [...state.tenants.values()].find(t => t.type === 'conference')!;
    hall.conferenceDay = state.calendar.day;
    hall.conferenceDelegates = 55;
    deck.lastDayVisits = 77;
    tickN(state, 50);
    const restored = deserializeGame(serializeGame(state));
    expect(serializeGame(restored)).toBe(serializeGame(state));
    expect(restored.tenants.get(hall.id)!.conferenceDelegates).toBe(55);
    expect(restored.tenants.get(deck.id)!.lastDayVisits).toBe(77);
    tickN(restored, 50);
    tickN(state, 50);
    expect(serializeGame(restored)).toBe(serializeGame(state));
  });
});
