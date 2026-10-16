import type { EncodedSave, SaveEncoding } from './codec';

export type SaveKind = 'manual' | 'auto' | 'legacy';

/** Lightweight slot description, listed without loading the tower itself. */
export interface SaveMeta {
  id: string;
  name: string;
  kind: SaveKind;
  /** Wall-clock save time (ms since epoch). */
  savedAt: number;
  /** In-game day and its "1st WD / 1st Qtr / Year 1" label. */
  day: number;
  dateLabel: string;
  population: number;
  stars: number;
  fundsCents: number;
  /** Stored payload size in bytes. */
  bytes: number;
  encoding: SaveEncoding;
}

/**
 * Storage for slot metadata and payloads. Kept separate so listing slots
 * never reads multi-megabyte payloads. Implementations: IndexedDB (browser)
 * and in-memory (tests / storage-less fallback).
 */
export interface SaveBackend {
  /** True when data survives a page reload. */
  readonly persistent: boolean;
  list(): Promise<SaveMeta[]>;
  read(id: string): Promise<EncodedSave | undefined>;
  /** Writes metadata and payload atomically. */
  write(meta: SaveMeta, payload: EncodedSave): Promise<void>;
  remove(id: string): Promise<void>;
}

export class MemoryBackend implements SaveBackend {
  readonly persistent = false;
  private readonly metas = new Map<string, SaveMeta>();
  private readonly payloads = new Map<string, EncodedSave>();
  async list(): Promise<SaveMeta[]> {
    return [...this.metas.values()].map(meta => ({ ...meta }));
  }
  async read(id: string): Promise<EncodedSave | undefined> {
    return this.payloads.get(id);
  }
  async write(meta: SaveMeta, payload: EncodedSave): Promise<void> {
    this.metas.set(meta.id, { ...meta });
    this.payloads.set(meta.id, payload);
  }
  async remove(id: string): Promise<void> {
    this.metas.delete(id);
    this.payloads.delete(id);
  }
}
