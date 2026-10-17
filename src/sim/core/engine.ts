import { stepCampaign } from '../campaign';
import { stepCommercialPopulation } from '../commercialPopulation';
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
import { stepScenario } from '../scenarios';
import { stepStats } from '../stats';

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
  const previousDay = state.calendar.day;
  stepTime(state);
  if (state.calendar.day !== previousDay) stepDailySettlement(state, previousDay);
  stepConstruction(state); // completes tenants and spawns their people
  stepCommercialPopulation(state);
  checkRouting(state); // rebuild routing tables on structural changes
  stepPeople(state); // schedules, visitors, walking, queue joins, give-ups
  stepElevators(state); // dispatch, movement, doors, boarding
  const residents = stepStress(state); // stress accrual/decay by state
  // Additions always take a fresh entity id and removals shrink the map, so
  // an unchanged size and id counter means the same people as stepStress saw.
  const peopleSize = state.people.size;
  const nextEntityId = state.nextEntityId;
  // Daily evaluation at 15:00 (everyone present), settlement at day end.
  if (
    state.calendar.minuteOfDay % 1440 >= CONFIG.EVAL_TIME_MIN &&
    state.evaluationDay !== state.calendar.day
  ) {
    state.evaluationDay = state.calendar.day;
    stepEvaluation(state);
  }
  stepCampaign(state);
  const unchanged = state.people.size === peopleSize && state.nextEntityId === nextEntityId;
  stepProgression(state, unchanged ? residents : undefined); // population-based star ratings
  stepScenario(state); // scenario goals and outcomes
  stepStats(state); // daily statistics for the graphs window
}
