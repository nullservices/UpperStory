import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/data/config';
import { placeTenant, stepEvaluation, tenantVoices, voicesFromFacts } from '../../src/sim';
import type { Tenant } from '../../src/sim';
import type { VoiceFacts } from '../../src/sim/complaints';
import { newTestGame, scenarioTower } from '../helpers/simHarness';

function room(type: Tenant['type'], over: Partial<Tenant> = {}): Tenant {
  return {
    id: 1, type, floor: 3, x: 20, sizeCells: 16, state: 'open', constructionTicksLeft: 0,
    occupancy: 0, capacity: 3, pricing: 2, cleanliness: 100, dailyRevenue: 0,
    grade: 4, evalScore: 80, noisePenalty: 0, daysVacant: 0, daysGood: 0, ...over,
  } as Tenant;
}
const calm: VoiceFacts = { avgStress: 0, failedTrips: 0, noise: null, access: true, waste: 0 };
const causes = (t: Tenant, f: Partial<VoiceFacts> = {}) => voicesFromFacts(t, { ...calm, ...f }).map(v => v.cause);

describe('tenant voices', () => {
  it('happy rooms get praise', () => {
    for (const type of ['condo', 'office', 'hotel', 'shop', 'apartment', 'gym'] as Tenant['type'][]) {
      const voices = voicesFromFacts(room(type), calm);
      expect(voices[0]).toMatchObject({ tone: 'praise', cause: 'happy' });
    }
  });

  it('each cause triggers its voice', () => {
    expect(causes(room('condo'), { noise: { type: 'fastfood', floor: 3, floorDistance: 0 } })).toContain('noise');
    expect(voicesFromFacts(room('condo'), { ...calm, noise: { type: 'fastfood', floor: 3, floorDistance: 0 } })[0]!.text)
      .toBe('The fast food place next door is so loud');
    expect(causes(room('office'), { avgStress: 60 })).toContain('liftWait');
    expect(causes(room('office'), { failedTrips: 2 })).toContain('liftWait');
    expect(causes(room('office'), { avgStress: 25 })).toContain('stress');
    expect(causes(room('office', { pricing: 3 }))).toContain('rent');
    expect(causes(room('hotel', { cleanliness: 40 }), { housekeeping: { openOffices: 1, reachableOffices: 1, assignedCleaners: 0 } })).toContain('dirty');
    expect(causes(room('hotel', { cleanliness: 40 }), { housekeeping: { openOffices: 0, reachableOffices: 0, assignedCleaners: 0 } })).toContain('noHousekeeping');
    expect(causes(room('condo'), { access: false })[0]).toBe('noAccess');
    expect(causes(room('apartment'), { access: false })[0]).toBe('noAccess');
    expect(causes(room('office', { grade: 1, daysVacant: 1 }))).toContain('evaluationRisk');
    expect(causes(room('shop', { reportedPopulation: 2, tradingDays: 3, capacity: 25 }))).toContain('emptyShop');
    expect(causes(room('bar', { grade: 0 }))).toContain('emptyShop');
    expect(causes(room('restaurant', { pricing: 3 }))).toContain('price');
    expect(causes(room('condo'), { waste: 90 })).toContain('waste');
    expect(causes(room('office', { state: 'damaged' }))).toEqual(['damaged']);
    expect(causes(room('condo', { state: 'vacant' }), { access: false })).toEqual(['noAccess']);
  });

  it('keeps lines short, ordered and capped', () => {
    const voices = voicesFromFacts(room('hotel', { cleanliness: 10, pricing: 3, grade: 0 }),
      { ...calm, avgStress: 80, failedTrips: 3, noise: { type: 'restaurant', floor: 2, floorDistance: 1 }, waste: 90 });
    expect(voices).toHaveLength(3);
    expect(voices[0]!.cause).toBe('dirty');
    for (const v of voices) expect(v.text.length).toBeLessThanOrEqual(60);
  });

  it('services and scaffolds stay silent', () => {
    expect(voicesFromFacts(room('security'), calm)).toEqual([]);
    expect(voicesFromFacts(room('maintenance'), calm)).toEqual([]);
    expect(voicesFromFacts(room('condo', { state: 'constructing' }), calm)).toEqual([]);
  });

  it('agrees with the grade after a real evaluation', () => {
    const state = newTestGame();
    scenarioTower(state);
    const office = [...state.tenants.values()].find(t => t.type === 'office')!;
    office.state = 'open';
    office.occupancy = office.capacity;
    stepEvaluation(state);
    expect(office.grade).toBeGreaterThanOrEqual(4);
    expect(tenantVoices(state, office)[0]).toMatchObject({ tone: 'praise' });

    office.occupancy = 0;
    state.tickCount = CONFIG.QUARTER_DAYS * CONFIG.DAY_TICKS;
    stepEvaluation(state);
    expect(office.grade).toBeLessThanOrEqual(1);
    const voices = tenantVoices(state, office);
    expect(voices[0]).toMatchObject({ tone: 'complaint', cause: 'evaluationRisk' });
    expect(voices.some(v => v.tone === 'praise' && v.cause === 'happy')).toBe(false);
  });

  it('names a real noisy neighbour from state', () => {
    const state = newTestGame();
    scenarioTower(state);
    const office = [...state.tenants.values()].find(t => t.type === 'office')!;
    office.state = 'open';
    placeTenant(state, 'fastfood', 2, 34);
    const shop = [...state.tenants.values()].find(t => t.type === 'fastfood')!;
    shop.state = 'open';
    const noise = tenantVoices(state, office).find(v => v.cause === 'noise');
    expect(noise?.text).toBe('Noise from the fast food place next door is distracting');
  });
});
