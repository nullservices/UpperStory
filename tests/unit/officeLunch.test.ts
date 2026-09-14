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
