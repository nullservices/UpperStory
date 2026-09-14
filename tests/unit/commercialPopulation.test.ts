import { expect, it } from 'vitest';
import { newTestGame } from '../helpers/simHarness';
import { buildFloor, placeTenant, stepDailySettlement, serializeGame, deserializeGame } from '../../src/sim';
import { commercialOpeningMinute, stepCommercialPopulation } from '../../src/sim/commercialPopulation';

it.each(['fastfood', 'shop', 'restaurant'] as const)('%s publishes preceding visits only at opening, including after save/load', type => {
  let state = newTestGame(); state.starLevel = 5; buildFloor(state, 2);
  const room = placeTenant(state, type, 2, 20); room.state = 'open';
  room.reportedPopulation = 5; room.visitsToday = 20;
  stepDailySettlement(state, 1);
  expect(room.reportedPopulation).toBe(5); expect(room.visitsToday).toBe(20);
  state.calendar.day = 2; state.calendar.minuteOfDay = commercialOpeningMinute(type)! - 1;
  stepCommercialPopulation(state); expect(room.reportedPopulation).toBe(5);
  state = deserializeGame(serializeGame(state));
  state.calendar.minuteOfDay++;
  stepCommercialPopulation(state);
  const loaded = state.tenants.get(room.id)!;
  expect(loaded.reportedPopulation).toBe(20); expect(loaded.visitsToday).toBe(0);
  loaded.visitsToday = 7;
  state = deserializeGame(serializeGame(state)); stepCommercialPopulation(state);
  expect(state.tenants.get(room.id)!.reportedPopulation).toBe(20);
  expect(state.tenants.get(room.id)!.visitsToday).toBe(7);
});

it.each([['fastfood', 48, 35], ['shop', 30, 25]] as const)('%s carries weekend population into the following weekday', (type, weekend, weekday) => {
  const state = newTestGame(); state.starLevel = 5; buildFloor(state, 2);
  const room = placeTenant(state, type, 2, 20); room.state = 'open'; room.visitsToday = 100;
  state.calendar.day = 4; state.calendar.minuteOfDay = 720;
  stepCommercialPopulation(state); expect(room.reportedPopulation).toBe(weekend);
  room.visitsToday = 100; state.calendar.day = 5;
  stepCommercialPopulation(state); expect(room.reportedPopulation).toBe(weekday);
});

it('preserves population from a legacy save until the next opening day', () => {
  const state = newTestGame(); buildFloor(state, 2);
  const room = placeTenant(state, 'fastfood', 2, 20); room.state = 'open'; room.reportedPopulation = 30;
  state.calendar.minuteOfDay = 720;
  const saved = JSON.parse(serializeGame(state)); saved.version = 6;
  const loaded = deserializeGame(JSON.stringify(saved)); stepCommercialPopulation(loaded);
  expect(loaded.tenants.get(room.id)!.reportedPopulation).toBe(30);
});
