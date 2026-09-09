import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/data/config';
import { startIncident, respondToIncident } from '../../src/sim/campaign';
import { buildFloor, createInitialState, deserializeGame, placeElevatorGroup, placeTenant, rebuildRouting, serializeGame, setupNewGame, tick } from '../../src/sim';
import { repairTenant, changeMovie, demolishTenant } from '../../src/sim/tenants';
import { progressionRequirements, stepProgression } from '../../src/sim/progression';
import { newTestGame, scenarioTower, tickN } from '../helpers/simHarness';

function fixture() {
  const state = newTestGame(12); state.starLevel = 5; state.money.balanceCents = 100_000_000_00;
  for (let f = 2; f <= 10; f++) buildFloor(state, f);
  for (let f = -1; f >= -8; f--) buildFloor(state, f);
  placeElevatorGroup(state, -8, 10, 10);
  rebuildRouting(state);
  return state;
}
describe('complete facility catalog', () => {
  it('reserves, completes and demolishes every level of a large venue', () => {
    const state = fixture();
    const cinema = placeTenant(state, 'cinema', 2, 30);
    expect(() => placeTenant(state, 'office', 3, 35)).toThrow('occupied');
    tickN(state, 2600);
    expect(cinema.state).toBe('open');
    expect(state.tower.floors.find(f => f.index === 3)!.cells[35]!.tenantId).toBe(cinema.id);
    cinema.movieAge = 9;
    const money = state.money.balanceCents;
    changeMovie(state, cinema.id);
    expect(cinema.movieAge).toBe(0);
    expect(state.money.balanceCents).toBe(money - 5000_00);
    demolishTenant(state, 3, 35);
    for (const floor of [2, 3]) expect(state.tower.floors.find(f => f.index === floor)!.cells[35]!.content).toBe('empty');
  });
  it('requires basement ramps, correct metro depth and complete multi-floor footprints', () => {
    const state = fixture();
    expect(() => placeTenant(state, 'parkingSpace', 0, 60)).toThrow('ramp');
    placeTenant(state, 'parkingRamp', 0, 30);
    placeTenant(state, 'parkingSpace', 0, 60);
    expect(() => placeTenant(state, 'parkingRamp', -1, 50)).toThrow('Align');
    placeTenant(state, 'parkingRamp', -1, 30);
    expect(() => placeTenant(state, 'recycling', 2, 100)).toThrow('below ground');
    const recycling = placeTenant(state, 'recycling', -1, 100);
    expect(recycling.floor).toBe(-1);
    expect(() => placeTenant(state, 'metro', -3, 60)).toThrow('floor -8');
    placeTenant(state, 'metro', -8, 60);
    expect(() => placeTenant(state, 'metro', -8, 100)).toThrow('Maximum');
    expect(() => placeTenant(state, 'cathedral', 10, 200)).toThrow('floor 97');
  });
});

