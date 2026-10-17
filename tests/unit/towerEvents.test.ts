import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/data/config';
import { floorLabel, respondToIncident, responseQuote, startIncident } from '../../src/sim/campaign';
import { rngNext, seedRng } from '../../src/sim/core/rng';
import {
  addElevatorCar,
  buildFloor,
  deserializeGame,
  placeElevatorGroup,
  placeTenant,
  rebuildRouting,
  repairElevatorCar,
  repairElevatorCarError,
  serializeGame,
  tick,
  type GameState,
  type TenantType,
} from '../../src/sim';
import { eventRoll } from '../../src/sim/services';
import { newTestGame, setClock, tickN } from '../helpers/simHarness';

const mutable = CONFIG as unknown as Record<string, number>;
const saved: Record<string, number> = {};
function patchConfig(key: string, value: number): void {
  saved[key] ??= mutable[key]!;
  mutable[key] = value;
}
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) mutable[key] = value;
  for (const key of Object.keys(saved)) delete saved[key];
});

function fixture(top = 10): GameState {
  const state = newTestGame(12);
  state.starLevel = 5;
  state.money.balanceCents = 100_000_000_00;
  for (let f = 2; f <= top; f++) buildFloor(state, f);
  placeElevatorGroup(state, 1, Math.min(top, 29), 10);
  rebuildRouting(state);
  return state;
}
/** Place a facility and finish its construction immediately. */
function build(state: GameState, type: TenantType, floor: number, x: number) {
  const tenant = placeTenant(state, type, floor, x);
  if (tenant.state === 'constructing') {
    tenant.constructionTicksLeft = 1;
    tick(state);
  }
  return tenant;
}
/** An event-stream state whose next roll is below (or at/above) a threshold. */
function eventStateWhere(test: (roll: number) => boolean): number {
  for (let seed = 1; ; seed++) {
    const holder = { rngState: seedRng(seed) };
    const start = holder.rngState;
    if (test(rngNext(holder))) return start;
  }
}

describe('fire responses', () => {
  it('security fights fires for free only when guards can reach the floor', () => {
    const state = fixture();
    const office = build(state, 'office', 2, 30);
    const fire = startIncident(state, 'fire', office.id);
    const unavailable = responseQuote(state, fire.id, 'security');
    expect(unavailable.error).toContain('security');
    expect(unavailable.successChance).toBe(0);
    expect(unavailable.delayTicks).toBe(CONFIG.SECURITY_FIRE_DELAY_TICKS);
    expect(() => respondToIncident(state, fire.id, 'security')).toThrow('security');
    build(state, 'security', 2, 60);
    const quote = responseQuote(state, fire.id, 'security');
    expect(quote).toMatchObject({ error: null, costCents: 0, delayTicks: CONFIG.SECURITY_FIRE_DELAY_TICKS, successChance: CONFIG.SECURITY_FIRE_BASE_CHANCE });
    const money = state.money.balanceCents;
    respondToIncident(state, fire.id, 'security');
    expect(state.money.balanceCents).toBe(money);
    expect(fire.response).toBe('security');
  });

  it('more reachable security offices respond faster and more reliably', () => {
    const state = fixture();
    const office = build(state, 'office', 2, 30);
    build(state, 'security', 2, 60);
    build(state, 'security', 2, 80);
    const fire = startIncident(state, 'fire', office.id);
    const quote = responseQuote(state, fire.id, 'security');
    expect(quote.delayTicks).toBeLessThan(CONFIG.SECURITY_FIRE_DELAY_TICKS);
    expect(quote.successChance).toBeCloseTo(CONFIG.SECURITY_FIRE_BASE_CHANCE + CONFIG.SECURITY_FIRE_CHANCE_PER_OFFICE);
  });

  it('a successful security attempt puts the fire out; a failed one leaves it burning', () => {
    for (const succeed of [true, false]) {
      const state = fixture();
      const office = build(state, 'office', 2, 30);
      build(state, 'security', 2, 60);
      const fire = startIncident(state, 'fire', office.id);
      respondToIncident(state, fire.id, 'security');
      while (state.tickCount < fire.responseAt! - 1) tick(state);
      state.campaign.eventRngState = eventStateWhere(roll => succeed ? roll < 0.4 : roll >= 0.4);
      tick(state);
      if (succeed) {
        expect(state.campaign.incidents).toHaveLength(0);
        expect(office.state).toBe('open');
      } else {
        expect(state.campaign.incidents).toContain(fire);
        expect(fire.response).toBeNull();
        expect(state.campaign.history[0]!.message).toContain('could not put out');
        // The player may answer again, e.g. with paid rescue.
        respondToIncident(state, fire.id, 'rescue');
        expect(fire.response).toBe('rescue');
      }
    }
  });

  it('a reachable fire station makes rescue cheaper and faster; distant stations do not', () => {
    const state = fixture(30);
    placeElevatorGroup(state, 2, 30, 300, 'service');
    rebuildRouting(state);
    const near = build(state, 'office', 3, 30);
    const far = build(state, 'office', 25, 30);
    const nearFire = startIncident(state, 'fire', near.id);
    const farFire = startIncident(state, 'fire', far.id);
    expect(responseQuote(state, nearFire.id, 'rescue')).toMatchObject({ costCents: 50_000_00, delayTicks: 150 });
    build(state, 'fireStation', 2, 60);
    rebuildRouting(state);
    expect(responseQuote(state, nearFire.id, 'rescue')).toMatchObject({ costCents: CONFIG.FIRE_STATION_RESCUE_COST_DOLLARS * 100, delayTicks: CONFIG.FIRE_STATION_RESCUE_DELAY_TICKS });
    // Floor 25 is 23 floors from the station: beyond its 20-floor reach.
    expect(responseQuote(state, farFire.id, 'rescue')).toMatchObject({ costCents: 50_000_00, delayTicks: 150 });
    const money = state.money.balanceCents;
    respondToIncident(state, nearFire.id, 'rescue');
    expect(state.money.balanceCents).toBe(money - CONFIG.FIRE_STATION_RESCUE_COST_DOLLARS * 100);
    tickN(state, CONFIG.FIRE_STATION_RESCUE_DELAY_TICKS);
    expect(state.campaign.incidents).not.toContain(nearFire);
  });
});

