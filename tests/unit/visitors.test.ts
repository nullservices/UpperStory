import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/data/config';
import { placeTenant } from '../../src/sim';
import { newTestGame, scenarioTower, setClock, tickN } from '../helpers/simHarness';

/**
 * A tower with everything built and open on day 2: restaurants, a hotel,
 * a shop — ready for visitors.
 */
function livelyTower(): ReturnType<typeof newTestGame> {
  const state = newTestGame(7);
  state.starLevel = 5; // M3: unlock everything by hand (M4 makes it real)
  scenarioTower(state);
  placeTenant(state, 'restaurant', 4, 20);
  placeTenant(state, 'fastfood', 4, 40);
  placeTenant(state, 'shop', 5, 20);
  placeTenant(state, 'hotel', 5, 40);
  // Construction finishes by day 2 morning.
  tickN(state, 2_600 + 160);
  return state;
}

describe('external visitors', () => {
  it('diners flood in at lunch, eat, pay, and leave', () => {
    const state = livelyTower();
    setClock(state, 720); // 12:00 — the rush begins
    tickN(state, 300); // into the rush (lunch hour = 800 ticks)
    const diners = [...state.people.values()].filter((p) => p.kind === 'diner');
    expect(diners.length).toBeGreaterThan(0);
    const restaurant = [...state.tenants.values()].find((t) => t.type === 'restaurant')!;
    const fastfood = [...state.tenants.values()].find((t) => t.type === 'fastfood')!;
    expect(restaurant.dailyRevenue + fastfood.dailyRevenue).toBeGreaterThan(0);

    // Past the rush plus eating time, most diners have finished and left.
    tickN(state, 2_000);
    const later = [...state.people.values()].filter((p) => p.kind === 'diner');
    expect(later.length).toBeLessThan(diners.length + 5);
  });

  it('shoppers visit shops during the day', () => {
    const state = livelyTower();
    setClock(state, 660); // 11:00
    tickN(state, 800);
    const shoppers = [...state.people.values()].filter((p) => p.kind === 'shopper');
    expect(shoppers.length).toBeGreaterThan(0);
    const shop = [...state.tenants.values()].find((t) => t.type === 'shop')!;
    expect(shop.dailyRevenue).toBeGreaterThan(0);
  });

  it('hotel guests check in, pay at checkout, and leave next day', () => {
    const state = livelyTower();
    setClock(state, 1200); // 20:00 — evening check-ins
    tickN(state, 600);
    const hotel = [...state.tenants.values()].find((t) => t.type === 'hotel')!;
    expect(hotel.occupancy).toBeGreaterThan(0);
    const eveningGuests = [...state.people.values()].filter((p) => p.kind === 'hotelGuest');
    expect(eveningGuests.length).toBeGreaterThan(0);
    const eveningDay = eveningGuests[0]!.dayTracked;

    // Next day at 12:58: checkout is long done — every guest who checked in
    // yesterday is gone (new arrivals keep checking in through the day).
    tickN(state, CONFIG.DAY_TICKS - state.calendar.tickOfDay + 1_180);
    const staleGuests = [...state.people.values()].filter(
      (p) => p.kind === 'hotelGuest' && p.dayTracked === eveningDay,
    );
    expect(staleGuests).toHaveLength(0);
    expect(hotel.dailyRevenue).toBeGreaterThan(0);
  });

  it('a dirty hotel stresses its guests', () => {
    const state = livelyTower();
    setClock(state, 1200);
    tickN(state, 600);
    const hotel = [...state.tenants.values()].find((t) => t.type === 'hotel')!;
    hotel.cleanliness = CONFIG.DIRTY_HOTEL_THRESHOLD - 1;
    const before = [...state.people.values()]
      .filter((p) => p.kind === 'hotelGuest')
      .map((p) => p.stress);
    tickN(state, 200);
    const after = [...state.people.values()]
      .filter((p) => p.kind === 'hotelGuest')
      .map((p) => p.stress);
    expect(after.reduce((a, b) => a + b, 0)).toBeGreaterThan(
      before.reduce((a, b) => a + b, 0),
    );
  });

  it('no eateries, no diners', () => {
    const state = newTestGame();
    state.starLevel = 5;
    scenarioTower(state); // offices + condo only
    tickN(state, 2_600 + 400);
    const diners = [...state.people.values()].filter((p) => p.kind === 'diner');
    expect(diners).toHaveLength(0);
  });
});
