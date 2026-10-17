import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/data/config';
import { buildFloor, placeElevatorGroup, placeTenant, placementError, spawnTenantPeople, stepEvaluation, type SimEvent } from '../../src/sim';
import { tenantCenter } from '../../src/sim/people';
import { createInitialState, setupNewGame } from '../../src/sim/state';
import { newTestGame, scenarioTower } from '../helpers/simHarness';

function alerts(events: SimEvent[]) {
  return events.filter((e): e is Extract<SimEvent, { type: 'ALERT' }> => e.type === 'ALERT');
}

describe('tenant status alerts', () => {
  it('vacancies and new occupants use player-facing names and carry the tenant', () => {
    const state = newTestGame();
    scenarioTower(state);
    const office = [...state.tenants.values()].find(t => t.type === 'office')!;
    office.state = 'open';
    office.occupancy = 0;
    state.tickCount = CONFIG.QUARTER_DAYS * CONFIG.DAY_TICKS;
    for (let i = 0; i < CONFIG.EVAL_VACANCY_DAYS; i++) stepEvaluation(state);
    const vacancy = alerts(state.events).find(e => e.kind === 'vacancy')!;
    expect(vacancy).toMatchObject({ message: 'Office on floor 2 has gone vacant', tenantId: office.id, floor: 2 });
    state.events.length = 0;
    for (let i = 0; i < CONFIG.EVAL_REPOPULATE_DAYS; i++) stepEvaluation(state);
    expect(alerts(state.events).find(e => e.kind === 'occupied')).toMatchObject({ message: 'Office on floor 2 has new occupants', tenantId: office.id });
  });

  it('a filthy hotel alert names the room and floor', () => {
    const state = newTestGame();
    state.starLevel = 5;
    scenarioTower(state);
    const hotel = placeTenant(state, 'hotelSuite', 4, 20);
    hotel.state = 'open';
    hotel.cleanliness = CONFIG.DIRTY_HOTEL_THRESHOLD - 1;
    hotel.occupancy = 1;
    const guest = { ...[...state.people.values()][0]!, id: 900, kind: 'hotelGuest' as const, tenantId: hotel.id, state: 'inTenant' as const };
    state.people.set(900, guest);
    stepEvaluation(state);
    expect(alerts(state.events).find(e => e.kind === 'filthyHotel')).toMatchObject({ tenantId: hotel.id, floor: 4 });
    expect(alerts(state.events).find(e => e.kind === 'filthyHotel')!.message).toContain('hotel suite on floor 4');
  });
});

describe('placement feedback', () => {
  it('explains a room that overhangs the built floor edge', () => {
    const state = createInitialState(); setupNewGame(state);
    for (let x = 20; x < 40; x++) placeTenant(state, 'lobby', 1, x);
    buildFloor(state, 2);
    expect(placementError(state, 'office', 2, 35)).toBe('Not enough floor here: this room needs 9 cells (5 built). Extend this floor first.');
    expect(placementError(state, 'office', 2, 60)).toBe('Extend this floor first');
  });
});

describe('office evaluation', () => {
  it('workers already on their way back to the office count as present', () => {
    const state = newTestGame();
    scenarioTower(state);
    const office = [...state.tenants.values()].find(t => t.type === 'office')!;
    office.state = 'open';
    office.occupancy = 0;
    spawnTenantPeople(state, office);
    const home = tenantCenter(state, office.id);
    for (const p of state.people.values()) {
      if (p.tenantId !== office.id) continue;
      // Back from lunch, walking along their floor toward the office.
      p.state = 'walking';
      p.pos = { floor: home.floor, x: home.x + 100 };
      p.destination = { ...home };
      p.endState = 'inTenant';
    }
    stepEvaluation(state);
    expect(office.grade).toBeGreaterThanOrEqual(4);
  });

  it('workers heading anywhere else (or gone home) still count as absent', () => {
    const state = newTestGame();
    scenarioTower(state);
    placeElevatorGroup(state, 1, 5, 60);
    const office = [...state.tenants.values()].find(t => t.type === 'office')!;
    office.state = 'open';
    office.occupancy = 0;
    spawnTenantPeople(state, office);
    for (const p of state.people.values()) {
      if (p.tenantId !== office.id) continue;
      p.state = 'walking';
      p.destination = { floor: 1, x: 0 };
      p.endState = 'offscreen';
    }
    stepEvaluation(state);
    expect(office.grade).toBeLessThanOrEqual(1);
  });
});
