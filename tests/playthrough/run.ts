/**
 * Headless playthrough: a deterministic bot plays a normal new game toward
 * the TOWER rating. Prints one progress line per in-game quarter, writes a
 * per-quarter metrics CSV, and exits non-zero when the run misses its target.
 *
 *   npm run playthrough -- [--days 150] [--seed 20261015] [--target 4]
 *                          [--csv <path> | --no-csv]
 *
 * The per-quarter CSV is written only when --csv <path> is given.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CONFIG } from '../../src/data/config';
import { tick } from '../../src/sim/core/engine';
import { flattenMetrics, towerMetrics, type TowerMetrics } from '../../src/sim/metrics';
import { population } from '../../src/sim/people';
import { createInitialState, setupNewGame } from '../../src/sim/state';
import { progressionRequirements } from '../../src/sim/progression';
import { pickupRoute } from '../../src/sim/routing';
import { formatTowerDate, isWeekend } from '../../src/sim/time';
import { PlaythroughBot } from './bot';

const STAR_LABEL = ['', '1★', '2★', '3★', '4★', '5★', 'TOWER'];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const maxDays = Number(arg('days') ?? 150);
const seed = Number(arg('seed') ?? 20261015);
const target = Number(arg('target') ?? 4);
const decideEvery = 100; // ticks (~1 game hour on average)
const reactEvery = 20;
const csvArg = arg('csv');
const csvPath = flag('no-csv') ? null : csvArg ?? null;

const state = createInitialState(seed);
setupNewGame(state); // normal game: no lobby, $2M
const bot = new PlaythroughBot(state);

const rows: TowerMetrics[] = [];
const starDays: { stars: number; day: number }[] = [];
let giveUpsToday = 0;
let giveUpsQuarter = 0;
let peakGiveUpsPerDay = 0;
const giveUpBreakdown: Record<string, number> = {};
let weddingCheckedDay = 0;
let lastVip: string | null = null;
function describeVip(id: number): string {
  const incident = state.campaign.incidents.find(i => i.id === id)!;
  const suite = state.tenants.get(incident.tenantId);
  const person = incident.personId === undefined ? undefined : state.people.get(incident.personId);
  const guests = [...state.people.values()].filter(p => p.tenantId === incident.tenantId);
  return JSON.stringify({
    suiteFloor: suite?.floor, suiteGrade: suite?.grade, suiteScore: suite?.evalScore, cleanliness: suite && Math.round(suite.cleanliness),
    stayed: incident.stayed ?? false, arrivalCleanliness: incident.arrivalCleanliness, peakStress: incident.stress && Math.round(incident.stress),
    vip: person ? { state: person.state, floor: person.pos.floor, stress: Math.round(person.stress), failed: person.failedTripsToday } : 'gone',
    guests: guests.map(p => ({ stress: Math.round(p.stress), failed: p.failedTripsToday, state: p.state })),
    connected: suite ? pickupRoute(state, 1, suite.floor, 'hotelGuest') !== null : false,
    ticksLeft: incident.deadline - state.tickCount,
  });
}
let quarterIncome = 0;
let quarterUpkeep = 0;
const t0 = performance.now();
let lastDay = state.calendar.day;

const money = (cents: number): string => `$${Math.round(cents / 100).toLocaleString('en-US')}`;

function progressLine(): string {
  const unmet = bot.unmetNext();
  const m = towerMetrics(state);
  const offices = m.tenants.office;
  const condos = m.tenants.condo;
  return [
    formatTowerDate(state.calendar.day).padEnd(24),
    `day ${String(state.calendar.day).padStart(3)}`,
    `${STAR_LABEL[state.starLevel]}`.padEnd(5),
    `funds ${money(m.fundsCents)}`.padEnd(20),
    `qtr in ${money(quarterIncome)} up ${money(quarterUpkeep)}`.padEnd(30),
    `pop ${String(m.population).padStart(6)}`,
    `floors ${m.floors.bottom}..${m.floors.top}`,
    `off ${offices?.open ?? 0}/${offices?.total ?? 0}`,
    `condo ${condos?.open ?? 0}/${condos?.total ?? 0}`,
    `cars ${m.elevators.cars}`,
    `gaveUp/qtr ${giveUpsQuarter}`,
    unmet.length ? `next: ${unmet.join('; ')}` : '',
  ].join(' | ');
}

console.log(`playthrough seed=${seed} maxDays=${maxDays} target=${STAR_LABEL[target]}`);
while (state.calendar.day <= maxDays && state.starLevel < 6) {
  tick(state);
  for (const event of state.events) {
    if (event.type === 'PERSON_GAVE_UP') {
      giveUpsToday++;
      giveUpsQuarter++;
      // Visitors are deleted when they give up; anyone still tracked is a tenant.
      const kind = state.people.get(event.personId)?.kind ?? 'visitor';
      const where = event.floor <= 0 ? 'basement' : event.floor === 1 ? 'lobby' : `zone${PlaythroughBot.zoneOf(event.floor)}`;
      const key = `${kind}@${where}`;
      giveUpBreakdown[key] = (giveUpBreakdown[key] ?? 0) + 1;
    }
    if (event.type === 'ALERT' && /VIP/.test(event.message)) console.log(`  .. ${formatTowerDate(state.calendar.day)}: ${event.message}`);
    if (event.type === 'LEVEL_UP') {
      starDays.push({ stars: event.starLevel, day: state.calendar.day });
      console.log(`  >> ${STAR_LABEL[event.starLevel]} reached on ${formatTowerDate(state.calendar.day)} (day ${state.calendar.day}), population ${population(state)}`);
    }
  }
  // The TOWER wedding can only happen at weekend noon: report what blocks it.
  if (state.starLevel === 5 && isWeekend(state) && state.calendar.minuteOfDay >= 750 && weddingCheckedDay !== state.calendar.day) {
    weddingCheckedDay = state.calendar.day;
    const unmet = progressionRequirements(state, 6).filter(r => !r.met).map(r => r.label);
    console.log(`  .. weekend noon ${formatTowerDate(state.calendar.day)}: population ${population(state)}, TOWER blocked by: ${unmet.join('; ') || 'nothing'}`);
  }
  // VIP diagnostics: remember the last view of each inspection's inputs.
  const vip = state.campaign.incidents.find(i => i.kind === 'vip');
  if (vip) lastVip = describeVip(vip.id);
  else if (lastVip) { console.log(`  .. VIP verdict inputs (just before the deadline): ${lastVip}`); lastVip = null; }
  if (state.tickCount % reactEvery === 0) bot.react();
  if (state.tickCount % (reactEvery * 2) === 0) bot.checkCongestion();
  if (state.tickCount % decideEvery === 0) bot.decide();
  if (state.calendar.day !== lastDay) {
    // Settlement just ran for the finished day.
    quarterIncome += state.money.dailyIncomeCents;
    quarterUpkeep += state.money.dailyUpkeepCents;
    peakGiveUpsPerDay = Math.max(peakGiveUpsPerDay, giveUpsToday);
    giveUpsToday = 0;
    // Quarter boundary (QUARTER_DAYS-day quarters start on day 1, 4, 7, ...).
    if ((state.calendar.day - 1) % CONFIG.QUARTER_DAYS === 0) {
      rows.push(towerMetrics(state));
      console.log(progressLine());
      giveUpsQuarter = 0;
      quarterIncome = 0;
      quarterUpkeep = 0;
    }
    lastDay = state.calendar.day;
  }
}
rows.push(towerMetrics(state));
const wallMs = performance.now() - t0;

// --- CSV ---
const flat = rows.map(flattenMetrics);
const columns = [...new Set(flat.flatMap(row => Object.keys(row)))];
const csv = [columns.join(','), ...flat.map(row => columns.map(c => {
  const v = row[c];
  const s = v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(','))].join('\n');
if (csvPath) {
  mkdirSync(dirname(csvPath), { recursive: true });
  writeFileSync(csvPath, csv + '\n');
} else if (!flag('no-csv')) {
  console.log('\n--- metrics CSV ---');
  console.log(csv);
}

// --- summary ---
const final = rows[rows.length - 1]!;
const topRejections = Object.entries(bot.stats.rejections).sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log('\n--- summary ---');
console.log(JSON.stringify({
  result: STAR_LABEL[state.starLevel],
  day: state.calendar.day,
  date: formatTowerDate(state.calendar.day),
  population: final.population,
  funds: money(final.fundsCents),
  floors: final.floors,
  starDays,
  peakGiveUpsPerDay,
  giveUpsByKindAndPlace: Object.fromEntries(Object.entries(giveUpBreakdown).sort((a, b) => b[1] - a[1])),
  wallSeconds: Number((wallMs / 1000).toFixed(1)),
  msPerTick: Number((wallMs / state.tickCount).toFixed(3)),
  unmetNext: bot.unmetNext(),
  commands: bot.stats.commands,
  topRejections: Object.fromEntries(topRejections),
  notes: bot.stats.notes,
  csv: csvPath,
}, null, 2));

if (state.starLevel < target) {
  console.error(`playthrough FAILED: reached ${STAR_LABEL[state.starLevel]} by day ${state.calendar.day}, target ${STAR_LABEL[target]}`);
  process.exit(1);
}
console.log(`playthrough OK: reached ${STAR_LABEL[state.starLevel]} (target ${STAR_LABEL[target]})`);
