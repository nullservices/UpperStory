/**
 * Save payload encoding. Late-game towers serialize to ~10M characters of
 * JSON, which gzip shrinks by roughly 10-20x. Compression uses the browser's
 * streaming CompressionStream when present; without it saves are stored as
 * plain JSON (IndexedDB has no practical size limit for either).
 */
export type SaveEncoding = 'gzip' | 'json';

export interface EncodedSave {
  encoding: SaveEncoding;
  /** Compressed bytes for 'gzip', the raw JSON string for 'json'. */
  data: Uint8Array | string;
}

/** Injected so tests (node) and browsers without CompressionStream both work. */
export interface Compressor {
  compress(text: string): Promise<Uint8Array>;
  decompress(bytes: Uint8Array): Promise<string>;
}

/** gzip via CompressionStream/DecompressionStream, or null when unsupported. */
export function streamGzip(): Compressor | null {
  if (
    typeof CompressionStream !== 'function' ||
    typeof DecompressionStream !== 'function' ||
    typeof Blob !== 'function' ||
    typeof Response !== 'function'
  ) return null;
  return {
    async compress(text) {
      const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    },
    async decompress(bytes) {
      const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).text();
    },
  };
}

/** Compress when possible; any compressor failure falls back to plain JSON. */
export async function encodeSave(json: string, compressor: Compressor | null): Promise<EncodedSave> {
  if (compressor) {
    try {
      return { encoding: 'gzip', data: await compressor.compress(json) };
    } catch {
      // Fall through: an uncompressed save beats no save.
    }
  }
  return { encoding: 'json', data: json };
}

export async function decodeSave(save: EncodedSave, compressor: Compressor | null): Promise<string> {
  if (save.encoding === 'json') {
    if (typeof save.data !== 'string') throw new Error('Save data is damaged (expected text).');
    return save.data;
  }
  if (!compressor) throw new Error('This save is compressed, but this browser cannot decompress it.');
  if (typeof save.data === 'string') throw new Error('Save data is damaged (expected compressed bytes).');
  try {
    return await compressor.decompress(toBytes(save.data));
  } catch {
    throw new Error('Save data is damaged and could not be decompressed.');
  }
}

/** Stored size in bytes (UTF-16 strings count two bytes per code unit). */
export function encodedSize(save: EncodedSave): number {
  return typeof save.data === 'string' ? save.data.length * 2 : save.data.byteLength;
}

/** IndexedDB may hand back an ArrayBuffer or a typed array; normalize. */
function toBytes(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}
