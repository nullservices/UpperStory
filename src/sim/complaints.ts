import { CONFIG, isHotel, isUngradedService } from '../data/config';
import { condoHasAccess } from './condoEconomy';
import { housekeepingAccess, type HousekeepingAccess } from './housekeepingAccess';
import { officeRentScoreAdjustment } from './money';
import { noiseSources } from './noise';
import type { GameState } from './state';
import type { Tenant } from './tenants';

/**
 * Tenant voices: short, plain-language complaints and compliments that
 * explain a room's mood without decoding grades. Read-only and
 * deterministic; every line mirrors a real driver in evaluation.ts
 * (presence, stress, noise, office rent, hotel cleanliness, waste) or a
 * real consequence (vacancy streaks, missing lobby access, slow trade).
 */

export type VoiceTone = 'complaint' | 'praise' | 'info';
export type VoiceCause =
  | 'noise' | 'liftWait' | 'stress' | 'rent' | 'price' | 'dirty' | 'noAccess'
  | 'noHousekeeping' | 'emptyShop' | 'evaluationRisk' | 'waste' | 'damaged'
  | 'vacant' | 'new' | 'ok' | 'happy';

export interface Voice { tone: VoiceTone; text: string; cause: VoiceCause }

/** Who is talking. New tenant types fall into a category by shape, not by name. */
export type VoiceCategory = 'resident' | 'office' | 'hotel' | 'commercial' | 'none';

/** The live facts a voice can draw on beyond the tenant's own fields. */
export interface VoiceFacts {
  /** Mean stress of the tenant's people (0 when none). */
  avgStress: number;
  /** Trips abandoned today by the tenant's people. */
  failedTrips?: number;
  /** Closest current noise source, if any. */
  noise?: { type: string; floor: number; floorDistance: number } | null;
  /** Residential only: lobby reachable both ways (undefined = unknown). */
  access?: boolean;
  housekeeping?: HousekeepingAccess;
  /** Tower waste level 0..100. */
  waste?: number;
}

const MAX_VOICES = 3;
const STAFF: readonly string[] = ['lobby', 'security', 'housekeeping', 'skyLobby'];

export function voiceCategory(tenant: Tenant): VoiceCategory {
  const type: string = tenant.type;
  if (STAFF.includes(type) || isUngradedService(type) || tenant.capacity <= 0) return 'none';
  if (type === 'condo' || type === 'apartment') return 'resident';
  if (isHotel(type)) return 'hotel';
  if (type === 'office') return 'office';
  return 'commercial';
}

/** Gather the facts for `tenant` from live state (no mutation, no RNG). */
export function voiceFacts(state: GameState, tenant: Tenant): VoiceFacts {
  let sum = 0, count = 0, failed = 0;
  for (const p of state.people.values()) {
    if (p.tenantId !== tenant.id) continue;
    sum += p.dayStress;
    failed += p.failedTripsToday;
    count++;
  }
  const category = voiceCategory(tenant);
  let noise: VoiceFacts['noise'] = null;
  if (category !== 'none') {
    let best = Infinity;
    for (const source of noiseSources(state, tenant)) {
      const other = state.tenants.get(source.tenantId);
      const rank = source.floorDistance * 100 + source.gap;
      if (other && rank < best) {
        best = rank;
        noise = { type: other.type, floor: other.floor, floorDistance: source.floorDistance };
      }
    }
  }
  return {
    avgStress: count ? sum / count : 0,
    failedTrips: failed,
    noise,
    access: category === 'resident' ? condoHasAccess(state, tenant) : undefined,
    housekeeping: housekeepingAccess(state, tenant),
    waste: state.campaign.waste,
  };
}

/** Up to three voices for a room, most important first. */
export function tenantVoices(state: GameState, tenant: Tenant): Voice[] {
  if (voiceCategory(tenant) === 'none' || tenant.state === 'constructing') return [];
  return voicesFromFacts(tenant, voiceFacts(state, tenant));
}

const NOISE_NAMES: Record<string, string> = {
  fastfood: 'fast food place', restaurant: 'restaurant', shop: 'shop',
  cinema: 'cinema', office: 'office',
};

interface Ranked extends Voice { weight: number }

