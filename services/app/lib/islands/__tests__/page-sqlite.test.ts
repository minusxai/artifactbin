/** Where the page's SQLite core comes from: loaded once per engine, from a URL or from bytes the page already has. */
import { afterEach, describe, expect, it, vi } from 'vitest';

const loadSqlite = vi.hoisted(() => vi.fn(async () => ({ core: true })));
vi.mock('@artifactbin/sql/core', () => ({ loadSqlite }));

import { sqliteFrom } from '../page-sqlite';

afterEach(() => { vi.unstubAllGlobals(); loadSqlite.mockClear(); });

describe('sqliteFrom', () => {
  it('fetches a URL once, credential-free, however often the engine asks', async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([0, 97, 115, 109])));
    vi.stubGlobal('fetch', fetch);
    const load = sqliteFrom('/islands/sqlite-abc.wasm');
    const [a, b] = await Promise.all([load(), load()]);
    await load();
    expect(a).toBe(b);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/islands/sqlite-abc.wasm', { credentials: 'omit' });
    expect(loadSqlite).toHaveBeenCalledTimes(1);
  });

  it('reads given bytes once, however often the engine asks', async () => {
    const bytes = vi.fn(async () => new Uint8Array([0, 97, 115, 109]));
    const load = sqliteFrom(bytes);
    await Promise.all([load(), load()]);
    await load();
    expect(bytes).toHaveBeenCalledTimes(1);
    expect(loadSqlite).toHaveBeenCalledTimes(1);
    expect(loadSqlite).toHaveBeenCalledWith(new Uint8Array([0, 97, 115, 109]));
  });
});
