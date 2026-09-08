import { CONFIG } from '../data/config';
import type { GameState } from './state';

/**
 * Stress accrual (StressT equivalent). Stress grows while moving/waiting and
 * decays while at rest; waiting in a tall lobby stresses more
 * (CalcLobbyStress equivalent). Patience while queuing scales with stress.
 */

export function patienceTicks(stress: number): number {
  return CONFIG.PATIENCE_BASE_TICKS + stress / CONFIG.PATIENCE_STRESS_DIVISOR;
}

/** Multiplier for queue-wait stress on a floor (worse higher up). */
export function lobbyWaitStressMultiplier(floor: number): number {
  if (floor <= CONFIG.LOBBY_FLOOR_INDEX) return 1;
  return 1 + (floor - CONFIG.LOBBY_FLOOR_INDEX) * CONFIG.LOBBY_STRESS_HEIGHT_FACTOR;
}

/** Per-tick stress accrual/decay for every person, by current state. */
export function stepStress(state: GameState): void {
  for (const p of state.people.values()) {
    let delta: number;
    switch (p.state) {
      case 'walking':
        delta = CONFIG.STRESS_WALK_PER_TICK;
        break;
      case 'waiting':
        delta = CONFIG.STRESS_WAIT_PER_TICK * lobbyWaitStressMultiplier(p.pos.floor);
        break;
      case 'onStairs':
        delta = CONFIG.STRESS_STAIR_PER_TICK;
        break;
      case 'riding':
      case 'onEscalator':
        delta = CONFIG.STRESS_RIDE_PER_TICK;
        break;
      default: {
        // At rest — except guests stuck in a dirty hotel.
        delta = -CONFIG.STRESS_DECAY_PER_TICK;
        if (p.state === 'inTenant' && p.kind === 'hotelGuest') {
          const hotel = state.tenants.get(p.tenantId);
          if (
            hotel &&
            hotel.type === 'hotel' &&
            hotel.cleanliness < CONFIG.DIRTY_HOTEL_THRESHOLD
          ) {
            delta = CONFIG.DIRTY_HOTEL_STRESS_PER_TICK;
          }
        }
        break;
      }
    }
    p.stress = Math.min(Math.max(p.stress + delta, 0), CONFIG.STRESS_MAX);
    p.dayStress = Math.max(0, p.dayStress + Math.max(delta, 0));
  }
}
