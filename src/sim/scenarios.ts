import { CONFIG, TENANT_DATA, facilityHeight } from '../data/config';
import { recordEvent, tenantTypeLabel } from './campaign';
import { addElevatorCar, placeElevatorGroup, type ElevatorKind } from './elevators';
import { population, removeTenantPeople } from './people';
import { createInitialState, setupNewGame, type GameState } from './state';
import { placeTenant, stepConstruction, type TenantType } from './tenants';
import { operatingDay, isWeekendDay } from './time';
import { buildFloor, placeStair, topFloorIndex } from './tower';

/**
 * Scenarios: goals, constraints and win/lose evaluation.
 *
 * A scenario is pure data plus a setup function that builds the starting
 * tower through the normal sim commands. `startScenario` returns a fresh
 * GameState with `state.scenario` attached; `stepScenario` (run every tick
 * after progression) tracks progress and records the outcome exactly once.
 * Everything here is deterministic: it reads the sim state and the tick's
 * event stream, and never touches the RNG.
 */

export type ScenarioDifficulty = 'Easy' | 'Medium' | 'Hard' | 'Expert';

export type ObjectiveKind =
  /** Star rating ≥ target. */
  | 'stars'
  /** Tower population ≥ target. */
  | 'population'
  /** Funds ≥ target (cents). */
  | 'funds'
  /** Highest built floor ≥ target. */
  | 'topFloor'
  /** Hotel guests checked in (in the room or out and about) ≥ target. */
  | 'hotelGuests'
  /** Open hotel suites graded at least `param` ≥ target. */
  | 'suites'
  /** Consecutive weekdays with nobody giving up and average worker stress below `param`. */
  | 'calmWeekdays'
  /** Damaged rooms ≤ target (usually 0). */
  | 'damaged'
  /** The last settled day's income minus upkeep ≥ target (cents). */
  | 'netIncome'
  /** Open (occupied) offices ≥ target. */
  | 'openOffices'
  /** Open sky lobbies on an express elevator's stop list ≥ target. */
  | 'expressSkyLobbies'
  /** The cathedral wedding has been held (TOWER rating). */
  | 'tower';

export interface ObjectiveDef {
  kind: ObjectiveKind;
  target: number;
  /** Kind-specific parameter: minimum suite grade, or the stress ceiling for calm weekdays. */
  param?: number;
  label: string;
  /**
   * Must still be true when the scenario is won. Other objectives are ticked
   * off once reached (a weekend population dip never un-ticks a goal).
   */
  hold?: boolean;
}

/** Placement limits enforced by the sim's pre-checks while the scenario runs. */
export interface ScenarioRules {
  /** Facilities that cannot be placed. */
  banned?: TenantType[];
  /** Elevator kinds that cannot be built. */
  bannedElevators?: ElevatorKind[];
  /** Highest floor that may be built. */
  maxFloor?: number;
  /** Deepest basement index that may be built (0 = B1). */
  minFloor?: number;
  /** Half-open range of cells the tower may occupy. */
  lot?: { lo: number; hi: number };
}

export interface ScenarioDef {
  id: string;
  title: string;
  /** One-line pitch for the scenario list. */
  pitch: string;
  /** A short paragraph shown when the scenario is selected and started. */
  briefing: string;
  difficulty: ScenarioDifficulty;
  seed: number;
  lobbyHeight: 1 | 2 | 3;
  /** Game days available (a quarter is three days; a year is twelve). */
  timeLimitDays: number;
  objectives: ObjectiveDef[];
  rules: ScenarioRules;
  /** Losing condition besides the clock: the tower ends a day in debt. */
  failOnDebt?: boolean;
  /** Plain-language constraint list for the briefing. */
  constraints: string[];
  /** Builds the starting tower with sim commands; sets funds and rating. */
  setup: (state: GameState) => void;
}

export interface CalmTracker {
  /** Operating day being measured. */
  day: number;
  giveUps: number;
  stressSum: number;
  samples: number;
  streak: number;
  /** The last finished weekday's figures, for progress feedback. */
  lastGiveUps?: number;
  lastStress?: number;
}

