import { describe, expect, it } from 'vitest';
import { CONFIG, TENANT_DATA } from '../../src/data/config';
import { BuildStroke } from '../../src/game/buildStroke';
import { placementCostDollars } from '../../src/game/placementCost';
import { buildFloor, createInitialState, floorCostDollars, placeElevatorGroup, placeTenant, setupNewGame } from '../../src/sim';
import { describeEntity } from '../../src/ui/cursorTip';
import { blackoutActive, hasLocation, loanBalanceCents } from '../../src/ui/simCompat';

function fixture() {
  const state = createInitialState(1); setupNewGame(state, true);
  buildFloor(state, 2); buildFloor(state, 3);
  return state;
}

describe('cursor-side placement cost', () => {
  it('quotes tenant, floor and elevator prices like the simulation charges', () => {
    const state = fixture();
    expect(placementCostDollars(state, 'office', { floor: 2, cell: 0 })).toBe(TENANT_DATA.office.costDollars);
    expect(placementCostDollars(state, 'buildFloor', { floor: 9, cell: 10 })).toBe(floorCostDollars(4));
    expect(placementCostDollars(state, 'elevator', { floor: 2, cell: 20 })).toBe(CONFIG.ELEVATOR_PRICES.standard.shaft);
    expect(placementCostDollars(state, 'select', { floor: 2, cell: 0 })).toBeNull();
    expect(placementCostDollars(state, 'office', null)).toBeNull();
  });

  it('charges only the added floors when dragging an existing shaft', () => {
    const state = fixture();
    placeElevatorGroup(state, 1, 2, 20, 'standard');
    const cost = placementCostDollars(state, 'elevator', { floor: 3, cell: 20 }, { fromFloor: 2, cell: 20 });
    expect(cost).toBe(CONFIG.ELEVATOR_SHAFT_COST_PER_FLOOR_DOLLARS);
  });

  it('keeps a running total for row builds', () => {
    const state = fixture();
    const stroke = new BuildStroke('office', 2, 0);
    stroke.extend(state, 20);
    expect(stroke.placed).toBe(3);
    expect(stroke.spentCents).toBe(3 * TENANT_DATA.office.costDollars * 100);
  });
});

describe('inspect hover summary', () => {
  it('describes rooms and elevators compactly', () => {
    const state = fixture();
    const office = placeTenant(state, 'office', 2, 0);
    const room = describeEntity(state, { kind: 'tenant', tenant: office });
    expect(room).toContain('Office');
    expect(room).toContain('Floor 2');
    expect(room).toContain('Under construction');
    const group = placeElevatorGroup(state, 1, 3, 20, 'standard');
    const lift = describeEntity(state, { kind: 'elevator', group });
    expect(lift).toContain('Elevator');
    expect(lift).toContain('1 car');
    expect(lift).toContain('0 waiting');
  });

  it('flags broken cars', () => {
    const state = fixture();
    const group = placeElevatorGroup(state, 1, 3, 20, 'standard');
    group.cars[0]!.outOfService = true;
    expect(describeEntity(state, { kind: 'elevator', group })).toContain('1 out of service');
  });
});

describe('simulation contract reads', () => {
  it('reads blackout, loan and located history fields with safe defaults', () => {
    const state = fixture();
    expect(blackoutActive(state)).toBe(false);
    state.campaign.blackoutUntilTick = state.tickCount + 10;
    expect(blackoutActive(state)).toBe(true);
    expect(loanBalanceCents(state)).toBe(0);
    expect(hasLocation({ day: 1, message: 'x' })).toBe(false);
    expect(hasLocation({ day: 1, message: 'x', floor: 0, x: 4 })).toBe(true);
  });
});
