import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/data/config';
import { placeTenant, spawnTenantPeople, stepEvaluation } from '../../src/sim';
import { newTestGame, scenarioTower, tickN } from '../helpers/simHarness';

describe('stepEvaluation', () => {
  it('a full office with calm workers grades high', () => {
    const state = newTestGame();
    scenarioTower(state);
    const office = [...state.tenants.values()].find((t) => t.type === 'office')!;
    office.state = 'open';
    office.occupancy = office.capacity;
    stepEvaluation(state);
    expect(office.grade).toBe(5);
    expect(office.evalScore).toBeGreaterThanOrEqual(90);
  });

  it('an empty office grades 0 and vacates after EVAL_VACANCY_DAYS', () => {
    const state = newTestGame();
    scenarioTower(state);
    const office = [...state.tenants.values()].find((t) => t.type === 'office')!;
    office.state = 'open';
    office.occupancy = 0;
    spawnTenantPeople(state, office); // its workers exist…
    expect([...state.people.values()].filter((p) => p.tenantId === office.id)).toHaveLength(6);

    for (let i = 0; i < CONFIG.EVAL_VACANCY_DAYS; i++) stepEvaluation(state);

    expect(office.state).toBe('vacant');
    // The workers left with the vacancy.
    expect([...state.people.values()].filter((p) => p.tenantId === office.id)).toHaveLength(0);
    expect(state.events.some((e) => e.type === 'ALERT')).toBe(true);
  });

  it('a vacant unit refills after EVAL_REPOPULATE_DAYS', () => {
    const state = newTestGame();
    scenarioTower(state);
    const office = [...state.tenants.values()].find((t) => t.type === 'office')!;
    office.state = 'vacant';
    for (let i = 0; i < CONFIG.EVAL_REPOPULATE_DAYS; i++) stepEvaluation(state);
    expect(office.state).toBe('open');
    expect([...state.people.values()].filter((p) => p.tenantId === office.id)).toHaveLength(6);
  });

  it('a dirty hotel loses guests', () => {
    const state = newTestGame();
    state.starLevel = 5;
    scenarioTower(state);
    const hotel = placeTenant(state, 'hotel', 4, 20);
    hotel.state = 'open';
    hotel.cleanliness = CONFIG.DIRTY_HOTEL_THRESHOLD - 1;
    hotel.occupancy = 3;
    // Three guests staying.
    for (let i = 0; i < 3; i++) {
      state.people.set(100 + i, {
        id: 100 + i,
        kind: 'hotelGuest',
        tenantId: hotel.id,
        scheduleIndex: 0,
        scheduleDone: true,
        state: 'inTenant',
        pos: { floor: 4, x: 22 + i },
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
    stepEvaluation(state);
    const guestsLeft = [...state.people.values()].filter((p) => p.kind === 'hotelGuest');
    expect(guestsLeft).toHaveLength(2); // one stormed out
  });

  it('evaluation triggers automatically once per day at 15:00', () => {
    const state = newTestGame();
    scenarioTower(state);
    // Day 1: construction + evening. Evaluation fires at 15:00 (tick 1400).
    tickN(state, 2_600);
    expect(state.evaluationDay).toBe(1);
    // Day 2 fires again.
    tickN(state, 2_600);
    expect(state.evaluationDay).toBe(2);
  });
});