describe('fire spread', () => {
  it('ignites touching rooms on the floor and the room above, at most two per attempt', () => {
    patchConfig('FIRE_SPREAD_CHANCE', 1);
    const state = fixture();
    const source = build(state, 'office', 3, 40);
    const left = build(state, 'office', 3, 31);
    const right = build(state, 'office', 3, 49);
    const above = build(state, 'office', 4, 42);
    const distant = build(state, 'office', 3, 100);
    const fire = startIncident(state, 'fire', source.id);
    tickN(state, CONFIG.FIRE_SPREAD_INTERVAL_TICKS - 1);
    expect(state.campaign.incidents).toHaveLength(1);
    tick(state);
    const burning = state.campaign.incidents.filter(i => i.kind === 'fire').map(i => i.tenantId);
    expect(burning).toHaveLength(1 + CONFIG.FIRE_SPREAD_MAX_PER_STEP);
    expect(burning).not.toContain(distant.id);
    for (const id of burning.slice(1)) expect([left.id, right.id, above.id]).toContain(id);
    // New fires start their own clocks: nothing spreads twice in one tick.
    for (const incident of state.campaign.incidents.slice(1)) expect(incident.nextSpreadTick).toBe(state.tickCount + CONFIG.FIRE_SPREAD_INTERVAL_TICKS);
    expect(fire.nextSpreadTick).toBe(state.tickCount + CONFIG.FIRE_SPREAD_INTERVAL_TICKS);
    expect(state.campaign.history[0]!.floor).toBeGreaterThanOrEqual(3);
  });

  it('respects the one-incident-per-room rule and the active fire cap', () => {
    patchConfig('FIRE_SPREAD_CHANCE', 1);
    patchConfig('FIRE_MAX_ACTIVE', 2);
    const state = fixture();
    const source = build(state, 'office', 3, 40);
    const left = build(state, 'office', 3, 31);
    const right = build(state, 'office', 3, 49);
    startIncident(state, 'bomb', left.id);
    startIncident(state, 'fire', source.id);
    tickN(state, CONFIG.FIRE_SPREAD_INTERVAL_TICKS);
    expect(state.campaign.incidents.filter(i => i.tenantId === left.id)).toHaveLength(1);
    expect(state.campaign.incidents.some(i => i.kind === 'fire' && i.tenantId === right.id)).toBe(true);
    tickN(state, CONFIG.FIRE_SPREAD_INTERVAL_TICKS * 2);
    expect(state.campaign.incidents.filter(i => i.kind === 'fire').length).toBeLessThanOrEqual(2);
  });

  it('does not spread while a response is underway or near a fire station', () => {
    patchConfig('FIRE_SPREAD_CHANCE', 1);
    for (const guard of ['rescue', 'station'] as const) {
      const state = fixture();
      const source = build(state, 'office', 3, 40);
      build(state, 'office', 3, 49);
      if (guard === 'station') build(state, 'fireStation', 3, 100);
      const fire = startIncident(state, 'fire', source.id);
      if (guard === 'rescue') {
        fire.deadline += 1000; // keep the fire alive past the rescue delay
        respondToIncident(state, fire.id, 'rescue');
        fire.responseAt = state.tickCount + CONFIG.FIRE_SPREAD_INTERVAL_TICKS + 10;
      }
      tickN(state, CONFIG.FIRE_SPREAD_INTERVAL_TICKS + 1);
      expect(state.campaign.incidents.filter(i => i.kind === 'fire')).toHaveLength(1);
    }
  });

  it('spreads deterministically from the seeded event stream', () => {
    const run = (): number[] => {
      const state = fixture();
      const source = build(state, 'office', 3, 40);
      build(state, 'office', 3, 31);
      build(state, 'office', 3, 49);
      build(state, 'office', 4, 42);
      startIncident(state, 'fire', source.id);
      tickN(state, CONFIG.FIRE_SPREAD_INTERVAL_TICKS * 3);
      return state.campaign.incidents.map(i => i.tenantId);
    };
    expect(run()).toEqual(run());
  });
});

