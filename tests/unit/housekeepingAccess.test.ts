import { expect, it } from 'vitest';
import { buildFloor, placeElevatorGroup, placeTenant } from '../../src/sim';
import { housekeepingAccess } from '../../src/sim/housekeepingAccess';
import { setElevatorStop } from '../../src/sim/elevators';
import { spawnTenantPeople } from '../../src/sim/people';
import { newTestGame } from '../helpers/simHarness';

it('distinguishes missing offices, unfinished offices, missing routes and restored access', () => {
  const state = newTestGame(); state.starLevel = 5;
  for (let f = 2; f <= 5; f++) buildFloor(state, f);
  const hotel = placeTenant(state, 'hotel', 5, 70);
  const office = placeTenant(state, 'housekeeping', 4, 70);
  expect(housekeepingAccess(state, hotel)).toEqual({ openOffices: 0, reachableOffices: 0, assignedCleaners: 0 });
  office.state = 'open';
  placeElevatorGroup(state, 1, 5, 10);
  expect(housekeepingAccess(state, hotel)?.reachableOffices).toBe(0);
  expect(housekeepingAccess(state, hotel)?.openOffices).toBe(1);
  const service = placeElevatorGroup(state, 1, 5, 30, 'service');
  expect(housekeepingAccess(state, hotel)?.reachableOffices).toBe(1);
  setElevatorStop(state, service.id, 5, false);
  expect(housekeepingAccess(state, hotel)?.reachableOffices).toBe(0);
  setElevatorStop(state, service.id, 5, true);
  expect(housekeepingAccess(state, hotel)?.reachableOffices).toBe(1);
  expect(housekeepingAccess(state, office)).toBeUndefined();
});

it('recognizes same-floor access and counts only active assignments to this hotel', () => {
  const state = newTestGame(); state.starLevel = 5;
  buildFloor(state, 2);
  const hotel = placeTenant(state, 'hotel', 2, 70);
  const office = placeTenant(state, 'housekeeping', 2, 30); office.state = 'open';
  spawnTenantPeople(state, office);
  const staff = [...state.people.values()];
  Object.assign(staff[0]!, { activityTenantId: hotel.id, state: 'walking' });
  Object.assign(staff[1]!, { activityTenantId: hotel.id, state: 'cleaning' });
  Object.assign(staff[2]!, { activityTenantId: hotel.id, state: 'offscreen' });
  expect(housekeepingAccess(state, hotel)).toEqual({ openOffices: 1, reachableOffices: 1, assignedCleaners: 2 });
});
