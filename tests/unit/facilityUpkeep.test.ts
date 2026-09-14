import { expect, it } from 'vitest';
import { newTestGame } from '../helpers/simHarness';
import { buildFloor, placeTenant, placeEscalator, stepDailySettlement, demolishAt, serializeGame, deserializeGame } from '../../src/sim';

it.each([['housekeeping', 10000], ['security', 20000], ['parkingRamp', 10000], ['recycling', 50000], ['metro', 100000]] as const)(
  '%s charges exactly $%i per quarter, including after save/load', (type, cost) => {
    let state = newTestGame(); state.starLevel = 5; state.money.balanceCents = 100_000_000_00;
    for (let f = -1; f >= -8; f--) buildFloor(state, f);
    buildFloor(state, 2);
    const floor = type === 'metro' ? -8 : type === 'recycling' ? -1 : type === 'parkingRamp' ? 0 : 2;
    const facility = placeTenant(state, type, floor, 30);
    stepDailySettlement(state, 1); expect(state.money.dailyUpkeepCents).toBe(0);
    facility.state = 'open';
    const before = state.money.balanceCents;
    stepDailySettlement(state, 1);
    state = deserializeGame(serializeGame(state));
    stepDailySettlement(state, 2); stepDailySettlement(state, 3);
    expect(before - state.money.balanceCents).toBe(cost * 100);
    state.tenants.get(facility.id)!.state = 'damaged';
    stepDailySettlement(state, 4); expect(state.money.dailyUpkeepCents).toBe(0);
  },
);

it('charges per escalator link, not shared landing cells, and stops after demolition', () => {
  const state = newTestGame(); buildFloor(state, 2); buildFloor(state, 3);
  placeEscalator(state, 1, 30, 'up'); placeEscalator(state, 2, 30, 'up');
  const before = state.money.balanceCents;
  for (let day = 1; day <= 3; day++) stepDailySettlement(state, day);
  expect(before - state.money.balanceCents).toBe(10000_00);
  demolishAt(state, 3, 37);
  stepDailySettlement(state, 4);
  expect(state.money.dailyUpkeepCents).toBe(Math.floor(5000_00 / 3));
});
