import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/data/config';
import {
  buildFloor,
  placeElevatorGroup,
  placeTenant,
  rentMultiplier,
  spawnTenantPeople,
  stepDailySettlement,
} from '../../src/sim';
import { newTestGame } from '../helpers/simHarness';

describe('daily settlement', () => {
  it('collects grade-adjusted rents plus commercial revenue, pays upkeep', () => {
    const state = newTestGame();
    buildFloor(state, 2);
    placeTenant(state, 'office', 2, 10);
    placeTenant(state, 'condo', 2, 30);
    const office = [...state.tenants.values()].find((t) => t.type === 'office')!;
    const condo = [...state.tenants.values()].find((t) => t.type === 'condo')!;
    office.state = 'open';
    condo.state = 'open';
    office.grade = 3;
    condo.grade = 4;
    office.dailyRevenue = 5_000_00; // $5,000 commercial take for the day
    condo.dailyRevenue = 0;
    const before = state.money.balanceCents;

    stepDailySettlement(state);

    const expectedIncome =
      Math.round(CONFIG.OFFICE_RENT_DAILY_DOLLARS * 100 * rentMultiplier(3)) +
      Math.round(CONFIG.CONDO_RENT_DAILY_DOLLARS * 100 * rentMultiplier(4)) +
      5_000_00;
    expect(state.money.dailyIncomeCents).toBe(expectedIncome);
    // No staff, no elevators → zero upkeep.
    expect(state.money.dailyUpkeepCents).toBe(0);
    expect(state.money.balanceCents).toBe(before + expectedIncome);
    expect(office.dailyRevenue).toBe(0); // reset
  });

  it('pays guard/housekeeper wages and elevator upkeep', () => {
    const state = newTestGame();
    state.starLevel = 5; // M3: unlocks by hand (M4 makes progression real)
    for (let i = 2; i <= 5; i++) buildFloor(state, i);
    placeElevatorGroup(state, 1, 5, 10);
    const security = placeTenant(state, 'security', 2, 20);
    security.state = 'open';
    spawnTenantPeople(state, security);
    const before = state.money.balanceCents;

    stepDailySettlement(state);

    const expectedUpkeep =
      CONFIG.GUARD_WAGE_DAILY_DOLLARS * 100 + CONFIG.ELEVATOR_CAR_UPKEEP_DAILY_DOLLARS * 100;
    expect(state.money.dailyUpkeepCents).toBe(expectedUpkeep);
    expect(state.money.balanceCents).toBe(before - expectedUpkeep);
  });

  it('emits a QUARTER_REPORT every QUARTER_DAYS days', () => {
    const state = newTestGame();
    state.calendar.day = CONFIG.QUARTER_DAYS;
    state.money.quarterIncomeCents = 1_234_00;
    state.money.quarterUpkeepCents = 432_00;
    stepDailySettlement(state);
    expect(state.events).toContainEqual({
      type: 'QUARTER_REPORT',
      quarter: 1,
      income: 1_234_00 + state.money.dailyIncomeCents,
      upkeep: 432_00 + state.money.dailyUpkeepCents,
    });
    // Quarter counters reset after the report.
    expect(state.money.quarterIncomeCents).toBe(0);
    expect(state.money.quarterUpkeepCents).toBe(0);
  });

  it('alerts when funds go negative', () => {
    const state = newTestGame();
    state.money.balanceCents = -50;
    stepDailySettlement(state);
    expect(state.events).toContainEqual({
      type: 'ALERT',
      message: 'Funds are negative!',
    });
  });

  it('rentMultiplier ranges 0.4 (grade 0) to 1.15 (grade 5)', () => {
    expect(rentMultiplier(0)).toBe(0.4);
    expect(rentMultiplier(3)).toBe(0.85);
    expect(rentMultiplier(5)).toBe(1.15);
  });
});
