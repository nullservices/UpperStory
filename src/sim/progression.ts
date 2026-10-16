import { PROGRESSION } from '../data/config';
import { pushEvent } from './core/events';
import { recordEvent } from './campaign';
import { population } from './people';
import { pickupRoute } from './routing';
import { isWeekend } from './time';
import type { GameState } from './state';
import type { TenantType } from './tenants';

export interface RatingRequirement { label: string; met: boolean }
export function progressionRequirements(state: GameState, star: number): RatingRequirement[] {
  const gate = PROGRESSION.find(g => g.star === star);
  if (!gate) return [];
  const open = (type: TenantType) => [...state.tenants.values()].some(t => t.type === type && t.state === 'open');
  // Weekend population dips while offices are closed, so the finale's head
  // count is booked once met rather than re-checked during the wedding itself.
  const booked = star === 6 && state.campaign.weddingBookedDay !== undefined;
  const requirements: RatingRequirement[] = [{ label: `${gate.population.toLocaleString()} people`, met: booked || population(state) >= gate.population }];
  if (star >= 3) requirements.push({ label: 'Open security office', met: open('security') });
  if (star >= 4) requirements.push(
    { label: 'Open hotel suite', met: open('hotelSuite') },
    { label: 'Favorable VIP inspection', met: state.campaign.vipApproved },
    { label: 'Open recycling center', met: open('recycling') },
    { label: 'Open medical center', met: open('medical') });
  if (star >= 5) requirements.push({ label: 'Open metro station with passenger access', met: [...state.tenants.values()].some(t => t.type === 'metro' && t.state === 'open' && pickupRoute(state, 1, t.floor, 'shopper') !== null) });
  if (star === 6) requirements.push(
    { label: 'Cathedral at the top of a 100-floor tower', met: cathedralReady(state) },
    { label: 'Weekend wedding at noon', met: isWeekend(state) && state.calendar.minuteOfDay >= 720 && state.calendar.minuteOfDay < 780 });
  return requirements;
}
function cathedralReady(state: GameState): boolean {
  return [...state.tenants.values()].some(t => t.type === 'cathedral' && t.state === 'open' && t.floor === 97 && pickupRoute(state, 1, t.floor, 'resident') !== null);
}

export function stepProgression(state: GameState): void {
  const finale = PROGRESSION.find(g => g.star === 6);
  if (finale && state.starLevel === 5 && state.campaign.weddingBookedDay === undefined &&
      population(state) >= finale.population && cathedralReady(state)) {
    state.campaign.weddingBookedDay = state.calendar.day;
    recordEvent(state, 'A wedding has been booked at the cathedral for the next weekend at noon.');
  }
  for (const gate of PROGRESSION) {
    if (state.starLevel >= gate.star) continue;
    if (!progressionRequirements(state, gate.star).every(r => r.met)) break;
    state.starLevel = gate.star;
    pushEvent(state, { type: 'LEVEL_UP', starLevel: gate.star });
    if (gate.star === 6) {
      state.campaign.weddingHeld = true;
      recordEvent(state, 'Wedding bells ring from the cathedral. Your building has earned the TOWER rating!');
    } else recordEvent(state, `Tower rated ${gate.star} stars. New facilities are available.`);
  }
}
