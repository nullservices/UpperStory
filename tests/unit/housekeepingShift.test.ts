import { expect, it } from 'vitest';
import { buildFloor, deserializeGame, placeElevatorGroup, placeTenant, serializeGame, rebuildRouting } from '../../src/sim';
import { spawnTenantPeople, stepPeople } from '../../src/sim/people';
import { stepElevators } from '../../src/sim/elevators';
import { newTestGame, setClock } from '../helpers/simHarness';

function fixture() {
  const state = newTestGame(); state.starLevel = 5;
  buildFloor(state, 2); buildFloor(state, 3);
  const office = placeTenant(state, 'housekeeping', 2, 20); office.state = 'open';
  const hotel = placeTenant(state, 'hotel', 3, 50); hotel.state = 'open'; hotel.cleanliness = 20;
  const group = placeElevatorGroup(state, 1, 3, 40, 'service'); rebuildRouting(state);
  spawnTenantPeople(state, office);
  const p = [...state.people.values()][0]!;
  state.people.clear(); state.people.set(p.id, p);
  p.scheduleIndex = 4; p.jitterTicks = 0;
  return { state, p, hotel, group };
}

it.each([989, 990])('respects the new-job cutoff at minute %i', minute => {
  const { state, p, hotel } = fixture(); setClock(state, minute);
  stepPeople(state);
  expect(p.activityTenantId).toBe(minute < 990 ? hotel.id : -1);
});

it('stops cleaning at 17:00 without finishing or charging a room against the quota', () => {
  const { state, p, hotel } = fixture(); setClock(state, 1019);
  Object.assign(p, { state: 'cleaning', pos: { floor: 3, x: 51 }, activityTenantId: hotel.id,
    stairsTicksLeft: 100, roomsCleanedToday: 4 });
  stepPeople(state); expect(hotel.cleanliness).toBeGreaterThan(20);
  const partial = hotel.cleanliness;
  setClock(state, 1020); stepPeople(state);
  expect(hotel.cleanliness).toBe(partial);
  expect(p.activityTenantId).toBe(-1);
  expect(p.roomsCleanedToday).toBe(4);
  expect(p.destination?.floor).toBe(2);
  expect(p.failedTripsToday).toBe(0);
});

it('finishes an elevator leg before returning home and saves the shift-end transition', () => {
  const { state, p, group, hotel } = fixture(); setClock(state, 1020);
  Object.assign(p, { state: 'riding', legIndex: 0, activityTenantId: hotel.id,
    pos: { floor: 2, x: 40.5 }, endState: 'cleaning', destination: { floor: 3, x: 51 },
    route: [{ mode: 'elevator', from: 2, to: 3, dir: 1, groupId: group.id }] });
  Object.assign(group.cars[0]!, { y: 2, state: 'moving', targetFloor: 3, dir: 1, passengers: [p.id] });
  stepPeople(state);
  expect(p.state).toBe('riding'); expect(group.cars[0]!.passengers).toContain(p.id);
  const restored = deserializeGame(serializeGame(state));
  for (let i = 0; i < 500; i++) {
    stepPeople(state); stepElevators(state); stepPeople(restored); stepElevators(restored);
  }
  expect(p.state).toBe('inTenant'); expect(p.pos.floor).toBe(2);
  expect(p.failedTripsToday).toBe(0); expect(hotel.cleanliness).toBe(20);
  expect(serializeGame(restored)).toBe(serializeGame(state));
  state.calendar.day++; setClock(state, 600); stepPeople(state);
  expect(p.activityTenantId).toBe(hotel.id);
});
