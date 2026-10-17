import { describe, expect, it } from 'vitest';
import {
  SCENARIOS,
  buildFloor,
  buildFloorError,
  deserializeGame,
  elevatorPlacementError,
  placementError,
  placeTenant,
  scenarioProgress,
  serializeGame,
  startScenario,
  stepScenario,
  tick,
  type GameState,
} from '../../src/sim';
import { floorExtensionError } from '../../src/sim/tower';
import { operatingDay } from '../../src/sim/time';
import { tickN } from '../helpers/simHarness';

const wins = (state: GameState): number => state.campaign.history.filter(h => h.message.startsWith('Scenario complete')).length;
const losses = (state: GameState): number => state.campaign.history.filter(h => h.message.startsWith('Scenario failed')).length;
/** Advance to the next objective check (every 50 ticks). */
const toCheck = (state: GameState): void => { do tick(state); while (state.tickCount % 50 !== 0); };

describe('scenario setup', () => {
  it.each(SCENARIOS.map(s => s.id))('%s starts a fresh, unfinished scenario', id => {
    const def = SCENARIOS.find(s => s.id === id)!;
    const state = startScenario(id);
    expect(state.scenario).toMatchObject({ id, startDay: 1, deadlineDay: 1 + def.timeLimitDays });
    expect(state.scenario!.met).toEqual(def.objectives.map(() => false));
    expect(state.scenario!.outcome).toBeUndefined();
    expect(state.tower.lobbyHeight).toBe(def.lobbyHeight);
    expect(state.money.balanceCents).toBeGreaterThan(0);
    expect(state.campaign.history[0]!.message).toContain(def.title);
    expect(scenarioProgress(state)!.objectives).toHaveLength(def.objectives.length);
  });

  it('builds the same tower every time (deterministic setup)', () => {
    for (const id of ['rush-hour', 'rebuild']) expect(serializeGame(startScenario(id))).toBe(serializeGame(startScenario(id)));
  });

  it('prebuilds the scenario towers it describes', () => {
    const rush = startScenario('rush-hour');
    expect([...rush.tenants.values()].filter(t => t.type === 'office' && t.state === 'open')).toHaveLength(72);
    expect(rush.elevatorGroups.size).toBe(1);
    expect([...rush.elevatorGroups.values()][0]!.cars).toHaveLength(1);
    const rebuild = startScenario('rebuild');
    expect(rebuild.scenario!.initialDamaged).toBeGreaterThan(50);
    expect(rebuild.starLevel).toBe(3);
    // Condos sold during setup are not counted as scenario income.
    expect([...rebuild.tenants.values()].every(t => t.dailyRevenue === 0)).toBe(true);
    const sky = startScenario('skyline');
    const lobby = [...sky.tenants.values()].find(t => t.type === 'lobby')!;
    expect([lobby.x, lobby.x + lobby.sizeCells]).toEqual([sky.scenario!.rules.lot!.lo, sky.scenario!.rules.lot!.hi]);
  });
});

