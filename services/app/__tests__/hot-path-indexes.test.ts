/**
 * THE FOUR HOT-PATH INDEXES, proven on the planner (lib/platform/schema): each query the app really issues is
 * EXPLAINed on a database big enough that a scan is the wrong answer, and must choose the index declared for it.
 * No enable_seqscan override: the planner picks these on its own once the tables are real-sized.
 */
import { expect, it } from 'vitest';
import { useAppHarness } from './harness';
import { getDb } from '@/lib/platform';
import { LIVE_ARTIFACT_SQL } from '@/lib/artifact-access';

useAppHarness();

async function plan(sql: string, params: unknown[]): Promise<string> {
  const db = await getDb();
  const rows = (await db.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${sql}`, params)).rows;
  return rows.map((row) => row['QUERY PLAN']).join('\n');
}

async function seed() {
  const db = await getDb();
  await db.query(`INSERT INTO artifacts (id, token_id, user_id, group_id, format, updated_at, deleted_at)
    SELECT 'a' || n, 'tok', CASE WHEN n % 5 = 0 THEN 'user' || (n % 40) END, CASE WHEN n % 5 <> 0 THEN 'group' || (n % 60) END,
           'markup', now() - (n || ' minutes')::interval, CASE WHEN n % 11 = 0 THEN now() END
    FROM generate_series(1, 12000) n`);
  await db.query(`INSERT INTO artifact_shares (artifact_id, email, role, user_id)
    SELECT 'a' || n, 'person' || (n % 300) || '@example.com', 'viewer', CASE WHEN n % 4 = 0 THEN 'user' || (n % 200) END
    FROM generate_series(1, 6000) n`);
  await db.query(`INSERT INTO groups (id, handle, name, created_by) SELECT 'group' || n, 'g' || n, 'G' || n, 'user1' FROM generate_series(1, 60) n`);
  await db.query(`INSERT INTO group_invitations (id, group_id, email, role, invited_by)
    SELECT 'gin_' || n, 'group' || (n % 60 + 1), 'invitee' || n || '@example.com', 'viewer', 'user1' FROM generate_series(1, 3000) n`);
  for (const table of ['artifacts', 'artifact_shares', 'groups', 'group_invitations']) await db.query(`ANALYZE ${table}`);
}

it('chooses each new index for the query that motivated it', async () => {
  await seed();
  // The group workspace listing (lib/workspace/inventory workspaceDocumentsFor).
  const inventory = await plan(`SELECT id, title, format, version, visibility, ancestor_ids, updated_at FROM artifacts
    WHERE group_id = $1 AND ${LIVE_ARTIFACT_SQL} AND format IN ('markup', 'folder') ORDER BY updated_at DESC, id DESC LIMIT 1000`, ['group7']);
  expect(inventory).toContain('idx_artifacts_group_updated');
  expect(inventory).not.toMatch(/Seq Scan on artifacts/);

  // "Shared with me" (lib/workspace/listings listSharedWithEmail): the address, whether or not it is resolved yet.
  const shared = await plan(`SELECT a.id, s.role FROM artifacts a JOIN artifact_shares s ON s.artifact_id = a.id
    WHERE s.email = $1 AND a.${LIVE_ARTIFACT_SQL} ORDER BY a.updated_at DESC LIMIT 200`, ['person7@example.com']);
  expect(shared).toContain('idx_artifact_shares_email');

  // What an account was shared by its resolved id.
  expect(await plan('SELECT artifact_id, role FROM artifact_shares WHERE user_id = $1', ['user8'])).toContain('idx_artifact_shares_user');

  // Pending invitations of a verified address (lib/groups acceptGroupInvitations).
  const invitations = await plan(`SELECT i.id, i.group_id, i.role FROM group_invitations i JOIN groups g ON g.id = i.group_id
    WHERE i.email = $1 AND g.deleted_at IS NULL ORDER BY i.group_id`, ['invitee42@example.com']);
  expect(invitations).toContain('idx_group_invitations_by_email');
  expect(invitations).not.toMatch(/Seq Scan on group_invitations/);
});

it('chooses the launch indexes and the snapshot GIN index', async () => {
  const db = await getDb();
  await seed();
  await db.query(`INSERT INTO tokens (id, token_hash, user_id, deleted_at)
    SELECT 'tok' || n, 'hash' || n, 'user' || (n % 2000), CASE WHEN n % 9 = 0 THEN now() END FROM generate_series(1, 12000) n`);
  await db.query(`INSERT INTO member_notifications (id, artifact_id, user_id, recipient_id, sender_id, kind, source)
    SELECT 'mn' || n, 'a' || (n % 3000), 'user' || (n % 400), 'user' || (n % 400), 'user1', 'reply', 'comment:t' || (n % 4000)
    FROM generate_series(1, 12000) n`);
  await db.query(`INSERT INTO event_outbox (id, envelope, created_at)
    SELECT 'ev' || n, '{}'::jsonb, now() - (n || ' seconds')::interval FROM generate_series(1, 12000) n`);
  await db.query(`INSERT INTO data_snapshots (artifact_id, slot, plan_key, inputs_key, datasets)
    SELECT 'a' || n, 'head', 'p', 'i', ARRAY['ds' || (n % 3000)] FROM generate_series(1, 12000) n`);
  for (const table of ['tokens', 'member_notifications', 'event_outbox', 'data_snapshots']) await db.query(`ANALYZE ${table}`);

  // An account's live tokens (lib/accounts/tokens).
  expect(await plan('SELECT id FROM tokens WHERE user_id = $1 AND deleted_at IS NULL', ['user8'])).toContain('idx_tokens_user');
  // An account's own documents (lib/workspace/listings).
  expect(await plan(`SELECT id FROM artifacts WHERE group_id IS NULL AND user_id = $1 AND ${LIVE_ARTIFACT_SQL} ORDER BY updated_at DESC LIMIT 200`, ['user5']))
    .toContain('idx_artifacts_user_updated');
  // A thread's notifications (lib/notifications/write).
  expect(await plan('SELECT id, recipient_id, revision FROM member_notifications WHERE artifact_id = $1 AND source = $2', ['a7', 'comment:t7']))
    .toContain('idx_member_notifications_source');
  // The outbox drain (lib/platform/event-outbox).
  expect(await plan('SELECT id, envelope FROM event_outbox ORDER BY created_at, id LIMIT 50', [])).toContain('idx_event_outbox_created');
  // Dataset invalidation (lib/publish/prepared/snapshots.server).
  expect(await plan(`UPDATE data_snapshots SET stale_at = coalesce(stale_at, now()) WHERE datasets @> ARRAY[$1]::text[]
    RETURNING artifact_id`, ['ds7'])).toContain('idx_data_snapshots_datasets');
});
