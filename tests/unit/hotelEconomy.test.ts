import { expect, it } from 'vitest';
import { newTestGame } from '../helpers/simHarness';
import { buildFloor, placeElevatorGroup, placeTenant, serializeGame, deserializeGame, rebuildRouting } from '../../src/sim';
import { spawnVIP, stepPeople } from '../../src/sim/people';
import { hotelCheckoutCents } from '../../src/sim/hotelEconomy';

it.each([['hotel', 1, 2000], ['hotelTwin', 2, 3000], ['hotelSuite', 2, 6000]] as const)(
  '%s collects its room rate through individual checkouts without double payment', (type, guests, roomRate) => {
    let state = newTestGame(); state.starLevel = 5;
    buildFloor(state, 2); placeElevatorGroup(state, 1, 2, 10);
    const room = placeTenant(state, type, 2, 20); room.state = 'open';
    rebuildRouting(state);
    // Use the preferred-room guest spawner so this fixture never depends on random arrivals.
    const ids: number[] = [];
    for (let i = 0; i < guests; i++) {
      state.tickCount++;
      const id = spawnVIP(state, room)!; ids.push(id);
      const person = state.people.get(id)!; person.vip = false;
      Object.assign(person, { state: 'walking', pos: { floor: 1, x: 0 }, target: { floor: 1, x: 0 },
        destination: { floor: 1, x: 0 }, endState: 'offscreen', route: [], legIndex: 0 });
    }
    state = deserializeGame(serializeGame(state));
    stepPeople(state);
    expect(state.tenants.get(room.id)!.dailyRevenue).toBe(roomRate * 100);
    expect(ids.every(id => !state.people.has(id))).toBe(true);
    stepPeople(state);
    expect(state.tenants.get(room.id)!.dailyRevenue).toBe(roomRate * 100);
  },
);

it('prices partial occupancy by guest share and applies the selected price level', () => {
  const state = newTestGame(); state.starLevel = 5; buildFloor(state, 2);
  const room = placeTenant(state, 'hotelTwin', 2, 20);
  expect(hotelCheckoutCents(room)).toBe(1500_00);
  room.pricing = 0; expect(hotelCheckoutCents(room)).toBe(900_00);
  room.pricing = 3; expect(hotelCheckoutCents(room)).toBe(2025_00);
});
