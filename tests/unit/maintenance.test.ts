import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG, TENANT_DATA } from '../../src/data/config';
import {
  addElevatorCar,
  buildFloor,
  demolishAt,
  deserializeGame,
  placeElevatorGroup,
  placeTenant,
  rebuildRouting,
  repairElevatorCar,
  serializeGame,
  tick,
  type ElevatorGroup,
  type GameState,
  type TenantType,
} from '../../src/sim';
import { maintenanceCoverage, maintenanceOfficeReport, maintenanceSummary } from '../../src/sim/services';
import { newTestGame, setClock, tickN } from '../helpers/simHarness';

const mutable = CONFIG as unknown as Record<string, number>;
const saved: Record<string, number> = {};
function patchConfig(key: string, value: number): void {
  saved[key] ??= mutable[key]!;
  mutable[key] = value;
}
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) mutable[key] = value;
  for (const key of Object.keys(saved)) delete saved[key];
});

/** Floors 2..top, one standard shaft over [lo, hi] at column 10. No service elevators. */
function tower(top: number, shafts: [number, number, number][] = [[1, Math.min(top, 29), 10]]): { state: GameState; groups: ElevatorGroup[] } {
  const state = newTestGame(7);
  state.starLevel = 5;
  state.money.balanceCents = 100_000_000_00;
  for (let f = 2; f <= top; f++) buildFloor(state, f);
  const groups = shafts.map(([lo, hi, x]) => placeElevatorGroup(state, lo, hi, x));
  rebuildRouting(state);
  return { state, groups };
}
function build(state: GameState, type: TenantType, floor: number, x: number) {
  const tenant = placeTenant(state, type, floor, x);
  if (tenant.state === 'constructing') {
    tenant.constructionTicksLeft = 1;
    tick(state);
  }
  return tenant;
}
function breakCar(state: GameState, group: ElevatorGroup, index = 0, floor?: number) {
  const car = group.cars[index]!;
  if (floor !== undefined) { car.y = floor; car.lastFloor = floor; }
  car.breakdownAtTick = state.tickCount + 1;
  tick(state);
  expect(car.outOfService).toBe(true);
  return car;
}

