import { CONFIG } from '../data/config';
import { tick } from './core/engine';
import { placeElevatorGroup } from './elevators';
import { setupNewGame, type GameState } from './state';
import { placeTenant } from './tenants';
import { buildFloor, placeStair } from './tower';

/** Repeatable transport scenario, independent of the showcase demo. */
export function setupReferenceTower(state: GameState): void {
  setupNewGame(state);
  for (let floor = 2; floor <= 10; floor++) buildFloor(state, floor);
  placeElevatorGroup(state, 1, 10, 10);
  placeStair(state, 2, 4);
  placeStair(state, 3, 4);
  for (let floor = 2; floor <= 10; floor++) {
    if (floor <= 3) {
      for (const x of [20, 24, 28]) placeTenant(state, 'fastfood', floor, x);
    } else if (floor <= 7) {
      for (const x of [20, 34]) placeTenant(state, 'office', floor, x);
    } else {
      for (const x of [20, 26, 32, 38]) placeTenant(state, 'condo', floor, x);
    }
  }
  // Finish construction, then open at the beginning of the next morning.
  for (let i = 0; i < CONFIG.DAY_TICKS; i++) tick(state);
  state.events.length = 0;
}
