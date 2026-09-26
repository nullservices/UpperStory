import { expect, it } from 'vitest';
import { buildFloor, deserializeGame, pickupRoute, placeElevatorGroup, placeEscalator,
  placeStair, placeTenant, rebuildRouting, serializeGame } from '../../src/sim';
import { stepElevators } from '../../src/sim/elevators';
import { spawnTenantPeople, stepPeople } from '../../src/sim/people';
import { newTestGame } from '../helpers/simHarness';

function fixture(mode: 'stair' | 'escalator', lobby = true) {
  const state = newTestGame();
  state.starLevel = 5; state.money.balanceCents = 2_000_000_000;
  for (let f = 2; f <= 23; f++) buildFloor(state, f);
  if (lobby) placeTenant(state, 'skyLobby', 15, 44);
  placeElevatorGroup(state, 1, 15, 44, lobby ? 'express' : 'standard');
  if (mode === 'stair') {
    for (let f = 2; f <= 20; f++) placeStair(state, f, 20);
  } else {
    for (let f = 15; f < 23; f++) placeEscalator(state, f, 20, 'up');
  }
  rebuildRouting(state);
  return state;
}

it('connects stairs through a sky lobby in both directions and respects flight limits', () => {
  const state = fixture('stair');
  expect(pickupRoute(state, 1, 17, 'officeWorker')?.map(l => l.mode)).toEqual(['elevator', 'stair', 'stair']);
  expect(pickupRoute(state, 17, 1, 'officeWorker')?.map(l => l.mode)).toEqual(['stair', 'stair', 'elevator']);
  expect(pickupRoute(state, 1, 19, 'officeWorker')).toHaveLength(5);
  expect(pickupRoute(state, 1, 20, 'officeWorker')).toBeNull();
});

it('respects escalator direction and seven-flight limit after an elevator ride', () => {
  const state = fixture('escalator');
  expect(pickupRoute(state, 1, 17, 'officeWorker')?.map(l => l.mode)).toEqual(['elevator', 'escalator', 'escalator']);
  expect(pickupRoute(state, 17, 1, 'officeWorker')).toBeNull();
  expect(pickupRoute(state, 1, 22, 'officeWorker')).toHaveLength(8);
  expect(pickupRoute(state, 1, 23, 'officeWorker')).toBeNull();
});

it.each(['stair', 'escalator'] as const)('does not change from an elevator to %s on an ordinary floor', mode => {
  const state = fixture(mode, false);
  expect(pickupRoute(state, 1, 17, 'officeWorker')).toBeNull();
  expect(pickupRoute(state, 17, 1, 'officeWorker')).toBeNull();
});

it.each([
  ['stair', false], ['stair', true], ['escalator', false],
] as const)('completes a mixed %s journey (return: %s) across a saved transfer', (mode, reverse) => {
  let state = fixture(mode);
  const office = placeTenant(state, 'office', 17, 70);
  spawnTenantPeople(state, office);
  const person = [...state.people.values()][0]!;
  state.people.clear(); state.people.set(person.id, person);
  const from = reverse ? 17 : 1;
  const to = reverse ? 1 : 17;
  Object.assign(person, { state: 'walking', scheduleDone: true,
    pos: { floor: from, x: 60 }, destination: { floor: to, x: 80 },
    route: pickupRoute(state, from, to, person.kind), target: null, legIndex: 0 });
  let saved = false;
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    stepPeople(state); stepElevators(state);
    const p = state.people.get(person.id)!;
    seen.add(p.state);
    if (!saved && p.legIndex > 0 && p.state === 'walking') {
      const loaded = deserializeGame(serializeGame(state));
      stepPeople(state); stepElevators(state);
      stepPeople(loaded); stepElevators(loaded);
      expect(serializeGame(loaded)).toBe(serializeGame(state));
      state = loaded; saved = true;
    }
    if (state.people.get(person.id)!.state === 'inTenant') break;
  }
  expect(saved).toBe(true);
  expect(seen.has('riding')).toBe(true);
  expect(seen.has(mode === 'stair' ? 'onStairs' : 'onEscalator')).toBe(true);
  expect(state.people.get(person.id)).toMatchObject({ state: 'inTenant',
    pos: { floor: to, x: 80 }, failedTripsToday: 0, route: null });
  expect(Object.values(state.queues).flat()).toEqual([]);
});
