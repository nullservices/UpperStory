import { expect, it } from 'vitest';
import { newTestGame } from '../helpers/simHarness';
import { buildFloor, getFloor, placeTenant, serializeGame, deserializeGame } from '../../src/sim';
import { elevatorPlacementError, placeElevatorGroup, shaftWidth, groupAt, demolishElevatorGroup } from '../../src/sim/elevators';
import { buildElevator, elevatorBuildPlan } from '../../src/game/elevatorBuild';

it.each(['standard', 'service', 'express'] as const)('reserves the entire %s footprint and supports extension from its far edge', kind => {
  const state = newTestGame(); state.starLevel = 5;
  for (let f = 2; f <= 4; f++) buildFloor(state, f);
  const width = kind === 'express' ? 6 : 4;
  expect(elevatorPlacementError(state, 1, 3, 376 - width, kind)).toBe('Does not fit on the floor');
  const group = placeElevatorGroup(state, 1, 3, 10, kind);
  for (let x = 10; x < 10 + width; x++) {
    expect(groupAt(state, 2, x)).toBe(group);
    expect(getFloor(state.tower, 2)!.cells[x]!.content).not.toBe('empty');
  }
  expect(() => placeTenant(state, 'office', 2, 10 + width - 1)).toThrow();
  expect(elevatorPlacementError(state, 1, 3, 10 + width - 1)).toBe('An elevator is already here');
  expect(elevatorBuildPlan(state, 2, 4, 10 + width - 1, kind)).toMatchObject({ x: 10, width, groupId: group.id, error: null });
  buildElevator(state, 2, 4, 10 + width - 1, kind);
  expect(getFloor(state.tower, 4)!.cells[10 + width - 1]!.content).toBe('elevatorShaft');
  expect(shaftWidth(deserializeGame(serializeGame(state)).elevatorGroups.get(group.id)!)).toBe(width);
  demolishElevatorGroup(state, group.id);
  for (const f of [2, 3, 4]) expect(getFloor(state.tower, f)!.cells.slice(10, 10 + width).every(c => c.content === 'empty')).toBe(true);
});

it('keeps legacy shafts narrow beside rooms through loading, extension and demolition', () => {
  const state = newTestGame(); for (let f = 2; f <= 4; f++) buildFloor(state, f);
  const group = placeElevatorGroup(state, 1, 3, 10);
  delete group.widthCells;
  for (const f of [2, 3]) for (const x of [12, 13]) getFloor(state.tower, f)!.cells[x] = { content: 'empty', tenantId: -1 };
  const room = placeTenant(state, 'office', 2, 12);
  const saved = JSON.parse(serializeGame(state)); saved.version = 3;
  const loaded = deserializeGame(JSON.stringify(saved));
  expect(shaftWidth(loaded.elevatorGroups.get(group.id)!)).toBe(2);
  buildElevator(loaded, 2, 4, 11, 'standard');
  expect(getFloor(loaded.tower, 4)!.cells[12]!.content).toBe('empty');
  demolishElevatorGroup(loaded, group.id);
  expect(getFloor(loaded.tower, 2)!.cells[12]!.tenantId).toBe(room.id);
});
