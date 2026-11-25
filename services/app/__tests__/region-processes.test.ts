import {createHistoricalPage} from './historical-page';
/**
 * TWO APP PROCESSES, ONE DATABASE (production runs two). Two RegionSessions instances share nothing but the database:
 * each has its own document cache, client-id memory, LISTEN subscriptions, stream registry and timers, exactly what
 * a second process would have. Editors on each type at once; every update is accepted once, in one order, and both
 * streams deliver all of them; saves racing from both make one version.
 *
 * Here on the harness's PGLite (which serializes whole transactions, so it proves the protocol, not the row locks);
 * region-processes-postgres.test.ts runs the same scenario (region-processes-scenario.ts) on TWO connection pools of a
 * real PostgreSQL, where concurrent transactions really race on FOR UPDATE and NOTIFY really crosses connections.
 */
import { describe, it } from 'vitest';
import { identityForUser } from '@/lib/accounts';
import { createUser } from '@/lib/accounts/testing';
import { editableRegions } from '@/lib/live-regions';
import { getDb } from '@/lib/platform';
import { nativeHtml } from './native-html-fixture';
import { useAppHarness } from './harness';
import { seedShares } from '@/__tests__/rows';
import { BODY, concurrentTyping } from './region-processes-scenario';

useAppHarness();

describe('two instances over the harness database', () => {
  it('serialize concurrent updates from both into one order that both streams deliver whole', async () => {
    const [alice, bob] = await Promise.all(['alice', 'bob'].map((name) => createUser({ email: `mxmx_test_region_two_${name}@example.com` })));
    const row = await createHistoricalPage(null, alice!.id, { format: 'html', source: nativeHtml(BODY), meta: {}, visibility: 'private' });
    await seedShares((await getDb()), { artifact_id: row.id, email: bob!.email, role: 'editor' });
    await concurrentTyping({
      pageId: row.id, regionId: editableRegions(row.source!)[0]!.id,
      alice: identityForUser(alice!.id, null), bob: identityForUser(bob!.id, null), dbs: [getDb, getDb],
      headVersion: async () => (await (await getDb()).query<{ version: number }>('SELECT version FROM artifacts WHERE id = $1', [row.id])).rows[0]!.version,
    });
  });
});
