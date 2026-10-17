import { describe, expect, it } from 'vitest';
import {
  DEPARTED_MAX,
  departedFavorites,
  deserializeGame,
  favoriteIds,
  favoriteOf,
  generatedName,
  isFavorite,
  personName,
  prunePersonNotes,
  renamePerson,
  serializeGame,
  setFavorite,
  tenantVoices,
  withSpeaker,
  type GameState,
  type Person,
  type Tenant,
} from '../../src/sim';
import { emptyDrawn, pickNearest, recordDrawn } from '../../src/render/personPick';
import { homeSpot, personActivity, personRole, stressMood } from '../../src/ui/personInfo';
import { searchPeople } from '../../src/ui/peopleWindow';
import { newTestGame, scenarioTower, tickN } from '../helpers/simHarness';

function tenantOf(state: GameState, type: Tenant['type']): Tenant {
  return [...state.tenants.values()].find(t => t.type === type)!;
}

/** A tower with people: the standard scenario after construction. */
function peopledTower(): GameState {
  const state = newTestGame(7);
  scenarioTower(state);
  tickN(state, 1000);
  return state;
}

function fakePerson(state: GameState, over: Partial<Person>): Person {
  const office = tenantOf(state, 'office');
  const person: Person = {
    id: 9000 + state.people.size, kind: 'officeWorker', tenantId: office.id, scheduleIndex: 0, scheduleDone: false,
    state: 'inTenant', pos: { floor: office.floor, x: office.x + 2 }, target: null, destination: null, endState: 'inTenant',
    route: null, legIndex: 0, stairsTicksLeft: 0, waitTicks: 0, stress: 0, dayStress: 0, failedTripsToday: 0,
    jitterTicks: 0, dayTracked: 1, activityTicksLeft: 0, activityTenantId: -1, ...over,
  };
  state.people.set(person.id, person);
  return person;
}

describe('person names', () => {
  it('are stable per (seed, id) and never touch the sim RNG', () => {
    const state = peopledTower();
    const rng = state.rngState;
    const names = [...state.people.keys()].map(id => personName(state, id));
    expect(names.every(n => /^\S+ \S+$/.test(n))).toBe(true);
    expect([...state.people.keys()].map(id => generatedName(state.seed, id))).toEqual(names);
    expect(state.rngState).toBe(rng);
    expect(generatedName(1, 5)).toBe(generatedName(1, 5));
    // Different towers name the same ids differently (mostly).
    const differ = Array.from({ length: 50 }, (_, id) => generatedName(1, id) !== generatedName(2, id)).filter(Boolean).length;
    expect(differ).toBeGreaterThan(40);
    // A wide spread of names across a crowd.
    expect(new Set(Array.from({ length: 200 }, (_, id) => generatedName(3, id))).size).toBeGreaterThan(180);
  });

  it('renames and favourites survive save/load; older saves load without notes', () => {
    const state = peopledTower();
    const [a, b] = [...state.people.keys()];
    expect(renamePerson(state, a!, '  Grandma   Rose  ')).toBe('Grandma Rose');
    expect(renamePerson(state, b!, 'x'.repeat(40))).toHaveLength(24);
    setFavorite(state, a!, true);
    const loaded = deserializeGame(serializeGame(state));
    expect(personName(loaded, a!)).toBe('Grandma Rose');
    expect(isFavorite(loaded, a!)).toBe(true);
    expect(favoriteIds(loaded)).toEqual([a]);
    // Blank or the generated name clears the override; unstarring drops the note.
    renamePerson(loaded, a!, '');
    setFavorite(loaded, a!, false);
    expect(loaded.personNotes?.[a!]).toBeUndefined();
    expect(personName(loaded, a!)).toBe(generatedName(loaded.seed, a!));
    const old = JSON.parse(serializeGame(newTestGame())) as { state: Record<string, unknown> };
    delete old.state.personNotes;
    expect(deserializeGame(JSON.stringify(old)).personNotes).toBeUndefined();
    expect(() => renamePerson(loaded, 123456, 'Ghost')).toThrow();
  });

  it('forgets notes about people who left; favourites keep a capped dated record', () => {
    const state = peopledTower();
    const ids = [...state.people.keys()];
    renamePerson(state, ids[0]!, 'Plain Note');
    setFavorite(state, ids[1]!, true);
    renamePerson(state, ids[1]!, 'Star Person');
    state.people.delete(ids[0]!);
    state.people.delete(ids[1]!);
    prunePersonNotes(state);
    expect(state.personNotes?.[ids[0]!]).toBeUndefined();
    expect(departedFavorites(state)).toEqual([{ id: ids[1], name: 'Star Person', day: state.calendar.day }]);
    expect(favoriteIds(state)).toEqual([]);
    // Cap: only the newest DEPARTED_MAX records stay.
    for (let i = 0; i < DEPARTED_MAX + 5; i++) state.personNotes![100000 + i] = { favorite: true, departedDay: 2 + i, name: `P${i}` };
    prunePersonNotes(state);
    const records = departedFavorites(state);
    expect(records).toHaveLength(DEPARTED_MAX);
    expect(records[0]!.name).toBe(`P${DEPARTED_MAX + 4}`);
    // Unstarring a record forgets it.
    setFavorite(state, records[0]!.id, false);
    expect(departedFavorites(state)).toHaveLength(DEPARTED_MAX - 1);
  });

  it('the engine prunes notes as it ticks', () => {
    const state = peopledTower();
    const id = [...state.people.keys()][0]!;
    setFavorite(state, id, true);
    state.people.delete(id);
    tickN(state, 31);
    expect(departedFavorites(state).map(r => r.id)).toEqual([id]);
  });
});

