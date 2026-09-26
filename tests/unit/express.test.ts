import { describe, expect, it } from 'vitest';
import {
  buildFloor,
  checkRouting,
  deserializeGame,
  elevatorPlacementError,
  placeElevatorGroup,
  placeTenant,
  pickupRoute,
  pressCall,
  rebuildRouting,
  serializeGame,
  tick,
} from '../../src/sim';
import { newTestGame } from '../helpers/simHarness';
import { setElevatorStop } from '../../src/sim/elevators';

/**
 * A tall tower: floors 1..40, sky lobbies on 15 and 30, standard shafts
 * (1..15 at col 10, 15..30 at col 20, 30..40 at col 30), express 1..40
 * through the sky lobbies at col 45.
 */
function tallTower(): ReturnType<typeof newTestGame> {
  const state = newTestGame();
  state.starLevel = 5;
  state.money.balanceCents = 20_000_000_00; // $20M builds a 40-floor tower
  for (let i = 2; i <= 40; i++) buildFloor(state, i);
  placeTenant(state, 'skyLobby', 15, 44);
  placeTenant(state, 'skyLobby', 30, 44);
  placeElevatorGroup(state, 1, 15, 10);
  placeElevatorGroup(state, 15, 30, 20);
  placeElevatorGroup(state, 30, 40, 30);
  placeElevatorGroup(state, 1, 40, 44, 'express');
  rebuildRouting(state);
  return state;
}

describe('express elevators', () => {
  it('must run through each sky lobby in its span', () => {
    const state = tallTower();
    // Columns missing the sky lobbies at 44-46 are rejected.
    expect(elevatorPlacementError(state, 1, 40, 55, 'express')).toBe(
      'The express shaft must run through the sky lobby',
    );
    expect(elevatorPlacementError(state, 1, 40, 50, 'express')).toBe(
      'The express shaft must run through the sky lobby',
    );
    // Existing columns are occupied (44 shares a cell with the 45 shaft).
    expect(elevatorPlacementError(state, 1, 40, 10, 'express')).toBe(
      'An elevator is already here',
    );
    expect(elevatorPlacementError(state, 1, 40, 44, 'express')).toBe(
      'An elevator is already here',
    );
    expect(elevatorPlacementError(state, 1, 40, 44, 'express')).toBe('An elevator is already here');
  });

  it('a valid express shaft runs through the sky lobby without touching its cells', () => {
    const state = newTestGame();
    state.starLevel = 5;
    state.money.balanceCents = 20_000_000_00;
    for (let i = 2; i <= 16; i++) buildFloor(state, i);
    placeTenant(state, 'skyLobby', 15, 44);
    expect(elevatorPlacementError(state, 1, 16, 44, 'express')).toBeNull();
    const group = placeElevatorGroup(state, 1, 16, 44, 'express');
    expect(group.stops).toEqual([1, 15]);
    // The sky lobby's cells stay its own (scaffold while constructing).
    const f15 = state.tower.floors.find((f) => f.index === 15)!;
    expect(f15.cells[44]!.content).toBe('scaffold');
    expect(f15.cells[45]!.content).toBe('scaffold');
  });

  it('stops only at the lobby and sky lobbies', () => {
    const state = tallTower();
    const express = [...state.elevatorGroups.values()].find((g) => g.kind === 'express')!;
    expect(express.stops).toEqual([1, 15, 30]);
    // Routing tables register the express only at its stops.
    expect(state.routing.groupsServing.get(5)).not.toContain(express.id);
    expect(state.routing.groupsServing.get(15)).toContain(express.id);
    expect(state.routing.groupsServing.get(30)).toContain(express.id);
  });

  it('never answers a call on a non-stop floor', () => {
    const state = tallTower();
    const express = [...state.elevatorGroups.values()].find((g) => g.kind === 'express')!;
    pressCall(state, 5, 'up'); // no group serves floor 5 but the express spans it
    const car = express.cars[0]!;
    for (let i = 0; i < 100; i++) tick(state);
    expect(car.state).toBe('idle');
    expect(car.targetFloor).toBeNull();
  });

  it('rides non-stop between sky lobbies', () => {
    const state = tallTower();
    const route = pickupRoute(state, 15, 30, 'officeWorker');
    expect(route).toHaveLength(1);
    expect(route?.[0]).toMatchObject({ mode: 'elevator', from: 15, to: 30 });
  });

  it('sky-lobby transfer connects floors a single shaft cannot span', () => {
    const state = tallTower();
    // 10 → 25: shaft A reaches 15 from 10, shaft B takes over at the sky lobby.
    const route = pickupRoute(state, 10, 25, 'officeWorker');
    expect(route).toHaveLength(2);
    expect(route?.[0]).toMatchObject({ mode: 'elevator', from: 10, to: 15, dir: 1 });
    expect(route?.[1]).toMatchObject({ mode: 'elevator', from: 15, to: 25, dir: 1 });
  });

  it('express + sky-lobby transfer: lobby to a far local floor', () => {
    const state = tallTower();
    // 1 → 35: express 1→30, then the local shaft 30→35.
    const express = [...state.elevatorGroups.values()].find((g) => g.kind === 'express')!;
    const route = pickupRoute(state, 1, 35, 'officeWorker');
    expect(route).toHaveLength(2);
    expect(route?.[0]).toMatchObject({ mode: 'elevator', from: 1, to: 30, groupId: express.id });
    expect(route?.[1]).toMatchObject({ mode: 'elevator', from: 30, to: 35, dir: 1 });
  });

  it('rejects more than one elevator change, as specified in the original manual', () => {
    const state = tallTower();
    // 10 → 35 needs changes at both 15 and 30, exceeding the original limit.
    expect(pickupRoute(state, 10, 35, 'officeWorker')).toBeNull();
    expect(pickupRoute(state, 35, 10, 'officeWorker')).toBeNull();
  });

  it('keeps express stops fixed without mutating routes or saves on rejection', () => {
    const state = tallTower();
    const express = [...state.elevatorGroups.values()].find(g => g.kind === 'express')!;
    const before = serializeGame(state);
    expect(() => setElevatorStop(state, express.id, 15, false)).toThrow('Express elevator stops cannot be disabled');
    expect(serializeGame(state)).toBe(before);
    expect(() => setElevatorStop(state, express.id, 5, true)).toThrow('cannot stop');
    setElevatorStop(state, express.id, 15, true); // Already enabled is a no-op.
    expect(serializeGame(state)).toBe(before);
  });

  it('preserves legacy disabled express stops on load and permits restoring them', () => {
    let state = tallTower();
    const id = [...state.elevatorGroups.values()].find(g => g.kind === 'express')!.id;
    const legacy = state.elevatorGroups.get(id)!;
    legacy.disabledStops = [30]; legacy.stops = [1, 15];
    rebuildRouting(state);
    state = deserializeGame(serializeGame(state));
    expect(state.elevatorGroups.get(id)!.stops).toEqual([1, 15]);
    expect(pickupRoute(state, 1, 35, 'officeWorker')).toBeNull();
    setElevatorStop(state, id, 30, true);
    checkRouting(state);
    expect(pickupRoute(state, 1, 35, 'officeWorker')).toHaveLength(2);
    expect(() => setElevatorStop(state, id, 30, false)).toThrow('cannot be disabled');
    expect(deserializeGame(serializeGame(state)).elevatorGroups.get(id)!.stops).toEqual([1, 15, 30]);
  });
});