export interface ScenarioOutcome {
  result: 'won' | 'lost';
  day: number;
  /** Game days from the start to the outcome. */
  daysTaken: number;
  reason: string;
  population: number;
  fundsCents: number;
  stars: number;
  topFloor: number;
}

/** Active scenario progress; saved with the tower (absent in free play). */
export interface ScenarioState {
  /** Scenario definition id. */
  id: string;
  startDay: number;
  /** The scenario is lost when this day begins without a win. */
  deadlineDay: number;
  rules: ScenarioRules;
  /** Objectives already reached (latched), by index. */
  met: boolean[];
  /** Damaged rooms at the start, for repair progress. */
  initialDamaged?: number;
  calm?: CalmTracker;
  outcome?: ScenarioOutcome;
}

export interface ObjectiveProgress {
  label: string;
  kind: ObjectiveKind;
  value: number;
  target: number;
  /** 0..1 for progress bars. */
  fraction: number;
  met: boolean;
  /** How to display value/target. */
  format: 'count' | 'money' | 'stars' | 'floor' | 'done';
  /** Extra live context (e.g. the last weekday's give-ups). */
  detail?: string;
}

export interface ScenarioProgress {
  def: ScenarioDef;
  objectives: ObjectiveProgress[];
  daysLeft: number;
  outcome?: ScenarioOutcome;
}

/** Objectives are re-evaluated this often (about 9 game minutes at midday). */
const CHECK_TICKS = 50;
const LOBBY = CONFIG.LOBBY_FLOOR_INDEX;

// --- Setup helpers --------------------------------------------------------

/** Empty plot with a lobby spanning cells [lo, hi). */
function lobbyPlot(state: GameState, lo: number, hi: number): void {
  setupNewGame(state);
  state.money.balanceCents = 100_000_000_00;
  for (let x = lo; x < hi; x++) placeTenant(state, 'lobby', LOBBY, x);
}

/** Finish every room under construction now (occupants move in). */
function finishConstruction(state: GameState): void {
  for (const id of state.constructionQueue) {
    const tenant = state.tenants.get(id);
    if (tenant) tenant.constructionTicksLeft = 1;
  }
  stepConstruction(state);
}

/** Close a room as if a fire had gutted it. */
function gut(state: GameState, id: number): void {
  const tenant = state.tenants.get(id);
  if (!tenant) return;
  removeTenantPeople(state, id);
  tenant.state = 'damaged';
  tenant.occupancy = 0;
  tenant.reportedPopulation = 0;
  state.tower.structureRevision++;
}

/** Place a row of rooms from x0 while they fit before `hi`; returns their ids. */
function row(state: GameState, type: TenantType, floor: number, x0: number, hi: number, gap = 0): number[] {
  const ids: number[] = [];
  const size = TENANT_DATA[type].sizeCells;
  for (let x = x0; x + size <= hi; x += size + gap) ids.push(placeTenant(state, type, floor, x).id);
  return ids;
}

function finish(state: GameState, fundsDollars: number, stars: number): void {
  state.starLevel = Math.max(state.starLevel, stars);
  state.money.balanceCents = fundsDollars * 100;
  state.money.dailyIncomeCents = 0;
  state.money.dailyUpkeepCents = 0;
  state.money.quarterIncomeCents = 0;
  state.money.quarterUpkeepCents = 0;
  // Prebuilt condos were sold during setup: that sale is not scenario income.
  for (const t of state.tenants.values()) t.dailyRevenue = 0;
}

// --- Scenario definitions -------------------------------------------------

const SKY_LO = 150;
const SKY_HI = 246;
const RUSH_TOP = 10;
const RUSH_LOBBY_CELLS = 100;
const RUSH_FUNDS = 250_000;

