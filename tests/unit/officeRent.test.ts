import { expect, it } from 'vitest';
import { buildFloor, cyclePricing, deserializeGame, placeTenant, serializeGame, stepDailySettlement } from '../../src/sim';
import { officeQuarterRentCents } from '../../src/sim/money';
import { newTestGame } from '../helpers/simHarness';

it.each([0, 1, 2, 3] as const)('collects the exact selected quarterly rent at tier %s regardless of grade', pricing => {
  const state = newTestGame(); buildFloor(state, 2);
  const office = placeTenant(state, 'office', 2, 20);
  office.state = 'open'; office.pricing = pricing;
  let total = 0;
  for (let day = 1; day <= 3; day++) {
    office.grade = day === 1 ? 0 : 5;
    stepDailySettlement(state, day);
    total += state.money.dailyIncomeCents;
  }
  expect(total).toBe([6000_00, 8000_00, 10000_00, 13500_00][pricing]);
  expect(total).toBe(officeQuarterRentCents(office));
});

it('persists player rent selection and collects nothing from vacant, damaged or unfinished offices', () => {
  const state = newTestGame(); buildFloor(state, 2);
  const office = placeTenant(state, 'office', 2, 20);
  expect(office.pricing).toBe(2);
  cyclePricing(state, office.id);
  const loaded = deserializeGame(serializeGame(state));
  const restored = loaded.tenants.get(office.id)!;
  expect(restored.pricing).toBe(3);
  for (const status of ['vacant', 'damaged', 'constructing'] as const) {
    restored.state = status; stepDailySettlement(loaded);
    expect(loaded.money.dailyIncomeCents).toBe(0);
  }
  cyclePricing(loaded, restored.id);
  expect(restored.pricing).toBe(0);
  restored.state = 'open'; stepDailySettlement(loaded);
  expect(loaded.money.dailyIncomeCents).toBe(2000_00);
});
