/** The file's embedded SQLite wasm: read from the page itself, raw or gzipped, never from a URL. */
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeEmbeddedWasm } from '../compiled-sqlite';

const WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const page = (text: string | null) => ({ getElementById: (id: string) => (id === 'afbin-wasm' && text !== null ? { textContent: `\n${text}\n` } : null) });

describe('decodeEmbeddedWasm', () => {
  it('reads the wasm a file carries gzipped, and one an older file carries raw', async () => {
    expect(await decodeEmbeddedWasm(page(Buffer.from(gzipSync(WASM)).toString('base64')))).toEqual(WASM);
    expect(await decodeEmbeddedWasm(page(Buffer.from(WASM).toString('base64')))).toEqual(WASM);
  });

  it('refuses a file that carries no engine', async () => {
    await expect(decodeEmbeddedWasm(page(null))).rejects.toThrow('offline: the SQLite engine is unavailable');
  });
});
