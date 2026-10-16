import { expect, it } from 'vitest';
import { CONFIG } from '../../src/data/config';
import { buildFloor, deserializeGame, placeElevatorGroup, placeStair, placeTenant, serializeGame, stepConstruction, stepEvaluation } from '../../src/sim';
import { condoHasAccess } from '../../src/sim/condoEconomy';
import { setElevatorStop } from '../../src/sim/elevators';
import { newTestGame } from '../helpers/simHarness';

it('holds a disconnected completed condo for sale across saves, then admits buyers after connection', () => {
  let state = newTestGame(); buildFloor(state, 2);
  const condo = placeTenant(state, 'condo', 2, 20);
  condo.constructionTicksLeft = 1; stepConstruction(state);
  expect(condo).toMatchObject({ state: 'vacant', dailyRevenue: 0 });
  expect(condo.sold).not.toBe(true);
  expect(state.people.size).toBe(0);
  for (let i = 0; i < 5; i++) stepEvaluation(state);
  expect(condo.daysGood).toBe(0);
  state = deserializeGame(serializeGame(state));
  placeStair(state, 2, 0);
  for (let i = 0; i < CONFIG.EVAL_REPOPULATE_DAYS; i++) stepEvaluation(state);
  expect(state.tenants.get(condo.id)).toMatchObject({ state: 'open', sold: true, dailyRevenue: 150_000_00 });
  expect([...state.people.values()].filter(p => p.tenantId === condo.id)).toHaveLength(3);
  stepEvaluation(state);
  expect(state.tenants.get(condo.id)!.dailyRevenue).toBe(150_000_00);
});

it('rejects service-only access and restarts the buyer timer after a stop is disabled', () => {
  const state = newTestGame(); state.starLevel = 5; buildFloor(state, 2);
  buildFloor(state, 3);
  const condo = placeTenant(state, 'condo', 2, 20);
  placeElevatorGroup(state, 1, 2, 60, 'service');
  expect(condoHasAccess(state, condo)).toBe(false);
  condo.constructionTicksLeft = 1; stepConstruction(state);
  const standard = placeElevatorGroup(state, 1, 3, 80);
  expect(condoHasAccess(state, condo)).toBe(true);
  stepEvaluation(state); expect(condo.daysGood).toBe(1);
  setElevatorStop(state, standard.id, 2, false);
  stepEvaluation(state); expect(condo.daysGood).toBe(0);
  expect(condo.state).toBe('vacant');
  setElevatorStop(state, standard.id, 2, true);
  for (let i = 0; i < CONFIG.EVAL_REPOPULATE_DAYS; i++) stepEvaluation(state);
  expect(condo.sold).toBe(true);
});
