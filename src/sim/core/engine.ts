import { CONFIG } from '../../data/config';
import { stepElevators } from '../elevators';
import { stepEvaluation } from '../evaluation';
import { stepPeople } from '../people';
import { stepProgression } from '../progression';
import { checkRouting } from '../routing';
import { stepStress } from '../stress';
import { stepConstruction } from '../tenants';
import { stepTime } from '../time';
import { stepDailySettlement } from '../money';
import type { GameState } from '../state';

/**
 * One simulation step. Systems run in a FIXED order — this is the heart of
 * determinism: same seed + same command sequence = identical state.
 *
 * Order (per plan): time → tenants (construction/completion/state) → people
 * schedules/activities → routing needs → queues/boarding → elevators move →
 * stress → evaluation (if due) → money settlement (if due) → progression check.
 * Within a system, iterate insertion-ordered arrays only (never Map/Set order).
 */
export function tick(state: GameState): void {
  state.tickCount++;
  state.events.length = 0;
  stepTime(state);
  stepConstruction(state); // completes tenants and spawns their people
  checkRouting(state); // rebuild routing tables on structural changes
  stepPeople(state); // schedules, visitors, walking, queue joins, give-ups
  stepElevators(state); // dispatch, movement, doors, boarding
  stepStress(state); // stress accrual/decay by state
  // Daily evaluation at 15:00 (everyone present), settlement at day end.
  if (
    state.calendar.minuteOfDay >= CONFIG.EVAL_TIME_MIN &&
    state.evaluationDay !== state.calendar.day
  ) {
    state.evaluationDay = state.calendar.day;
    stepEvaluation(state);
  }
  if (state.calendar.tickOfDay === CONFIG.DAY_TICKS - 1) {
    stepDailySettlement(state);
  }
  stepProgression(state); // population-based star ratings
}
