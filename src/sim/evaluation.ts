import { CONFIG, isHotel, isUngradedService } from '../data/config';
import { isWeekend } from './time';
import { pushEvent } from './core/events';
import { removeTenantPeople, spawnTenantPeople } from './people';
import type { GameState } from './state';
import { noiseIndex, noisePenalty } from './noise';
import { officeRentScoreAdjustment } from './money';
import { sellCondo, repurchaseCondo, condoHasAccess } from './condoEconomy';
import { floorLabel, tenantTypeLabel } from './campaign';

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
  const noise = noiseIndex(state);
  const medicalFloors = [...state.tenants.values()]
    .filter(t => t.type === 'medical' && t.state === 'open').map(t => t.floor);
  // Upper Story original: a helipad's medevac extends medical cover tower-wide.
  const medevac = medicalFloors.length > 0 && [...state.tenants.values()].some(t => t.type === 'helipad' && t.state === 'open');
  const poolFloors = [...state.tenants.values()]
    .filter(t => t.type === 'rooftopPool' && t.state === 'open').map(t => t.floor);
  // One pass over people instead of one per tenant. Each tenant only changes
  // its own roster below, after reading it, so the snapshot stays accurate.
  // Workers already travelling back to their own office (after lunch, or a
  // late commute) count as present: on wide floors the walk alone can take
  // hours of the compressed afternoon, and the trip's cost shows up as stress.
  const stressByTenant = new Map<number, { sum: number; count: number; enRoute: number }>();
  for (const p of state.people.values()) {
    const entry = stressByTenant.get(p.tenantId) ?? { sum: 0, count: 0, enRoute: 0 };
    entry.sum += p.dayStress;
    entry.count++;
    if (p.kind === 'officeWorker' && p.state !== 'inTenant' && p.state !== 'offscreen' && p.endState === 'inTenant' && p.destination) {
      const office = state.tenants.get(p.tenantId);
      if (office && p.destination.floor === office.floor && p.destination.x === office.x + office.sizeCells / 2) entry.enRoute++;
    }
    stressByTenant.set(p.tenantId, entry);
  }

  for (const tenant of state.tenants.values()) {
    if (tenant.type === 'lobby' || (tenant.state === 'constructing' || tenant.state === 'damaged')) continue;
    if (tenant.capacity <= 0 || isUngradedService(tenant.type)) continue;
    // Weekend absence is expected, not a failed commute. Retain the last
    // workday grade and dissatisfaction streak; vacant units still refill.
    if ((tenant.type === 'office' || tenant.type === 'bank') && tenant.state === 'open' && isWeekend(state)) continue;

    // Condos grade on stress (residents are home most of the day); offices
    // grade on actual presence at the 15:00 evaluation.
    const roster = stressByTenant.get(tenant.id);
    const ratio = tenant.type === 'condo' ? 1
      : tenant.type === 'office' ? Math.min(1, (tenant.occupancy + (roster?.enRoute ?? 0)) / tenant.capacity)
        : tenant.occupancy / tenant.capacity;
    const avgStress = roster ? roster.sum / roster.count : 0;

    let score = 100 * ratio - avgStress * 0.6;
    tenant.noisePenalty = noisePenalty(state, tenant, noise);
    score -= tenant.noisePenalty;
    if (tenant.type === 'office') {
      tenant.rentScoreAdjustment = officeRentScoreAdjustment(tenant);
      score += tenant.rentScoreAdjustment;
    }
    if (isHotel(tenant.type)) score -= (100 - tenant.cleanliness) * 0.5;
    if (hasSecurity) score += 5;
    if (medevac || medicalFloors.some(floor => Math.abs(floor - tenant.floor) <= 20)) score += 5;
    if ((tenant.type === 'condo' || isHotel(tenant.type)) && poolFloors.some(floor => Math.abs(floor - tenant.floor) <= CONFIG.POOL_REACH_FLOORS)) score += CONFIG.POOL_EVAL_BONUS;
    score -= Math.max(0, state.campaign.waste - 30) * 0.3;
    tenant.evalScore = Math.min(Math.max(Math.round(score), 0), 100);
    tenant.grade = gradeFromScore(tenant.evalScore);

    if (tenant.type === 'office' || tenant.type === 'condo') {
      // Vacant units refill on a timer (an empty unit can't grade itself up).
      if (tenant.state === 'vacant') {
        if (tenant.type === 'condo' && !condoHasAccess(state, tenant)) {
          tenant.daysGood = 0;
          continue;
        }
        tenant.daysGood++;
        if (tenant.daysGood >= CONFIG.EVAL_REPOPULATE_DAYS) {
          tenant.state = 'open';
          sellCondo(tenant);
          tenant.daysGood = 0;
          tenant.daysVacant = 0;
          spawnTenantPeople(state, tenant);
          pushEvent(state, {
            type: 'ALERT',
            message: `${tenantTypeLabel(tenant.type)} on ${floorLabel(tenant.floor)} has new occupants`,
            tenantId: tenant.id, floor: tenant.floor, kind: 'occupied',
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
        const minimumTermComplete = tenant.type !== 'office' || state.tickCount >= (tenant.officeLeaseUntilTick ?? 0);
        if (tenant.daysVacant >= CONFIG.EVAL_VACANCY_DAYS && minimumTermComplete) {
          tenant.state = 'vacant';
          repurchaseCondo(tenant);
          delete tenant.officeLeaseUntilTick;
          tenant.daysGood = 0;
          removeTenantPeople(state, tenant.id);
          pushEvent(state, {
            type: 'ALERT',
            message: `${tenantTypeLabel(tenant.type)} on ${floorLabel(tenant.floor)} has gone vacant`,
            tenantId: tenant.id, floor: tenant.floor, kind: 'vacancy',
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
            message: `Guests are leaving a filthy ${tenantTypeLabel(tenant.type).toLowerCase()} on ${floorLabel(tenant.floor)}: send housekeeping`,
            tenantId: tenant.id, floor: tenant.floor, kind: 'filthyHotel',
          });
          break; // one departure per evaluation keeps it gradual
        }
      }
    }
  }
}