describe('maintenance coverage', () => {
  it('mechanics repair a car that broke down away from their floor (no service elevator needed)', () => {
    const { state, groups } = tower(12);
    const office = build(state, 'maintenance', 2, 100);
    const car = breakCar(state, groups[0]!, 0, 9);
    expect(car.repairAtTick).toBeDefined();
    expect(car.repairOfficeId).toBe(office.id);
    expect(state.campaign.history[0]!.message).toContain('Mechanics from the floor 2 maintenance office are on the way');
    tickN(state, car.repairAtTick! - state.tickCount);
    expect(car.outOfService).toBeUndefined();
    expect(car.repairOfficeId).toBeUndefined();
  });

  it('covers shafts with a stop within reach that the mechanics can get to, and no others', () => {
    // Shaft A serves 1-18, shaft B 18-29 (transfer at 18). Office on floor 2.
    const { state, groups } = tower(29, [[1, 18, 10], [18, 29, 20]]);
    const [a, b] = groups as [ElevatorGroup, ElevatorGroup];
    expect(maintenanceCoverage(state, a.id).covered).toBe(false);
    const office = build(state, 'maintenance', 2, 100);
    expect(maintenanceCoverage(state, a.id)).toMatchObject({ covered: true, officeIds: [office.id] });
    // B's nearest stop (18) is 16 floors from the office: out of reach.
    expect(CONFIG.MAINTENANCE_REACH_FLOORS).toBeLessThan(16);
    expect(maintenanceCoverage(state, b.id).covered).toBe(false);
    // An office on floor 20 (reached via the transfer at 18) covers both.
    const upper = build(state, 'maintenance', 20, 100);
    expect(maintenanceCoverage(state, b.id)).toMatchObject({ covered: true, officeIds: [upper.id] });
    expect(maintenanceCoverage(state, a.id).officeIds).toEqual([office.id, upper.id]);
    expect(maintenanceOfficeReport(state, upper.id)).toMatchObject({ shafts: [a.id, b.id], crews: TENANT_DATA.maintenance.capacity, busy: 0 });
    expect(maintenanceSummary(state)).toMatchObject({ shafts: 2, coveredShafts: 2, uncoveredShaftIds: [] });
  });

  it('an office that cannot reach the shaft does not cover it', () => {
    // Floor 6 office with no transport to floor 6's neighbours except the shaft
    // itself, which is out of reach (shaft runs 20..29 only).
    const { state, groups } = tower(29, [[20, 29, 10]]);
    build(state, 'maintenance', 6, 100);
    expect(maintenanceCoverage(state, groups[0]!.id).covered).toBe(false);
  });

  it('a broken car on an uncovered shaft explains how to fix it', () => {
    const { state, groups } = tower(10);
    const car = breakCar(state, groups[0]!, 0, 5);
    expect(car.repairAtTick).toBeUndefined();
    const message = state.campaign.history[0]!.message;
    expect(message).toContain('broke down at floor 5');
    expect(message).toContain('No maintenance office covers this shaft');
    expect(message).toContain(`$${CONFIG.ELEVATOR_REPAIR_COST_DOLLARS.toLocaleString('en-US')}`);
  });

  it('each office repairs at most one car per mechanic at a time; more offices repair more', () => {
    const { state, groups } = tower(10);
    const group = groups[0]!;
    for (let i = 1; i < 8; i++) addElevatorCar(state, group.id);
    const crews = TENANT_DATA.maintenance.capacity;
    const first = build(state, 'maintenance', 2, 100);
    const cars = group.cars.slice(0, crews + 2);
    for (const car of cars) { car.y = 1; car.lastFloor = 1; car.breakdownAtTick = state.tickCount + 1; }
    tick(state);
    expect(cars.filter(c => c.repairOfficeId === first.id)).toHaveLength(crews);
    expect(cars.filter(c => c.outOfService && c.repairAtTick === undefined)).toHaveLength(2);
    expect(state.campaign.history.some(h => h.message.includes('busy'))).toBe(true);
    expect(maintenanceOfficeReport(state, first.id)!.busy).toBe(crews);
    // A second office takes the waiting cars at the next dispatch round.
    const second = build(state, 'maintenance', 3, 100);
    tickN(state, 50);
    expect(cars.filter(c => c.repairOfficeId === second.id)).toHaveLength(2);
    // Everything is eventually repaired without paying.
    const money = state.money.balanceCents;
    tickN(state, CONFIG.MAINTENANCE_REPAIR_TICKS + 20 * CONFIG.MAINTENANCE_TRAVEL_TICKS_PER_FLOOR + 60);
    expect(cars.every(c => !c.outOfService)).toBe(true);
    expect(state.money.balanceCents).toBeGreaterThanOrEqual(money - 1_000_00); // only daily upkeep may apply
  });

  it('repair time grows with the distance from the office to the car', () => {
    const { state, groups } = tower(12);
    build(state, 'maintenance', 2, 100);
    const near = breakCar(state, groups[0]!, 0, 2);
    expect(near.repairAtTick! - state.tickCount).toBe(CONFIG.MAINTENANCE_REPAIR_TICKS);
    addElevatorCar(state, groups[0]!.id);
    const far = breakCar(state, groups[0]!, 1, 11);
    expect(far.repairAtTick! - state.tickCount).toBe(CONFIG.MAINTENANCE_REPAIR_TICKS + 9 * CONFIG.MAINTENANCE_TRAVEL_TICKS_PER_FLOOR);
  });

  it('a repair stops when its office closes, and another office or a manual repair can finish it', () => {
    const { state, groups } = tower(12);
    const office = build(state, 'maintenance', 2, 100);
    const car = breakCar(state, groups[0]!, 0, 6);
    expect(car.repairOfficeId).toBe(office.id);
    demolishAt(state, 2, 100);
    tick(state);
    expect(car.repairAtTick).toBeUndefined();
    expect(car.repairOfficeId).toBeUndefined();
    expect(car.outOfService).toBe(true);
    repairElevatorCar(state, groups[0]!.id, car.id);
    expect(car.outOfService).toBeUndefined();
  });

  it('a manual repair frees the mechanics assigned to the car', () => {
    const { state, groups } = tower(12);
    const office = build(state, 'maintenance', 2, 100);
    const car = breakCar(state, groups[0]!, 0, 6);
    repairElevatorCar(state, groups[0]!.id, car.id);
    expect(car.repairOfficeId).toBeUndefined();
    expect(car.repairAtTick).toBeUndefined();
    expect(maintenanceOfficeReport(state, office.id)!.busy).toBe(0);
  });

  it('announces how many shafts a new maintenance office looks after', () => {
    const { state } = tower(29, [[1, 18, 10], [18, 29, 20]]);
    build(state, 'maintenance', 2, 100);
    expect(state.campaign.history[0]!.message).toBe('Maintenance office opened on floor 2: its mechanics look after 1 of 2 elevator shafts.');
  });

  it('covered shafts break down a quarter as often (daily roll)', () => {
    patchConfig('ELEVATOR_BREAKDOWN_MEAN_DAYS', 1);
    patchConfig('MAINTENANCE_BREAKDOWN_FACTOR', 0);
    const count = (maintained: boolean): number => {
      const { state, groups } = tower(10);
      for (let i = 1; i < 8; i++) addElevatorCar(state, groups[0]!.id);
      if (maintained) build(state, 'maintenance', 9, 100);
      setClock(state, 1439);
      tickN(state, 3);
      return groups[0]!.cars.filter(c => c.breakdownAtTick !== undefined).length;
    };
    expect(count(false)).toBe(8);
    expect(count(true)).toBe(0);
  });

  it('round-trips repair assignments and loads version 10 repairs in progress', () => {
    const { state, groups } = tower(12);
    const office = build(state, 'maintenance', 2, 100);
    const car = breakCar(state, groups[0]!, 0, 6);
    const loaded = deserializeGame(serializeGame(state));
    expect(loaded.elevatorGroups.get(groups[0]!.id)!.cars[0]!.repairOfficeId).toBe(office.id);
    const legacy = JSON.parse(serializeGame(state));
    legacy.version = 10;
    // Version 10 cars carried only the repair clock.
    for (const [, g] of legacy.state.elevatorGroups.__simMap) for (const c of g.cars) delete c.repairOfficeId;
    const old = deserializeGame(JSON.stringify(legacy));
    const oldCar = old.elevatorGroups.get(groups[0]!.id)!.cars[0]!;
    expect(oldCar.repairAtTick).toBe(car.repairAtTick);
    tickN(old, car.repairAtTick! - old.tickCount);
    expect(oldCar.outOfService).toBeUndefined();
  });
});
