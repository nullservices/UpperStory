import { CONFIG } from '../data/config';
import { pushEvent } from './core/events';
import { rngInt, rngNext } from './core/rng';
import { spend } from './money';
import { removeTenantPeople, spawnVIP } from './people';
import { pickupRoute } from './routing';
import type { GameState } from './state';

export type IncidentKind = 'fire' | 'bomb' | 'infestation' | 'vip';
export type IncidentResponse = 'rescue' | 'search' | 'ransom' | 'exterminate';
export interface Incident {
  id: number;
  personId?: number;
  stayed?: boolean;
  stress?: number;
  kind: IncidentKind;
  tenantId: number;
  deadline: number;
  responseAt: number | null;
  response: IncidentResponse | null;
}
export interface CampaignState {
  waste: number;
  weather: 'clear' | 'rain';
  lastDay: number;
  nextIncidentTick: number;
  incidents: Incident[];
  history: { day: number; message: string }[];
  vipApproved: boolean;
  treasureFound: boolean;
  weddingHeld: boolean;
  bankrupt: boolean;
}
export function newCampaign(): CampaignState {
  return { waste: 0, weather: 'clear', lastDay: 1, nextIncidentTick: CONFIG.DAY_TICKS * 3,
    incidents: [], history: [], vipApproved: false, treasureFound: false, weddingHeld: false, bankrupt: false };
}
export function recordEvent(state: GameState, message: string): void {
  state.campaign.history.unshift({ day: state.calendar.day, message });
  state.campaign.history.length = Math.min(40, state.campaign.history.length);
  pushEvent(state, { type: 'ALERT', message });
}
export function startIncident(state: GameState, kind: IncidentKind, tenantId: number): Incident {
  const tenant = state.tenants.get(tenantId);
  if (!tenant || tenant.state !== 'open') throw new Error('Choose an open facility');
  if (state.campaign.incidents.some(i => i.tenantId === tenantId)) throw new Error('An incident is already active here');
  if (kind === 'vip' && tenant.type !== 'hotelSuite') throw new Error('VIPs require a hotel suite');
  const incident: Incident = { id: state.nextEntityId++, kind, tenantId,
    deadline: state.tickCount + (kind === 'vip' ? CONFIG.DAY_TICKS : kind === 'infestation' ? 1800 : 900),
    responseAt: null, response: null };
  if (kind === 'vip') incident.personId = spawnVIP(state, tenant);
  state.campaign.incidents.push(incident);
  recordEvent(state, `${kind === 'vip' ? 'VIP inspection' : kind === 'bomb' ? 'Bomb threat' : kind === 'fire' ? 'Fire reported' : 'Cockroach infestation'} on floor ${tenant.floor}.`);
  return incident;
}
function serviceAvailable(state: GameState, type: 'security' | 'housekeeping', floor: number): boolean {
  return [...state.tenants.values()].some(t => t.type === type && t.state === 'open' &&
    pickupRoute(state, t.floor, floor, type === 'security' ? 'guard' : 'housekeeper') !== null);
}
export function respondToIncident(state: GameState, id: number, action: IncidentResponse): void {
  const incident = state.campaign.incidents.find(i => i.id === id);
  const tenant = incident && state.tenants.get(incident.tenantId);
  if (!incident || !tenant) throw new Error('This incident has ended');
  if (incident.response !== null) throw new Error('A response is already underway');
  const allowed = incident.kind === 'fire' ? ['rescue'] : incident.kind === 'bomb' ? ['search', 'ransom'] : incident.kind === 'infestation' ? ['exterminate'] : [];
  if (!allowed.includes(action)) throw new Error('That response does not apply');
  if (action === 'search' && !serviceAvailable(state, 'security', tenant.floor)) throw new Error('An accessible security office is required');
  const cost = action === 'rescue' ? 50_000 : action === 'ransom' ? 100_000 : action === 'exterminate' ? 2500 : 0;
  if (!spend(state, cost * 100)) throw new Error('Not enough funds');
  incident.response = action;
  incident.responseAt = state.tickCount + (action === 'search' ? 500 : action === 'rescue' ? 150 : 1);
  recordEvent(state, action === 'search' ? 'Security is searching for the bomb.' : action === 'rescue' ? 'Fire rescue is on the way.' : action === 'ransom' ? 'Ransom paid.' : 'Pest control dispatched.');
}
function damage(state: GameState, tenantId: number): void {
  const tenant = state.tenants.get(tenantId);
  if (!tenant || tenant.type === 'lobby') return;
  removeTenantPeople(state, tenant.id);
  tenant.state = 'damaged';
  tenant.occupancy = 0;
  tenant.reportedPopulation = 0;
  state.tower.structureRevision++;
}
export function stepCampaign(state: GameState): void {
  const c = state.campaign;
  if (c.lastDay !== state.calendar.day) {
    c.lastDay = state.calendar.day;
    const recycling = [...state.tenants.values()].filter(t => t.type === 'recycling' && t.state === 'open').length;
    c.waste = Math.max(0, Math.min(100, c.waste + state.people.size / 500 - recycling * 10));
    c.weather = rngNext(state) < 0.2 ? 'rain' : 'clear';
    if (c.weather === 'rain') recordEvent(state, 'Rain is reducing outside shopping and dining traffic.');
    if (state.money.balanceCents < 0 && !c.bankrupt) {
      c.bankrupt = true;
      recordEvent(state, 'The tower is in debt. Restore a positive balance to resume construction.');
    } else if (state.money.balanceCents >= 0) c.bankrupt = false;
  }
  for (const incident of [...c.incidents]) {
    const tenant = state.tenants.get(incident.tenantId);
    const vip = incident.personId === undefined ? undefined : state.people.get(incident.personId);
    if (vip) {
      incident.stayed ||= vip.state === 'inTenant';
      incident.stress = Math.max(incident.stress ?? 0, vip.stress + vip.failedTripsToday * 50);
    }
    let result: string | null = null;
    if (!tenant || tenant.state !== 'open') result = 'Incident closed: facility is no longer open.';
    else if (incident.responseAt !== null && state.tickCount >= incident.responseAt && incident.responseAt <= incident.deadline) {
      if (incident.kind === 'infestation') tenant.cleanliness = 100;
      result = incident.kind === 'fire' ? 'Fire extinguished. The facility is safe.' : incident.kind === 'bomb' ? 'Bomb threat resolved.' : 'Infestation cleared.';
    } else if (incident.kind === 'infestation' && tenant.cleanliness >= 90 && serviceAvailable(state, 'housekeeping', tenant.floor)) {
      result = 'Housekeeping cleared the infestation.';
    } else if (state.tickCount >= incident.deadline) {
      if (incident.kind === 'vip') {
        const guests = [...state.people.values()].filter(p => p.tenantId === tenant.id);
        const connected = pickupRoute(state, 1, tenant.floor, 'hotelGuest') !== null;
        const happy = incident.stayed === true && (incident.stress ?? 0) < 50 && connected && tenant.cleanliness >= 70 && tenant.grade >= 2 && guests.every(p => p.stress < 50 && p.failedTripsToday === 0);
        c.vipApproved ||= happy;
        result = happy ? 'The VIP approved your tower. A favorable inspection is recorded.' : 'The VIP was disappointed. Improve suite cleanliness, access and service before the next visit.';
      } else {
        damage(state, tenant.id);
        if (incident.kind === 'fire' || incident.kind === 'bomb') {
          const neighbor = [...state.tenants.values()].find(t => t.id !== tenant.id && t.floor === tenant.floor && t.state === 'open' && Math.abs(t.x - tenant.x) <= tenant.sizeCells + t.sizeCells);
          if (neighbor) damage(state, neighbor.id);
        }
        result = incident.kind === 'infestation' ? 'Infestation forced the facility to close. Inspect it to renovate.' : 'The incident damaged the tower. Inspect damaged rooms to repair them.';
      }
    }
    if (result) {
      c.incidents.splice(c.incidents.indexOf(incident), 1);
      recordEvent(state, result);
    }
  }
  if (state.tickCount < c.nextIncidentTick) return;
  c.nextIncidentTick = state.tickCount + rngInt(state, 3, 6) * CONFIG.DAY_TICKS;
  const open = [...state.tenants.values()].filter(t => t.state === 'open' && t.type !== 'lobby' && t.type !== 'skyLobby' && !c.incidents.some(i => i.tenantId === t.id));
  if (!open.length || state.starLevel < 2) return;
  const suite = open.find(t => t.type === 'hotelSuite');
  if (suite && !c.vipApproved && state.starLevel >= 3) { startIncident(state, 'vip', suite.id); return; }
  const dirty = open.find(t => t.cleanliness < 40);
  if (dirty) { startIncident(state, 'infestation', dirty.id); return; }
  const target = open[rngInt(state, 0, open.length - 1)]!;
  startIncident(state, state.starLevel >= 3 && rngNext(state) < 0.35 ? 'bomb' : 'fire', target.id);
}
