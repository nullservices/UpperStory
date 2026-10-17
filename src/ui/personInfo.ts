import { CONFIG } from '../data/config';
import { floorLabel, tenantTypeLabel } from '../sim/campaign';
import { patienceTicks } from '../sim/stress';
import { tickToMinute } from '../sim/time';
import type { GameState } from '../sim/state';
import type { Person } from '../sim/people';
import type { Tenant } from '../sim/tenants';

/**
 * Plain-words descriptions of one person for the person card and People
 * window: who they are, what they are doing right now, how stressed they
 * are. Read-only and DOM-free (unit-tested).
 */

const where = (tenant: Tenant): string => `${tenantTypeLabel(tenant.type)}, ${floorLabel(tenant.floor)}`;

/** "Office worker at Office, floor 5", "Resident of Condo, floor 8", "Shopper". */
export function personRole(state: GameState, person: Person): string {
  const home = state.tenants.get(person.tenantId);
  switch (person.kind) {
    case 'officeWorker': return home ? `Office worker at ${where(home)}` : 'Office worker';
    case 'resident': return home ? `Resident of ${where(home)}` : 'Resident';
    case 'hotelGuest': return home ? `Hotel guest in ${where(home)}` : 'Hotel guest';
    case 'guard': return home ? `Security guard at ${where(home)}` : 'Security guard';
    case 'housekeeper': return home ? `Housekeeper at ${where(home)}` : 'Housekeeper';
    case 'diner': return 'Diner';
    case 'shopper': return 'Shopper';
  }
}

/** What someone does at a venue: "Eating at", "Shopping at", ... */
function doingAt(type: string): string {
  switch (type) {
    case 'fastfood': case 'restaurant': return 'Eating at';
    case 'shop': case 'supermarket': return 'Shopping at';
    case 'cinema': return 'Watching a film at';
    case 'gym': return 'Working out at';
    case 'bar': return 'Having a drink at';
    case 'partyHall': return 'At a party in';
    case 'conference': return 'In a meeting at';
    case 'observationDeck': return 'Enjoying the view at';
    case 'medical': return 'Seeing a doctor at';
    case 'bank': return 'Banking at';
    default: return 'Visiting';
  }
}

/** Where the current trip ends, as "to work", "home", "to Fast food, floor 3". */
function heading(state: GameState, person: Person): string {
  if (person.endState === 'offscreen') return 'out of the tower';
  if (person.endState === 'cleaning') {
    const room = state.tenants.get(person.activityTenantId);
    return room ? `to clean ${where(room)}` : 'to clean a room';
  }
  const venue = person.activityTenantId >= 0 ? state.tenants.get(person.activityTenantId) : undefined;
  if (venue) return `to ${where(venue)}`;
  if (person.destination) {
    const home = state.tenants.get(person.tenantId);
    if (home && home.floor === person.destination.floor) {
      if (person.kind === 'resident') return 'home';
      if (person.kind === 'hotelGuest') return 'to their room';
      return 'to work';
    }
    return person.destination.floor === CONFIG.LOBBY_FLOOR_INDEX ? 'to the lobby' : `to ${floorLabel(person.destination.floor)}`;
  }
  return '';
}

/** Game minutes someone has been waiting (the clock's uneven tick segments included). */
export function waitMinutes(state: GameState, person: Person): number {
  const now = state.calendar.tickOfDay;
  const minutes = tickToMinute(now) - tickToMinute(now - person.waitTicks);
  return Math.max(0, Math.round(((minutes % 1440) + 1440) % 1440));
}

function elevatorName(state: GameState, groupId: number | undefined): string {
  const kind = groupId === undefined ? undefined : state.elevatorGroups.get(groupId)?.kind;
  return kind === 'express' ? 'express elevator' : kind === 'service' ? 'service elevator' : 'elevator';
}

/** Current activity in plain words ("Waiting for the elevator on floor 12 · 3 min"). */
export function personActivity(state: GameState, person: Person): string {
  const leg = person.route?.[person.legIndex];
  const floor = Math.round(person.pos.floor);
  switch (person.state) {
    case 'offscreen':
      return 'Off-site';
    case 'waiting': {
      const minutes = waitMinutes(state, person);
      return `Waiting for the ${elevatorName(state, leg?.groupId)} on ${floorLabel(floor)} · ${minutes} min`;
    }
    case 'riding':
      return `Riding the ${elevatorName(state, leg?.groupId)} to ${floorLabel(leg?.to ?? floor)}`;
    case 'onStairs':
      return `Taking the stairs to ${floorLabel(leg?.to ?? floor)}`;
    case 'onEscalator':
      return `Riding the escalator to ${floorLabel(leg?.to ?? floor)}`;
    case 'walking': {
      const to = heading(state, person);
      return to ? `Walking on ${floorLabel(floor)}, heading ${to}` : `Walking on ${floorLabel(floor)}`;
    }
    case 'cleaning': {
      const room = state.tenants.get(person.activityTenantId);
      return room ? `Cleaning ${where(room)}` : 'Cleaning a room';
    }
    case 'inTenant': {
      const venue = person.activityTenantId >= 0 ? state.tenants.get(person.activityTenantId) : undefined;
      if (venue && venue.id !== person.tenantId) return `${doingAt(venue.type)} ${where(venue)}`;
      switch (person.kind) {
        case 'resident': return 'At home';
        case 'officeWorker': return 'At work';
        case 'hotelGuest': return 'In their room';
        case 'guard': case 'housekeeper': return 'On duty';
        default: return 'Inside';
      }
    }
  }
}

export type StressMood = 'calm' | 'pink' | 'red';

/**
 * SimTower's colour code: people turn pink when stressed and red when very
 * stressed (a long wait in a queue counts too, like the figures in the tower).
 */
export function stressMood(person: Person): { mood: StressMood; level: number; label: string } {
  const level = Math.min(1, Math.max(0, person.stress / CONFIG.STRESS_MAX));
  const waiting = person.state === 'waiting' ? person.waitTicks / patienceTicks(person.stress) : 0;
  const mood: StressMood = level >= 0.7 || waiting >= 0.75 ? 'red' : level >= 0.35 || waiting >= 0.4 ? 'pink' : 'calm';
  const label = mood === 'red' ? 'Very stressed (red)' : mood === 'pink' ? 'Stressed (pink)' : 'Calm';
  return { mood, level, label };
}

/** Grid spot to centre on for "Jump to home/workplace" (null for visitors). */
export function homeSpot(state: GameState, person: Person): { floor: number; x: number; label: string } | null {
  if (person.kind === 'diner' || person.kind === 'shopper') return null;
  const home = state.tenants.get(person.tenantId);
  if (!home) return null;
  const label = person.kind === 'resident' ? 'Jump to home' : person.kind === 'hotelGuest' ? 'Jump to room' : 'Jump to workplace';
  return { floor: home.floor, x: home.x + home.sizeCells / 2, label };
}
