import { describe, expect, it } from 'vitest';
import { buildElevator, elevatorBuildPlan } from '../../src/game/elevatorBuild';
import { buildFloor, getFloor, placeStair, placeTenant, rebuildRouting } from '../../src/sim';
import { newTestGame } from '../helpers/simHarness';

describe('transport construction gestures', () => {
  it('clicks the lobby to build a lift without replacing the lobby', () => {
    const state = newTestGame();
    buildFloor(state, 2);
    const lobby = structuredClone(getFloor(state.tower, 1)!.cells);
    buildElevator(state, 1, 1, 10, 'standard');
    expect([...state.elevatorGroups.values()][0]!.stops).toEqual([1, 2]);
    expect(getFloor(state.tower, 1)!.cells).toEqual(lobby);
    expect(() => buildElevator(state, 1, 2, 9, 'standard')).toThrow('already here');
  });

  it('extends from either shaft cell while moving and charges only new floors', () => {
    const state = newTestGame();
    for (let floor = 2; floor <= 5; floor++) buildFloor(state, floor);
    buildElevator(state, 1, 3, 10, 'standard');
    const group = [...state.elevatorGroups.values()][0]!;
    const car = group.cars[0]!;
    Object.assign(car, { state: 'moving', y: 1.5, targetFloor: 3, dir: 1 });
    const beforeCar = structuredClone(car);
    const funds = state.money.balanceCents;
    const plan = elevatorBuildPlan(state, 2, 5, 11, 'standard');
    expect(plan).toMatchObject({ lo: 1, hi: 5, x: 10, groupId: group.id, error: null });
    buildElevator(state, 2, 5, 11, 'standard');
    expect(state.elevatorGroups.size).toBe(1);
    expect(state.money.balanceCents).toBe(funds - 2 * 500 * 100);
    expect(car).toEqual(beforeCar);
    expect(group.stops).toEqual([1, 2, 3, 4, 5]);
    rebuildRouting(state);
    expect(state.routing.groupsServing.get(5)).toContain(group.id);
    buildElevator(state, 2, 5, 11, 'standard');
    expect(state.money.balanceCents).toBe(funds - 2 * 500 * 100);
  });

  it('rejects blocked, unaffordable and mismatched extensions without mutations', () => {
    const state = newTestGame();
    for (let floor = 2; floor <= 4; floor++) buildFloor(state, floor);
    buildElevator(state, 1, 2, 10, 'standard');
    const group = [...state.elevatorGroups.values()][0]!;
    placeTenant(state, 'office', 4, 10);
    const before = structuredClone(group);
    const funds = state.money.balanceCents;
    expect(() => buildElevator(state, 2, 4, 10, 'standard')).toThrow('occupied');
    expect(group).toEqual(before);
    expect(state.money.balanceCents).toBe(funds);
    state.money.balanceCents = 0;
    expect(() => buildElevator(state, 2, 3, 10, 'standard')).toThrow('funds');
    expect(() => buildElevator(state, 2, 3, 10, 'service')).toThrow('matching');
    expect(group).toEqual(before);
  });

  it('clicks new space immediately above a shaft to extend it one floor', () => {
    const state = newTestGame();
    for (let floor = 2; floor <= 3; floor++) buildFloor(state, floor);
    buildElevator(state, 1, 2, 10, 'standard');
    buildElevator(state, 3, 3, 10, 'standard');
    expect(state.elevatorGroups.size).toBe(1);
    expect([...state.elevatorGroups.values()][0]!.serviceHi).toBe(3);
  });

  it('builds stairs from the lobby without overwriting it or charging twice', () => {
    const state = newTestGame();
    expect(() => placeStair(state, 1, 4)).toThrow('Build this floor first');
    buildFloor(state, 2);
    const lobby = structuredClone(getFloor(state.tower, 1)!.cells);
    const funds = state.money.balanceCents;
    placeStair(state, 1, 4);
    expect(getFloor(state.tower, 2)!.cells[4]!.content).toBe('stair');
    expect(getFloor(state.tower, 1)!.cells).toEqual(lobby);
    expect(() => placeStair(state, 2, 4)).toThrow('occupied');
    expect(state.money.balanceCents).toBe(funds - 1000 * 100);
  });
});