export const SCENARIOS: readonly ScenarioDef[] = [
  {
    id: 'first-tower',
    title: 'First Tower',
    pitch: 'An empty lot and $2 million. Earn your second star before the year is out.',
    briefing: 'The city has granted you a plot on Main Street. Lay a lobby, stack a few floors, connect them with an elevator and fill them with offices and condos. Condos sell once for a profit; offices pay rent every quarter.',
    difficulty: 'Easy',
    seed: 1101,
    lobbyHeight: 1,
    timeLimitDays: 12,
    objectives: [
      { kind: 'stars', target: 2, label: 'Earn the ★★ rating (300 people)' },
      { kind: 'openOffices', target: 10, label: 'Lease 10 offices', hold: true },
      { kind: 'funds', target: 1_000_000_00, label: 'Hold $1,000,000 in funds', hold: true },
    ],
    rules: {},
    constraints: ['One year (12 days)'],
    setup: state => { setupNewGame(state); },
  },
  {
    id: 'rush-hour',
    title: 'Rush Hour',
    pitch: 'Seventy-two offices, one tired elevator. Make the morning commute bearable.',
    briefing: 'A developer filled nine floors with offices and installed a single elevator car. Every weekday the lobby queue stretches out the door, and tenants are threatening to leave. You have a modest budget for transport: add cars, shafts, stairs or escalators, and tune the elevator schedule.',
    difficulty: 'Medium',
    seed: 2202,
    lobbyHeight: 1,
    timeLimitDays: 9,
    objectives: [
      { kind: 'calmWeekdays', target: 2, param: 45, label: 'Two calm weekdays in a row' },
      { kind: 'openOffices', target: 66, label: 'Keep 66 offices leased', hold: true },
    ],
    rules: { maxFloor: 10, minFloor: 0 },
    failOnDebt: true,
    constraints: ['Three quarters (9 days)', 'No floors above 10 or below B1', 'Lose if the tower ends a day in debt'],
    setup: state => {
      lobbyPlot(state, 0, RUSH_LOBBY_CELLS);
      for (let f = 2; f <= RUSH_TOP; f++) buildFloor(state, f);
      placeElevatorGroup(state, LOBBY, RUSH_TOP, 10);
      for (let f = 2; f <= RUSH_TOP; f++) row(state, 'office', f, 28, RUSH_LOBBY_CELLS);
      finishConstruction(state);
      finish(state, RUSH_FUNDS, 2);
    },
  },
  {
    id: 'grand-hotel',
    title: 'Grand Hotel',
    pitch: 'No offices, no condos: build a hotel worthy of royalty.',
    briefing: 'Investors want a landmark hotel. Guests check in every evening and leave in the morning; rooms need housekeeping before the next guest, and a dirty room drives guests away. Housekeepers ride service elevators. Suites earn the most and judge the hardest.',
    difficulty: 'Medium',
    seed: 3303,
    lobbyHeight: 2,
    timeLimitDays: 24,
    objectives: [
      { kind: 'hotelGuests', target: 100, label: '100 hotel guests checked in at once' },
      { kind: 'suites', target: 3, param: 4, label: 'Three suites rated ★★★★ or better' },
      { kind: 'netIncome', target: 150_000_00, label: 'Net $150,000 in a single day' },
    ],
    rules: { banned: ['office', 'condo'] },
    constraints: ['Two years (24 days)', 'Offices and condos are not allowed'],
    setup: state => {
      lobbyPlot(state, 0, 120);
      finish(state, 2_500_000, 2);
    },
  },
  {
    id: 'rebuild',
    title: 'Rebuild',
    pitch: 'A fire gutted a third of a busy tower. Repair it and win back the tenants.',
    briefing: 'Last night a fire tore through this 3★ tower. A third of the rooms are closed and the insurance payout is small. Inspect each damaged room to repair it (repairs cost a quarter of the build price), keep the money flowing, and watch out: security can only fight fires it can reach.',
    difficulty: 'Medium',
    seed: 4404,
    lobbyHeight: 1,
    timeLimitDays: 12,
    objectives: [
      { kind: 'damaged', target: 0, label: 'Repair every damaged room' },
      { kind: 'population', target: 1_200, label: 'Bring back 1,200 people' },
      { kind: 'netIncome', target: 400_000_00, label: 'Net $400,000 in a single day' },
    ],
    rules: { maxFloor: 20 },
    failOnDebt: true,
    constraints: ['One year (12 days)', 'No floors above 20', 'Lose if the tower ends a day in debt'],
    setup: state => {
      lobbyPlot(state, 0, 140);
      for (let f = 2; f <= 20; f++) buildFloor(state, f);
      for (const f of [-1, -2]) buildFloor(state, f);
      placeStair(state, 2, 0);
      const local = placeElevatorGroup(state, LOBBY, 20, 10);
      for (let i = 0; i < 4; i++) addElevatorCar(state, local.id);
      const upper = placeElevatorGroup(state, LOBBY, 20, 16);
      for (let i = 0; i < 3; i++) addElevatorCar(state, upper.id);
      state.starLevel = 3;
      placeElevatorGroup(state, -2, 20, 22, 'service');
      const gutted: number[] = [];
      const burn = (ids: number[], every: number): void => { ids.forEach((id, i) => { if (i % every === 0) gutted.push(id); }); };
      row(state, 'fastfood', 2, 28, 140, 0);
      row(state, 'shop', 3, 28, 140);
      placeTenant(state, 'security', 4, 28);
      placeTenant(state, 'medical', 4, 44);
      placeTenant(state, 'housekeeping', 4, 70);
      for (let f = 5; f <= 10; f++) burn(row(state, 'office', f, 28, 140), f % 2 === 0 ? 2 : 3);
      for (let f = 11; f <= 14; f++) burn(row(state, 'hotel', f, 28, 140), 3);
      for (let f = 15; f <= 20; f++) burn(row(state, 'condo', f, 28, 140), f >= 17 ? 2 : 4);
      finishConstruction(state);
      for (const id of gutted) gut(state, id);
      finish(state, 400_000, 3);
    },
  },
  {
    id: 'skyline',
    title: 'Skyline',
    pitch: 'A sliver of downtown land. Build the city\'s tallest tower on it.',
    briefing: 'Your lot is only 96 cells wide, squeezed between two older buildings. Reach floor 60 and connect a sky lobby every 15 floors with an express elevator. Floors cost more the higher you go, so sell condos and lease offices to pay for the climb.',
    difficulty: 'Hard',
    seed: 5505,
    lobbyHeight: 2,
    timeLimitDays: 48,
    objectives: [
      { kind: 'topFloor', target: 60, label: 'Build up to floor 60' },
      { kind: 'expressSkyLobbies', target: 4, label: 'Express service to 4 sky lobbies' },
      { kind: 'population', target: 1_000, label: 'House or employ 1,000 people' },
    ],
    rules: { lot: { lo: SKY_LO, hi: SKY_HI } },
    constraints: ['Four years (48 days)', 'A lot only 96 cells wide'],
    setup: state => {
      lobbyPlot(state, SKY_LO, SKY_HI);
      finish(state, 7_000_000, 3);
    },
  },
  {
    id: 'the-wedding',
    title: 'The Wedding',
    pitch: 'The ultimate test: a 100-floor tower worthy of a cathedral wedding.',
    briefing: 'Start from an empty lot and earn every star: security, a suite with a happy VIP, recycling, medical care, a metro station, and finally more than 15,000 people with a cathedral on floors 97–100. When everything is ready, a wedding is booked for the next weekend at noon.',
    difficulty: 'Expert',
    seed: 6606,
    lobbyHeight: 1,
    timeLimitDays: 120,
    objectives: [
      { kind: 'stars', target: 5, label: 'Earn the ★★★★★ rating' },
      { kind: 'population', target: 15_001, label: 'More than 15,000 people' },
      { kind: 'tower', target: 1, label: 'Hold the cathedral wedding (TOWER)' },
    ],
    rules: {},
    constraints: ['Ten years (120 days)'],
    setup: state => { setupNewGame(state); },
  },
];

