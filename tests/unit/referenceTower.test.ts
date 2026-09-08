import { expect, it } from 'vitest';
import { createInitialState, serializeGame, tick } from '../../src/sim';
import { CONFIG } from '../../src/data/config';
import { setupReferenceTower } from '../../src/sim/referenceTower';

it('repeats the ten-floor scenario and carries passengers during a full day', () => {
  const state = createInitialState(20260907);
  const repeat = createInitialState(20260907);
  setupReferenceTower(state);
  setupReferenceTower(repeat);
  expect(serializeGame(state)).toBe(serializeGame(repeat));
  expect(state.tower.floors.at(-1)!.index).toBe(10);
  expect(state.people.size).toBeGreaterThan(0);
  expect(state.elevatorGroups.size).toBe(1);
  let carriedPassengers = false;
  for (let i = 0; i < CONFIG.DAY_TICKS; i++) {
    tick(state);
    for (const group of state.elevatorGroups.values()) {
      for (const car of group.cars) {
        carriedPassengers ||= car.passengers.length > 0;
        expect(car.y).toBeGreaterThanOrEqual(group.serviceLo);
        expect(car.y).toBeLessThanOrEqual(group.serviceHi);
        for (const id of car.passengers) expect(state.people.get(id)?.state).toBe('riding');
      }
    }
  }
  expect(carriedPassengers).toBe(true);
});