describe('bomb search', () => {
  it('scales search time inversely with reachable security offices', () => {
    const state = fixture();
    const office = build(state, 'office', 2, 30);
    const bomb = startIncident(state, 'bomb', office.id);
    expect(responseQuote(state, bomb.id, 'search').error).toContain('security');
    build(state, 'security', 2, 60);
    expect(responseQuote(state, bomb.id, 'search').delayTicks).toBe(CONFIG.BOMB_SEARCH_TICKS);
    build(state, 'security', 2, 80);
    expect(responseQuote(state, bomb.id, 'search').delayTicks).toBe(CONFIG.BOMB_SEARCH_TICKS / 2);
    respondToIncident(state, bomb.id, 'search');
    tickN(state, CONFIG.BOMB_SEARCH_TICKS / 2);
    expect(state.campaign.incidents).toHaveLength(0);
    expect(office.state).toBe('open');
  });
});

describe('elevator breakdowns', () => {
  function rushHour(): { state: GameState; groupId: number } {
    const state = fixture();
    const group = [...state.elevatorGroups.values()][0]!;
    addElevatorCar(state, group.id);
    for (const x of [30, 40, 50, 60]) build(state, 'office', 9, x);
    setClock(state, 535);
    return { state, groupId: group.id };
  }

  it('a broken car stops at the nearest floor, unloads riders who carry on, and is ignored by dispatch', () => {
    const { state, groupId } = rushHour();
    const group = state.elevatorGroups.get(groupId)!;
    let car = group.cars.find(c => c.passengers.length > 0 && c.state === 'moving');
    for (let i = 0; i < 400 && !car; i++) {
      tick(state);
      car = group.cars.find(c => c.passengers.length > 0 && c.state === 'moving' && c.y > 2.2 && c.y < 7.8);
    }
    expect(car).toBeDefined();
    const riders = [...car!.passengers];
    car!.breakdownAtTick = state.tickCount + 1;
    tickN(state, 10);
    expect(car!.outOfService).toBe(true);
    expect(car!.state).toBe('idle');
    expect(Number.isInteger(car!.y)).toBe(true);
    expect(car!.passengers).toHaveLength(0);
    // Riders left the broken car; some may already ride the working one.
    const other = group.cars.find(c => c !== car)!;
    for (const id of riders) {
      const p = state.people.get(id)!;
      if (p.state === 'riding') expect(other.passengers).toContain(id);
    }
    expect(state.campaign.history.find(h => h.message.includes('broke down'))).toMatchObject({ floor: car!.y, x: group.x });
    const y = car!.y;
    tickN(state, 600);
    expect(car!.y).toBe(y); // dispatch never moves a broken car
    // The stranded riders still reach work on the other car.
    expect(riders.filter(id => state.people.get(id)!.state === 'inTenant').length).toBeGreaterThan(0);
  });

  it('routing skips a shaft whose only car is broken', () => {
    const state = fixture();
    const group = [...state.elevatorGroups.values()][0]!;
    group.cars[0]!.breakdownAtTick = state.tickCount + 1;
    tick(state);
    tick(state);
    expect(state.routing.groupsServing.get(5) ?? []).not.toContain(group.id);
  });

  it('manual repair is paid and immediate; reachable mechanics repair automatically', () => {
    const state = fixture();
    const group = [...state.elevatorGroups.values()][0]!;
    const car = group.cars[0]!;
    expect(repairElevatorCarError(state, group.id, car.id)).toBe('This car is running normally');
    car.breakdownAtTick = state.tickCount + 1;
    tick(state);
    expect(car.outOfService).toBe(true);
    expect(car.repairAtTick).toBeUndefined();
    const money = state.money.balanceCents;
    repairElevatorCar(state, group.id, car.id);
    expect(car.outOfService).toBeUndefined();
    expect(state.money.balanceCents).toBe(money - CONFIG.ELEVATOR_REPAIR_COST_DOLLARS * 100);

    // Mechanics on floor 2 reach a car stranded at floor 2 on foot.
    build(state, 'maintenance', 2, 100);
    car.y = 2; car.lastFloor = 2;
    car.breakdownAtTick = state.tickCount + 1;
    tick(state);
    expect(car.repairAtTick).toBe(state.tickCount + CONFIG.MAINTENANCE_REPAIR_TICKS);
    tickN(state, CONFIG.MAINTENANCE_REPAIR_TICKS);
    expect(car.outOfService).toBeUndefined();
    expect(state.campaign.history[0]!.message).toContain('Mechanics repaired');
  });

  it('schedules breakdowns from 2 stars, less often where maintenance reaches the shaft', () => {
    patchConfig('ELEVATOR_BREAKDOWN_MEAN_DAYS', 1); // certain without maintenance
    const count = (stars: number, maintenance: boolean): number => {
      const state = fixture();
      const group = [...state.elevatorGroups.values()][0]!;
      for (let i = 1; i < 8; i++) addElevatorCar(state, group.id);
      // Mechanics reach the shaft's stop nearest their office (floor 2 itself).
      if (maintenance) build(state, 'maintenance', 2, 100);
      state.starLevel = stars;
      setClock(state, 1439);
      tickN(state, 3);
      return group.cars.filter(c => c.breakdownAtTick !== undefined).length;
    };
    expect(count(1, false)).toBe(0);
    expect(count(2, false)).toBe(8);
    expect(count(2, true)).toBeLessThan(8);
  });
});

