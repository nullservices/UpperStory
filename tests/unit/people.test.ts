import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/data/config';
import {
  buildFloor,
  lobbyWaitStressMultiplier,
  patienceTicks,
  placeTenant,
  population,
  stepStress,
} from '../../src/sim';
import {
  newTestGame,
  scenarioTower,
  tickCollecting,
  tickN,
} from '../helpers/simHarness';

describe('daily schedules', () => {
  it('the full worker commute: arrive by elevator at 09:00, leave at 18:00', () => {
    const state = newTestGame();
    scenarioTower(state);

    // Day 1: construction completes (~13:54 for the office, earlier for the
    // condo). Workers spawn but their 9:00 slot already passed — they wait
    // for the next morning.
    tickN(state, 1_400);
    const workers = [...state.people.values()].filter((p) => p.kind === 'officeWorker');
    expect(workers).toHaveLength(6);
    expect(workers.every((p) => p.state === 'offscreen')).toBe(true);

    // Day 2, 09:00: everyone heads in; check at 11:30 (before the 12:00 lunch).
    tickN(state, CONFIG.DAY_TICKS - state.calendar.tickOfDay + 160);
    tickN(state, 200);
    const atWork = [...state.people.values()].filter((p) => p.kind === 'officeWorker');
    expect(atWork.every((p) => p.state === 'inTenant' && p.pos.floor === 2)).toBe(true);
    // No queue left hanging, no calls left burning.
    expect(Object.values(state.queues).every((q) => q.length === 0)).toBe(true);

    // Day 2, 18:00: everyone leaves (after lunch and the afternoon at work).
    tickN(state, 1_700 - state.calendar.tickOfDay);
    tickN(state, 400); // commute buffer
    const afterWork = [...state.people.values()].filter((p) => p.kind === 'officeWorker');
    expect(afterWork.every((p) => p.state === 'offscreen')).toBe(true);
  });

  it('residents take the stairs to the lobby and back', () => {
    const state = newTestGame();
    scenarioTower(state);
    // Day 1: condo completes at 12:30 (tick 800); residents take their 13:30
    // outing to the lobby via the stairs.
    tickN(state, 1_400);
    const residents = [...state.people.values()].filter((p) => p.kind === 'resident');
    expect(residents).toHaveLength(3);
    expect(residents.every((p) => p.state === 'inTenant' && p.pos.floor === 1)).toBe(true);

    // Day 2, 08:00 (tick 80): to the lobby via the stairs.
    tickN(state, CONFIG.DAY_TICKS - state.calendar.tickOfDay + 80);
    tickN(state, 250); // ~11:07 — comfortably before the 12:00 goHome
    const inLobby = [...state.people.values()].filter((p) => p.kind === 'resident');
    expect(inLobby.every((p) => p.state === 'inTenant' && p.pos.floor === 1)).toBe(true);

    // 12:00 goHome (jitter up to ±30 ticks); everyone is home by ~12:52,
    // still before the 13:30 outing.
    tickN(state, 770);
    const atHome = [...state.people.values()].filter((p) => p.kind === 'resident');
    expect(atHome.every((p) => p.state === 'inTenant' && p.pos.floor === 3)).toBe(true);
  });

  it('workers give up when no transport exists and leave the tower', () => {
    const state = newTestGame();
    for (let i = 2; i <= 5; i++) buildFloor(state, i);
    placeTenant(state, 'office', 5, 10); // no elevators, no stairs past floor 3
    tickN(state, 1_400); // construction done, workers wait for day 2

    tickN(state, CONFIG.DAY_TICKS - state.calendar.tickOfDay + 160); // day 2, 09:00
    const events = tickCollecting(state, 100);
    expect(events.filter((e) => e.type === 'PERSON_GAVE_UP').length).toBeGreaterThan(0);
    // Workers storm out offscreen but stay tracked — they retry tomorrow.
    const workers = [...state.people.values()].filter((p) => p.kind === 'officeWorker');
    expect(workers).toHaveLength(6);
    expect(workers.every((p) => p.state === 'offscreen')).toBe(true);
  });

  it('population counts everyone, workers included', () => {
    const state = newTestGame();
    scenarioTower(state);
    tickN(state, 1_400);
    expect(population(state)).toBe(9);
  });
});

describe('stress', () => {
  it('patience grows with stress', () => {
    expect(patienceTicks(0)).toBe(CONFIG.PATIENCE_BASE_TICKS);
    expect(patienceTicks(100)).toBe(CONFIG.PATIENCE_BASE_TICKS + 10);
  });

  it('waiting high up stresses more (lobby modifier)', () => {
    expect(lobbyWaitStressMultiplier(1)).toBe(1);
    expect(lobbyWaitStressMultiplier(30)).toBeCloseTo(1 + 29 * CONFIG.LOBBY_STRESS_HEIGHT_FACTOR);
  });

  it('waiting past patience triggers a give-up', () => {
    const state = newTestGame();
    scenarioTower(state);
    tickN(state, 1_400);
    tickN(state, CONFIG.DAY_TICKS - state.calendar.tickOfDay + 160); // day 2, 09:00
    // Set up a worker waiting for the elevator with a valid route.
    const group = state.elevatorGroups.values().next().value!;
    const worker = [...state.people.values()].find((p) => p.kind === 'officeWorker')!;
    worker.pos = { floor: 1, x: 11 };
    worker.state = 'waiting';
    worker.route = [{ mode: 'elevator', from: 1, to: 2, dir: 1, groupId: group.id }];
    worker.legIndex = 0;
    worker.waitTicks = 0;
    state.queues['1:up'] = [worker.id];
    // Fast-forward the wait past patience: next tick the person gives up.
    worker.waitTicks = 1_000_000;
    const events = tickCollecting(state, 1);
    expect(events).toContainEqual({
      type: 'PERSON_GAVE_UP',
      personId: worker.id,
      floor: 1,
    });
    // Workers storm out offscreen; they try again tomorrow morning.
    expect(state.people.get(worker.id)?.state).toBe('offscreen');
  });

  it('waiting stress accrues and is worse higher up', () => {
    const state = newTestGame();
    scenarioTower(state);
    tickN(state, 1_400);
    const p = [...state.people.values()][0]!;
    p.state = 'waiting';
    p.pos.floor = 30;
    p.stress = 0;
    for (let i = 0; i < 100; i++) stepStress(state);
    expect(p.stress).toBeCloseTo(100 * CONFIG.STRESS_WAIT_PER_TICK * lobbyWaitStressMultiplier(30));
  });
});

describe('determinism with people', () => {
  it('same seed replays identically over a full day with traffic', () => {
    const a = newTestGame(42);
    const b = newTestGame(42);
    for (const s of [a, b]) {
      scenarioTower(s);
      tickN(s, 1_400);
      tickN(s, CONFIG.DAY_TICKS - s.calendar.tickOfDay + 200);
      tickN(s, 800);
    }
    expect(a).toEqual(b);
  });

  it('different seeds diverge', () => {
    const a = newTestGame(1);
    const b = newTestGame(2);
    for (const s of [a, b]) {
      scenarioTower(s);
      tickN(s, 2_000);
    }
    expect(a).not.toEqual(b);
  });
});
