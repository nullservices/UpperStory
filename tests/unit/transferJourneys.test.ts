import { expect, it } from 'vitest';
import { CONFIG } from '../../src/data/config';
import {
  buildFloor, deserializeGame, pickupRoute, placeElevatorGroup, placeTenant,
  rebuildRouting, serializeGame,
} from '../../src/sim';
import { setElevatorStop, stepElevators } from '../../src/sim/elevators';
import { spawnTenantPeople, stepPeople } from '../../src/sim/people';
import { callPending, joinQueue, pressCall, queueLength } from '../../src/sim/queues';
import type { GameState } from '../../src/sim/state';
import { newTestGame } from '../helpers/simHarness';

function journey(sky: boolean, reverse: boolean) {
  const state = newTestGame();
  state.starLevel = 5;
  state.money.balanceCents = 2_000_000_000;
  for (let floor = 2; floor <= (sky ? 20 : 5); floor++) buildFloor(state, floor);
  if (sky) {
    placeTenant(state, 'skyLobby', 15, 44);
    placeElevatorGroup(state, 1, 20, 44, 'express');
    placeElevatorGroup(state, 15, 20, 20);
  } else {
    const a = placeElevatorGroup(state, 1, 4, 10);
    const b = placeElevatorGroup(state, 1, 5, 30);
    for (const floor of [2, 3, 4]) setElevatorStop(state, b.id, floor, false);
    expect(a.stops).toContain(3);
  }
  rebuildRouting(state);
  const from = reverse ? (sky ? 20 : 5) : (sky ? 1 : 3);
  const to = reverse ? (sky ? 1 : 3) : (sky ? 20 : 5);
  const office = placeTenant(state, 'office', sky ? 20 : 5, 70);
  spawnTenantPeople(state, office);
  const person = [...state.people.values()][0]!;
  state.people.clear();
  state.people.set(person.id, person);
  Object.assign(person, {
    state: 'walking', scheduleDone: true, pos: { floor: from, x: 60 },
    destination: { floor: to, x: 80 }, endState: 'inTenant',
    route: pickupRoute(state, from, to, person.kind), legIndex: 0, target: null,
  });
  expect(person.route).toHaveLength(2);
  expect(person.route![0]!.to).toBe(sky ? 15 : 1);
  return { state, id: person.id, to };
}

function step(state: GameState) {
  // Isolate transport from daily schedules and new tenant construction.
  stepPeople(state);
  stepElevators(state);
}

it('a full second-shaft queue rejects the transfer without losing existing waiters after load', () => {
  const fixture = journey(true, false);
  let state = fixture.state;
  let reached = false;
  for (let i = 0; i < 1000; i++) {
    step(state);
    const person = state.people.get(fixture.id)!;
    if (person.legIndex === 1 && person.state === 'walking' && person.target &&
        Math.abs(person.pos.x - person.target.x) <= CONFIG.PERSON_WALK_CELLS_PER_TICK) {
      reached = true;
      break;
    }
  }
  expect(reached).toBe(true);
  const person = state.people.get(fixture.id)!;
  const leg = person.route![1]!;
  const dir = leg.dir === 1 ? 'up' : 'down';
  const waitingIds = Array.from({ length: CONFIG.QUEUE_MAX_PER_SIDE }, (_, i) => 1000 + i);
  for (const id of waitingIds) {
    state.people.set(id, { ...person, id, state: 'waiting', waitTicks: 0, target: null });
    expect(joinQueue(state, id, leg.from, dir)).toBe(true);
  }
  pressCall(state, leg.from, dir);
  state = deserializeGame(serializeGame(state));
  stepPeople(state);
  expect(state.people.get(fixture.id)).toMatchObject({ state: 'offscreen', failedTripsToday: 1, route: null });
  expect(queueLength(state, leg.from, dir, leg.groupId)).toBe(40);
  expect(state.queues[`${leg.from}:${dir}`]).toEqual(waitingIds);
  expect(callPending(state, leg.from, dir)).toBe(true);
  expect([...state.elevatorGroups.values()].flatMap(g => g.cars.flatMap(c => c.passengers))).not.toContain(fixture.id);
});

for (const sky of [false, true]) for (const reverse of [false, true]) {
  it(`${sky ? 'sky' : 'ground'} lobby transfer ${reverse ? 'return' : 'outbound'} walks, queues and rides both legs across saves`, () => {
    const fixture = journey(sky, reverse);
    let state = fixture.state;
    const checkpoints = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const before = state.people.get(fixture.id)!;
      const wasFinalWalk = before.state === 'walking' && before.legIndex === 2;
      const previousX = before.pos.x;
      step(state);
      const person = state.people.get(fixture.id)!;
      if (wasFinalWalk) expect(Math.abs(person.pos.x - previousX)).toBeLessThanOrEqual(CONFIG.PERSON_WALK_CELLS_PER_TICK + 1e-9);
      const phase = person.legIndex === 1 ? person.state : person.legIndex === 2 && person.state === 'walking' ? 'finalWalk' : '';
      if (['walking', 'waiting', 'riding', 'finalWalk'].includes(phase) && !checkpoints.has(phase)) {
        const loaded = deserializeGame(serializeGame(state));
        expect(loaded.people.get(fixture.id)).toEqual(person);
        // Resume both versions and compare the next simulation step.
        step(state); step(loaded);
        expect(serializeGame(loaded)).toBe(serializeGame(state));
        state = loaded;
        checkpoints.add(phase);
      }
      if (state.people.get(fixture.id)!.state === 'inTenant') break;
    }
    expect([...checkpoints].sort()).toEqual(['finalWalk', 'riding', 'waiting', 'walking']);
    expect(state.people.get(fixture.id)).toMatchObject({
      state: 'inTenant', pos: { floor: fixture.to, x: 80 }, failedTripsToday: 0,
      route: null, target: null, destination: null,
    });
    expect(Object.values(state.queues).flat()).toEqual([]);
    expect([...state.elevatorGroups.values()].flatMap(group => group.cars.flatMap(car => car.passengers))).toEqual([]);
  });
}
