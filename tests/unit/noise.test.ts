import { expect, it } from 'vitest';
import { newTestGame } from '../helpers/simHarness';
import { buildFloor, placeTenant, stepEvaluation } from '../../src/sim';
import { noisePenalty, noiseSources } from '../../src/sim/noise';

it('uses edge spacing and clears office noise at eleven cells', () => {
  const state = newTestGame(); buildFloor(state, 2);
  const office = placeTenant(state, 'office', 2, 20); office.state = 'open';
  const food = placeTenant(state, 'fastfood', 2, 39); food.state = 'open';
  expect(noisePenalty(state, office)).toBe(20);
  expect(noiseSources(state, office)).toEqual([{ tenantId: food.id, gap: 10, clearance: 11 }]);
  office.occupancy = office.capacity; stepEvaluation(state);
  expect(office.noisePenalty).toBe(20);
  expect(office.evalScore).toBe(80);
  food.x++;
  expect(noisePenalty(state, office)).toBe(0);
  stepEvaluation(state); expect(office.evalScore).toBe(100);
});

it.each(['hotel', 'hotelTwin', 'hotelSuite'] as const)('requires twenty-one cells between %s and an office', type => {
  const state = newTestGame(); state.starLevel = 5; buildFloor(state, 2);
  const office = placeTenant(state, 'office', 2, 20); office.state = 'open';
  const hotel = placeTenant(state, type, 2, 49); hotel.state = 'open';
  expect(noisePenalty(state, hotel)).toBe(20);
  hotel.x++; expect(noisePenalty(state, hotel)).toBe(0);
  hotel.x--; office.state = 'vacant'; expect(noisePenalty(state, hotel)).toBe(0);
  office.state = 'open'; office.floor = 3; expect(noisePenalty(state, hotel)).toBe(0);
});
