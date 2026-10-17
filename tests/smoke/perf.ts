/**
 * Sim-side performance smoke: a 100-floor tower dense with offices and
 * condos (over 15,000 people), ticking a full in-game day. The wall-clock budget
 * leaves headroom for the 15,000-person endgame at the realtime tick rate
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
setupNewGame(state, true); // fixture: prebuilt full-width lobby
state.money.balanceCents = 1_000_000_000_00; // $1B builds the test tower
state.starLevel = 5;

for (let i = 2; i <= 100; i++) buildFloor(state, i);
// Express backbone (6 cells) and 4-cell local banks make every office reachable from the lobby.
for (let f = 15; f <= 90; f += 15) placeTenant(state, 'skyLobby', f, 0);
placeElevatorGroup(state, 1, 90, 0, 'express');
for (let lo = 1, bank = 0; lo < 100; lo = lo === 1 ? 15 : lo + 15, bank++) {
  placeElevatorGroup(state, lo, Math.min(lo + 15, 100), 10 + bank * 5);
}
for (let f = 2; f <= 100; f++) {
  for (let x = 50; x < 320; x += 9) placeTenant(state, 'office', f, x);
}
// Second-wave venues and rental homes, so their off-peak trips are measured too.
const VENUES = ['gym', 'bar', 'supermarket', 'apartment', 'conference'] as const;
for (let f = 2; f < 100; f++) {
  const type = VENUES[f % VENUES.length]!;
  placeTenant(state, type, f, 322);
  if (type === 'apartment') placeTenant(state, type, f, 340);
}
placeTenant(state, 'observationDeck', 100, 322);

// Construction completes (offices take 1,300 ticks), then a full busy day.
const t0 = performance.now();
let worstTickMs = 0;
for (let i = 0; i < 4_000; i++) {
  const start = performance.now();
  tick(state);
  worstTickMs = Math.max(worstTickMs, performance.now() - start);
}
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
      worstTickMs: Number(worstTickMs.toFixed(1)),
      population: pop,
      offices,
      condos,
      floors: state.tower.floors.length,
    },
    null,
    2,
  ),
);

if (pop < 15_000) {
  console.error(`perf FAILED: expected a dense population, got ${pop}`);
  process.exit(1);
}
// Budget: the realtime tick rate is 100 ms; 10 ms/tick leaves 10x headroom.
if (wallMs > 40_000) {
  console.error(`perf FAILED: 4,000 ticks took ${wallMs} ms (> 40 s)`);
  process.exit(1);
}
// One slow tick is a visible hitch even when the average is fine (e.g. the
// daily 15:00 evaluation). 150 ms leaves ~5x headroom for slower CI machines.
if (worstTickMs > 150) {
  console.error(`perf FAILED: slowest tick took ${worstTickMs.toFixed(1)} ms (> 150 ms)`);
  process.exit(1);
}
console.log(`perf OK (${CONFIG.MAX_PEOPLE.toLocaleString()} people cap)`);
