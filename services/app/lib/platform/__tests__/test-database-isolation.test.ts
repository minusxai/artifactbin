/**
 * A TEST NEVER OPENS THE DEV SERVER'S DATABASE. `npm run dev` holds the implicit store (services/app/data/pglite) open;
 * a second PGLite on that directory (the app harness wiping every table, a spawned tool booting the app) deletes
 * relation files under the running server, and every signed-in request fails until the data is moved aside.
 *
 * Enrolled in pr fast's guard tier (scripts/ci/guard-tests.json, setup guard.setup.ts) and selected by the node
 * project (vitest.setup.ts), so both setups are held to it.
 */
import { expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { databaseTargetForRuntime } from '@/lib/platform/db';

const IN_MEMORY = { engine: 'pglite', dataDir: null };
// What the harness is about to open: the setup's configured target, else DATABASE_URL (lib/platform/db createDb).
// Read at collection, before its beforeAll opens anything, so a regression fails without touching a running server.
const inherited = databaseTargetForRuntime(process.env.DATABASE_URL);
const opening = globalThis.__artifact_bin_db_options__?.target ?? inherited;
if (opening.engine !== 'pglite' || opening.dataDir !== null) throw new Error(`The test database would open ${JSON.stringify(opening)}, not an in-memory PGLite.`);
const harness = useAppHarness();

it('the environment a test, and any server, script or tool it spawns, inherits resolves to an in-memory database', () => {
  expect(inherited).toEqual(IN_MEMORY);
});

it('the database the app harness opens is in memory, never the implicit store', async () => {
  expect(opening).toEqual(IN_MEMORY);
  const raw = (await harness.db()).raw();
  if (raw.kind !== 'pglite') throw new Error(`expected an in-memory PGLite, opened ${raw.kind}`);
  expect((raw.instance as { dataDir?: string }).dataDir).toBeUndefined();
});
