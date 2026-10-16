import type { SaveBackend, SaveMeta } from './backend';
import type { EncodedSave } from './codec';

const DB_NAME = 'upper-story-saves';
const DB_VERSION = 1;
const META = 'meta';
const PAYLOADS = 'payloads';

interface PayloadRow extends EncodedSave {
  id: string;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Browser storage request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Browser storage transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('Browser storage transaction was aborted'));
  });
}

/** IndexedDB-backed slots: one store of metadata rows, one of payloads. */
export class IndexedDbBackend implements SaveBackend {
  readonly persistent = true;
  private constructor(private readonly db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB): Promise<IndexedDbBackend> {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(PAYLOADS)) db.createObjectStore(PAYLOADS, { keyPath: 'id' });
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open browser storage'));
      req.onblocked = () => reject(new Error('Browser storage is busy in another tab; close it and try again.'));
    });
    // Another tab upgrading the schema: step aside rather than block it.
    db.onversionchange = () => db.close();
    return new IndexedDbBackend(db);
  }

  async list(): Promise<SaveMeta[]> {
    return request(this.db.transaction(META, 'readonly').objectStore(META).getAll() as IDBRequest<SaveMeta[]>);
  }

  async read(id: string): Promise<EncodedSave | undefined> {
    const row = await request(this.db.transaction(PAYLOADS, 'readonly').objectStore(PAYLOADS).get(id) as IDBRequest<PayloadRow | undefined>);
    return row ? { encoding: row.encoding, data: row.data } : undefined;
  }

  async write(meta: SaveMeta, payload: EncodedSave): Promise<void> {
    const tx = this.db.transaction([META, PAYLOADS], 'readwrite');
    const finished = done(tx);
    tx.objectStore(PAYLOADS).put({ id: meta.id, encoding: payload.encoding, data: payload.data } satisfies PayloadRow);
    tx.objectStore(META).put(meta);
    await finished;
  }

  async remove(id: string): Promise<void> {
    const tx = this.db.transaction([META, PAYLOADS], 'readwrite');
    const finished = done(tx);
    tx.objectStore(PAYLOADS).delete(id);
    tx.objectStore(META).delete(id);
    await finished;
  }
}
