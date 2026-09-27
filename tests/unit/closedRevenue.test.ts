import { expect, it } from 'vitest';
import { buildFloor, deserializeGame, placeTenant, serializeGame, stepConstruction, stepDailySettlement } from '../../src/sim';
import { newTestGame } from '../helpers/simHarness';

it.each(['vacant', 'damaged', 'constructing'] as const)('settles previously earned revenue once while %s without charging new rent', status => {
  let state = newTestGame(); buildFloor(state, 2);
  const office = placeTenant(state, 'office', 2, 20);
  office.state = status;
  office.dailyRevenue = 12345;
  office.paidExternalVisits = 7; office.paidOfficeVisits = 4;
  state = deserializeGame(serializeGame(state));
  const room = state.tenants.get(office.id)!;
  const before = state.money.balanceCents;
  stepDailySettlement(state, 1);
  expect(state.money.dailyIncomeCents).toBe(12345);
  expect(state.money.balanceCents).toBe(before + 12345);
  expect(room).toMatchObject({ dailyRevenue: 0, paidExternalVisits: 0, paidOfficeVisits: 0 });
  state = deserializeGame(serializeGame(state));
  stepDailySettlement(state, 2);
  expect(state.money.dailyIncomeCents).toBe(0);
  expect(state.money.quarterIncomeCents).toBe(12345);
});

it('retains a completed condo sale if damage occurs before its first settlement', () => {
  const state = newTestGame(); buildFloor(state, 2);
  const condo = placeTenant(state, 'condo', 2, 20);
  condo.constructionTicksLeft = 1; stepConstruction(state);
  expect(condo.dailyRevenue).toBe(150_000_00);
  condo.state = 'damaged';
  stepDailySettlement(state, 3);
  expect(state.money.dailyIncomeCents).toBe(150_000_00);
  expect(state.events).toContainEqual({ type: 'QUARTER_REPORT', quarter: 1, income: 150_000_00, upkeep: 0 });
  condo.state = 'open'; stepDailySettlement(state, 4);
  expect(state.money.dailyIncomeCents).toBe(0);
});
