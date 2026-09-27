import { expect, it } from 'vitest';
import { CONFIG } from '../../src/data/config';
import { buildFloor, cyclePricing, demolishTenant, deserializeGame, placeTenant, serializeGame, stepConstruction, stepDailySettlement, stepEvaluation } from '../../src/sim';
import { newTestGame } from '../helpers/simHarness';

function fixture() {
  const state = newTestGame(); buildFloor(state, 2);
  const condo = placeTenant(state, 'condo', 2, 20);
  cyclePricing(state, condo.id); // high, before occupants move in
  condo.constructionTicksLeft = 1; stepConstruction(state);
  return { state, condo };
}

it('locks the selected sale price while residents are away and preserves it across saves', () => {
  const { state, condo } = fixture();
  expect(condo).toMatchObject({ sold: true, condoSaleCents: 202_500_00, dailyRevenue: 202_500_00 });
  condo.occupancy = 0;
  const before = serializeGame(state);
  expect(() => cyclePricing(state, condo.id)).toThrow('while owned');
  expect(serializeGame(state)).toBe(before);
  expect(deserializeGame(before).tenants.get(condo.id)!.condoSaleCents).toBe(202_500_00);
});

it('repurchases on move-out and sells once to replacement occupants at the new price', () => {
  const { state, condo } = fixture(); stepDailySettlement(state);
  // Stress and poor waste service produce a bad condo grade.
  state.campaign.waste = 100;
  for (const person of state.people.values()) person.dayStress = 100;
  for (let i = 0; i < CONFIG.EVAL_VACANCY_DAYS; i++) stepEvaluation(state);
  expect(condo).toMatchObject({ state: 'vacant', sold: false, dailyRevenue: -202_500_00 });
  expect(condo.condoSaleCents).toBeUndefined();
  cyclePricing(state, condo.id); // very low
  const loaded = deserializeGame(serializeGame(state));
  stepDailySettlement(loaded);
  expect(loaded.money.dailyIncomeCents).toBe(-202_500_00);
  for (let i = 0; i < CONFIG.EVAL_REPOPULATE_DAYS; i++) stepEvaluation(loaded);
  expect(loaded.tenants.get(condo.id)).toMatchObject({ state: 'open', sold: true, condoSaleCents: 90_000_00 });
  stepDailySettlement(loaded); expect(loaded.money.dailyIncomeCents).toBe(90_000_00);
  stepDailySettlement(loaded); expect(loaded.money.dailyIncomeCents).toBe(0);
});

it.each([false, true])('preserves demolition refund across save/load (sale already settled: %s)', settled => {
  const { state, condo } = fixture();
  if (settled) stepDailySettlement(state);
  demolishTenant(state, condo.floor, condo.x);
  const loaded = deserializeGame(serializeGame(state));
  stepDailySettlement(loaded, 3);
  expect(loaded.money.dailyIncomeCents).toBe(settled ? -202_500_00 : 0);
  expect(loaded.events).toContainEqual({ type: 'QUARTER_REPORT', quarter: 1, income: 0, upkeep: 0 });
  stepDailySettlement(loaded, 4); expect(loaded.money.dailyIncomeCents).toBe(0);
});

it('refunds the historical fixed amount for sold condos from older saves', () => {
  const { state, condo } = fixture(); condo.dailyRevenue = 0; delete condo.condoSaleCents;
  demolishTenant(state, condo.floor, condo.x); stepDailySettlement(state);
  expect(state.money.dailyIncomeCents).toBe(-150_000_00);
});

it('reopens already-vacant legacy condos for pricing without a retroactive refund', () => {
  const { state, condo } = fixture();
  condo.state = 'vacant'; condo.dailyRevenue = 0; delete condo.condoSaleCents;
  const loaded = deserializeGame(serializeGame(state));
  const restored = loaded.tenants.get(condo.id)!;
  expect(restored.sold).toBe(false);
  cyclePricing(loaded, restored.id);
  expect(restored.pricing).toBe(0);
  stepDailySettlement(loaded); expect(loaded.money.dailyIncomeCents).toBe(0);
});