describe('scenario objectives', () => {
  it('reports stars, funds, offices and population', () => {
    const state = startScenario('first-tower');
    const [stars0, offices, funds0] = scenarioProgress(state)!.objectives;
    expect(stars0).toMatchObject({ kind: 'stars', value: 1, target: 2, met: false, format: 'stars' });
    expect(offices).toMatchObject({ value: 0, target: 10, met: false });
    expect(funds0).toMatchObject({ value: 2_000_000_00, met: true, fraction: 1 });
    state.starLevel = 2;
    state.money.balanceCents = 500_000_00;
    const [stars, , funds] = scenarioProgress(state)!.objectives;
    expect(stars!.met).toBe(true);
    expect(funds).toMatchObject({ met: false, fraction: 0.5 });
  });

  it('counts damaged rooms down from the start', () => {
    const state = startScenario('rebuild');
    const damaged = scenarioProgress(state)!.objectives[0]!;
    expect(damaged).toMatchObject({ kind: 'damaged', met: false, fraction: 0 });
    const rooms = [...state.tenants.values()].filter(t => t.state === 'damaged');
    rooms.slice(0, rooms.length / 2).forEach(t => { t.state = 'open'; });
    expect(scenarioProgress(state)!.objectives[0]!.fraction).toBeCloseTo(0.5, 1);
    rooms.forEach(t => { t.state = 'open'; });
    expect(scenarioProgress(state)!.objectives[0]).toMatchObject({ value: 0, met: true });
  });

  it('counts hotel guests, graded suites, net income and express sky lobbies', () => {
    const hotel = startScenario('grand-hotel');
    buildFloor(hotel, 2);
    const suite = placeTenant(hotel, 'hotelSuite', 2, 20);
    suite.state = 'open';
    suite.grade = 4;
    hotel.money.dailyIncomeCents = 200_000_00;
    hotel.money.dailyUpkeepCents = 20_000_00;
    const [guests, suites, net] = scenarioProgress(hotel)!.objectives;
    expect(guests).toMatchObject({ kind: 'hotelGuests', value: 0 });
    expect(suites).toMatchObject({ kind: 'suites', value: 1, target: 3 });
    expect(net).toMatchObject({ kind: 'netIncome', value: 180_000_00, met: true });

    const sky = startScenario('skyline');
    for (let f = 2; f <= 15; f++) buildFloor(sky, f);
    placeTenant(sky, 'skyLobby', 15, 150).state = 'open';
    expect(elevatorPlacementError(sky, 1, 15, 150, 'express')).toBeNull();
    const objectives = scenarioProgress(sky)!.objectives;
    expect(objectives.find(o => o.kind === 'topFloor')!.value).toBe(15);
    expect(objectives.find(o => o.kind === 'expressSkyLobbies')!.value).toBe(0);
  });

  it('tracks calm weekdays: a weekday without give-ups and below the stress ceiling extends the streak', () => {
    const state = startScenario('rush-hour');
    const calm = state.scenario!.calm!;
    expect(operatingDay(state)).toBe(1);
    Object.assign(calm, { day: 2, giveUps: 3, stressSum: 10, samples: 1, streak: 1 });
    tick(state);
    expect(calm).toMatchObject({ streak: 0, lastGiveUps: 3, day: 1 });
    Object.assign(calm, { day: 2, giveUps: 0, stressSum: 90, samples: 1 });
    tick(state);
    expect(calm.streak).toBe(0); // too stressed
    Object.assign(calm, { day: 2, giveUps: 0, stressSum: 10, samples: 1, streak: 1 });
    tick(state);
    // Second calm weekday with every office leased: the scenario is won at once.
    expect(state.scenario!.outcome?.result).toBe('won');
  });
});

describe('scenario constraints', () => {
  it('bans facilities with a clear message', () => {
    const state = startScenario('grand-hotel');
    buildFloor(state, 2);
    expect(placementError(state, 'office', 2, 20)).toBe('Office is not allowed in this scenario');
    expect(placementError(state, 'condo', 2, 20)).toBe('Condo is not allowed in this scenario');
    expect(placementError(state, 'hotel', 2, 20)).toBeNull();
  });

  it('limits floors above and below', () => {
    const state = startScenario('rush-hour');
    expect(buildFloorError(state, 11)).toBe("This scenario's height limit is floor 10");
    expect(buildFloorError(state, -1)).toBe("This scenario's basements go down to B1");
  });

  it('keeps the tower on its lot', () => {
    const state = startScenario('skyline');
    expect(placementError(state, 'lobby', 1, 149)).toBe("Outside the scenario's building lot");
    expect(placementError(state, 'lobby', 1, 246)).toBe("Outside the scenario's building lot");
    buildFloor(state, 2);
    expect(floorExtensionError(state, 2, 246)).toBe("Outside the scenario's building lot");
  });

  it('bans elevator kinds and lifts every rule once the scenario ends', () => {
    const state = startScenario('rush-hour');
    state.scenario!.rules.bannedElevators = ['service'];
    expect(elevatorPlacementError(state, 1, 5, 2, 'service')).toBe('Service elevators are not allowed in this scenario');
    expect(elevatorPlacementError(state, 1, 5, 2, 'standard')).toBeNull();
    state.scenario!.outcome = { result: 'won', day: 2, daysTaken: 1, reason: '', population: 0, fundsCents: 0, stars: 2, topFloor: 10 };
    expect(elevatorPlacementError(state, 1, 5, 2, 'service')).toBeNull();
    expect(buildFloorError(state, 11)).toBeNull();
  });
});