export function getScenario(id: string): ScenarioDef | undefined {
  return SCENARIOS.find(s => s.id === id);
}

/** A fresh game set up for a scenario (the same path as a new tower). */
export function startScenario(id: string): GameState {
  const def = getScenario(id);
  if (!def) throw new Error(`Unknown scenario: ${id}`);
  const state = createInitialState(def.seed);
  state.tower.lobbyHeight = def.lobbyHeight;
  def.setup(state);
  const scenario: ScenarioState = {
    id: def.id,
    startDay: state.calendar.day,
    deadlineDay: state.calendar.day + def.timeLimitDays,
    rules: structuredCloneRules(def.rules),
    met: def.objectives.map(() => false),
  };
  const damaged = [...state.tenants.values()].filter(t => t.state === 'damaged').length;
  if (def.objectives.some(o => o.kind === 'damaged')) scenario.initialDamaged = damaged;
  if (def.objectives.some(o => o.kind === 'calmWeekdays')) scenario.calm = { day: operatingDay(state), giveUps: 0, stressSum: 0, samples: 0, streak: 0 };
  state.scenario = scenario;
  state.campaign.history = [];
  recordEvent(state, `Scenario started: ${def.title}. Open Game › Scenarios… for the briefing.`);
  state.events.length = 0;
  return state;
}

