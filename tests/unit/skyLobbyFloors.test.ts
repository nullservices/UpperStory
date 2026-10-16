import { expect, it } from 'vitest';
import { buildFloor, placementError, placeTenant } from '../../src/sim';
import { newTestGame } from '../helpers/simHarness';

it('allows sky lobbies only on floors 15, 30, 45, 60, 75 and 90', () => {
  const state = newTestGame();
  state.starLevel = 5;
  state.money.balanceCents = 200_000_000_00;
  for (let f = 2; f <= 91; f++) buildFloor(state, f);
  for (const f of [2, 14, 16, 29, 50, 91]) {
    expect(placementError(state, 'skyLobby', f, 0)).toBe('Sky lobbies go on floors 15, 30, 45, 60, 75 and 90');
  }
  for (const f of [15, 30, 45, 60, 75, 90]) {
    expect(placementError(state, 'skyLobby', f, 0)).toBeNull();
    expect(placeTenant(state, 'skyLobby', f, 0).floor).toBe(f);
  }
});