describe('scenario outcomes', () => {
  function readyFirstTower(): GameState {
    const state = startScenario('first-tower');
    for (let x = 0; x < 100; x++) placeTenant(state, 'lobby', 1, x);
    buildFloor(state, 2);
    for (let i = 0; i < 10; i++) placeTenant(state, 'office', 2, i * 9).state = 'open';
    state.starLevel = 2;
    state.money.balanceCents = 1_500_000_00;
    return state;
  }

  it('records a win once, with stats and a journal entry', () => {
    const state = readyFirstTower();
    toCheck(state);
    const outcome = state.scenario!.outcome!;
    expect(outcome).toMatchObject({ result: 'won', day: 1, daysTaken: 0, stars: 2, topFloor: 2 });
    expect(state.scenario!.met).toEqual([true, true, true]);
    expect(state.events.some(e => e.type === 'ALERT' && e.message.startsWith('Scenario complete'))).toBe(true);
    tickN(state, 120);
    expect(wins(state)).toBe(1);
    expect(state.scenario!.outcome).toBe(outcome);
  });

  it('needs held goals at the moment of victory but keeps reached goals ticked', () => {
    const state = readyFirstTower();
    state.money.balanceCents = 900_000_00;
    toCheck(state);
    expect(state.scenario!.outcome).toBeUndefined();
    expect(state.scenario!.met).toEqual([true, false, false]);
    state.starLevel = 1; // a reached goal stays reached
    state.money.balanceCents = 1_200_000_00;
    toCheck(state);
    expect(state.scenario!.outcome?.result).toBe('won');
  });

  it('is lost when time runs out, once', () => {
    const state = startScenario('first-tower');
    state.calendar.day = state.scenario!.deadlineDay;
    tick(state);
    expect(state.scenario!.outcome).toMatchObject({ result: 'lost', reason: 'Time ran out with 2 goals unmet.' });
    tickN(state, 60);
    expect(losses(state)).toBe(1);
  });

  it('is lost when a no-debt scenario ends a day in debt', () => {
    const state = startScenario('rush-hour');
    state.campaign.bankrupt = true;
    tick(state);
    expect(state.scenario!.outcome).toMatchObject({ result: 'lost', reason: 'The tower ended a day in debt.' });
  });

  it('ignores free play and unknown scenario ids', () => {
    const state = startScenario('first-tower');
    delete state.scenario;
    expect(() => stepScenario(state)).not.toThrow();
    expect(scenarioProgress(state)).toBeNull();
    state.scenario = { id: 'retired', startDay: 1, deadlineDay: 2, rules: {}, met: [] };
    state.calendar.day = 5;
    stepScenario(state);
    expect(state.scenario.outcome).toBeUndefined();
  });
});

describe('scenario saves', () => {
  it('round-trips an active scenario and keeps evaluating', () => {
    const state = startScenario('rush-hour');
    tickN(state, 120);
    const loaded = deserializeGame(serializeGame(state));
    expect(loaded.scenario).toEqual(state.scenario);
    tickN(state, 60);
    tickN(loaded, 60);
    expect(serializeGame(loaded)).toBe(serializeGame(state));
  });

  it('loads older saves as free play', () => {
    const state = startScenario('rush-hour');
    const envelope = JSON.parse(serializeGame(state)) as { version: number; state: Record<string, unknown> };
    envelope.version = 11;
    delete envelope.state.scenario;
    delete envelope.state.stats;
    const loaded = deserializeGame(JSON.stringify(envelope));
    expect(loaded.scenario).toBeUndefined();
    expect(scenarioProgress(loaded)).toBeNull();
    expect(buildFloorError(loaded, 11)).toBeNull(); // no height limit in free play
    expect(() => tickN(loaded, 60)).not.toThrow();
  });
});