describe('person card text', () => {
  it('describes every person state in plain words', () => {
    const state = peopledTower();
    const office = tenantOf(state, 'office');
    const condo = tenantOf(state, 'condo');
    const group = [...state.elevatorGroups.values()][0]!;
    const leg = { mode: 'elevator' as const, from: 1, to: 5, dir: 1 as const, groupId: group.id };
    expect(personActivity(state, fakePerson(state, { state: 'offscreen' }))).toBe('Off-site');
    expect(personActivity(state, fakePerson(state, {}))).toBe('At work');
    expect(personActivity(state, fakePerson(state, { kind: 'resident', tenantId: condo.id }))).toBe('At home');
    expect(personActivity(state, fakePerson(state, { state: 'waiting', pos: { floor: 1, x: 10 }, route: [leg], waitTicks: 0 })))
      .toBe('Waiting for the elevator on floor 1 · 0 min');
    const waited = personActivity(state, fakePerson(state, { state: 'waiting', pos: { floor: 1, x: 10 }, route: [leg], waitTicks: 40 }));
    expect(waited).toMatch(/^Waiting for the elevator on floor 1 · [1-9]\d* min$/);
    group.kind = 'express';
    expect(personActivity(state, fakePerson(state, { state: 'riding', pos: { floor: 1, x: 10 }, route: [leg] })))
      .toBe('Riding the express elevator to floor 5');
    group.kind = 'standard';
    const stair = { mode: 'stair' as const, from: 2, to: 3, dir: 1 as const, x: 0 };
    expect(personActivity(state, fakePerson(state, { state: 'onStairs', route: [stair] }))).toBe('Taking the stairs to floor 3');
    expect(personActivity(state, fakePerson(state, { state: 'onEscalator', route: [{ ...stair, mode: 'escalator' }] }))).toBe('Riding the escalator to floor 3');
    expect(personActivity(state, fakePerson(state, { state: 'walking', pos: { floor: 2, x: 5 }, destination: { floor: office.floor, x: office.x } })))
      .toBe('Walking on floor 2, heading to work');
    expect(personActivity(state, fakePerson(state, { state: 'walking', pos: { floor: 1, x: 5 }, endState: 'offscreen' })))
      .toBe('Walking on floor 1, heading out of the tower');
    expect(personActivity(state, fakePerson(state, { state: 'cleaning', activityTenantId: condo.id }))).toBe('Cleaning Condo, floor 3');
    // Eating at someone else's venue.
    condo.type = 'fastfood';
    expect(personActivity(state, fakePerson(state, { activityTenantId: condo.id }))).toBe('Eating at Fast food, floor 3');
    condo.type = 'condo';
  });

  it('names roles, home spots and the SimTower stress colours', () => {
    const state = peopledTower();
    const condo = tenantOf(state, 'condo');
    expect(personRole(state, fakePerson(state, {}))).toBe('Office worker at Office, floor 2');
    expect(personRole(state, fakePerson(state, { kind: 'resident', tenantId: condo.id }))).toBe('Resident of Condo, floor 3');
    expect(personRole(state, fakePerson(state, { kind: 'shopper', tenantId: -1 }))).toBe('Shopper');
    expect(homeSpot(state, fakePerson(state, {}))?.label).toBe('Jump to workplace');
    expect(homeSpot(state, fakePerson(state, { kind: 'shopper' }))).toBeNull();
    expect(stressMood(fakePerson(state, { stress: 10 })).mood).toBe('calm');
    expect(stressMood(fakePerson(state, { stress: 50 })).mood).toBe('pink');
    expect(stressMood(fakePerson(state, { stress: 90 })).mood).toBe('red');
  });

  it('searches people by name on demand, favourites first, capped', () => {
    const state = peopledTower();
    const ids = [...state.people.keys()];
    renamePerson(state, ids[2]!, 'Zelda Quartz');
    expect(searchPeople(state, 'zelda q')).toEqual([ids[2]]);
    expect(searchPeople(state, '   ')).toEqual([]);
    const surname = personName(state, ids[0]!).split(' ')[0]!;
    expect(searchPeople(state, surname, 1)).toHaveLength(1);
  });
});