function structuredCloneRules(rules: ScenarioRules): ScenarioRules {
  return JSON.parse(JSON.stringify(rules)) as ScenarioRules;
}

// --- Constraint checks (called from the sim's placement pre-checks) --------

/** Why a facility cannot be placed under the active scenario's rules, or null. */
export function scenarioPlacementError(state: GameState, type: TenantType, floor: number, x: number): string | null {
  const rules = state.scenario?.outcome ? undefined : state.scenario?.rules;
  if (!rules) return null;
  if (rules.banned?.includes(type)) return `${tenantTypeLabel(type)} is not allowed in this scenario`;
  if (rules.lot && (x < rules.lot.lo || x + TENANT_DATA[type].sizeCells > rules.lot.hi)) return 'Outside the scenario\'s building lot';
  if (rules.maxFloor !== undefined && floor + facilityHeight(type) - 1 > rules.maxFloor) return `This scenario's height limit is floor ${rules.maxFloor}`;
  return null;
}

/** Why a floor cannot be built under the active scenario's rules, or null. */
export function scenarioFloorError(state: GameState, index: number): string | null {
  const rules = state.scenario?.outcome ? undefined : state.scenario?.rules;
  if (!rules) return null;
  if (rules.maxFloor !== undefined && index > rules.maxFloor) return `This scenario's height limit is floor ${rules.maxFloor}`;
  if (rules.minFloor !== undefined && index < rules.minFloor) return rules.minFloor >= 1 ? 'No basements in this scenario' : `This scenario's basements go down to B${1 - rules.minFloor}`;
  return null;
}

/** Why floor space cannot extend to cell x under the scenario's lot, or null. */
export function scenarioLotError(state: GameState, x: number, width = 1): string | null {
  const lot = state.scenario?.outcome ? undefined : state.scenario?.rules.lot;
  if (!lot) return null;
  return x < lot.lo || x + width > lot.hi ? 'Outside the scenario\'s building lot' : null;
}

/** Why a new shaft cannot be built under the active scenario's rules, or null. */
export function scenarioElevatorError(state: GameState, kind: ElevatorKind, x: number, width: number): string | null {
  const rules = state.scenario?.outcome ? undefined : state.scenario?.rules;
  if (!rules) return null;
  if (rules.bannedElevators?.includes(kind)) return `${kind === 'express' ? 'Express' : kind === 'service' ? 'Service' : 'Standard'} elevators are not allowed in this scenario`;
  return scenarioLotError(state, x, width);
}

// --- Evaluation -------------------------------------------------------------

function countOpen(state: GameState, type: TenantType): number {
  let n = 0;
  for (const t of state.tenants.values()) if (t.type === type && t.state === 'open') n++;
  return n;
}

