import { describe, expect, it } from 'vitest';
import { createInitialState, serializeGame, setupNewGame, formatTowerDate } from '../../src/sim';
import {
  AUTOSAVE_ID, LEGACY_ID, LEGACY_SAVE_KEY, MemoryBackend, SaveManager, decodeSave, describeSaveError,
  encodeSave, streamGzip, type Compressor, type LegacyStorage,
} from '../../src/persistence';

function tower(seed = 7) {
  const state = createInitialState(seed);
  setupNewGame(state);
  return state;
}

class FakeStorage implements LegacyStorage {
  constructor(public items = new Map<string, string>()) {}
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  removeItem(key: string): void { this.items.delete(key); }
}

function manager(options: { compressor?: Compressor | null; legacy?: LegacyStorage | null; backend?: MemoryBackend } = {}) {
  let clock = 1_000;
  let ids = 0;
  const backend = options.backend ?? new MemoryBackend();
  const saves = new SaveManager({
    backend,
    compressor: options.compressor === undefined ? streamGzip() : options.compressor,
    legacy: options.legacy ?? null,
    now: () => (clock += 1_000),
    newId: () => `slot-${++ids}`,
  });
  return { saves, backend };
}

describe('save codec', () => {
  it('round-trips gzip and shrinks repetitive JSON', async () => {
    const gzip = streamGzip();
    expect(gzip).not.toBeNull();
    const json = serializeGame(tower());
    const encoded = await encodeSave(json, gzip);
    expect(encoded.encoding).toBe('gzip');
    expect((encoded.data as Uint8Array).byteLength).toBeLessThan(json.length / 3);
    expect(await decodeSave(encoded, gzip)).toBe(json);
  });

  it('falls back to plain JSON without compression support', async () => {
    const encoded = await encodeSave('{"a":1}', null);
    expect(encoded).toEqual({ encoding: 'json', data: '{"a":1}' });
    expect(await decodeSave(encoded, null)).toBe('{"a":1}');
  });

  it('falls back to plain JSON when the compressor throws', async () => {
    const broken: Compressor = { compress: () => Promise.reject(new Error('nope')), decompress: () => Promise.reject(new Error('nope')) };
    expect((await encodeSave('x', broken)).encoding).toBe('json');
  });

  it('explains compressed saves that cannot be opened', async () => {
    await expect(decodeSave({ encoding: 'gzip', data: new Uint8Array([1, 2]) }, null)).rejects.toThrow(/cannot decompress/);
    await expect(decodeSave({ encoding: 'gzip', data: new Uint8Array([1, 2]) }, streamGzip())).rejects.toThrow(/damaged/);
  });
});

describe('SaveManager slots', () => {
  it('saves named slots with tower metadata and loads them back', async () => {
    const { saves } = manager();
    const state = tower();
    state.calendar.day = 4;
    const meta = await saves.save(state, { name: '  Downtown  ' });
    expect(meta).toMatchObject({
      id: 'slot-1', name: 'Downtown', kind: 'manual', day: 4, dateLabel: formatTowerDate(4),
      stars: state.starLevel, fundsCents: state.money.balanceCents, encoding: 'gzip',
    });
    expect(meta.bytes).toBeGreaterThan(0);
    const loaded = await saves.load('slot-1');
    expect(serializeGame(loaded)).toBe(serializeGame(state));
  });

  it('snapshots the tower when save is called, not when the write finishes', async () => {
    const { saves } = manager();
    const state = tower();
    const day = state.calendar.day;
    const pending = saves.save(state);
    state.calendar.day = 99;
    const meta = await pending;
    expect(meta.day).toBe(day);
    expect((await saves.load(meta.id)).calendar.day).toBe(day);
  });

  it('lists newest first, overwrites in place, and deletes', async () => {
    const { saves } = manager();
    await saves.save(tower(), { name: 'A' });
    await saves.save(tower(), { name: 'B' });
    await saves.save(tower(), { id: 'slot-1', name: 'A2' });
    expect((await saves.list()).map(m => m.name)).toEqual(['A2', 'B']);
    await saves.delete('slot-2');
    expect((await saves.list()).map(m => m.id)).toEqual(['slot-1']);
    await expect(saves.load('slot-2')).rejects.toThrow(/no longer exists/);
  });

  it('defaults the name to the tower date', async () => {
    const { saves } = manager();
    const state = tower();
    expect((await saves.save(state)).name).toBe(`Tower · ${formatTowerDate(state.calendar.day)}`);
  });

  it('keeps a single autosave slot', async () => {
    const { saves } = manager();
    await saves.autosave(tower());
    const state = tower();
    state.calendar.day = 12;
    await saves.autosave(state);
    const list = await saves.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: AUTOSAVE_ID, kind: 'auto', day: 12 });
  });

  it('works uncompressed when CompressionStream is unavailable', async () => {
    const { saves } = manager({ compressor: null });
    const meta = await saves.save(tower());
    expect(meta.encoding).toBe('json');
    expect((await saves.load(meta.id)).calendar.day).toBe(meta.day);
  });

  it('surfaces storage write failures', async () => {
    const backend = new MemoryBackend();
    backend.write = () => Promise.reject(Object.assign(new Error('quota'), { name: 'QuotaExceededError' }));
    const { saves } = manager({ backend });
    const failure = await saves.save(tower()).catch((err: unknown) => err);
    expect(describeSaveError(failure)).toMatch(/storage space/);
    // The queue keeps working after a failure.
    backend.write = MemoryBackend.prototype.write.bind(backend);
    await expect(saves.save(tower())).resolves.toMatchObject({ kind: 'manual' });
  });
});

