import { expect, it } from 'vitest';
import { newTestGame } from '../helpers/simHarness';
import { buildFloor, placeTenant, rebuildRouting } from '../../src/sim';
import { spawnTenantPeople, stepPeople, tenantCenter } from '../../src/sim/people';

function fixture() {
  const state = newTestGame();
  buildFloor(state, 2); buildFloor(state, 3);
  const office = placeTenant(state, 'office', 2, 30); office.state = 'open';
  spawnTenantPeople(state, office);
  const worker = [...state.people.values()].find(p => p.tenantId === office.id)!;
  state.people.clear(); state.people.set(worker.id, worker);
  worker.state = 'inTenant'; worker.pos = tenantCenter(state, office.id);
  worker.scheduleIndex = 1; worker.jitterTicks = 0;
  state.calendar.minuteOfDay = 720; rebuildRouting(state);
  return { state, office, worker };
}

it('returns workers to their office when lunch finishes', () => {
  const { state, office, worker } = fixture();
  worker.pos = { floor: 2, x: 90 }; worker.activityTicksLeft = 1;
  worker.scheduleDone = true;
  stepPeople(state);
  expect(worker.endState).toBe('inTenant');
  expect(worker.pos).toEqual(tenantCenter(state, office.id));
  expect(worker.state).toBe('inTenant');
});

it('ignores unreachable eateries and takes a break at the office', () => {
  const { state, office, worker } = fixture();
  const food = placeTenant(state, 'fastfood', 3, 60); food.state = 'open';
  rebuildRouting(state); stepPeople(state);
  expect(worker.activityTenantId).toBe(-1);
  expect(worker.failedTripsToday).toBe(0);
  expect(worker.pos.floor).toBe(office.floor);
});

it('does not bring an absent worker into the tower at lunchtime', () => {
  const { state, worker } = fixture(); worker.state = 'offscreen';
  stepPeople(state);
  expect(worker.state).toBe('offscreen');
  expect(worker.destination).toBeNull();
});

it('sends five of six office workers to fast food on weekdays', () => {
  const { state, office } = fixture();
  state.people.clear(); spawnTenantPeople(state, office);
  const workers = [...state.people.values()];
  for (const worker of workers) {
    worker.state = 'inTenant'; worker.pos = tenantCenter(state, office.id);
    worker.scheduleIndex = 1; worker.jitterTicks = 0;
  }
  const food = placeTenant(state, 'fastfood', 2, 60); food.state = 'open';
  rebuildRouting(state); stepPeople(state);
  expect(workers.filter(worker => worker.activityTenantId === food.id)).toHaveLength(5);
  expect(workers.filter(worker => worker.activityTenantId === -1)).toHaveLength(1);
});

it('does not send workers to fast food on weekends', () => {
  const { state, worker } = fixture();
  const food = placeTenant(state, 'fastfood', 2, 60); food.state = 'open';
  state.calendar.day = 3; worker.dayTracked = 3;
  rebuildRouting(state); stepPeople(state);
  expect(worker.activityTenantId).toBe(-1);
  expect(worker.activityTicksLeft).toBe(0);
});

it('does not substitute restaurants for office fast-food demand', () => {
  const { state, worker } = fixture();
  state.starLevel = 3;
  const restaurant = placeTenant(state, 'restaurant', 2, 60); restaurant.state = 'open';
  rebuildRouting(state); stepPeople(state);
  expect(worker.activityTenantId).toBe(-1);
  expect(restaurant.dailyRevenue).toBe(0);
});
