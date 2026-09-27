import { expect, it } from 'vitest';
import { buildFloor, deserializeGame, pickupRoute, placeElevatorGroup, placeTenant,
  rebuildRouting, serializeGame } from '../../src/sim';
import { spawnTenantPeople, stepPeople, type PersonKind } from '../../src/sim/people';
import { stepElevators } from '../../src/sim/elevators';
import { newTestGame, setClock } from '../helpers/simHarness';

function fixture(kind: 'standard' | 'express' = 'standard') {
  const state = newTestGame(); state.starLevel = 5;
  for (let floor = 2; floor <= 5; floor++) buildFloor(state, floor);
  const standard = placeElevatorGroup(state, 1, 5, 10, kind);
  rebuildRouting(state);
  return { state, standard };
}

it.each(['housekeeper', 'guard'] as const)('%s requires service rather than standard cars for a new elevator journey', kind => {
  const { state } = fixture();
  expect(pickupRoute(state, 1, 5, kind)).toBeNull();
  expect(pickupRoute(state, 5, 1, kind)).toBeNull();
  const service = placeElevatorGroup(state, 1, 5, 30, 'service');
  rebuildRouting(state);
  for (const [from, to] of [[1, 5], [5, 1]]) {
    expect(pickupRoute(state, from!, to!, kind)).toEqual([
      { mode: 'elevator', from, to, dir: to! > from! ? 1 : -1, groupId: service.id },
    ]);
  }
});

it.each(['officeWorker', 'resident', 'hotelGuest', 'diner', 'shopper'] satisfies PersonKind[])(
  '%s cannot use a service shaft as a public route', kind => {
    const state = newTestGame(); state.starLevel = 5;
    for (let floor = 2; floor <= 5; floor++) buildFloor(state, floor);
    placeElevatorGroup(state, 1, 5, 30, 'service'); rebuildRouting(state);
    expect(pickupRoute(state, 1, 5, kind)).toBeNull();
    const standard = placeElevatorGroup(state, 1, 5, 10); rebuildRouting(state);
    expect(pickupRoute(state, 1, 5, kind)?.[0]?.groupId).toBe(standard.id);
  },
);

it('does not assign an unreachable hotel until a service shaft connects it', () => {
  const { state } = fixture();
  const office = placeTenant(state, 'housekeeping', 4, 70);
  const hotel = placeTenant(state, 'hotel', 5, 70);
  hotel.state = 'open'; hotel.cleanliness = 0;
  spawnTenantPeople(state, office);
  const staff = [...state.people.values()];
  for (const p of staff) { p.jitterTicks = 0; p.scheduleIndex = 0; }
  setClock(state, 480);
  stepPeople(state);
  expect(staff.every(p => p.activityTenantId === -1)).toBe(true);
  for (let i = 0; i < 100; i++) stepPeople(state);
  placeElevatorGroup(state, 1, 5, 30, 'service'); rebuildRouting(state);
  setClock(state, 600);
  stepPeople(state);
  expect(staff.filter(p => p.activityTenantId === hotel.id)).toHaveLength(1);
});

it.each(['standard', 'express'] as const)('finishes an existing %s-car staff trip loaded from an older save', kind => {
  const fixtureState = fixture(kind);
  const { standard } = fixtureState;
  let state = fixtureState.state;
  const office = placeTenant(state, 'housekeeping', 5, 70);
  spawnTenantPeople(state, office);
  const p = [...state.people.values()][0]!;
  state.people.clear(); state.people.set(p.id, p);
  Object.assign(p, { state: 'riding', scheduleDone: true, pos: { floor: 1, x: 10.5 },
    destination: { floor: 5, x: 70 }, endState: 'inTenant', legIndex: 0,
    route: [{ mode: 'elevator', from: 1, to: 5, dir: 1, groupId: standard.id }] });
  standard.cars[0]!.passengers.push(p.id);
  state = deserializeGame(serializeGame(state));
  for (let i = 0; i < 1500 && state.people.get(p.id)!.state !== 'inTenant'; i++) {
    stepPeople(state); stepElevators(state);
  }
  expect(state.people.get(p.id)).toMatchObject({ state: 'inTenant', pos: { floor: 5, x: 70 }, failedTripsToday: 0 });
  expect(pickupRoute(state, 5, 1, 'housekeeper')).toBeNull();
});

it.each(['housekeeper', 'guard'] as const)('%s cannot use express cars directly or in a sky-lobby transfer', kind => {
  const state = newTestGame(); state.starLevel = 5;
  state.money.balanceCents = 2_000_000_000;
  for (let floor = 2; floor <= 20; floor++) buildFloor(state, floor);
  placeTenant(state, 'skyLobby', 15, 44);
  const express = placeElevatorGroup(state, 1, 20, 44, 'express');
  placeElevatorGroup(state, 15, 20, 70, 'service');
  rebuildRouting(state);
  for (const [from, to] of [[1, 15], [15, 1], [1, 20], [20, 1]] as const) {
    expect(pickupRoute(state, from, to, kind)).toBeNull();
  }
  for (const publicKind of ['officeWorker', 'resident', 'hotelGuest', 'diner', 'shopper'] as const) {
    expect(pickupRoute(state, 1, 15, publicKind)?.[0]?.groupId).toBe(express.id);
    expect(pickupRoute(state, 15, 1, publicKind)?.[0]?.groupId).toBe(express.id);
  }
  const service = placeElevatorGroup(state, 1, 20, 90, 'service');
  rebuildRouting(state);
  expect(pickupRoute(state, 1, 20, kind)?.[0]?.groupId).toBe(service.id);
});
