import { CONFIG, isHotel } from '../data/config';
import { pushEvent } from './core/events';
import { removeTenantPeople, spawnTenantPeople } from './people';
import type { GameState } from './state';

/**
 * Daily tenant evaluation (JudgeT equivalent): grades from occupancy,
 * stress, cleanliness and security presence; offices/condos vacate when
 * conditions stay bad and refill when they recover. Runs at 15:00 when
 * everyone is present.
 */

function gradeFromScore(score: number): number {
  let grade = 0;
  for (const threshold of CONFIG.EVAL_GRADE_THRESHOLDS) {
    if (score >= threshold) grade++;
  }
  return grade;
}

export function stepEvaluation(state: GameState): void {
  const hasSecurity = [...state.tenants.values()].some(
    (t) => t.type === 'security' && t.state === 'open',
  );

  for (const tenant of state.tenants.values()) {
    if (tenant.type === 'lobby' || (tenant.state === 'constructing' || tenant.state === 'damaged')) continue;
    if (tenant.capacity <= 0) continue;

    // Condos grade on stress (residents are home most of the day); offices
    // grade on actual presence at the 15:00 evaluation.
    const ratio = tenant.type === 'condo' ? 1 : tenant.occupancy / tenant.capacity;
    const people = [...state.people.values()].filter((p) => p.tenantId === tenant.id);
    const avgStress = people.length
      ? people.reduce((sum, p) => sum + p.dayStress, 0) / people.length
      : 0;

    let score = 100 * ratio - avgStress * 0.6;
    if (isHotel(tenant.type)) score -= (100 - tenant.cleanliness) * 0.5;
    if (hasSecurity) score += 5;
    if ([...state.tenants.values()].some(t => t.type === 'medical' && t.state === 'open' && Math.abs(t.floor - tenant.floor) <= 20)) score += 5;
    score -= Math.max(0, state.campaign.waste - 30) * 0.3;
    tenant.evalScore = Math.min(Math.max(Math.round(score), 0), 100);
    tenant.grade = gradeFromScore(tenant.evalScore);

    if (tenant.type === 'office' || tenant.type === 'condo') {
      // Vacant units refill on a timer (an empty unit can't grade itself up).
      if (tenant.state === 'vacant') {
        tenant.daysGood++;
        if (tenant.daysGood >= CONFIG.EVAL_REPOPULATE_DAYS) {
          tenant.state = 'open';
          tenant.daysGood = 0;
          tenant.daysVacant = 0;
          spawnTenantPeople(state, tenant);
          pushEvent(state, {
            type: 'ALERT',
            message: `A ${tenant.type} on floor ${tenant.floor} has new occupants!`,
          });
        }
      } else {
        if (tenant.grade <= 1) {
          tenant.daysVacant++;
          tenant.daysGood = 0;
        } else {
          tenant.daysGood++;
          tenant.daysVacant = 0;
        }
        if (tenant.daysVacant >= CONFIG.EVAL_VACANCY_DAYS) {
          tenant.state = 'vacant';
          tenant.daysGood = 0;
          removeTenantPeople(state, tenant.id);
          pushEvent(state, {
            type: 'ALERT',
            message: `A ${tenant.type} on floor ${tenant.floor} has gone vacant!`,
          });
        }
      }
    }

    // A filthy hotel loses guests.
    if (
      isHotel(tenant.type) &&
      tenant.cleanliness < CONFIG.DIRTY_HOTEL_THRESHOLD &&
      tenant.occupancy > 0
    ) {
      for (const p of [...state.people.values()]) {
        if (p.kind === 'hotelGuest' && p.tenantId === tenant.id && p.state === 'inTenant') {
          state.people.delete(p.id);
          pushEvent(state, {
            type: 'ALERT',
            message: 'Guests are leaving your filthy hotel!',
          });
          break; // one departure per evaluation keeps it gradual
        }
      }
    }
  }
}
