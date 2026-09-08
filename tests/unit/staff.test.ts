import { describe, expect, it } from 'vitest';
import { placeTenant } from '../../src/sim';
import { newTestGame, scenarioTower, setClock, tickN } from '../helpers/simHarness';

describe('staff', () => {
  it('a guard patrols: leaves the office during the workday and returns by night', () => {
    const state = newTestGame();
    state.starLevel = 5;
    scenarioTower(state);
    placeTenant(state, 'security', 4, 20);
    tickN(state, 2_600 + 160); // construction done, day 2 morning
    const guard = [...state.people.values()].find((p) => p.kind === 'guard');
    expect(guard).toBeDefined();
    // At 11:00 the guard is out on patrol (or heading out).
    setClock(state, 660);
    tickN(state, 500);
    const g = [...state.people.values()].find((p) => p.kind === 'guard')!;
    expect(g.state === 'inTenant' ? g.pos.floor : 1).not.toBe(4);
    expect(g.state).not.toBe('offscreen');
    // By 01:30 (ticking continuously through the evening) the guard is home.
    tickN(state, 2_500 - state.calendar.tickOfDay);
    const g2 = [...state.people.values()].find((p) => p.kind === 'guard')!;
    expect(g2.state).toBe('inTenant');
    expect(g2.pos.floor).toBe(4);
  });

  it('a housekeeper cleans a dirty hotel', () => {
    const state = newTestGame();
    state.starLevel = 5;
    scenarioTower(state);
    placeTenant(state, 'housekeeping', 4, 20);
    const hotel = placeTenant(state, 'hotel', 4, 40);
    tickN(state, 2_600 + 160); // day 2 morning
    const housekeeper = [...state.people.values()].find((p) => p.kind === 'housekeeper');
    expect(housekeeper).toBeDefined();

    // Dirty the hotel, then run a full workday (08:00 → 19:00).
    hotel.cleanliness = 50;
    setClock(state, 480);
    tickN(state, 2_200);
    expect(hotel.cleanliness).toBeGreaterThan(50);
  });

  it('housekeepers skip clean hotels', () => {
    const state = newTestGame();
    state.starLevel = 5;
    scenarioTower(state);
    placeTenant(state, 'housekeeping', 4, 20);
    const hotel = placeTenant(state, 'hotel', 4, 40);
    tickN(state, 2_600 + 160);
    hotel.cleanliness = 100;
    setClock(state, 480);
    tickN(state, 2_000);
    expect(hotel.cleanliness).toBe(100);
  });
});
