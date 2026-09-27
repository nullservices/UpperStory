import { expect, it } from 'vitest';
import { buildFloor, deserializeGame, placeTenant, serializeGame } from '../../src/sim';
import { spawnTenantPeople, stepPeople, type Person } from '../../src/sim/people';
import { newTestGame, setClock } from '../helpers/simHarness';

function fixture() {
  const state = newTestGame(); state.starLevel = 5; buildFloor(state, 2);
  const office = placeTenant(state, 'housekeeping', 2, 20); office.state = 'open';
  const hotel = placeTenant(state, 'hotel', 2, 50); hotel.state = 'open'; hotel.cleanliness = 20;
  spawnTenantPeople(state, office);
  const cleaner = [...state.people.values()][0]!;
  state.people.clear(); state.people.set(cleaner.id, cleaner);
  cleaner.jitterTicks = 0; cleaner.scheduleIndex = 0;
  const guest: Person = { ...cleaner, id: state.nextEntityId++, kind: 'hotelGuest',
    tenantId: hotel.id, state: 'inTenant', scheduleDone: true,
    pos: { floor: 2, x: 51 } };
  state.people.set(guest.id, guest);
  setClock(state, 480);
  return { state, hotel, cleaner, guest };
}

it('waits until the guest leaves before assigning housekeeping', () => {
  const { state, cleaner, guest, hotel } = fixture();
  stepPeople(state);
  expect(cleaner.activityTenantId).toBe(-1);
  for (let i = 0; i < 100; i++) stepPeople(state);
  guest.state = 'walking';
  guest.target = { floor: 2, x: 0 };
  setClock(state, 600);
  stepPeople(state);
  expect(cleaner.activityTenantId).toBe(hotel.id);
  expect(cleaner.endState).toBe('cleaning');
});

it.each(['occupied', 'damaged'] as const)('rechecks a %s room before cleaning and releases the assignment across save/load', reason => {
  const { state, cleaner, guest, hotel } = fixture();
  Object.assign(cleaner, { state: 'cleaning', activityTenantId: hotel.id,
    stairsTicksLeft: 100, scheduleDone: true, pos: { floor: 2, x: 51 } });
  if (reason === 'damaged') { hotel.state = 'damaged'; state.people.delete(guest.id); }
  const before = hotel.cleanliness;
  const restored = deserializeGame(serializeGame(state));
  stepPeople(state); stepPeople(restored);
  expect(hotel.cleanliness).toBeLessThanOrEqual(before);
  expect(cleaner.activityTenantId).toBe(-1);
  expect(cleaner.state).not.toBe('cleaning');
  expect(serializeGame(restored)).toBe(serializeGame(state));
});
