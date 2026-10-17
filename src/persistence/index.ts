/**
 * Tower persistence: named save slots in IndexedDB, gzip-compressed with
 * CompressionStream where available. Kept out of src/sim; the JSON itself
 * still comes from serializeGame/deserializeGame.
 */
import { MemoryBackend, type SaveBackend, type SaveMeta } from './backend';
import type { EncodedSave } from './codec';
import { streamGzip } from './codec';
import { IndexedDbBackend } from './indexedDbBackend';
import { SaveManager, describeSaveError, type LegacyStorage } from './saveManager';

export type { SaveBackend, SaveKind, SaveMeta } from './backend';
export { MemoryBackend } from './backend';
export type { Compressor, EncodedSave, SaveEncoding } from './codec';
export { decodeSave, encodeSave, streamGzip } from './codec';
export { IndexedDbBackend } from './indexedDbBackend';
export {
  AUTOSAVE_ID, LEGACY_ID, LEGACY_SAVE_KEY, SaveManager, describeSaveError, describeTower,
} from './saveManager';
export type { LegacyStorage, SaveFileExport, SaveManagerOptions, SaveRequest } from './saveManager';
export {
  SAVE_FILE_EXTENSION, SAVE_FILE_MIME, SaveFileError, decodeSaveFile, encodeSaveFile, importedSaveName, readSaveFile, saveFileName,
} from './saveFile';

export interface OpenedSaves {
  manager: SaveManager;
  /**
   * Resolves once storage is open: null when IndexedDB works, otherwise why
   * saves are session-only. Startup never waits on it.
   */
  ready: Promise<string | null>;
}

/**
 * IndexedDB opens in the background; calls made before it is ready wait for
 * it. If it cannot open, an in-memory backend takes over.
 */
class DeferredBackend implements SaveBackend {
  persistent = true;
  constructor(private readonly backend: Promise<SaveBackend>) {
    void backend.then(b => { this.persistent = b.persistent; }, () => undefined);
  }
  async list(): Promise<SaveMeta[]> { return (await this.backend).list(); }
  async read(id: string): Promise<EncodedSave | undefined> { return (await this.backend).read(id); }
  async write(meta: SaveMeta, payload: EncodedSave): Promise<void> { return (await this.backend).write(meta, payload); }
  async remove(id: string): Promise<void> { return (await this.backend).remove(id); }
}

/** Open browser save storage without blocking startup. Never throws. */
export function openBrowserSaves(): OpenedSaves {
  let legacy: LegacyStorage | null = null;
  try { legacy = window.localStorage; } catch { legacy = null; }
  let warning: string | null = null;
  const backend = (async (): Promise<SaveBackend> => {
    try {
      if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available in this browser.');
      return await IndexedDbBackend.open(indexedDB);
    } catch (err) {
      warning = `Browser storage is unavailable (${describeSaveError(err)}). Saves will only last until this tab closes.`;
      return new MemoryBackend();
    }
  })();
  return {
    manager: new SaveManager({ backend: new DeferredBackend(backend), compressor: streamGzip(), legacy }),
    ready: backend.then(() => warning),
  };
}
