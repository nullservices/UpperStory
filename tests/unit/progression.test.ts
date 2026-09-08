import { describe, expect, it } from 'vitest';
import { isUnlocked, population, stepProgression } from '../../src/sim';
import { newTestGame, scenarioTower, tickN } from '../helpers/simHarness';

describe('star progression', () => {
  it('stays at 1★ below 300 population', () => {
    const state = newTestGame();
    scenarioTower(state);
    tickN(state, 1_400); // 9 people
    stepProgression(state);
    expect(state.starLevel).toBe(1);
  });

  it('raises stars at the population gates and emits LEVEL_UP', () => {
    const state = newTestGame();
    state.starLevel = 1;
    // Fake the population directly: gates are pure population checks.
    const fakePopulation = (n: number) => {
      for (let i = state.people.size; i < n; i++) {
        state.people.set(10_000 + i, {
          id: 10_000 + i,
          kind: 'resident',
          tenantId: -1,
          scheduleIndex: 0,
          scheduleDone: true,
          state: 'offscreen',
          pos: { floor: 1, x: 0 },
          target: null,
          destination: null,
          endState: 'inTenant',
          route: null,
          legIndex: 0,
          stairsTicksLeft: 0,
          waitTicks: 0,
          stress: 0,
          dayStress: 0,
          failedTripsToday: 0,
          jitterTicks: 0,
          dayTracked: state.calendar.day,
          activityTicksLeft: 0,
          activityTenantId: -1,
        });
      }
    };

    expect(state.starLevel).toBe(1);
    fakePopulation(300);
    stepProgression(state);
    expect(state.starLevel).toBe(2);
    expect(state.events).toContainEqual({ type: 'LEVEL_UP', starLevel: 2 });

    fakePopulation(1_000);
    stepProgression(state);
    expect(state.starLevel).toBe(3);

    fakePopulation(5_000);
    stepProgression(state);
    expect(state.starLevel).toBe(4);

    fakePopulation(10_000);
    stepProgression(state);
    expect(state.starLevel).toBe(5);
    expect(population(state)).toBe(10_000);
  });

  it('unlocks follow the star level', () => {
    const state = newTestGame();
    state.starLevel = 1;
    expect(isUnlocked(state, 'fastfood')).toBe(true);
    expect(isUnlocked(state, 'hotel')).toBe(false);
    state.starLevel = 2;
    expect(isUnlocked(state, 'hotel')).toBe(true);
    expect(isUnlocked(state, 'restaurant')).toBe(false);
    state.starLevel = 3;
    expect(isUnlocked(state, 'restaurant')).toBe(true);
    expect(isUnlocked(state, 'skyLobby')).toBe(true);
  });
});
