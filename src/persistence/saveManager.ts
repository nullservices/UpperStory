import { deserializeGame, formatTowerDate, population, serializeGame, type GameState } from '../sim';
import type { SaveBackend, SaveKind, SaveMeta } from './backend';
import { decodeSave, encodeSave, encodedSize, type Compressor } from './codec';
import { encodeSaveFile, importedSaveName, readSaveFile, saveFileName, slotToSaveFile } from './saveFile';

/** A save file ready to download. */
export interface SaveFileExport {
  fileName: string;
  bytes: Uint8Array;
}

/** Original single-slot localStorage key (pre-IndexedDB builds). */
export const LEGACY_SAVE_KEY = 'towerproject-save-v1';
export const AUTOSAVE_ID = 'autosave';
export const LEGACY_ID = 'legacy';
const NAME_LIMIT = 48;

/** The slice of Storage the legacy migration needs (injectable for tests). */
export interface LegacyStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

export interface SaveManagerOptions {
  backend: SaveBackend;
  compressor: Compressor | null;
  /** localStorage holding a pre-IndexedDB save, if any. */
  legacy?: LegacyStorage | null;
  now?: () => number;
  newId?: () => string;
}

export interface SaveRequest {
  /** Overwrite this slot; omitted = a new manual slot. */
  id?: string;
  name?: string;
}

/** Metadata describing a live tower (shared by saves and migration). */
export function describeTower(state: GameState): Pick<SaveMeta, 'day' | 'dateLabel' | 'population' | 'stars' | 'fundsCents'> {
  return {
    day: state.calendar.day,
    dateLabel: formatTowerDate(state.calendar.day),
    population: population(state),
    stars: state.starLevel,
    fundsCents: state.money.balanceCents,
  };
}