describe('incidents and recovery', () => {
  it('fire rescue prevents damage, while an unanswered fire closes rooms and requires paid repair', () => {
    const state = fixture();
    const office = placeTenant(state, 'office', 2, 30); tickN(state, 1300);
    const incident = startIncident(state, 'fire', office.id);
    respondToIncident(state, incident.id, 'rescue');
    tickN(state, 151);
    expect(office.state).toBe('open');
    expect(state.campaign.incidents).toHaveLength(0);
    startIncident(state, 'fire', office.id);
    tickN(state, 901);
    expect(office.state).toBe('damaged');
    expect([...state.people.values()].some(p => p.tenantId === office.id)).toBe(false);
    repairTenant(state, office.id);
    expect(office.state).toBe('constructing');
    tickN(state, 651);
    expect(office.state).toBe('open');
    expect([...state.people.values()].filter(p => p.tenantId === office.id)).toHaveLength(6);
  });
  it('bomb search needs reachable security; ransom cannot overspend', () => {
    const state = fixture(); const office = placeTenant(state, 'office', 2, 30); tickN(state, 1300);
    const incident = startIncident(state, 'bomb', office.id);
    expect(() => respondToIncident(state, incident.id, 'search')).toThrow('security');
    state.money.balanceCents = 0;
    expect(() => respondToIncident(state, incident.id, 'ransom')).toThrow('funds');
    expect(incident.response).toBeNull();
    state.money.balanceCents = 100_000_00;
    respondToIncident(state, incident.id, 'ransom'); tick(state);
    expect(state.campaign.incidents).toHaveLength(0);
    expect(office.state).toBe('open');
  });
  it('pest treatment restores cleanliness and resolves the incident', () => {
    const state = fixture(); const hotel = placeTenant(state, 'hotelTwin', 2, 30); tickN(state, 1600);
    hotel.cleanliness = 10;
    const incident = startIncident(state, 'infestation', hotel.id);
    respondToIncident(state, incident.id, 'exterminate'); tick(state);
    expect(hotel.cleanliness).toBe(100);
    expect(state.campaign.incidents).toHaveLength(0);
  });
  it('saves an active incident and replays its outcome deterministically', () => {
    const a = fixture(); const office = placeTenant(a, 'office', 2, 30); tickN(a, 1300);
    const fire = startIncident(a, 'fire', office.id); respondToIncident(a, fire.id, 'rescue');
    const b = deserializeGame(serializeGame(a)); tickN(a, 300); tickN(b, 300);
    expect(serializeGame(a)).toBe(serializeGame(b));
  });
  it('requires a real successful VIP stay rather than an open suite alone', () => {
    const state = fixture(); const suite = placeTenant(state, 'hotelSuite', 2, 30); tickN(state, 2200);
    const visit = startIncident(state, 'vip', suite.id);
    expect(visit.personId).toBeDefined();
    expect(state.people.get(visit.personId!)!.vip).toBe(true);
    placeTenant(state, 'housekeeping', 2, 60);
    tickN(state, CONFIG.DAY_TICKS);
    expect(visit.stayed).toBe(true);
    expect(state.campaign.vipApproved).toBe(true);
  });
  it('rejects a VIP stay when the suite has no route from the entrance', () => {
    const state = newTestGame(12); state.starLevel = 5;
    buildFloor(state, 2);
    const suite = placeTenant(state, 'hotelSuite', 2, 30);
    tickN(state, 2200);
    const visit = startIncident(state, 'vip', suite.id);
    tickN(state, CONFIG.DAY_TICKS);
    expect(visit.stayed).not.toBe(true);
    expect(state.campaign.vipApproved).toBe(false);
  });
  it('lets reachable security resolve a bomb before its deadline', () => {
    const state = fixture();
    const office = placeTenant(state, 'office', 2, 30);
    placeTenant(state, 'security', 2, 60);
    tickN(state, 2200);
    const incident = startIncident(state, 'bomb', office.id);
    respondToIncident(state, incident.id, 'search');
    tickN(state, 500);
    expect(state.campaign.incidents).toHaveLength(0);
    expect(office.state).toBe('open');
  });
});

describe('save migration and rating gates', () => {
  it('expands legacy floors and supplies campaign defaults without moving existing rooms', () => {
    const state = newTestGame(); scenarioTower(state);
    const legacy = JSON.parse(serializeGame(state)); legacy.version = 1; delete legacy.state.campaign;
    for (const floor of legacy.state.tower.floors) floor.cells.length = 60;
    const migrated = deserializeGame(JSON.stringify(legacy));
    expect(migrated.tower.floors[0]!.cells).toHaveLength(375);
    expect([...migrated.tenants.values()].find(t => t.type === 'office')!.x).toBe(20);
    expect(migrated.campaign.vipApproved).toBe(false);
    expect(migrated.campaign.nextIncidentTick).toBe(migrated.tickCount + CONFIG.DAY_TICKS * 3);
  });
  it('blocks population-only advancement and lists unmet requirements', () => {
    const state = createInitialState(1); setupNewGame(state); state.starLevel = 3;
    expect(progressionRequirements(state, 4).filter(r => !r.met).map(r => r.label)).toContain('Favorable VIP inspection');
    stepProgression(state); expect(state.starLevel).toBe(3);
  });
});
