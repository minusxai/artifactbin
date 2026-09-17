/**
 * THE HARNESS CONTRACT (testmig-2), seeded RED by the orchestrator. One PGLite per file; every table wiped per test in
 * FK-safe order derived from the schema; the rate limiter reset; nothing hand-listed. These pins are what let the nine
 * PGLite-per-test files (209 s of summed worker time) share one boot without order dependence.
 */
import { describe, expect, it } from 'vitest';
import { createArtifact } from '@/lib/artifacts';
import { mintToken } from '@/lib/tokens';
import { createUser } from '@/lib/users';
import { SCHEMA_STATEMENTS } from '@/lib/schema';
import { useAppHarness } from './harness';

const h = useAppHarness();
/** Every test records the instance it saw; in ANY order they must all be the same object (one PGLite per file). */
const seen: unknown[] = [];
const sameInstance = async () => { const db = await h.db(); seen.push(db); expect(seen.every((i) => i === seen[0])).toBe(true); return db; };
const count = async (db: Awaited<ReturnType<typeof h.db>>, table: string) => (await db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ${table}`)).rows[0]?.n;

describe('one database per file, wiped before every test — in any order', () => {
  it('a test that leaves rows behind starts empty and sees the shared instance', async () => {
    const db = await sameInstance();
    for (const table of ['artifacts', 'tokens', 'users']) expect(await count(db, table), table).toBe('0');
    const t = await mintToken('a');
    await createArtifact(t.id, null, { format: 'markup', content: '', source: '<div />', meta: {}, title: 'left behind', description: null });
    await createUser({ email: 'mxmx_test_harness@example.com' });
    expect(await count(db, 'artifacts')).toBe('1');
  });
  it('another test starts empty on the SAME instance, whatever ran before it', async () => {
    const db = await sameInstance();
    for (const table of ['artifacts', 'tokens', 'users']) expect(await count(db, table), table).toBe('0');
  });
});

describe('the wipe is derived from the schema, not hand-listed', () => {
  it('every table the schema creates is empty at test start, including ones with foreign keys', async () => {
    const db = await sameInstance();
    const tables = SCHEMA_STATEMENTS.map((s) => /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(s)?.[1]).filter((t): t is string => !!t);
    expect(tables.length).toBeGreaterThan(5);
    for (const table of tables) {
      const n = await db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ${table}`);
      expect(n.rows[0]?.n, table).toBe('0');
    }
  });
});
