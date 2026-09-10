import { CONFIG } from '../data/config';
import { newCampaign } from './campaign';
import { emptyCell } from './tower';
import type { GameState } from './state';

/**
 * Versioned JSON save/load. The whole GameState is plain data (Maps included)
 * so a save is a JSON round-trip; Maps/Set serialize with marker wrappers.
 * Version bumps go through the migration chain in `deserialize`.
 */

export const SAVE_VERSION = 3;

export interface SaveEnvelope {
  version: number;
  state: GameState;
}

const MAP_MARKER = '__simMap';
const SET_MARKER = '__simSet';

interface WrappedMap {
  [MAP_MARKER]: [unknown, unknown][];
}
interface WrappedSet {
  [SET_MARKER]: unknown[];
}

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) {
    const wrapped: WrappedMap = { [MAP_MARKER]: [...value.entries()] };
    return wrapped;
  }
  if (value instanceof Set) {
    const wrapped: WrappedSet = { [SET_MARKER]: [...value] };
    return wrapped;
  }
  return value;
}

function isNumericString(key: string): boolean {
  return key !== '' && /^-?\d+$/.test(key);
}

function reviver(_key: string, value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const obj = value as Record<string, unknown>;
  if (MAP_MARKER in obj) {
    const entries = (obj[MAP_MARKER] as [unknown, unknown][]).map(([k, v]) => [
      typeof k === 'string' && isNumericString(k) ? Number(k) : k,
      v,
    ]);
    return new Map(entries as [unknown, unknown][]);
  }
  if (SET_MARKER in obj) {
    return new Set(obj[SET_MARKER] as unknown[]);
  }
  return value;
}

/** Serialize a state to a save string (transient events are dropped). */
export function serializeGame(state: GameState): string {
  const envelope: SaveEnvelope = {
    version: SAVE_VERSION,
    state: { ...state, events: [] },
  };
  return JSON.stringify(envelope, replacer);
}

/**
 * Parse a save string back into a live GameState. Throws on version
 * mismatch — new versions should add migrations here instead.
 */
export function deserializeGame(json: string): GameState {
  const envelope = JSON.parse(json, reviver) as SaveEnvelope;
  if (typeof envelope !== 'object' || envelope === null || !('version' in envelope)) {
    throw new Error('Not a TowerProject save file');
  }
  if (![1, 2, SAVE_VERSION].includes(envelope.version)) {
    // Migration chain slot: handle older versions here as they appear.
    throw new Error(
      `Unsupported save version ${envelope.version} (current: ${SAVE_VERSION})`,
    );
  }
  if (!envelope.state || typeof envelope.state !== 'object') {
    throw new Error('Save file is missing its state');
  }
  const state = envelope.state as GameState;
  if (envelope.version < 3) state.tower.lobbyHeight = 2;
  if (![1, 2, 3].includes(state.tower.lobbyHeight)) throw new Error('Invalid lobby height');
  if (envelope.version === 1) {
    state.campaign = newCampaign();
    state.campaign.lastDay = state.calendar.day;
    state.campaign.nextIncidentTick = state.tickCount + CONFIG.DAY_TICKS * 3;
    for (const floor of state.tower.floors) while (floor.cells.length < CONFIG.FLOOR_WIDTH_CELLS) floor.cells.push(emptyCell());
    state.tower.structureRevision++;
  }
  return state;
}
