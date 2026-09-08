/**
 * Headless smoke run: builds the scenario tower (elevator + stairs + office +
 * condo), runs through a full day and the next morning's commute, and checks
 * sim invariants. Exits non-zero on failure.
 */
import { CONFIG } from '../../src/data/config';
import { createInitialState, population, setupNewGame } from '../../src/sim';
import { scenarioTower, tickN } from '../helpers/simHarness';

const state = createInitialState(20260907);
setupNewGame(state);
scenarioTower(state);

// Day 1: construction + settling; day 2: morning commute, checked at 11:30
// (before the lunch rush and the residents' 12:00 trip home).
tickN(state, 1_400);
tickN(state, CONFIG.DAY_TICKS - state.calendar.tickOfDay + 160);
tickN(state, 200);

const people = [...state.people.values()];
const byState = new Map<string, number>();
for (const p of people) byState.set(p.state, (byState.get(p.state) ?? 0) + 1);
const avgStress = people.reduce((sum, p) => sum + p.stress, 0) / Math.max(people.length, 1);

const summary = {
  day: state.calendar.day,
  timeOfDay: state.calendar.minuteOfDay,
  tickCount: state.tickCount,
  floors: state.tower.floors.map((f) => f.index),
  population: population(state),
  peopleByState: Object.fromEntries(byState),
  avgStress: Number(avgStress.toFixed(2)),
  elevators: [...state.elevatorGroups.values()].map((g) => ({
    service: [g.serviceLo, g.serviceHi],
    cars: g.cars.map((c) => ({ y: c.y, state: c.state, passengers: c.passengers.length })),
  })),
  moneyCents: state.money.balanceCents,
  queues: Object.fromEntries(
    Object.entries(state.queues).filter(([, q]) => q.length > 0),
  ),
};
console.log(JSON.stringify(summary, null, 2));

// Invariants
const fail = (msg: string): never => {
  console.error(`smoke FAILED: ${msg}`);
  process.exit(1);
};

if (state.calendar.day < 2) fail('expected the day to have rolled over');
if (population(state) !== 9) fail(`expected 9 people, got ${population(state)}`);
// Healthy tower: everyone commutes, nobody gives up.
for (const p of people) {
  if (p.failedTripsToday > 0) fail(`person ${p.id} failed ${p.failedTripsToday} trips`);
  if (p.kind === 'officeWorker' && p.state !== 'inTenant') {
    fail(`worker ${p.id} is ${p.state} during work hours`);
  }
}
// All queues drained after the morning rush.
if (Object.values(state.queues).some((q) => q.length > 0)) {
  fail('queues should be drained after the morning rush');
}
// Occupancy: the two offices are full during work hours.
for (const t of state.tenants.values()) {
  if (t.type === 'office' && t.occupancy !== t.capacity) {
    fail(`office ${t.id} occupancy ${t.occupancy}/${t.capacity}`);
  }
}
console.log('smoke OK');