describe('blackouts', () => {
  it('holds cars without a generator, records the event and restores power', () => {
    const state = fixture();
    const car = [...state.elevatorGroups.values()][0]!.cars[0]!;
    state.campaign.nextBlackoutTick = state.tickCount + 1;
    tick(state);
    const until = state.campaign.blackoutUntilTick!;
    expect(until).toBeGreaterThan(state.tickCount);
    expect(state.campaign.history[0]!.message).toContain('Blackout');
    car.state = 'moving'; car.targetFloor = 8; car.dir = 1;
    const y = car.y;
    tickN(state, 5);
    expect(car.y).toBe(y);
    while (state.tickCount < until) tick(state);
    expect(state.campaign.blackoutUntilTick).toBeUndefined();
    expect(state.campaign.history[0]!.message).toContain('restored');
    tickN(state, 5);
    expect(car.y).toBeGreaterThan(y);
  });

  it('lasts one to two game hours and an open generator keeps cars running', () => {
    const state = fixture();
    build(state, 'generator', 0, 100);
    const car = [...state.elevatorGroups.values()][0]!.cars[0]!;
    setClock(state, 840);
    state.campaign.nextBlackoutTick = state.tickCount + 1;
    tick(state);
    const ticks = state.campaign.blackoutUntilTick! - state.tickCount;
    // 13:00–01:00 runs at 100 ticks per game hour.
    expect(ticks).toBeGreaterThanOrEqual(100);
    expect(ticks).toBeLessThanOrEqual(200);
    expect(state.campaign.history[0]!.message).toContain('generator');
    car.state = 'moving'; car.targetFloor = 8; car.dir = 1;
    const y = car.y;
    tickN(state, 5);
    expect(car.y).toBeGreaterThan(y);
  });

  it('rolls blackouts daily from the weather-dependent chance', () => {
    expect(CONFIG.BLACKOUT_CHANCE_RAIN).toBeGreaterThan(CONFIG.BLACKOUT_CHANCE_CLEAR);
    patchConfig('BLACKOUT_CHANCE_CLEAR', 0);
    patchConfig('BLACKOUT_CHANCE_RAIN', 1);
    const state = fixture();
    const seen = new Set<string>();
    for (let day = 0; day < 15; day++) {
      const start = state.calendar.day;
      while (state.calendar.day === start) tick(state);
      const scheduled = state.campaign.nextBlackoutTick !== undefined;
      expect(scheduled).toBe(state.campaign.weather === 'rain');
      seen.add(state.campaign.weather);
      delete state.campaign.nextBlackoutTick;
    }
    expect(seen.size).toBe(2);
  });

  it('uses its own event stream so events never shift the main random stream', () => {
    const state = fixture();
    const main = state.rngState;
    eventRoll(state);
    expect(state.rngState).toBe(main);
    expect(state.campaign.eventRngState).toBeDefined();
  });
});

