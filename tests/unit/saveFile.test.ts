import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, buildFloor, createInitialState, serializeGame, setupNewGame } from '../../src/sim';
import {
  MemoryBackend, SaveFileError, SaveManager, decodeSaveFile, encodeSaveFile, importedSaveName, readSaveFile,
  saveFileName, streamGzip,
} from '../../src/persistence';

function tower() {
  const state = createInitialState(11);
  setupNewGame(state, true);
  buildFloor(state, 2);
  return state;
}

const gzip = streamGzip()!;

async function rejection(promise: Promise<unknown>): Promise<SaveFileError> {
  try { await promise; } catch (err) { expect(err).toBeInstanceOf(SaveFileError); return err as SaveFileError; }
  throw new Error('expected a rejection');
}

describe('save files', () => {
  it('round-trips a tower through a gzip file', async () => {
    const json = serializeGame(tower());
    const bytes = await encodeSaveFile(json, gzip);
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
    const decoded = await decodeSaveFile(bytes, gzip);
    expect(decoded).toEqual({ json, version: SAVE_VERSION });
    const state = await readSaveFile(bytes, gzip);
    expect(state.tower.floors.some(f => f.index === 2)).toBe(true);
  });

  it('accepts uncompressed save JSON', async () => {
    const json = serializeGame(tower());
    const state = await readSaveFile(new TextEncoder().encode(json), gzip);
    expect(state.calendar.day).toBe(1);
  });

  it('rejects files that are not saves', async () => {
    expect((await rejection(decodeSaveFile(new TextEncoder().encode('hello'), gzip))).code).toBe('not-a-save');
    expect((await rejection(decodeSaveFile(new TextEncoder().encode('{"name":"x"}'), gzip))).code).toBe('not-a-save');
    expect((await rejection(decodeSaveFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]), gzip))).code).toBe('not-a-save');
    expect((await rejection(decodeSaveFile(await gzip.compress('[1,2,3]'), gzip))).code).toBe('not-a-save');
  });

  it('explains saves from a newer version', async () => {
    const json = serializeGame(tower()).replace(`{"version":${SAVE_VERSION},`, `{"version":${SAVE_VERSION + 1},`);
    const err = await rejection(decodeSaveFile(await gzip.compress(json), gzip));
    expect(err.code).toBe('newer-version');
    expect(err.message).toMatch(/newer version/);
  });

  it('reports truncated or damaged files as corrupted', async () => {
    const bytes = await encodeSaveFile(serializeGame(tower()), gzip);
    expect((await rejection(decodeSaveFile(bytes.slice(0, Math.floor(bytes.length / 2)), gzip))).code).toBe('corrupted');
    const json = serializeGame(tower());
    const cut = new TextEncoder().encode(json.slice(0, json.length - 40));
    expect((await rejection(readSaveFile(cut, gzip))).code).toBe('corrupted');
  });

  it('cannot open a compressed file without a decompressor', async () => {
    const bytes = await encodeSaveFile(serializeGame(tower()), gzip);
    expect((await rejection(decodeSaveFile(bytes, null))).code).toBe('unsupported');
  });

  it('names files and imported slots', () => {
    expect(saveFileName('My Tower: v2')).toBe('My-Tower-v2.upperstory');
    expect(saveFileName('   ')).toBe('tower.upperstory');
    expect(importedSaveName('Skyline run (1).upperstory')).toBe('Skyline run (1)');
    expect(importedSaveName('.upperstory')).toBe('Imported tower');
  });

  it('exports a slot and imports it back into a new slot', async () => {
    let id = 0;
    const saves = new SaveManager({ backend: new MemoryBackend(), compressor: gzip, newId: () => `slot-${++id}`, now: () => 1 });
    const meta = await saves.save(tower(), { name: 'Original' });
    const file = await saves.exportSlot(meta.id);
    expect(file.fileName).toBe('Original.upperstory');
    const imported = await saves.importFile(file.bytes, 'Original copy.upperstory');
    expect(imported.id).not.toBe(meta.id);
    expect(imported.name).toBe('Original copy');
    const loaded = await saves.load(imported.id);
    expect(loaded.tower.floors.some(f => f.index === 2)).toBe(true);
    expect((await saves.list())).toHaveLength(2);
    const current = await saves.exportState(tower(), 'Live');
    expect(current.fileName).toBe('Live.upperstory');
    await expect(saves.importFile(new TextEncoder().encode('nope'), 'x.upperstory')).rejects.toBeInstanceOf(SaveFileError);
    expect((await saves.list())).toHaveLength(2);
  });
});
