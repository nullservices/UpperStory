import { newCampaign, type CampaignState } from './campaign';
import { CONFIG } from '../data/config';
import { seedRng } from './core/rng';
import type { SimEvent } from './core/events';
import { placeElevatorGroup, type ElevatorGroup } from './elevators';
import type { Person } from './people';
import { emptyRoutingTables, type RoutingTables } from './routing';
import { buildFloor, createTower, placeStair, type Tower } from './tower';
import { placeTenant, type Tenant } from './tenants';
import type { MoneyState } from './money';
import type { Calendar } from './time';

/**
 * Root simulation state. Everything in here is plain serializable data —
 * save/load is a JSON round-trip (see sim/save.ts, M5).
 */
export interface GameState {
  campaign: CampaignState;
  seed: number;
  /** Live mulberry32 state — part of the save so replays resume the stream. */
  rngState: number;
  nextEntityId: number;
  tickCount: number;
  tower: Tower;
  money: MoneyState;
  /** Insertion-ordered (deterministic iteration). */
  tenants: Map<number, Tenant>;
  /** Tenant ids under construction, in placement order. */
  constructionQueue: number[];
  people: Map<number, Person>;
  elevatorGroups: Map<number, ElevatorGroup>;
  /** floor index → up/down call buttons. */
  floorCalls: Map<number, { up: boolean; down: boolean }>;
  /** `${floor}:${dir}` → person ids in arrival order. */
  queues: Record<string, number[]>;
  /** `${floor}:${x}` → 1-way direction of the escalator spanning floor..floor+1. */
  escalators: Map<string, 'up' | 'down'>;
  routing: RoutingTables;
  calendar: Calendar;
  starLevel: number;
  /** Day of the last daily evaluation (runs once per day at 15:00). */
  evaluationDay: number;
  /** Per-tick sink drained by the controller; never influences the sim. */
  events: SimEvent[];
}

export function createInitialState(seed = 1): GameState {
  return {
    campaign: newCampaign(),
    seed,
    rngState: seedRng(seed),
    nextEntityId: 0,
    tickCount: 0,
    tower: createTower(),
    money: {
      balanceCents: CONFIG.STARTING_FUNDS_DOLLARS * 100,
      dailyIncomeCents: 0,
      dailyUpkeepCents: 0,
      quarterIncomeCents: 0,
      quarterUpkeepCents: 0,
    },
    tenants: new Map(),
    constructionQueue: [],
    people: new Map(),
    elevatorGroups: new Map(),
    floorCalls: new Map(),
    queues: {},
    escalators: new Map(),
    routing: emptyRoutingTables(),
    calendar: { tickOfDay: 0, minuteOfDay: 420, day: 1 },
    starLevel: 1,
    evaluationDay: 0,
    events: [],
  };
}

/**
 * A fresh game: B1, the lobby floor with a full-width lobby, and starting
 * funds. Runs through the same public commands the player uses.
 */
export function setupNewGame(state: GameState): void {
  buildFloor(state, CONFIG.BASEMENT_FLOOR_INDEX);
  buildFloor(state, CONFIG.LOBBY_FLOOR_INDEX);
  placeTenant(state, 'lobby', CONFIG.LOBBY_FLOOR_INDEX, 0);
}

/**
 * Debug/demo scenario (used by the smoke run and ?demo=1): a small working
 * tower with B1 + lobby, floors 2-7, a stair column, an elevator, two
 * offices, two condos and a fast-food joint (lunch traffic!) — the full
 * M3 loop.
 */
export function setupDemoTower(state: GameState): void {
  setupNewGame(state);
  for (let i = 2; i <= 7; i++) buildFloor(state, i);
  for (let i = 2; i <= 7; i++) placeStair(state, i, 0);
  placeElevatorGroup(state, 1, 7, 10);
  placeTenant(state, 'office', 2, 20);
  placeTenant(state, 'office', 2, 34);
  placeTenant(state, 'condo', 3, 20);
  placeTenant(state, 'condo', 3, 36);
  placeTenant(state, 'fastfood', 3, 60);
}