function expressSkyLobbies(state: GameState): number {
  const floors = new Set<number>();
  for (const group of state.elevatorGroups.values()) if (group.kind === 'express') for (const f of group.stops) floors.add(f);
  let n = 0;
  for (const t of state.tenants.values()) if (t.type === 'skyLobby' && t.state === 'open' && floors.has(t.floor)) n++;
  return n;
}

function objectiveValue(state: GameState, scenario: ScenarioState, def: ObjectiveDef): number {
  switch (def.kind) {
    case 'stars': return state.starLevel;
    case 'population': return population(state);
    case 'funds': return state.money.balanceCents;
    case 'topFloor': return Math.max(LOBBY, topFloorIndex(state.tower));
    case 'hotelGuests': {
      let n = 0;
      for (const p of state.people.values()) if (p.kind === 'hotelGuest') n++;
      return n;
    }
    case 'suites': {
      let n = 0;
      for (const t of state.tenants.values()) if (t.type === 'hotelSuite' && t.state === 'open' && t.grade >= (def.param ?? 4)) n++;
      return n;
    }
    case 'calmWeekdays': return scenario.calm?.streak ?? 0;
    case 'damaged': {
      let n = 0;
      for (const t of state.tenants.values()) if (t.state === 'damaged') n++;
      return n;
    }
    case 'netIncome': return state.money.dailyIncomeCents - state.money.dailyUpkeepCents;
    case 'openOffices': return countOpen(state, 'office');
    case 'expressSkyLobbies': return expressSkyLobbies(state);
    case 'tower': return state.campaign.weddingHeld ? 1 : 0;
  }
}

const FORMAT: Record<ObjectiveKind, ObjectiveProgress['format']> = {
  stars: 'stars', population: 'count', funds: 'money', topFloor: 'floor', hotelGuests: 'count', suites: 'count',
  calmWeekdays: 'count', damaged: 'count', netIncome: 'money', openOffices: 'count', expressSkyLobbies: 'count', tower: 'done',
};

function progressFor(state: GameState, scenario: ScenarioState, def: ObjectiveDef, latched: boolean): ObjectiveProgress {
  const value = objectiveValue(state, scenario, def);
  const lower = def.kind === 'damaged';
  const reached = lower ? value <= def.target : value >= def.target;
  const met = reached || (latched && !def.hold);
  let fraction: number;
  if (lower) {
    const start = Math.max(scenario.initialDamaged ?? 0, def.target + 1);
    fraction = (start - value) / (start - def.target);
  } else fraction = def.target > 0 ? value / def.target : 1;
  const progress: ObjectiveProgress = {
    label: def.label, kind: def.kind, value, target: def.target,
    fraction: met ? 1 : Math.max(0, Math.min(1, fraction)), met, format: FORMAT[def.kind],
  };
  if (def.kind === 'calmWeekdays' && scenario.calm) {
    const c = scenario.calm;
    const today = c.samples > 0 ? Math.round(c.stressSum / c.samples) : null;
    const parts: string[] = [];
    if (!isWeekendDay(c.day)) parts.push(`Today: ${c.giveUps} gave up${today === null ? '' : `, stress ${today}`}`);
    else parts.push('Weekend: offices are closed');
    if (c.lastGiveUps !== undefined) parts.push(`last weekday ${c.lastGiveUps} gave up, stress ${Math.round(c.lastStress ?? 0)}`);
    progress.detail = `${parts.join(' · ')} (calm = nobody gives up, average worker stress under ${def.param ?? 20})`;
  }
  if (def.kind === 'netIncome') progress.detail = 'Income minus upkeep at the end of the last day';
  if (def.kind === 'suites') progress.detail = `Suites are graded daily at 15:00 (open suites: ${countOpen(state, 'hotelSuite')})`;
  return progress;
}

