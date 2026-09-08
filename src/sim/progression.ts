import { PROGRESSION } from '../data/config';
import { pushEvent } from './core/events';
import { population } from './people';
import type { GameState } from './state';

/**
 * Star progression (LevelT/LevelUp equivalent): population gates raise the
 * tower's star level, which unlocks tenant types (checked via isUnlocked).
 */
export function stepProgression(state: GameState): void {
  for (const gate of PROGRESSION) {
    if (state.starLevel >= gate.star) continue;
    if (population(state) < gate.population) break; // gates are ascending
    state.starLevel = gate.star;
    pushEvent(state, { type: 'LEVEL_UP', starLevel: gate.star });
    pushEvent(state, {
      type: 'ALERT',
      message: `Tower rated ${gate.star}★! New facilities are available.`,
    });
  }
}
