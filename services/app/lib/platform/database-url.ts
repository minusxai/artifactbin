/** Pure database URL dispatch shared with CLI host configuration. */
export type DbTarget = { engine: 'pglite'; dataDir: string | null } | { engine: 'pg'; url: string };

const PGLITE_SCHEME = 'pglite://';
const DEFAULT_PGLITE_DIR = './data/pglite';

export function parseDatabaseUrl(url: string | undefined | null): DbTarget {
  const value = (url ?? '').trim();
  if (!value) return { engine: 'pglite', dataDir: DEFAULT_PGLITE_DIR };
  if (value.startsWith(PGLITE_SCHEME)) {
    const path = value.slice(PGLITE_SCHEME.length);
    return { engine: 'pglite', dataDir: path === 'memory' || path === '' ? null : path };
  }
  return { engine: 'pg', url: value };
}