/** Live progress of the active scenario for the UI, or null in free play. */
export function scenarioProgress(state: GameState): ScenarioProgress | null {
  const scenario = state.scenario;
  const def = scenario && getScenario(scenario.id);
  if (!scenario || !def) return null;
  const objectives = def.objectives.map((o, i) => scenario.outcome?.result === 'won' ? { ...progressFor(state, scenario, o, true), met: true, fraction: 1 } : progressFor(state, scenario, o, scenario.met[i] ?? false));
  return { def, objectives, daysLeft: Math.max(0, scenario.deadlineDay - state.calendar.day), outcome: scenario.outcome };
}

/** Office workers' average stress while in the building on a weekday. */
function sampleCalm(state: GameState, calm: CalmTracker): void {
  let sum = 0;
  let n = 0;
  for (const p of state.people.values()) {
    if (p.kind !== 'officeWorker' || p.state === 'offscreen') continue;
    sum += p.stress;
    n++;
  }
  if (n === 0) return;
  calm.stressSum += sum / n;
  calm.samples++;
}

function stepCalm(state: GameState, calm: CalmTracker, ceiling: number): void {
  const day = operatingDay(state);
  if (day !== calm.day) {
    if (!isWeekendDay(calm.day)) {
      const stress = calm.samples > 0 ? calm.stressSum / calm.samples : Infinity;
      calm.lastGiveUps = calm.giveUps;
      calm.lastStress = Number.isFinite(stress) ? stress : 0;
      calm.streak = calm.giveUps === 0 && stress < ceiling ? calm.streak + 1 : 0;
    }
    calm.day = day;
    calm.giveUps = 0;
    calm.stressSum = 0;
    calm.samples = 0;
  }
  if (isWeekendDay(day)) return;
  for (const event of state.events) if (event.type === 'PERSON_GAVE_UP') calm.giveUps++;
  const minute = state.calendar.minuteOfDay;
  if (state.tickCount % CHECK_TICKS === 0 && minute >= 480 && minute < 1140) sampleCalm(state, calm);
}

function conclude(state: GameState, scenario: ScenarioState, def: ScenarioDef, result: 'won' | 'lost', reason: string): void {
  scenario.outcome = {
    result,
    day: state.calendar.day,
    daysTaken: state.calendar.day - scenario.startDay,
    reason,
    population: population(state),
    fundsCents: state.money.balanceCents,
    stars: state.starLevel,
    topFloor: Math.max(LOBBY, topFloorIndex(state.tower)),
  };
  if (result === 'won') scenario.met = def.objectives.map(() => true);
  recordEvent(state, result === 'won'
    ? `Scenario complete: ${def.title}! ${reason}`
    : `Scenario failed: ${def.title}. ${reason}`);
}

/** Called every tick by the engine (after progression). */
export function stepScenario(state: GameState): void {
  const scenario = state.scenario;
  if (!scenario || scenario.outcome) return;
  const def = getScenario(scenario.id);
  if (!def) return;
  const calmDef = def.objectives.find(o => o.kind === 'calmWeekdays');
  const streakBefore = scenario.calm?.streak ?? 0;
  if (scenario.calm && calmDef) stepCalm(state, scenario.calm, calmDef.param ?? 20);
  const deadline = state.calendar.day >= scenario.deadlineDay;
  const debt = def.failOnDebt === true && state.campaign.bankrupt;
  const due = state.tickCount % CHECK_TICKS === 0 || deadline || debt || (scenario.calm?.streak ?? 0) !== streakBefore;
  if (!due) return;
  const objectives = def.objectives.map((o, i) => progressFor(state, scenario, o, scenario.met[i] ?? false));
  objectives.forEach((o, i) => { if (o.met && !def.objectives[i]!.hold) scenario.met[i] = true; });
  if (objectives.every(o => o.met)) {
    const days = state.calendar.day - scenario.startDay;
    conclude(state, scenario, def, 'won', `Every goal met in ${days} day${days === 1 ? '' : 's'}.`);
  } else if (debt) {
    conclude(state, scenario, def, 'lost', 'The tower ended a day in debt.');
  } else if (deadline) {
    const left = objectives.filter(o => !o.met).length;
    conclude(state, scenario, def, 'lost', `Time ran out with ${left} goal${left === 1 ? '' : 's'} unmet.`);
  }
}
