import { describe, expect, it } from 'vitest';
import { deserializeGame, serializeGame } from '../../src/sim';
import { newTestGame, scenarioTower, tickN } from '../helpers/simHarness';

describe('save/load', () => {
  it('round-trips a full mid-game state (Maps, queues, people, elevators)', () => {
    const state = newTestGame(42);
    scenarioTower(state);
    tickN(state, 3_000); // construction done, traffic flowing
    const loaded = deserializeGame(serializeGame(state));

    // Events are transient and dropped on save.
    state.events = [];
    expect(loaded).toEqual(state);
    // Maps and their numeric keys survive the JSON string round-trip.
    expect(loaded.floorCalls).toBeInstanceOf(Map);
    expect(loaded.people).toBeInstanceOf(Map);
    expect(loaded.people.get([...loaded.people.keys()][0]!)).toBeDefined();
    expect(loaded.routing.groupsServing.get(1)?.length).toBeGreaterThan(0);
  });

  it('replays deterministically after a save/load cycle', () => {
    const a = newTestGame(7);
    scenarioTower(a);
    tickN(a, 2_000);
    const b = deserializeGame(serializeGame(a));
    tickN(a, 1_500);
    tickN(b, 1_500);
    a.events = [];
    b.events = [];
    expect(a).toEqual(b);
  });

  it('rejects unknown versions and malformed files', () => {
    expect(() => deserializeGame('{"version":99,"state":{}}')).toThrow(
      'Unsupported save version',
    );
    expect(() => deserializeGame('not json')).toThrow();
    expect(() => deserializeGame('{"foo":1}')).toThrow('Not a TowerProject save');
  });

  it('serialization does not mutate the live state', () => {
    const state = newTestGame();
    scenarioTower(state);
    tickN(state, 1_500); // construction done, people have moved in
    serializeGame(state);
    // The live state keeps its counters and transient events untouched.
    expect(state.tickCount).toBe(1_500);
    expect(state.people.size).toBeGreaterThan(0);
    expect(state.tenants.size).toBeGreaterThan(0);
  });
});
