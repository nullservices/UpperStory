import { describe, expect, it } from 'vitest';
import {
  addElevatorCar,
  demolishElevatorGroup,
  elevatorPlacementError,
  placeElevatorGroup,
  placeTenant,
  pressCall,
  removeElevatorCar,
  setElevatorServiceRange,
  tick,
  upgradeCarSpeed,
} from '../../src/sim';
import { newTestGame, scenarioTower } from '../helpers/simHarness';

describe('elevator placement', () => {
  it('places a shaft with shaft+lobby cells on every serviced floor', () => {
    const state = newTestGame();
    scenarioTower(state);
    const before = state.money.balanceCents;
    const group = placeElevatorGroup(state, 1, 5, 40);
    expect(state.money.balanceCents).toBe(before - 200_000 * 100);
    expect(group.serviceLo).toBe(1);
    expect(group.serviceHi).toBe(5);
    expect(group.cars).toHaveLength(1);
    // Floors 2+ get shaft + boarding cells; the lobby floor keeps its cells
    // (shafts pass through it).
    for (let f = 2; f <= 5; f++) {
      const floor = state.tower.floors.find((fl) => fl.index === f)!;
      expect(floor.cells[40]!.content).toBe('elevatorShaft');
      expect(floor.cells[41]!.content).toBe('elevatorLobby');
    }
    const lobbyFloor = state.tower.floors.find((fl) => fl.index === 1)!;
    expect(lobbyFloor.cells[40]!.content).toBe('tenant'); // lobby untouched
  });

  it('rejects invalid shafts with reasons', () => {
    const state = newTestGame();
    scenarioTower(state);
    // no floors
    expect(elevatorPlacementError(state, 8, 10, 5)).toBe('Build the floors first');
    // span too short
    expect(elevatorPlacementError(state, 1, 1, 5)).toBe('Shaft must span at least 2 floors');
    // overlaps the stair at col 4
    expect(elevatorPlacementError(state, 1, 5, 4)).toBe('Space is occupied');
    // overlaps the existing elevator at col 10
    expect(elevatorPlacementError(state, 1, 5, 10)).toBe('An elevator is already here');
    // overlaps the office on floor 2 (cells 20-31)
    expect(elevatorPlacementError(state, 1, 5, 30)).toBe('Space is occupied');
    // funds
    state.money.balanceCents = 0;
    expect(elevatorPlacementError(state, 1, 5, 40)).toBe('Not enough funds');
  });
});

describe('elevator management', () => {
  it('adds/removes cars with costs and caps', () => {
    const state = newTestGame();
    scenarioTower(state);
    const group = state.elevatorGroups.values().next().value!;
    const before = state.money.balanceCents;
    addElevatorCar(state, group.id);
    expect(state.money.balanceCents).toBe(before - 80_000 * 100);
    expect(group.cars).toHaveLength(2);
    removeElevatorCar(state, group.id, group.cars[1]!.id);
    expect(group.cars).toHaveLength(1);
    expect(() => removeElevatorCar(state, group.id, group.cars[0]!.id)).toThrow(
      'at least one car',
    );
  });

  it('upgrades car speed through 3 levels', () => {
    const state = newTestGame();
    scenarioTower(state);
    const group = state.elevatorGroups.values().next().value!;
    const car = group.cars[0]!;
    upgradeCarSpeed(state, group.id, car.id);
    expect(car.speedLevel).toBe(2);
    upgradeCarSpeed(state, group.id, car.id);
    expect(car.speedLevel).toBe(3);
    expect(() => upgradeCarSpeed(state, group.id, car.id)).toThrow('Max speed');
  });

  it('resizes service range, updating cells', () => {
    const state = newTestGame();
    scenarioTower(state);
    const group = state.elevatorGroups.values().next().value!;
    setElevatorServiceRange(state, group.id, 1, 3);
    expect(group.serviceHi).toBe(3);
    const f5 = state.tower.floors.find((fl) => fl.index === 5)!;
    expect(f5.cells[10]!.content).toBe('empty');
    expect(f5.cells[11]!.content).toBe('empty');
    const f3 = state.tower.floors.find((fl) => fl.index === 3)!;
    expect(f3.cells[10]!.content).toBe('elevatorShaft');
    // extending into occupied cells fails
    placeTenant(state, 'office', 4, 5); // cells 5..16 cover the shaft column
    expect(() => setElevatorServiceRange(state, group.id, 1, 5)).toThrow('Space is occupied');
  });
});

describe('elevator dispatch', () => {
  it('answers a call: car moves to the floor, opens doors, idles', () => {
    const state = newTestGame();
    scenarioTower(state);
    // car parks at serviceLo = floor 1; call floor 5
    pressCall(state, 5, 'up');
    const group = state.elevatorGroups.values().next().value!;
    const car = group.cars[0]!;
    for (let i = 0; i < 100 && car.state !== 'doors'; i++) tick(state);
    expect(car.y).toBeCloseTo(5);
    expect(car.state).toBe('doors');
    for (let i = 0; i < 10; i++) tick(state);
    expect(car.state).toBe('idle');
    expect(car.passengers).toHaveLength(0);
  });

  it('collect mode: a moving car stops for same-direction calls it passes', () => {
    const state = newTestGame();
    scenarioTower(state);
    const group = state.elevatorGroups.values().next().value!;
    const car = group.cars[0]!;
    pressCall(state, 5, 'up');
    for (let i = 0; i < 10; i++) tick(state); // car departs floor 1 upward
    pressCall(state, 3, 'up'); // new up-call on its way
    for (let i = 0; i < 50 && !(car.state === 'doors' && Math.round(car.y) === 3); i++) {
      tick(state);
    }
    expect(Math.round(car.y)).toBe(3);
  });

  it('idle car picks the nearest pending call', () => {
    const state = newTestGame();
    scenarioTower(state);
    const group = state.elevatorGroups.values().next().value!;
    const car = group.cars[0]!;
    car.y = 2;
    pressCall(state, 5, 'up');
    pressCall(state, 1, 'down');
    for (let i = 0; i < 30 && car.state !== 'doors'; i++) tick(state);
    // nearest to y=2 is floor 1
    expect(Math.round(car.y)).toBe(1);
  });

  it('demolishing a shaft clears its cells', () => {
    const state = newTestGame();
    scenarioTower(state);
    const group = state.elevatorGroups.values().next().value!;
    demolishElevatorGroup(state, group.id);
    expect(state.elevatorGroups.size).toBe(0);
    for (let f = 2; f <= 5; f++) {
      const floor = state.tower.floors.find((fl) => fl.index === f)!;
      expect(floor.cells[10]!.content).toBe('empty');
    }
    // The lobby keeps its own cells.
    expect(state.tower.floors.find((fl) => fl.index === 1)!.cells[10]!.content).toBe('tenant');
  });
});
