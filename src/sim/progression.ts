import { PROGRESSION } from '../data/config';
import { pushEvent } from './core/events';
import { recordEvent } from './campaign';
import { population } from './people';
import { pickupRoute } from './routing';
import { isWeekend } from './time';
import type { GameState } from './state';
import type { TenantType } from './tenants';

export interface RatingRequirement { label: string; met: boolean }

/** A requirement whose check runs only when asked; `cost` orders lazy evaluation. */
interface LazyRequirement { label: string; cost: number; check: () => boolean }

function lazyRequirements(state: GameState, star: number, people?: number): LazyRequirement[] {
  const gate = PROGRESSION.find(g => g.star === star);
  if (!gate) return [];
  const open = (type: TenantType): boolean => {
    for (const t of state.tenants.values()) if (t.type === type && t.state === 'open') return true;
    return false;
  };
  // Weekend population dips while offices are closed, so the finale's head
  // count is booked once met rather than re-checked during the wedding itself.
  const booked = star === 6 && state.campaign.weddingBookedDay !== undefined;
  const requirements: LazyRequirement[] = [{ label: `${gate.population.toLocaleString()} people`, cost: 2, check: () => booked || (people ?? population(state)) >= gate.population }];
  if (star >= 3) requirements.push({ label: 'Open security office', cost: 1, check: () => open('security') });
  if (star >= 4) requirements.push(
    { label: 'Open hotel suite', cost: 1, check: () => open('hotelSuite') },
    { label: 'Favorable VIP inspection', cost: 0, check: () => state.campaign.vipApproved },
    { label: 'Open recycling center', cost: 1, check: () => open('recycling') },
    { label: 'Open medical center', cost: 1, check: () => open('medical') });
  if (star >= 5) requirements.push({ label: 'Open metro station with passenger access', cost: 3, check: () => {
    for (const t of state.tenants.values()) if (t.type === 'metro' && t.state === 'open' && pickupRoute(state, 1, t.floor, 'shopper') !== null) return true;
    return false;
  } });
  if (star === 6) requirements.push(
    { label: 'Cathedral at the top of a 100-floor tower', cost: 3, check: () => cathedralReady(state) },
    { label: 'Weekend wedding at noon', cost: 0, check: () => isWeekend(state) && state.calendar.minuteOfDay >= 720 && state.calendar.minuteOfDay < 780 });
  return requirements;
}

export function progressionRequirements(state: GameState, star: number): RatingRequirement[] {
  return lazyRequirements(state, star).map(r => ({ label: r.label, met: r.check() }));
}

/** Same verdict as every requirement being met, checking the cheapest first. */
function requirementsMet(state: GameState, star: number, people: number): boolean {
  return lazyRequirements(state, star, people).sort((a, b) => a.cost - b.cost).every(r => r.check());
}

function cathedralReady(state: GameState): boolean {
  for (const t of state.tenants.values()) {
    if (t.type === 'cathedral' && t.state === 'open' && t.floor === 97 && pickupRoute(state, 1, t.floor, 'resident') !== null) return true;
  }
  return false;
}

/** `residents`: an exact count of people toward population, when already known. */
export function stepProgression(state: GameState, residents?: number): void {
  // Runs every tick: count heads once; requirement checks run cheapest first.
  const people = population(state, residents);
  const finale = PROGRESSION.find(g => g.star === 6);
  if (finale && state.starLevel === 5 && state.campaign.weddingBookedDay === undefined &&
      people >= finale.population && cathedralReady(state)) {
    state.campaign.weddingBookedDay = state.calendar.day;
    recordEvent(state, 'A wedding has been booked at the cathedral for the next weekend at noon.');
  }
  for (const gate of PROGRESSION) {
    if (state.starLevel >= gate.star) continue;
    if (!requirementsMet(state, gate.star, people)) break;
    state.starLevel = gate.star;
    pushEvent(state, { type: 'LEVEL_UP', starLevel: gate.star });
    if (gate.star === 6) {
      state.campaign.weddingHeld = true;
      recordEvent(state, 'Wedding bells ring from the cathedral. Your building has earned the TOWER rating!');
    } else recordEvent(state, `Tower rated ${gate.star} stars. New facilities are available.`);
  }
}
