import { expect, it } from 'vitest';
import { newTestGame } from '../helpers/simHarness';
import { buildFloor, placeTenant, serializeGame, deserializeGame, stepDailySettlement } from '../../src/sim';
import { recordCommercialVisit } from '../../src/sim/commercialEconomy';

it.each([['fastfood', 35, 3000], ['restaurant', 35, 6000], ['shop', 25, 5000]] as const)(
  '%s reaches its calibrated weekday income after %i patrons', (type, count, income) => {
    let state = newTestGame(); state.starLevel = 5; buildFloor(state, 2);
    const room = placeTenant(state, type, 2, 20); room.state = 'open';
    for (let i = 0; i < count; i++) {
      recordCommercialVisit(state.tenants.get(room.id)!, false, 1);
      if (i === 10) state = deserializeGame(serializeGame(state));
    }
    const loaded = state.tenants.get(room.id)!;
    expect(loaded.dailyRevenue).toBe(income * 100);
    recordCommercialVisit(loaded, false, 1);
    expect(loaded.dailyRevenue).toBe(income * 100);
    stepDailySettlement(state, 1);
    expect(state.money.dailyIncomeCents).toBe(income * 100);
    expect(loaded.paidExternalVisits).toBe(0);
    expect(loaded.visitsToday).toBe(count + 1);
  },
);

it('adds weekday office lunch income without increasing population visits', () => {
  const state = newTestGame(); buildFloor(state, 2);
  const room = placeTenant(state, 'fastfood', 2, 20);
  for (let i = 0; i < 35; i++) recordCommercialVisit(room, false, 1);
  for (let i = 0; i < 15; i++) recordCommercialVisit(room, true, 1);
  expect(room.dailyRevenue).toBe(5000_00); expect(room.visitsToday).toBe(35);
  recordCommercialVisit(room, true, 1); expect(room.dailyRevenue).toBe(5000_00);
});

it('uses weekend patron targets and no office bonus on weekends', () => {
  const state = newTestGame(); buildFloor(state, 2);
  const room = placeTenant(state, 'fastfood', 2, 20);
  for (let i = 0; i < 48; i++) recordCommercialVisit(room, false, 3);
  for (let i = 0; i < 15; i++) recordCommercialVisit(room, true, 3);
  expect(room.dailyRevenue).toBe(3000_00); expect(room.visitsToday).toBe(48);
});

it('applies pricing only to new receipts and does not back-charge previous patrons', () => {
  const state = newTestGame(); state.starLevel = 5; buildFloor(state, 2);
  const room = placeTenant(state, 'shop', 2, 20);
  recordCommercialVisit(room, false, 1); expect(room.dailyRevenue).toBe(200_00);
  room.pricing = 3; recordCommercialVisit(room, false, 1);
  expect(room.dailyRevenue).toBe(470_00);
});
