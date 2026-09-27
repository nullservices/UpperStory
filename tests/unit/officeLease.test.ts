import { expect, it } from 'vitest';
import { CONFIG } from '../../src/data/config';
import { deserializeGame, serializeGame, spawnTenantPeople, stepEvaluation } from '../../src/sim';
import { newTestGame, scenarioTower } from '../helpers/simHarness';

function fixture() {
  const state = newTestGame(); scenarioTower(state);
  const office = [...state.tenants.values()].find(t => t.type === 'office')!;
  office.state = 'open'; office.occupancy = 3;
  spawnTenantPeople(state, office);
  return { state, office };
}

it('high rent can turn marginal conditions into a move-out after the minimum term', () => {
  const { state, office } = fixture();
  office.pricing = 3;
  for (let i = 0; i < CONFIG.EVAL_VACANCY_DAYS; i++) stepEvaluation(state);
  expect(office).toMatchObject({ state: 'open', evalScore: 30, rentScoreAdjustment: -20 });
  const loaded = deserializeGame(serializeGame(state));
  const restored = loaded.tenants.get(office.id)!;
  loaded.tickCount = restored.officeLeaseUntilTick! - 1;
  stepEvaluation(loaded);
  expect(restored.state).toBe('open');
  loaded.tickCount++;
  stepEvaluation(loaded);
  expect(restored.state).toBe('vacant');
  expect(restored.officeLeaseUntilTick).toBeUndefined();
  expect([...loaded.people.values()].some(p => p.tenantId === office.id)).toBe(false);
});

it('lowering rent before evaluation clears dissatisfaction without restarting the lease', () => {
  const { state, office } = fixture();
  office.pricing = 3; stepEvaluation(state);
  expect(office.daysVacant).toBe(1);
  const end = office.officeLeaseUntilTick;
  office.pricing = 1; stepEvaluation(state);
  expect(office).toMatchObject({ evalScore: 60, rentScoreAdjustment: 10, daysVacant: 0, officeLeaseUntilTick: end });
  state.tickCount = end!; stepEvaluation(state);
  expect(office.state).toBe('open');
});

it('starts a new minimum term for replacement occupants and preserves it in saves', () => {
  const { state, office } = fixture();
  office.state = 'vacant'; office.daysGood = CONFIG.EVAL_REPOPULATE_DAYS - 1;
  state.people.clear(); state.tickCount = 9000;
  stepEvaluation(state);
  expect(office.state).toBe('open');
  const expected = 9000 + CONFIG.QUARTER_DAYS * CONFIG.DAY_TICKS;
  expect(office.officeLeaseUntilTick).toBe(expected);
  expect(deserializeGame(serializeGame(state)).tenants.get(office.id)!.officeLeaseUntilTick).toBe(expected);
});

it('does not grant a fresh grace period to old saves with no lease timestamp', () => {
  const { state, office } = fixture();
  delete office.officeLeaseUntilTick;
  office.pricing = 3; office.daysVacant = CONFIG.EVAL_VACANCY_DAYS - 1;
  const loaded = deserializeGame(serializeGame(state)); stepEvaluation(loaded);
  expect(loaded.tenants.get(office.id)!.state).toBe('vacant');
});

it('defers rent evaluation over the weekend without extending the minimum term', () => {
  const { state, office } = fixture();
  stepEvaluation(state);
  const end = office.officeLeaseUntilTick;
  state.calendar.day = 3; office.pricing = 3;
  stepEvaluation(state);
  expect(office).toMatchObject({ evalScore: 50, rentScoreAdjustment: 0, officeLeaseUntilTick: end });
  state.calendar.day = 4; stepEvaluation(state);
  expect(office).toMatchObject({ evalScore: 30, rentScoreAdjustment: -20 });
});
