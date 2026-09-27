import { expect, it } from 'vitest';
import { newTestGame } from '../helpers/simHarness';
import { buildFloor, placeTenant, stepEvaluation } from '../../src/sim';
import { noisePenalty, noiseSources } from '../../src/sim/noise';
import type { TenantType } from '../../src/sim';

it('uses edge spacing and clears office noise at eleven cells', () => {
  const state = newTestGame(); buildFloor(state, 2);
  const office = placeTenant(state, 'office', 2, 20); office.state = 'open';
  const food = placeTenant(state, 'fastfood', 2, 39); food.state = 'open';
  expect(noisePenalty(state, office)).toBe(20);
  expect(noiseSources(state, office)).toEqual([{ tenantId: food.id, gap: 10, clearance: 11, floorDistance: 0 }]);
  office.occupancy = office.capacity; stepEvaluation(state);
  expect(office.noisePenalty).toBe(20);
  expect(office.evalScore).toBe(80);
  food.x++;
  expect(noisePenalty(state, office)).toBe(0);
  stepEvaluation(state); expect(office.evalScore).toBe(100);
});

for (const receiver of ['office', 'condo', 'hotel', 'hotelTwin', 'hotelSuite'] as const) {
  it.each(['fastfood', 'restaurant', 'shop', 'cinema'] satisfies TenantType[])(`${receiver} reacts to nearby %s without stacking complaints`, sourceType => {
    const state = newTestGame(); state.starLevel = 5; buildFloor(state, 2);
    // Use a valid separated layout, then exercise distance evaluation directly.
    const tenant = placeTenant(state, receiver, 2, 20); tenant.state = 'open';
    const source = placeTenant(state, 'fastfood', 2, 100); source.state = 'open'; source.type = sourceType;
    const clearance = receiver === 'office' ? 11 : 21;
    source.x = tenant.x + tenant.sizeCells + clearance - 1;
    expect(noiseSources(state, tenant)).toEqual([{ tenantId: source.id, gap: clearance - 1, clearance, floorDistance: 0 }]);
    const duplicate = { ...source, id: 999 };
    state.tenants.set(duplicate.id, duplicate);
    expect(noisePenalty(state, tenant)).toBe(20);
    source.x++; duplicate.x++;
    expect(noisePenalty(state, tenant)).toBe(0);
    source.x--; source.state = 'damaged';
    expect(noisePenalty(state, tenant)).toBe(0);
  });
}

it('condos react to offices, while offices do not complain about other offices', () => {
  const state = newTestGame(); state.starLevel = 5; buildFloor(state, 2);
  const condo = placeTenant(state, 'condo', 2, 20); condo.state = 'open';
  const office = placeTenant(state, 'office', 2, 70); office.state = 'open';
  office.x = condo.x + condo.sizeCells + 20;
  expect(noisePenalty(state, condo)).toBe(20);
  expect(noisePenalty(state, office)).toBe(0);
  stepEvaluation(state); expect(condo.noisePenalty).toBe(20);
});

it.each(['hotel', 'hotelTwin', 'hotelSuite'] as const)('requires twenty-one cells between %s and an office', type => {
  const state = newTestGame(); state.starLevel = 5; buildFloor(state, 2);
  const office = placeTenant(state, 'office', 2, 20); office.state = 'open';
  const hotel = placeTenant(state, type, 2, 49); hotel.state = 'open';
  expect(noisePenalty(state, hotel)).toBe(20);
  hotel.x++; expect(noisePenalty(state, hotel)).toBe(0);
  hotel.x--; office.state = 'vacant'; expect(noisePenalty(state, hotel)).toBe(0);
  office.state = 'open'; office.floor = 4; expect(noisePenalty(state, hotel)).toBe(0);
});

it('propagates above and below a two-story cinema, including its upper occupied band', () => {
  const state = newTestGame(); state.starLevel = 5; state.money.balanceCents = 2_000_000_000;
  for (let f = 2; f <= 7; f++) buildFloor(state, f);
  const cinema = placeTenant(state, 'cinema', 3, 20); cinema.state = 'open';
  const office = placeTenant(state, 'office', 2, 100); office.state = 'open'; office.x = 20;
  for (const [floor, distance] of [[2, 1], [4, 0], [5, 1]]) {
    office.floor = floor!;
    expect(noiseSources(state, office)).toEqual([{ tenantId: cinema.id, gap: 0, clearance: 11, floorDistance: distance }]);
  }
  office.floor = 6; expect(noisePenalty(state, office)).toBe(0);
  office.floor = 5; office.x = cinema.x + cinema.sizeCells + 11;
  expect(noisePenalty(state, office)).toBe(0);
  office.x--; expect(noisePenalty(state, office)).toBe(20);
  cinema.state = 'damaged'; expect(noisePenalty(state, office)).toBe(0);
});