/** Pure core: voices from a tenant plus pre-gathered facts. */
export function voicesFromFacts(tenant: Tenant, facts: VoiceFacts): Voice[] {
  const who = voiceCategory(tenant);
  if (who === 'none' || tenant.state === 'constructing') return [];
  const pick = (r: string, o: string, h: string, c: string): string =>
    who === 'resident' ? r : who === 'office' ? o : who === 'hotel' ? h : c;
  const out: Ranked[] = [];
  const say = (tone: VoiceTone, cause: VoiceCause, text: string, weight: number): void => {
    out.push({ tone, cause, text, weight });
  };

  if (tenant.state === 'damaged') {
    say('complaint', 'damaged', "It's wrecked in here. Please repair it!", 200);
    return finish(out);
  }
  if (tenant.state === 'vacant') {
    if (who === 'resident' && facts.access === false) say('complaint', 'noAccess', "Buyers can't reach this floor from the lobby", 100);
    else say('info', 'vacant', pick('For sale, waiting for a buyer', 'Empty, waiting for a new tenant', 'No guests right now', 'Closed for now'), 0);
    return finish(out);
  }

  const evaluated = tenant.noisePenalty !== undefined;

  // Hard blockers first.
  if (who === 'resident' && facts.access === false) say('complaint', 'noAccess', "We can't get to the lobby from here!", 100);

  // Hotel cleanliness (score −0.5 per missing point; filthy rooms lose guests).
  if (who === 'hotel' && tenant.cleanliness < 70) {
    const filthy = tenant.cleanliness < CONFIG.DIRTY_HOTEL_THRESHOLD;
    const weight = (100 - tenant.cleanliness) * 0.5 + (filthy ? 40 : 0);
    const hk = facts.housekeeping;
    if (hk && hk.openOffices === 0) say('complaint', 'noHousekeeping', 'No one cleans here. Is there no housekeeping?', weight);
    else if (hk && hk.reachableOffices === 0) say('complaint', 'noHousekeeping', "Housekeeping can't reach our floor", weight);
    else say('complaint', 'dirty', filthy ? "This room is filthy. We're checking out!" : "Our room hasn't been cleaned yet", weight);
  }

  // Stress and failed trips (score −0.6 per stress point).
  const failed = facts.failedTrips ?? 0;
  if (failed > 0 || facts.avgStress >= 45) {
    say('complaint', 'liftWait', failed > 0
      ? pick('I gave up waiting for the elevator today', 'Staff gave up on the elevator today', 'We gave up waiting for the elevator', "Customers say they can't get here")
      : pick('The elevator takes forever', 'Our staff wait ages for the elevator', 'We waited ages for the elevator', 'Customers say getting here takes ages'),
    Math.max(20, facts.avgStress * 0.6));
  } else if (facts.avgStress >= 20) {
    say('complaint', 'stress', pick('Getting home is such a hassle', 'The commute here is wearing us down', 'Getting around this hotel is tiring', 'Getting here is a chore'), facts.avgStress * 0.6);
  }

  // Noise (flat 20-point penalty).
  if (facts.noise || (tenant.noisePenalty ?? 0) > 0) {
    const n = facts.noise;
    const name = n ? NOISE_NAMES[n.type] ?? n.type.toLowerCase() : 'neighbours';
    const where = !n ? '' : n.floorDistance === 0 ? ' next door' : n.floor > tenant.floor ? ' upstairs' : ' downstairs';
    say('complaint', 'noise', pick(`The ${name}${where} is so loud`, `Noise from the ${name}${where} is distracting`,
      `Couldn't sleep, the ${name}${where} is loud`, `The ${name}${where} is too noisy`), 20);
  }

  // Office rent (−20 at high rent, up to +20 when cheap).
  if (who === 'office') {
    const rent = officeRentScoreAdjustment(tenant);
    if (rent < 0) say('complaint', 'rent', 'The rent here is too high', -rent);
    else if (rent >= 20 && evaluated) say('praise', 'rent', 'The rent is a real bargain', 0);
  }

  // Prices for guests and customers (fewer visitors at high prices).
  if ((who === 'hotel' || who === 'commercial') && tenant.pricing === 3) {
    say('complaint', 'price', who === 'hotel' ? 'This room is overpriced' : 'Prices here are a bit steep', 8);
  }

  // Shops: slow trade from reported counts, or a low grade from low presence.
  if (who === 'commercial') {
    const counted = tenant.reportedPopulation !== undefined && (tenant.tradingDays ?? 0) > 0;
    const slow = counted && tenant.reportedPopulation! < Math.min(tenant.capacity, 35) * 0.3;
    if (slow || (evaluated && tenant.grade <= 1)) say('complaint', 'emptyShop', 'Not enough customers come by', 30);
  }

  // Tower-wide waste (score −0.3 per point above 30).
  const waste = facts.waste ?? 0;
  if (waste > 45) say('complaint', 'waste', 'The whole building smells of garbage', (waste - 30) * 0.3);

  // Vacancy risk for leases that can end (offices, condos, apartments).
  const complaints = out.filter(v => v.tone === 'complaint');
  if (evaluated && tenant.grade <= 1) {
    if (who === 'office' || who === 'resident') {
      const last = tenant.daysVacant >= CONFIG.EVAL_VACANCY_DAYS - 1;
      say('complaint', 'evaluationRisk', last
        ? pick("We're selling up and leaving", "We're moving out unless things change", '', '')
        : pick("We're thinking of moving away", "We're thinking of moving out", '', ''), 60 + tenant.daysVacant * 10);
    } else if (who === 'hotel' && complaints.length === 0) {
      say('complaint', 'evaluationRisk', "We won't be staying here again", 30);
    }
  }

  const serious = out.some(v => v.tone === 'complaint' && v.weight >= 10);
  if (!serious) {
    if (!evaluated) say('info', 'new', pick('Just moved in, still settling', 'New office, settling in', 'Just checked in', 'Just opened, let us see'), 0);
    else if (tenant.grade >= 3) {
      const top = tenant.grade >= 4;
      say('praise', 'happy', pick(top ? 'Great building, we love it here' : 'A nice place to live',
        top ? 'Great building for business' : 'Work is going well here',
        top ? "Lovely stay, we'd come back" : 'Comfortable room, good stay',
        top ? 'Business is booming!' : 'Steady trade, no complaints'), 0);
    } else if (tenant.grade === 2) say('info', 'ok', "It's okay here, nothing special", 0);
  }
  return finish(out);
}

function finish(list: Ranked[]): Voice[] {
  const order: Record<VoiceTone, number> = { complaint: 0, praise: 1, info: 2 };
  return list
    .filter(v => v.text)
    .map((v, i) => ({ v, i }))
    .sort((a, b) => order[a.v.tone] - order[b.v.tone] || b.v.weight - a.v.weight || a.i - b.i)
    .slice(0, MAX_VOICES)
    .map(({ v }) => ({ tone: v.tone, text: v.text, cause: v.cause }));
}
