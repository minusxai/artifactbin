/**
 * A TEST NEVER OPENS THE DEV SERVER'S DATABASE. `npm run dev` holds the implicit store (services/app/data/pglite) open;
 * a second PGLite on that directory (the app harness wiping every table, a spawned tool booting the app) deletes
 * relation files under the running server, and every signed-in request fails until the data is moved aside.
 *
 * Enrolled in pr fast's guard tier (scripts/ci/guard-tests.json, setup guard.setup.ts) and selected by the node
 * project (vitest.setup.ts), so both setups are held to it. It checks the target BEFORE opening anything, so a
 * regression fails here without touching a running server's files.
 */
import { afterAll, expect, it } from 'vitest';
import { databaseTargetForRuntime, getDb, resetDb } from '@/lib/platform/db';

const IN_MEMORY = { engine: 'pglite', dataDir: null };

afterAll(() => resetDb());

it('the environment a test, and any server, script or tool it spawns, inherits resolves to an in-memory database', () => {
  expect(databaseTargetForRuntime(process.env.DATABASE_URL)).toEqual(IN_MEMORY);
});

it('the database a test opens is in memory, never the implicit store', async () => {
  // What getDb opens: the setup's configured target, else DATABASE_URL (lib/platform/db createDb).
  const target = globalThis.__artifact_bin_db_options__?.target ?? databaseTargetForRuntime(process.env.DATABASE_URL);
  expect(target).toEqual(IN_MEMORY);
  const raw = (await getDb()).raw();
  if (raw.kind !== 'pglite') throw new Error(`expected an in-memory PGLite, opened ${raw.kind}`);
  expect((raw.instance as { dataDir?: string }).dataDir).toBeUndefined();
});
