import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/data/config';
import { startIncident } from '../../src/sim/campaign';
import {
  buildFloor,
  buildFloorError,
  deserializeGame,
  loanLimitCents,
  placeElevatorGroup,
  placeTenant,
  placementError,
  population,
  rebuildRouting,
  repayLoan,
  serializeGame,
  stepDailySettlement,
  stepEvaluation,
  takeLoan,
  takeLoanError,
  tick,
  type GameState,
  type TenantType,
} from '../../src/sim';
import { extendFloor, floorExtensionError, trimFloor } from '../../src/sim/tower';
import { newTestGame, setClock, tickN } from '../helpers/simHarness';

function fixture(top = 10): GameState {
  const state = newTestGame(21);
  state.starLevel = 5;
  state.money.balanceCents = 100_000_000_00;
  for (let f = 2; f <= top; f++) buildFloor(state, f);
  placeElevatorGroup(state, 1, top, 10);
  rebuildRouting(state);
  return state;
}
function build(state: GameState, type: TenantType, floor: number, x: number) {
  const tenant = placeTenant(state, type, floor, x);
  if (tenant.state === 'constructing') {
    tenant.constructionTicksLeft = 1;
    tick(state);
  }
  return tenant;
}

describe('roof facilities', () => {
  it('rooftop pools and helipads go only where no floor covers them', () => {
    const state = fixture();
    expect(placementError(state, 'rooftopPool', 5, 100)).toContain('Roof only');
    expect(placementError(state, 'helipad', 9, 100)).toContain('Roof only');
    expect(placementError(state, 'rooftopPool', 10, 100)).toBeNull();
    expect(placementError(state, 'helipad', 10, 200)).toBeNull();
    // A narrower floor above leaves the rest of the floor below as open roof.
    trimFloor(state, 10, 374);
    for (let x = 373; x > 300; x--) trimFloor(state, 10, x);
    expect(placementError(state, 'rooftopPool', 9, 320)).toBeNull();
    expect(placementError(state, 'rooftopPool', 9, 280)).toContain('Roof only');
  });

  it('occupies the roof: no floor can be built or extended over it', () => {
    const state = fixture();
    trimFloor(state, 10, 374);
    for (let x = 373; x > 300; x--) trimFloor(state, 10, x);
    placeTenant(state, 'rooftopPool', 9, 320);
    expect(floorExtensionError(state, 10, 330)).toContain('rooftop');
    const helipad = placeTenant(state, 'helipad', 10, 100);
    expect(buildFloorError(state, 11)).toContain('rooftop');
    expect(() => buildFloor(state, 11)).toThrow('rooftop');
    expect(helipad.state).toBe('constructing');
    // Extending floor 10 elsewhere is still fine.
    expect(floorExtensionError(state, 9, 0)).not.toContain('rooftop');
    expect(() => extendFloor(state, 10, 330)).toThrow('rooftop');
    extendFloor(state, 10, 310); // short of the pool
  });

  it('residents and hotel guests swim in the evening and nearby homes grade higher', () => {
    const state = fixture();
    const pool = build(state, 'rooftopPool', 10, 100);
    const nearCondo = build(state, 'condo', 5, 30);
    // Residents have finished their day's schedule and are at home.
    for (const p of state.people.values()) p.scheduleDone = true;
    setClock(state, CONFIG.POOL_EVENING_START_MIN + 60);
    tickN(state, 120);
    const visitors = [...state.people.values()].filter(p => p.activityTenantId === pool.id);
    expect(visitors.length).toBeGreaterThan(0);
    expect(visitors.every(p => p.kind === 'resident' || p.kind === 'hotelGuest')).toBe(true);
    tickN(state, CONFIG.POOL_VISIT_TICKS + 100);
    // After a visit residents go home rather than leaving the tower.
    const residents = [...state.people.values()].filter(p => p.tenantId === nearCondo.id);
    expect(residents).toHaveLength(3);
    expect(residents.every(p => p.state !== 'offscreen')).toBe(true);
    expect(pool.dailyRevenue + state.money.dailyIncomeCents).toBeGreaterThanOrEqual(0);

    const scoreWith = (withPool: boolean): number => {
      pool.state = withPool ? 'open' : 'damaged';
      stepEvaluation(state);
      return nearCondo.evalScore;
    };
    const without = scoreWith(false);
    expect(scoreWith(true)).toBeGreaterThanOrEqual(Math.min(100, without + CONFIG.POOL_EVAL_BONUS));
  });

  it('VIPs fly in to a connected helipad', () => {
    const state = fixture();
    build(state, 'helipad', 10, 100);
    const suite = build(state, 'hotelSuite', 4, 30);
    const visit = startIncident(state, 'vip', suite.id);
    expect(visit.arrivalFloor).toBe(10);
    const vip = state.people.get(visit.personId!)!;
    expect(vip.vip).toBe(true);
    expect(vip.pos.floor).toBe(10);
    expect(state.campaign.history[0]!.message).toContain('helicopter');
  });

  it('a helipad extends medical cover to the whole tower', () => {
    const state = fixture(29);
    build(state, 'medical', 2, 100);
    const far = build(state, 'office', 28, 30);
    for (const p of state.people.values()) p.dayStress = 0;
    setClock(state, 900);
    far.occupancy = far.capacity;
    stepEvaluation(state);
    const before = far.evalScore;
    build(state, 'helipad', 29, 200);
    far.occupancy = far.capacity;
    stepEvaluation(state);
    expect(far.evalScore).toBe(Math.min(100, before + 5));
  });
});

