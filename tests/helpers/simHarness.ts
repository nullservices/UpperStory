import {
  buildFloor,
  createInitialState,
  minuteToTick,
  placeElevatorGroup,
  placeStair,
  placeTenant,
  rebuildRouting,
  setupNewGame,
  tick,
  type GameState,
  type SimEvent,
} from '../../src/sim';

/** Fresh game: B1 + lobby floor + full-width lobby + $2M starting funds. */
export function newTestGame(seed = 1): GameState {
  const state = createInitialState(seed);
  setupNewGame(state);
  return state;
}

export function tickN(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) tick(state);
}

/** Tick while collecting the event stream. */
export function tickCollecting(state: GameState, n: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    tick(state);
    events.push(...state.events);
  }
  return events;
}

/** Jump the clock to a minute-of-day (before the next tick advances it). */
export function setClock(state: GameState, minuteOfDay: number): void {
  state.calendar.tickOfDay = minuteToTick(minuteOfDay);
  state.calendar.minuteOfDay = minuteOfDay;
}

/**
 * Standard M2 scenario: floors 1-5, a stair column at x=4 on floors 2-3, an
 * elevator (col 10) serving floors 1-5, one office (floor 2, x=20) and one
 * condo (floor 3, x=20).
 */
export function scenarioTower(state: GameState): void {
  for (let i = 2; i <= 5; i++) buildFloor(state, i);
  placeStair(state, 2, 4);
  placeStair(state, 3, 4);
  placeElevatorGroup(state, 1, 5, 10);
  placeTenant(state, 'office', 2, 20);
  placeTenant(state, 'condo', 3, 20);
  rebuildRouting(state); // routing tests inspect tables without ticking
}
