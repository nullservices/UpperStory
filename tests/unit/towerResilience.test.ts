import { expect, it } from 'vitest';
import { CONFIG } from '../../src/data/config';
import { buildFloor, deserializeGame, placeElevatorGroup, placeTenant, rebuildRouting, serializeGame, tick } from '../../src/sim';
import { startIncident } from '../../src/sim/campaign';
import { newTestGame, tickN } from '../helpers/simHarness';

function towerWithLift() {
  const state = newTestGame(); state.starLevel = 5; state.money.balanceCents = 50_000_000_00;
  for (let f = 2; f <= 5; f++) buildFloor(state, f);
  const group = placeElevatorGroup(state, 1, 5, 10);
  rebuildRouting(state);
  return { state, group, car: group.cars[0]! };
}

it('a contractor eventually repairs a broken car no maintenance office covers, and bills it', () => {
  const { state, car } = towerWithLift();
  car.breakdownAtTick = state.tickCount + 1;
  tickN(state, 2);
  expect(car.outOfService).toBe(true);
  expect(car.contractorRepair).toBe(true);
  expect(state.campaign.history[0]!.message).toMatch(/contractor will fix it/);
  const loaded = deserializeGame(serializeGame(state));
  const loadedCar = [...loaded.elevatorGroups.values()][0]!.cars[0]!;
  tickN(loaded, CONFIG.CONTRACTOR_REPAIR_TICKS + 5);
  expect(loadedCar.outOfService).toBeUndefined();
  expect(loadedCar.contractorRepair).toBeUndefined();
  expect(loaded.campaign.history.some(h => /A contractor repaired an elevator car .* for \$10,000/.test(h.message))).toBe(true);
});

it('mechanics take over from a pending contractor once maintenance covers the shaft', () => {
  const { state, car } = towerWithLift();
  car.breakdownAtTick = state.tickCount + 1;
  tickN(state, 2);
  expect(car.contractorRepair).toBe(true);
  const office = placeTenant(state, 'maintenance', 3, 30);
  office.state = 'open'; office.constructionTicksLeft = 0;
  state.constructionQueue.length = 0;
  state.tower.structureRevision++;
  for (let i = 0; i < 400 && car.outOfService; i++) tick(state);
  expect(car.outOfService).toBeUndefined();
  expect(state.campaign.history.some(h => /Mechanics repaired/.test(h.message))).toBe(true);
  expect(state.campaign.history.some(h => /contractor repaired/i.test(h.message))).toBe(false);
});

it('one unanswered fire claims at most a small cluster of rooms', () => {
  const state = newTestGame(); state.starLevel = 5; state.money.balanceCents = 50_000_000_00;
  for (let f = 2; f <= 6; f++) buildFloor(state, f);
  const rooms = [];
  for (let f = 2; f <= 6; f++) for (let x = 20; x + 9 <= 200; x += 9) rooms.push(placeTenant(state, 'office', f, x));
  for (const room of rooms) { room.state = 'open'; room.constructionTicksLeft = 0; }
  state.constructionQueue.length = 0;
  startIncident(state, 'fire', rooms[Math.floor(rooms.length / 2)]!.id);
  tickN(state, CONFIG.DAY_TICKS);
  const damaged = rooms.filter(r => r.state === 'damaged').length;
  expect(damaged).toBeGreaterThanOrEqual(1);
  expect(damaged).toBeLessThanOrEqual(1 + CONFIG.FIRE_CHAIN_MAX_SPREAD + 2); // + up to two neighbours scorched at burn-out
});