describe('legacy localStorage migration', () => {
  it('imports the old single save as a slot and keeps the original until deleted', async () => {
    const state = tower(42);
    state.calendar.day = 9;
    const legacy = new FakeStorage(new Map([[LEGACY_SAVE_KEY, serializeGame(state)]]));
    const { saves } = manager({ legacy });
    const list = await saves.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: LEGACY_ID, kind: 'legacy', day: 9, dateLabel: formatTowerDate(9) });
    expect(legacy.items.has(LEGACY_SAVE_KEY)).toBe(true);
    expect((await saves.load(LEGACY_ID)).calendar.day).toBe(9);
    // Listing again does not duplicate it.
    expect(await saves.list()).toHaveLength(1);
    await saves.delete(LEGACY_ID);
    expect(legacy.items.has(LEGACY_SAVE_KEY)).toBe(false);
    expect(await saves.list()).toHaveLength(0);
  });

  it('does not re-import over an existing legacy slot in a new session', async () => {
    const legacy = new FakeStorage(new Map([[LEGACY_SAVE_KEY, serializeGame(tower())]]));
    const backend = new MemoryBackend();
    await manager({ legacy, backend }).saves.list();
    const second = manager({ legacy, backend });
    expect(await second.saves.migrateLegacy()).toBeNull();
    expect(await second.saves.list()).toHaveLength(1);
  });

  it('picks up a legacy save written after the first listing', async () => {
    const legacy = new FakeStorage();
    const { saves } = manager({ legacy });
    expect(await saves.list()).toHaveLength(0);
    legacy.items.set(LEGACY_SAVE_KEY, serializeGame(tower()));
    expect((await saves.list()).map(m => m.id)).toEqual([LEGACY_ID]);
  });

  it('keeps an unreadable legacy save as a slot and reports it on load', async () => {
    const legacy = new FakeStorage(new Map([[LEGACY_SAVE_KEY, '{"broken":true}']]));
    const { saves } = manager({ legacy });
    expect((await saves.list())[0]).toMatchObject({ id: LEGACY_ID, dateLabel: 'Unknown date' });
    await expect(saves.load(LEGACY_ID)).rejects.toThrow(/could not be read/);
  });

  it('lists other slots and reports when the import fails', async () => {
    const legacy = new FakeStorage(new Map([[LEGACY_SAVE_KEY, serializeGame(tower())]]));
    const backend = new MemoryBackend();
    const { saves } = manager({ legacy, backend });
    const write = backend.write.bind(backend);
    await saves.save(tower(), { name: 'Kept' });
    backend.write = () => Promise.reject(Object.assign(new Error('full'), { name: 'QuotaExceededError' }));
    // A fresh manager over the same backend tries the import and fails.
    const fresh = manager({ legacy, backend }).saves;
    expect((await fresh.list()).map(m => m.name)).toEqual(['Kept']);
    expect(fresh.legacyError).toMatch(/storage space/);
    backend.write = write;
    expect((await fresh.list()).map(m => m.id).sort()).toEqual([LEGACY_ID, 'slot-1']);
    expect(fresh.legacyError).toBeNull();
  });
});