describe('banks and loans', () => {
  it('weekday customers pay fees during business hours; banks close at weekends', () => {
    const state = fixture();
    const bank = build(state, 'bank', 3, 30);
    setClock(state, CONFIG.BANK_OPEN_MIN);
    tickN(state, 600);
    expect(bank.visitsToday ?? 0).toBeGreaterThan(0);
    expect(bank.dailyRevenue).toBe((bank.visitsToday ?? 0) * CONFIG.BANK_FEE_DOLLARS * 100);
    // Weekends: no customers.
    while (state.calendar.day % 3 !== 0) tick(state);
    setClock(state, CONFIG.BANK_OPEN_MIN);
    bank.visitsToday = 0;
    tickN(state, 600);
    expect(bank.visitsToday).toBe(0);
  });

  it('counts the previous weekday customers toward population like a shop', () => {
    const state = fixture();
    const bank = build(state, 'bank', 3, 30);
    setClock(state, CONFIG.BANK_OPEN_MIN);
    tickN(state, 1200);
    const visits = bank.visitsToday ?? 0;
    expect(visits).toBeGreaterThan(0);
    const day = state.calendar.day;
    while (state.calendar.day === day || state.calendar.minuteOfDay < CONFIG.BANK_OPEN_MIN || state.calendar.minuteOfDay >= 1440) tick(state);
    expect(bank.reportedPopulation).toBe(Math.min(bank.capacity, visits));
    expect(population(state)).toBeGreaterThanOrEqual(bank.reportedPopulation!);
  });

  it('lends only with an open bank, up to a limit growing with banks and population', () => {
    const state = fixture();
    expect(loanLimitCents(state)).toBe(0);
    expect(takeLoanError(state, 100_00)).toBe('Requires an open bank');
    build(state, 'bank', 3, 30);
    const oneBank = loanLimitCents(state);
    expect(oneBank).toBeGreaterThanOrEqual(CONFIG.LOAN_BASE_DOLLARS * 100);
    build(state, 'condo', 4, 30);
    expect(loanLimitCents(state)).toBe(oneBank + 3 * CONFIG.LOAN_PER_PERSON_DOLLARS * 100);
    build(state, 'bank', 5, 30);
    expect(loanLimitCents(state)).toBeGreaterThan(oneBank + CONFIG.LOAN_BASE_DOLLARS * 100 - 1);
    const balance = state.money.balanceCents;
    takeLoan(state, 300_000_00);
    expect(state.money.balanceCents).toBe(balance + 300_000_00);
    expect(state.money.loanCents).toBe(300_000_00);
    expect(() => takeLoan(state, loanLimitCents(state))).toThrow('credit limit');
    expect(() => repayLoan(state, 400_000_00)).toThrow('owe');
    repayLoan(state, 100_000_00);
    expect(state.money.loanCents).toBe(200_000_00);
    expect(state.money.balanceCents).toBe(balance + 200_000_00);
    expect(deserializeGame(serializeGame(state)).money.loanCents).toBe(200_000_00);
  });

  it('charges quarterly interest at settlement and reports it as an expense', () => {
    const state = fixture();
    build(state, 'bank', 3, 30);
    takeLoan(state, 400_000_00);
    const interest = Math.round(400_000_00 * CONFIG.LOAN_INTEREST_QUARTER);
    const balance = state.money.balanceCents;
    stepDailySettlement(state, 1);
    expect(state.money.lastQuarterInterestCents).toBeUndefined();
    const before = state.money.balanceCents;
    state.events.length = 0;
    stepDailySettlement(state, CONFIG.QUARTER_DAYS);
    expect(state.money.lastQuarterInterestCents).toBe(interest);
    const report = state.events.find(e => e.type === 'QUARTER_REPORT');
    expect(report).toMatchObject({ interest });
    expect(report && report.type === 'QUARTER_REPORT' && report.upkeep).toBeGreaterThanOrEqual(interest);
    expect(state.money.balanceCents).toBeLessThanOrEqual(before - interest + (state.money.dailyIncomeCents));
    expect(balance).toBeGreaterThan(0);
  });
});

describe('service facilities', () => {
  it('staffless services are not graded as empty failures', () => {
    const state = fixture();
    const types: TenantType[] = ['fireStation', 'maintenance', 'generator', 'rooftopPool', 'helipad'];
    const tenants = [build(state, 'fireStation', 2, 30), build(state, 'maintenance', 3, 30), build(state, 'generator', 0, 100),
      build(state, 'rooftopPool', 10, 100), build(state, 'helipad', 10, 200)];
    expect(tenants.map(t => t.type)).toEqual(types);
    setClock(state, 900);
    stepEvaluation(state);
    for (const t of tenants) expect(t.grade).toBe(3);
    expect(placementError(state, 'generator', 2, 200)).toContain('below ground');
  });
});