describe('person hit-testing', () => {
  it('picks the figure nearest the click within a small radius', () => {
    const drawn = emptyDrawn();
    for (let i = 0; i < 100; i++) recordDrawn(drawn, i, i * 20, 0);
    recordDrawn(drawn, 500, 24, 0); // overlaps figure 1 (x 20..27)
    expect(drawn.count).toBe(101);
    expect(pickNearest(drawn, 23, 6, 7, 12, 2)).toBe(1);
    expect(pickNearest(drawn, 28, 6, 7, 12, 2)).toBe(500);
    expect(pickNearest(drawn, 41, -1, 7, 12, 2)).toBe(2);
    expect(pickNearest(drawn, 34, 6, 7, 12, 2)).toBe(-1); // gap between figures
    expect(pickNearest(drawn, 23, 30, 7, 12, 2)).toBe(-1); // well below
  });
});

describe('favourite voices', () => {
  it("prefix a room's first line with a favourite's name, within 60 characters", () => {
    const voices = [{ tone: 'complaint' as const, cause: 'liftWait' as const, text: 'The elevator takes forever' }];
    expect(withSpeaker(voices, 'Maria Lopez')[0]!.text).toBe('Maria Lopez: The elevator takes forever');
    expect(withSpeaker(voices, 'X'.repeat(40))[0]!.text).toBe('The elevator takes forever');
    expect(withSpeaker([{ tone: 'info', cause: 'new', text: 'Just moved in' }], 'Maria')[0]!.text).toBe('Just moved in');

    const state = peopledTower();
    const home = tenantOf(state, 'condo');
    const worker = [...state.people.values()].find(p => p.tenantId === home.id)!;
    expect(favoriteOf(state, home.id)).toBeNull();
    setFavorite(state, worker.id, true);
    renamePerson(state, worker.id, 'Maria Lopez');
    expect(favoriteOf(state, home.id)).toBe('Maria Lopez');
    const lines = tenantVoices(state, home);
    expect(lines.some(v => v.text.startsWith('Maria Lopez: '))).toBe(lines.some(v => v.tone !== 'info'));
    expect(lines.every(v => v.text.length <= 60)).toBe(true);
  });
});
