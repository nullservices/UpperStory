import { expect, it } from 'vitest';
import { buildFloor, deserializeGame, placeTenant, serializeGame } from '../../src/sim';
import { spawnTenantPeople, stepPeople } from '../../src/sim/people';
import { newTestGame, setClock } from '../helpers/simHarness';

function fixture() {
  const state = newTestGame(); state.starLevel = 5; buildFloor(state, 2);
  const office = placeTenant(state, 'housekeeping', 2, 20); office.state = 'open';
  const hotel = placeTenant(state, 'hotel', 2, 50); hotel.state = 'open'; hotel.cleanliness = 99.5;
  const next = placeTenant(state, 'hotel', 2, 60); next.state = 'open'; next.cleanliness = 20;
  spawnTenantPeople(state, office);
  const p = [...state.people.values()][0]!;
  state.people.clear(); state.people.set(p.id, p);
  Object.assign(p, { state: 'cleaning', scheduleDone: true, roomsCleanedToday: 18,
    activityTenantId: hotel.id, stairsTicksLeft: 100, pos: { floor: 2, x: 51 } });
  setClock(state, 600);
  return { state, p, hotel, next };
}

it('finishes room nineteen, returns home and leaves further jobs for another cleaner', () => {
  const { state, p, hotel, next } = fixture();
  stepPeople(state);
  expect(hotel.cleanliness).toBe(100);
  expect(p.roomsCleanedToday).toBe(19);
  expect(p.activityTenantId).toBe(-1);
  expect(p.endState).toBe('inTenant');
  const restored = deserializeGame(serializeGame(state));
  for (let i = 0; i < 250; i++) { stepPeople(state); stepPeople(restored); }
  expect(next.cleanliness).toBe(20);
  expect(p.roomsCleanedToday).toBe(19);
  expect(serializeGame(restored)).toBe(serializeGame(state));
});

it.each(['damaged', 'timeout', 'already-clean'] as const)('does not count a %s job as a completed cleaning', reason => {
  const { state, p, hotel } = fixture();
  if (reason === 'damaged') hotel.state = 'damaged';
  if (reason === 'timeout') { hotel.cleanliness = 10; p.stairsTicksLeft = 1; }
  if (reason === 'already-clean') hotel.cleanliness = 100;
  stepPeople(state);
  expect(p.roomsCleanedToday).toBe(18);
});

it('resets at the next operating day and resumes work, including old saves without a counter', () => {
  const { state, p } = fixture();
  p.roomsCleanedToday = 19; p.state = 'inTenant'; p.activityTenantId = -1;
  state.calendar.day++;
  setClock(state, 600);
  stepPeople(state);
  expect(p.roomsCleanedToday).toBe(0);
  expect(p.activityTenantId).toBeGreaterThanOrEqual(0);
  delete p.roomsCleanedToday;
  const restored = deserializeGame(serializeGame(state));
  expect(restored.people.get(p.id)!.roomsCleanedToday).toBeUndefined();
  stepPeople(restored);
  expect(restored.people.get(p.id)!.failedTripsToday).toBe(0);
});
