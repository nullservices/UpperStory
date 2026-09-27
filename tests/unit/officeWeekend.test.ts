import { expect, it } from 'vitest';
import { deserializeGame, serializeGame, spawnTenantPeople, stepEvaluation } from '../../src/sim';
import { stepPeople } from '../../src/sim/people';
import { newTestGame, scenarioTower, setClock } from '../helpers/simHarness';

it('keeps workers offscreen through a saved weekend and resumes the next weekday', () => {
  let state = newTestGame(); scenarioTower(state); state.calendar.day = 3;
  setClock(state, 480);
  const office = [...state.tenants.values()].find(t => t.type === 'office')!;
  office.state = 'open'; spawnTenantPeople(state, office);
  for (const minute of [600, 750, 810, 1110]) {
    setClock(state, minute); stepPeople(state);
    expect([...state.people.values()].filter(p => p.tenantId === office.id).every(p => p.state === 'offscreen' && p.route === null)).toBe(true);
    state = deserializeGame(serializeGame(state));
  }
  const workers = [...state.people.values()].filter(p => p.tenantId === office.id);
  expect(workers).toHaveLength(6);
  expect(workers.every(p => p.failedTripsToday === 0)).toBe(true);
  state.calendar.day = 4; setClock(state, 600); stepPeople(state);
  expect(workers.every(p => p.state === 'walking')).toBe(true);
});

it('preserves weekend office grades and dissatisfaction, then evaluates the next workday', () => {
  const state = newTestGame(); scenarioTower(state);
  const office = [...state.tenants.values()].find(t => t.type === 'office')!;
  Object.assign(office, { state: 'open', occupancy: 0, grade: 4, evalScore: 80, daysVacant: 1, daysGood: 0 });
  state.calendar.day = 3; stepEvaluation(state);
  expect(office).toMatchObject({ state: 'open', grade: 4, evalScore: 80, daysVacant: 1, daysGood: 0 });
  state.calendar.day = 4; stepEvaluation(state);
  expect(office.grade).toBe(0);
  expect(office.daysVacant).toBe(2);
});

it('still advances vacant office repopulation on weekends', () => {
  const state = newTestGame(); scenarioTower(state); state.calendar.day = 3;
  const office = [...state.tenants.values()].find(t => t.type === 'office')!;
  Object.assign(office, { state: 'vacant', daysGood: 0 });
  stepEvaluation(state);
  expect(office.daysGood).toBe(1);
});