describe('journal locations and saves', () => {
  it('names basements B1..B9 in journal messages', () => {
    expect(floorLabel(5)).toBe('floor 5');
    expect(floorLabel(0)).toBe('B1');
    expect(floorLabel(-8)).toBe('B9');
    const state = fixture();
    for (let f = -1; f >= -2; f--) buildFloor(state, f);
    const group = placeElevatorGroup(state, -2, 0, 200);
    group.cars[0]!.breakdownAtTick = state.tickCount + 1;
    tick(state);
    expect(state.campaign.history[0]!.message).toMatch(/^An elevator car broke down at B3\. /);
  });

  it('records where incidents happen and keeps old two-field entries valid', () => {
    const state = fixture();
    const office = build(state, 'office', 4, 30);
    startIncident(state, 'fire', office.id);
    expect(state.campaign.history[0]).toMatchObject({ floor: 4, x: 34 });
    state.campaign.history.push({ day: 1, message: 'legacy entry' });
    const loaded = deserializeGame(serializeGame(state));
    expect(loaded.campaign.history.at(-1)).toEqual({ day: 1, message: 'legacy entry' });
  });

  it('round-trips broken cars, blackouts, loans and spreading fires, then replays identically', () => {
    const a = fixture();
    const office = build(a, 'office', 3, 40);
    build(a, 'office', 3, 49);
    startIncident(a, 'fire', office.id);
    a.money.loanCents = 123_00;
    a.campaign.blackoutUntilTick = a.tickCount + 50;
    const car = [...a.elevatorGroups.values()][0]!.cars[0]!;
    car.breakdownAtTick = a.tickCount + 1;
    tick(a);
    const b = deserializeGame(serializeGame(a));
    expect([...b.elevatorGroups.values()][0]!.cars[0]!.outOfService).toBe(true);
    expect(b.money.loanCents).toBe(123_00);
    tickN(a, 800);
    tickN(b, 800);
    a.events = [];
    b.events = [];
    expect(serializeGame(a)).toBe(serializeGame(b));
  });

  it('migrates version 9 saves: fires get a fresh spread clock', () => {
    const state = fixture();
    const office = build(state, 'office', 3, 40);
    startIncident(state, 'fire', office.id);
    const legacy = JSON.parse(serializeGame(state));
    legacy.version = 9;
    delete legacy.state.campaign.incidents[0].nextSpreadTick;
    delete legacy.state.money.loanCents;
    const loaded = deserializeGame(JSON.stringify(legacy));
    expect(loaded.campaign.incidents[0]!.nextSpreadTick).toBe(loaded.tickCount + CONFIG.FIRE_SPREAD_INTERVAL_TICKS);
    expect(loaded.money.loanCents).toBe(0);
    tickN(loaded, 10);
  });
});
