/**
 * The one path that erases a page for good (a test user's erase, lib/operations testuser-erase) takes its live
 * regions with it: every region table carries `artifact_id`, so the derived sweep deletes their rows.
 */
import { expect, it } from 'vitest';
import { createArtifact } from '@/lib/artifacts';
import { identityForUser } from '@/lib/accounts';
import { editableRegions } from '@/lib/live-regions';
import { createRegionSessions } from '@/lib/region-sessions';
import { getDb } from '@/lib/platform';
import { nativeHtml } from '@/__tests__/native-html-fixture';
import { useAppHarness } from '@/__tests__/harness';
import { eraseTestUser } from '../testuser-erase';

useAppHarness();

it('erasing a test user deletes the region rows of its pages', async () => {
  const db = await getDb();
  const id = `usr_testuser_${Math.random().toString(36).slice(2, 10)}`;
  await db.query("INSERT INTO users (id, email, kind) VALUES ($1, $2, 'testuser')", [id, `mxmx_test_${id}@example.test`]);
  const row = await createArtifact(null, id, { format: 'html', source: nativeHtml('<article data-af-editable="rich"><p>Hello</p></article>'), meta: {}, visibility: 'private' });
  const sessions = createRegionSessions({ db: getDb, keepaliveFrame: () => '', subscribe: async (channel, handler, onLost) => (await getDb()).listen(channel, handler, onLost) });
  const opened = await sessions.open(identityForUser(id, null), row.id, editableRegions(row.source!)[0]!.id);
  expect(opened.status).toBe(200);
  const rows = async (table: string) => (await db.query(`SELECT 1 FROM ${table} WHERE artifact_id = $1`, [row.id])).rows.length;
  expect([await rows('region_states'), await rows('region_updates'), await rows('region_snapshots')]).toEqual([1, 1, 1]);
  await eraseTestUser(id);
  expect([await rows('region_states'), await rows('region_updates'), await rows('region_snapshots')]).toEqual([0, 0, 0]);
  sessions.dispose();
});
