import { describe, expect, it } from 'vitest';
import { placeTenant, placeElevatorGroup } from '../../src/sim';
import { removeTenantPeople } from '../../src/sim/people';
import { newTestGame, scenarioTower, setClock, tickN } from '../helpers/simHarness';

describe('staff', () => {
  it('a guard patrols and completes the walk back to the security office', () => {
    const state = newTestGame();
    state.starLevel = 5;
    scenarioTower(state);
    placeElevatorGroup(state, 1, 5, 60, 'service');
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
    // Let the patrol finish, including walking across the wide fixture floor.
    tickN(state, 2_500 - state.calendar.tickOfDay);
    const g2 = [...state.people.values()].find((p) => p.kind === 'guard')!;
    for (let i = 0; i < 4000 && !(g2.state === 'inTenant' && g2.pos.floor === 4); i++) tickN(state, 1);
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
    removeTenantPeople(state, hotel.id);
    hotel.capacity = 0; // Keep new guests from dirtying this room during the check.
    hotel.occupancy = 0;
    hotel.cleanliness = 100;
    setClock(state, 480);
    tickN(state, 2_000);
    expect(hotel.cleanliness).toBe(100);
  });

  it('assigns at most one cleaner from an office to a hotel floor', () => {
    const state = newTestGame(); state.starLevel = 5;
    scenarioTower(state);
    placeTenant(state, 'housekeeping', 4, 20);
    const rooms = [40, 44, 48].map(x => placeTenant(state, 'hotel', 4, x));
    tickN(state, 2600);
    for (const room of rooms) room.cleanliness = 10;
    let simultaneousJobs = 0;
    for (let i = 0; i < 300; i++) {
      tickN(state, 1);
      const jobs = [...state.people.values()].filter(p => p.kind === 'housekeeper' && p.activityTenantId >= 0).map(p => p.activityTenantId);
      expect(new Set(jobs).size).toBe(jobs.length);
      simultaneousJobs = Math.max(simultaneousJobs, jobs.length);
    }
    expect(simultaneousJobs).toBe(1);
    expect(rooms.some(room => room.cleanliness > 10)).toBe(true);
  });

  it.each([false, true])('distributes staff across floors; additional office: %s', extraOffice => {
    const state = newTestGame(); state.starLevel = 5; state.money.balanceCents = 10_000_000_00;
    scenarioTower(state);
    const office = placeTenant(state, 'housekeeping', 4, 20);
    if (extraOffice) placeTenant(state, 'housekeeping', 4, 80);
    placeElevatorGroup(state, 1, 5, 60, 'service');
    const rooms = [4, 5].flatMap(f => [40, 44].map(x => placeTenant(state, 'hotel', f, x)));
    tickN(state, 2600);
    for (const room of rooms) room.cleanliness = 0;
    let maxJobs = 0;
    for (let i = 0; i < 300; i++) {
      tickN(state, 1);
      const jobs = [...state.people.values()].filter(p => p.kind === 'housekeeper' && p.activityTenantId >= 0);
      expect(new Set(jobs.map(p => p.activityTenantId)).size).toBe(jobs.length);
      for (const facility of new Set(jobs.map(p => p.tenantId))) {
        const floors = jobs.filter(p => p.tenantId === facility).map(p => state.tenants.get(p.activityTenantId)!.floor);
        expect(new Set(floors).size).toBe(floors.length);
      }
      maxJobs = Math.max(maxJobs, jobs.length);
    }
    expect(maxJobs).toBe(extraOffice ? 4 : 2);
    expect([...state.people.values()].filter(p => p.tenantId === office.id)).toHaveLength(6);
  });
});