/** Turn storage failures into a sentence a player can act on. */
export function describeSaveError(err: unknown): string {
  const name = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';
  if (name === 'QuotaExceededError') return 'Not enough browser storage space. Delete an old save and try again.';
  if (name === 'InvalidStateError') return 'Browser storage was closed (another tab may have upgraded it). Reload the page and try again.';
  if (name === 'SecurityError') return 'This browser is blocking site storage, so towers cannot be saved here.';
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Named save slots over a SaveBackend. Saves serialize synchronously at call
 * time (so the snapshot matches the moment the player clicked even though
 * compression and storage finish later) and writes run one at a time.
 */
export class SaveManager {
  private readonly backend: SaveBackend;
  private readonly compressor: Compressor | null;
  private readonly legacy: LegacyStorage | null;
  private readonly now: () => number;
  private readonly newId: () => string;
  private queue: Promise<unknown> = Promise.resolve();
  private migration: Promise<SaveMeta | null> | null = null;
  /** Set when the last legacy import attempt failed. */
  legacyError: string | null = null;

  constructor(options: SaveManagerOptions) {
    this.backend = options.backend;
    this.compressor = options.compressor;
    this.legacy = options.legacy ?? null;
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? (() => `slot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  }

  /** False when saves only last for this page session (no IndexedDB). */
  get persistent(): boolean { return this.backend.persistent; }
  get compressed(): boolean { return this.compressor !== null; }

  /** Every slot, newest first, after importing any legacy localStorage save. */
  async list(): Promise<SaveMeta[]> {
    try {
      await this.migrateLegacy();
      this.legacyError = null;
    } catch (err) {
      // Still list the other slots; the UI reports why the old save is missing.
      this.legacyError = `Your tower from an earlier version could not be imported: ${describeSaveError(err)}`;
    }
    const metas = await this.backend.list();
    return metas.sort((a, b) => b.savedAt - a.savedAt);
  }

  /** Save to a new manual slot, or overwrite `request.id`. */
  save(state: GameState, request: SaveRequest = {}): Promise<SaveMeta> {
    const id = request.id ?? this.newId();
    const kind: SaveKind = id === AUTOSAVE_ID ? 'auto' : 'manual';
    return this.store(state, id, kind, request.name);
  }

  /** Overwrite the single autosave slot. */
  autosave(state: GameState): Promise<SaveMeta> {
    return this.store(state, AUTOSAVE_ID, 'auto', 'Autosave');
  }

  async load(id: string): Promise<GameState> {
    const payload = await this.backend.read(id);
    if (!payload) throw new Error('That save no longer exists.');
    const json = await decodeSave(payload, this.compressor);
    try {
      return deserializeGame(json);
    } catch (err) {
      throw new Error(`This save could not be read: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** A slot as a `.upperstory` file (its stored gzip bytes, when compressed). */
  async exportSlot(id: string): Promise<SaveFileExport> {
    const metas = await this.backend.list();
    const meta = metas.find(m => m.id === id);
    const payload = await this.backend.read(id);
    if (!meta || !payload) throw new Error('That save no longer exists.');
    return { fileName: saveFileName(meta.name), bytes: await slotToSaveFile(payload, this.compressor) };
  }

  /** The live tower as a `.upperstory` file. */
  async exportState(state: GameState, name?: string): Promise<SaveFileExport> {
    const json = serializeGame(state);
    const label = (name ?? '').trim() || `Tower ${describeTower(state).dateLabel}`;
    return { fileName: saveFileName(label), bytes: await encodeSaveFile(json, this.compressor) };
  }

  /**
   * Validate a save file and store it in a new manual slot (upgraded to the
   * current save format). Throws SaveFileError with a player-facing reason.
   */
  async importFile(bytes: Uint8Array, fileName: string): Promise<SaveMeta> {
    const state = await readSaveFile(bytes, this.compressor);
    return this.save(state, { name: importedSaveName(fileName) });
  }

  /** Remove a slot; deleting the imported legacy slot also clears its old key. */
  delete(id: string): Promise<void> {
    return this.enqueue(async () => {
      await this.backend.remove(id);
      if (id === LEGACY_ID) {
        try { this.legacy?.removeItem(LEGACY_SAVE_KEY); } catch { /* storage blocked: nothing to clear */ }
      }
    });
  }

  /**
   * Copy the old single localStorage save into a slot (if not already there).
   * The localStorage copy stays until that slot is deleted, so a failed
   * import never loses the player's tower.
   */
  migrateLegacy(): Promise<SaveMeta | null> {
    this.migration ??= this.enqueue(async () => {
      let json: string | null = null;
      try { json = this.legacy?.getItem(LEGACY_SAVE_KEY) ?? null; } catch { json = null; }
      if (json === null) return null;
      const existing = await this.backend.list();
      if (existing.some(meta => meta.id === LEGACY_ID)) return null;
      let details: ReturnType<typeof describeTower> = { day: 0, dateLabel: 'Unknown date', population: 0, stars: 0, fundsCents: 0 };
      try { details = describeTower(deserializeGame(json)); } catch { /* keep it anyway; load reports the problem */ }
      const payload = await encodeSave(json, this.compressor);
      const meta: SaveMeta = {
        id: LEGACY_ID, name: 'Tower from an earlier version', kind: 'legacy', savedAt: this.now(),
        ...details, bytes: encodedSize(payload), encoding: payload.encoding,
      };
      await this.backend.write(meta, payload);
      return meta;
    });
    // Only de-duplicate concurrent calls: every later call re-checks, so a
    // failed import retries and a key written by an older tab is picked up.
    const current = this.migration;
    void current.then(() => undefined, () => undefined).then(() => { if (this.migration === current) this.migration = null; });
    return current;
  }

  private store(state: GameState, id: string, kind: SaveKind, name: string | undefined): Promise<SaveMeta> {
    let json: string;
    let details: ReturnType<typeof describeTower>;
    try {
      // Synchronous on purpose: capture the tower as it is right now.
      json = serializeGame(state);
      details = describeTower(state);
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    const label = (name ?? '').trim().slice(0, NAME_LIMIT) || `Tower · ${details.dateLabel}`;
    return this.enqueue(async () => {
      const payload = await encodeSave(json, this.compressor);
      const meta: SaveMeta = {
        id, name: label, kind, savedAt: this.now(), ...details,
        bytes: encodedSize(payload), encoding: payload.encoding,
      };
      await this.backend.write(meta, payload);
      return meta;
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
