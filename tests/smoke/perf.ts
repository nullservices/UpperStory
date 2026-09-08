/**
 * Sim-side performance smoke: a 100-floor tower dense with offices and
 * condos (~3,000 people), ticking a full in-game day. The wall-clock budget
 * leaves headroom for the 5,000-person target at the realtime tick rate
 * (100 ms per tick at 1x).
 */
import { CONFIG } from '../../src/data/config';
import {
  buildFloor,
  createInitialState,
  placeElevatorGroup,
  placeTenant,
  population,
  setupNewGame,
  tick,
} from '../../src/sim';

const state = createInitialState(20260907);
setupNewGame(state);
state.money.balanceCents = 1_000_000_000_00; // $1B builds the test tower
state.starLevel = 5;

for (let i = 2; i <= 100; i++) buildFloor(state, i);
// Local shafts stack in 28-floor segments up the tower (max 29 per shaft).
for (const col of [15, 30, 45]) {
  for (let lo = 2; lo <= 100; lo += 28) {
    placeElevatorGroup(state, lo, Math.min(lo + 27, 100), col);
  }
}
// Free bands between the shafts at cols 15/30/45: 2..13, 18..28, 33..43, 48..58.
for (let f = 2; f <= 100; f++) {
  if (f % 2 === 0) {
    placeTenant(state, 'office', f, 18);
    placeTenant(state, 'office', f, 33);
    placeTenant(state, 'hotel', f, 48); // guests flow in through the day
    placeTenant(state, 'fastfood', f, 2); // lunch-rush diners at scale
  } else {
    for (const x of [8, 18, 24, 33, 39, 48, 54]) {
      placeTenant(state, 'condo', f, x);
    }
  }
}

// Construction completes (offices take 1,300 ticks), then a full busy day.
const t0 = performance.now();
for (let i = 0; i < 4_000; i++) tick(state);
const wallMs = performance.now() - t0;

const pop = population(state);
const offices = [...state.tenants.values()].filter((t) => t.type === 'office').length;
const condos = [...state.tenants.values()].filter((t) => t.type === 'condo').length;

console.log(
  JSON.stringify(
    {
      wallMs: Math.round(wallMs),
      ticks: 4_000,
      msPerTick: Number((wallMs / 4_000).toFixed(3)),
      population: pop,
      offices,
      condos,
      floors: state.tower.floors.length,
    },
    null,
    2,
  ),
);

if (pop < 1_500) {
  console.error(`perf FAILED: expected a dense population, got ${pop}`);
  process.exit(1);
}
// Budget: the realtime tick rate is 100 ms; 10 ms/tick leaves 10x headroom.
if (wallMs > 40_000) {
  console.error(`perf FAILED: 4,000 ticks took ${wallMs} ms (> 40 s)`);
  process.exit(1);
}
console.log(`perf OK (${CONFIG.MAX_PEOPLE.toLocaleString()} people cap)`);
