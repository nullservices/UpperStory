/**
 * Save files (`.upperstory`): the same gzip-compressed save JSON the slots
 * store, so a slot's payload can be downloaded as-is. Uncompressed JSON is
 * accepted too (exports from browsers without CompressionStream).
 */
import { SAVE_VERSION, deserializeGame, type GameState } from '../sim';
import type { Compressor, EncodedSave } from './codec';

export const SAVE_FILE_EXTENSION = '.upperstory';
export const SAVE_FILE_MIME = 'application/x-upperstory';
/** Refuse absurd files before reading them into memory. */
export const SAVE_FILE_MAX_BYTES = 200 * 1024 * 1024;

/** An import problem with a sentence the player can act on. */
export class SaveFileError extends Error {
  constructor(message: string, readonly code: 'not-a-save' | 'newer-version' | 'corrupted' | 'too-large' | 'unsupported') {
    super(message);
    this.name = 'SaveFileError';
  }
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** File bytes for a save JSON string (gzip when possible). */
export async function encodeSaveFile(json: string, compressor: Compressor | null): Promise<Uint8Array> {
  if (compressor) {
    try { return await compressor.compress(json); } catch { /* fall back to plain JSON */ }
  }
  return new TextEncoder().encode(json);
}

/** File bytes for a stored slot payload, reusing its compressed bytes. */
export async function slotToSaveFile(payload: EncodedSave, compressor: Compressor | null): Promise<Uint8Array> {
  if (payload.encoding === 'gzip' && typeof payload.data !== 'string') {
    return payload.data instanceof Uint8Array ? payload.data : new Uint8Array(payload.data);
  }
  if (typeof payload.data !== 'string') throw new Error('Save data is damaged (expected text).');
  return encodeSaveFile(payload.data, compressor);
}

/**
 * Validate a file and return its save JSON. Throws SaveFileError for a file
 * that is not a save, a save from a newer version, or a corrupted one.
 */
export async function decodeSaveFile(bytes: Uint8Array, compressor: Compressor | null): Promise<{ json: string; version: number }> {
  if (bytes.byteLength > SAVE_FILE_MAX_BYTES) throw new SaveFileError('That file is too large to be an Upper Story save.', 'too-large');
  let json: string;
  if (isGzip(bytes)) {
    if (!compressor) throw new SaveFileError('This browser cannot decompress save files. Try a current Chrome, Edge, Firefox or Safari.', 'unsupported');
    try {
      json = await compressor.decompress(bytes);
    } catch {
      throw new SaveFileError('This save file is corrupted (it could not be decompressed). It may be incomplete — try downloading or copying it again.', 'corrupted');
    }
  } else {
    try {
      json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new SaveFileError('That file is not an Upper Story save. Choose a .upperstory file exported from the Game window.', 'not-a-save');
    }
  }
  // serializeGame writes the version first, so it can be read without parsing megabytes.
  const header = /^\s*\{\s*"version"\s*:\s*(\d+)\s*,\s*"state"\s*:/.exec(json.slice(0, 200));
  if (!header) throw new SaveFileError('That file is not an Upper Story save. Choose a .upperstory file exported from the Game window.', 'not-a-save');
  const version = Number(header[1]);
  if (version > SAVE_VERSION) {
    throw new SaveFileError(`This tower was saved by a newer version of Upper Story (save format ${version}; this copy reads up to ${SAVE_VERSION}). Reload the page to update, then import it again.`, 'newer-version');
  }
  return { json, version };
}

/** Decode, validate and load a save file into a live GameState. */
export async function readSaveFile(bytes: Uint8Array, compressor: Compressor | null): Promise<GameState> {
  const { json } = await decodeSaveFile(bytes, compressor);
  try {
    return deserializeGame(json);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new SaveFileError(`This save file is corrupted and could not be read (${detail}).`, 'corrupted');
  }
}

/** "My Tower: v2" → "My-Tower-v2.upperstory". */
export function saveFileName(name: string): string {
  const slug = name.normalize('NFKD').replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
  return `${slug || 'tower'}${SAVE_FILE_EXTENSION}`;
}

/** Slot name for an imported file: its file name without the extension. */
export function importedSaveName(fileName: string): string {
  const base = fileName.replace(/\.(upperstory|json|gz)$/i, '').trim();
  return (base || 'Imported tower').slice(0, 48);
}
