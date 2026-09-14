import { expect, it } from 'vitest';
import { newTestGame } from '../helpers/simHarness';
import { buildFloor, placeTenant, serializeGame, deserializeGame, placeElevatorGroup, rebuildRouting } from '../../src/sim';
import { stepCommercialPopulation } from '../../src/sim/commercialPopulation';
import { stepPeople } from '../../src/sim/people';

function fixture() {
  const state = newTestGame(); buildFloor(state, 2); placeElevatorGroup(state, 1, 2, 10);
  const room = placeTenant(state, 'fastfood', 2, 30); room.state = 'open';
  state.calendar.minuteOfDay = 600; rebuildRouting(state);
  return { state, room };
}

it('grows weekday demand, boosts established weekends, and halves rainy targets', () => {
  const { state, room } = fixture();
  for (const [day, expected] of [[1, 10], [2, 20], [3, 24], [4, 20], [5, 35], [6, 48]]) {
    state.calendar.day = day!; stepCommercialPopulation(state);
    expect(room.externalDemand).toBe(expected);
  }
  state.calendar.day = 9; state.campaign.weather = 'rain'; stepCommercialPopulation(state);
  expect(room.externalDemand).toBe(24);
});

it('preserves the daily arrival budget across saves and rejects further external arrivals', () => {
  const { state, room } = fixture(); stepCommercialPopulation(state);
  room.externalArrivals = room.externalDemand;
  const loaded = deserializeGame(serializeGame(state)); loaded.calendar.minuteOfDay = 720;
  for (let i = 0; i < 100; i++) { loaded.tickCount++; stepPeople(loaded); }
  expect(loaded.people.size).toBe(0);
  expect(loaded.tenants.get(room.id)!.externalArrivals).toBe(10);
});

it('does not restart established legacy businesses at first-day demand', () => {
  const { state, room } = fixture();
  const saved = JSON.parse(serializeGame(state)); saved.version = 7;
  const loaded = deserializeGame(JSON.stringify(saved)); stepCommercialPopulation(loaded);
  expect(loaded.tenants.get(room.id)!.externalDemand).toBe(35);
});

it('supplies each fast-food business independently and does not double-reduce rainy demand', () => {
  const { state, room } = fixture();
  const second = placeTenant(state, 'fastfood', 2, 60); second.state = 'open';
  state.campaign.weather = 'rain'; stepCommercialPopulation(state);
  // Clear departing customers to isolate demand from transport and capacity.
  for (let minute = 720; minute < 780; minute++) {
    state.people.clear(); state.tickCount++; state.calendar.minuteOfDay = minute;
    stepPeople(state);
    if (minute === 720) {
      expect(room.externalArrivals).toBe(1);
      expect(second.externalArrivals).toBe(1);
    }
  }
  expect(room.externalArrivals).toBe(5);
  expect(second.externalArrivals).toBe(5);
});
