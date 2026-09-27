import { expect, it } from 'vitest';
import { demolishAt, deserializeGame, placeEscalator, serializeGame } from '../../src/sim';
import { spawnTenantPeople, stepPeople } from '../../src/sim/people';
import { newTestGame, scenarioTower } from '../helpers/simHarness';

function fixture(mode: 'stair' | 'escalator') {
  const state = newTestGame(); scenarioTower(state);
  if (mode === 'escalator') placeEscalator(state, 2, 40, 'up');
  spawnTenantPeople(state, [...state.tenants.values()].find(t => t.type === 'office')!);
  const p = [...state.people.values()][0]!;
  state.people.clear(); state.people.set(p.id, p);
  const x = mode === 'stair' ? 0 : 40;
  Object.assign(p, { state: 'walking', scheduleDone: true, legIndex: 0,
    pos: { floor: 2, x }, target: { floor: 2, x }, destination: { floor: 3, x: 70 },
    route: [{ mode, from: 2, to: 3, dir: 1, x }] });
  return { state, p, x };
}

for (const mode of ['stair', 'escalator'] as const) {
  it(`cancels a walker approaching demolished ${mode} cells, including after save/load`, () => {
    const { state, p, x } = fixture(mode);
    demolishAt(state, 2, x + 2); // Any cell of the footprint selects the connection.
    expect(p).toMatchObject({ state: 'offscreen', target: null, route: null, failedTripsToday: 1 });
    const restored = deserializeGame(serializeGame(state));
    stepPeople(state); stepPeople(restored);
    expect(p.state).toBe('offscreen');
    expect(serializeGame(restored)).toBe(serializeGame(state));
  });

  it(`rejects demolition of occupied ${mode} without cancelling other approaching people`, () => {
    const { state, p, x } = fixture(mode);
    state.people.set(999, { ...p, id: 999 });
    p.state = mode === 'stair' ? 'onStairs' : 'onEscalator';
    const before = serializeGame(state);
    expect(() => demolishAt(state, 2, x)).toThrow('Wait for people');
    expect(serializeGame(state)).toBe(before);
  });

  it(`keeps a trip whose ${mode} leg is complete`, () => {
    const { state, p, x } = fixture(mode);
    p.legIndex = 1;
    demolishAt(state, 2, x);
    expect(p.failedTripsToday).toBe(0);
    expect(p.route).toHaveLength(1);
  });
}

it('preserves an adjacent escalator sharing a landing and its approaching passenger', () => {
  const { state, p } = fixture('escalator');
  placeEscalator(state, 3, 40, 'up');
  p.route = [{ mode: 'escalator', from: 3, to: 4, dir: 1, x: 40 }];
  demolishAt(state, 2, 40);
  expect(state.escalators.has('3:40')).toBe(true);
  expect(p.failedTripsToday).toBe(0);
  expect(state.tower.floors.find(f => f.index === 3)!.cells[40]!.content).toBe('escalator');
});
