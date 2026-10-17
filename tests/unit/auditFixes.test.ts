import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/data/config';
import { startIncident } from '../../src/sim/campaign';
import { buildFloor, placeElevatorGroup, placeTenant, rebuildRouting, tick, type GameState, type TenantType } from '../../src/sim';
import { joinQueue } from '../../src/sim/queues';
import { newTestGame, tickN } from '../helpers/simHarness';

function fixture(top = 16): GameState {
  const state = newTestGame(3);
  state.starLevel = 5;
  state.money.balanceCents = 100_000_000_00;
  for (let f = 2; f <= top; f++) buildFloor(state, f);
  return state;
}
function build(state: GameState, type: TenantType, floor: number, x: number) {
  const tenant = placeTenant(state, type, floor, x);
  if (tenant.state === 'constructing') { tenant.constructionTicksLeft = 1; tick(state); }
  return tenant;
}

describe('incident damage', () => {
  it('an unanswered fire next to a sky lobby damages a real neighbour, never the sky lobby', () => {
    const state = fixture();
    placeElevatorGroup(state, 1, 15, 100);
    const sky = build(state, 'skyLobby', 15, 0);
    const office = build(state, 'office', 15, 6);
    const neighbour = build(state, 'office', 15, 15);
    rebuildRouting(state);
    const fire = startIncident(state, 'fire', office.id);
    fire.nextSpreadTick = Number.MAX_SAFE_INTEGER; // isolate the deadline damage
    tickN(state, CONFIG.FIRE_DEADLINE_TICKS + 1);
    expect(office.state).toBe('damaged');
    expect(sky.state).toBe('open');
    expect(neighbour.state).toBe('damaged');
  });

  it('fire damage on a floor whose only other tenant is the lobby leaves the lobby alone', () => {
    const state = fixture(3);
    const office = build(state, 'office', 2, 40);
    const fire = startIncident(state, 'fire', office.id);
    fire.nextSpreadTick = Number.MAX_SAFE_INTEGER;
    tickN(state, CONFIG.FIRE_DEADLINE_TICKS + 1);
    expect(office.state).toBe('damaged');
    expect([...state.tenants.values()].find(t => t.type === 'lobby')!.state).toBe('open');
  });
});

describe('breakdowns strand no one', () => {
  it('when a shaft loses its last working car, its waiting passengers re-plan at once', () => {
    const state = fixture(6);
    const broken = placeElevatorGroup(state, 1, 6, 40);
    placeElevatorGroup(state, 1, 6, 80);
    const office = build(state, 'office', 5, 120);
    rebuildRouting(state);
    // A worker queued for the first shaft.
    const worker = [...state.people.values()].find(p => p.tenantId === office.id)!;
    worker.state = 'waiting';
    worker.pos = { floor: 1, x: broken.x + 1 };
    worker.destination = { floor: 5, x: office.x + office.sizeCells / 2 };
    worker.endState = 'inTenant';
    worker.route = [{ mode: 'elevator', from: 1, to: 5, dir: 1, groupId: broken.id }];
    worker.legIndex = 0;
    joinQueue(state, worker.id, 1, 'up');
    broken.cars[0]!.breakdownAtTick = state.tickCount + 1;
    tick(state);
    expect(broken.cars[0]!.outOfService).toBe(true);
    expect(state.queues['1:up'] ?? []).not.toContain(worker.id);
    expect(worker.route?.[0]?.groupId).not.toBe(broken.id);
    expect(worker.failedTripsToday).toBe(0);
  });
});

describe('incident mix', () => {
  it('a dirty room does not always turn the scheduled incident into an infestation', () => {
    const mutable = CONFIG as unknown as Record<string, number>;
    const saved = mutable.INFESTATION_PICK_CHANCE!;
    try {
      const kinds = (chance: number): string => {
        mutable.INFESTATION_PICK_CHANCE = chance;
        const state = fixture(4);
        const hotel = build(state, 'hotel', 3, 40);
        hotel.cleanliness = 10;
        state.campaign.nextIncidentTick = state.tickCount + 1;
        tick(state);
        return state.campaign.incidents[0]!.kind;
      };
      expect(kinds(1)).toBe('infestation');
      expect(['fire', 'bomb']).toContain(kinds(0));
    } finally {
      mutable.INFESTATION_PICK_CHANCE = saved;
    }
  });
});
