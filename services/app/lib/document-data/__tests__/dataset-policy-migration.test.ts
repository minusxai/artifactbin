/**
 * THE STORED POLICY MIGRATION over a fixture of every stored shape: the dry run reports and writes nothing;
 * apply stores exactly the v3 that was already enforced, the access column and the shares, with a bumped
 * revision and an actor-less audit row; reruns change nothing (idempotent); a limited or crashed run
 * continues where it stopped (resumable); people named by v2 grants keep their access through the share.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness } from '@/__tests__/harness';
import { account, dataset, head, mine, sql, type Account } from '@/__tests__/artifact-fixtures';
import { viewersWritePolicy } from '@artifactbin/utils/dataset-policy';
import { updateSharingFor } from '@/lib/artifacts';
import { datasetReadAccess, datasetWriteAccess, planPolicyMigration } from '@/lib/dataset-permissions';
import { getDb, type Db } from '@/lib/platform';
import { migrateDatasetPolicies, type MigrationDb } from '../dataset-policy/migrate';

useAppHarness();
const ROWS = { schema: 'public', name: 'rows' };
const READ_ALL = { actions: ['read'], from: { user: '*' } };
/** What every door already enforces for a stored policy (lib/dataset-permissions `toV3`, through the migration plan). */
const enforced = (policy: unknown, visibility: 'public' | 'unlisted' | 'private' = 'unlisted') => {
  const plan = planPolicyMigration({ policy, visibility, tables: [ROWS], access: 'read', ownerUserId: null });
  return 'policy' in plan ? plan.policy : policy;
};
const DEFAULT = { version: 2, allow: [READ_ALL, { actions: ['insert', 'update', 'delete'], from: { artifactOwner: '$owner' } }] };

async function fixture() {
  const owner = await account('owner@example.test'), reader = await account('reader@example.test'), writer = await account('writer@example.test'), sharedEditor = await account('editor@example.test');
  const page = await mine(owner, 'App');
  const ids = {
    none: (await dataset(owner)).id,
    v1: (await dataset(owner, viewersWritePolicy())).id,
    v1Private: (await dataset(owner, viewersWritePolicy(), { visibility: 'private' })).id,
    v1Functions: (await dataset(owner, { ...viewersWritePolicy(), execution: { functions: { deny: ['lower'] } } })).id,
    v2Default: (await dataset(owner, DEFAULT)).id,
    v2Named: (await dataset(owner, { version: 2, allow: [
      { actions: ['read'], from: { user: reader.userId } },
      { actions: ['read', 'insert', 'update'], from: { user: writer.userId } },
      { actions: ['read', 'insert'], from: { user: sharedEditor.userId } },
      { actions: ['read'], from: { user: 'usr_gone' } },
    ] })).id,
    v2Page: (await dataset(owner, { version: 2, allow: [READ_ALL, { actions: ['insert'], from: { artifact: page.id } }] })).id,
    v3: (await dataset(owner, enforced(null))).id,
    invalid: (await dataset(owner, DEFAULT)).id,
  };
  // Already shared as editor: the migration never lowers it.
  await updateSharingFor(owner, ids.v2Named, { shares: [{ email: sharedEditor.email!, role: 'editor' }] });
  await sql('UPDATE artifacts SET dataset_policy=$2 WHERE id=$1', [ids.invalid, JSON.stringify({ version: 2, allow: 'everyone' })]);
  return { owner, reader, writer, sharedEditor, page, ids };
}

const snapshot = async () => ({
  rows: await sql('SELECT id,dataset_policy,policy_revision,sharing_revision,access FROM artifacts WHERE format=$1 ORDER BY id', ['dataset']),
  audit: await sql('SELECT dataset_id,revision FROM dataset_policy_audit ORDER BY dataset_id,revision'),
  shares: await sql('SELECT artifact_id,email,role,user_id FROM artifact_shares ORDER BY artifact_id,email'),
});
const db = async (): Promise<MigrationDb> => getDb();
const entry = (report: Awaited<ReturnType<typeof migrateDatasetPolicies>>, id: string) => report.datasets.find((d) => d.id === id);

describe('migrateDatasetPolicies', () => {
  it('dry run: reports every shape, code, share and refusal by ID, and writes nothing', async () => {
    const f = await fixture();
    const before = await snapshot();
    const report = await migrateDatasetPolicies(await db(), { apply: false });
    expect(await snapshot()).toEqual(before);
    expect(report).toMatchObject({
      mode: 'dry-run', scanned: 9,
      counts: {
        source: { none: 1, v1: 3, v2: 3, v3: 1 },
        outcome: { planned: 7, already_v3: 1, invalid_policy: 1 },
        code: { anonymous_write: 2, private_viewer_only: 1, private_page_reads: 1, functions_dropped: 1, read_named_user: 1, write_named_user: 1, write_page_scoped: 1, share_unresolved: 1 },
        shares: { editor: 1, viewer: 1 },
        accessToReadwrite: 3,
      },
    });
    expect(entry(report, f.ids.v2Named)).toEqual({
      id: f.ids.v2Named, source: 'v2', outcome: 'planned',
      items: [
        { code: 'read_named_user', subjects: [f.reader.userId, f.writer.userId, f.sharedEditor.userId, 'usr_gone'] },
        { code: 'write_named_user', subjects: [f.writer.userId, f.sharedEditor.userId] },
        { code: 'share_unresolved', subjects: ['usr_gone'] },
      ],
      shares: [{ userId: f.writer.userId, role: 'editor' }, { userId: f.reader.userId, role: 'viewer' }],
    });
    expect(entry(report, f.ids.v2Page)?.items).toEqual([{ code: 'write_page_scoped', subjects: [f.page.id] }]);
    expect(entry(report, f.ids.invalid)).toMatchObject({ outcome: 'invalid_policy', error: expect.any(String) });
    // Clean rewrites are counted, not listed; everything reported needs the owner.
    expect(entry(report, f.ids.none)).toBeUndefined();
    expect(entry(report, f.ids.v2Default)).toBeUndefined();
    expect(report.attention.sort()).toEqual([f.ids.v1, f.ids.v1Private, f.ids.v1Functions, f.ids.v2Named, f.ids.v2Page, f.ids.invalid].sort());
    // IDs only: no emails or titles.
    expect(JSON.stringify(report)).not.toMatch(/@example\.test|"Data"|"App"/);
  });

  it('apply: stores the enforced v3, the access column and the shares, with a bumped revision and a system audit row', async () => {
    const f = await fixture();
    const before = new Map((await snapshot()).rows.map((r) => [r.id, r]));
    const report = await migrateDatasetPolicies(await db(), { apply: true });
    expect(report.counts.outcome).toEqual({ migrated: 7, already_v3: 1, invalid_policy: 1 });
    for (const id of [f.ids.none, f.ids.v1, f.ids.v1Private, f.ids.v1Functions, f.ids.v2Default, f.ids.v2Named, f.ids.v2Page]) {
      const was = before.get(id)!, now = await head(id);
      expect(now.dataset_policy).toEqual(enforced(was.dataset_policy, now.visibility));
      expect(now.policy_revision).toBe((was.policy_revision as number) + 1);
      expect(await sql('SELECT actor_user_id,actor_token_id,policy FROM dataset_policy_audit WHERE dataset_id=$1 AND revision=$2', [id, now.policy_revision])).toEqual([{ actor_user_id: null, actor_token_id: null, policy: now.dataset_policy }]);
    }
    expect((await head(f.ids.v1Functions)).dataset_policy).not.toHaveProperty('execution');
    // v2 never read `access`; v3 does, so migrated v2 datasets open it. None and v1 keep theirs.
    for (const id of [f.ids.v2Default, f.ids.v2Named, f.ids.v2Page]) expect((await head(id)).access).toBe('readwrite');
    expect((await head(f.ids.none)).access).toBe('readwrite');
    for (const id of [f.ids.v1, f.ids.v1Private, f.ids.v1Functions]) expect((await head(id)).access).toBe(before.get(id)!.access);
    expect(await sql('SELECT email,role,user_id FROM artifact_shares WHERE artifact_id=$1 ORDER BY email', [f.ids.v2Named])).toEqual([
      { email: 'editor@example.test', role: 'editor', user_id: null },
      { email: 'reader@example.test', role: 'viewer', user_id: f.reader.userId },
      { email: 'writer@example.test', role: 'editor', user_id: f.writer.userId },
    ]);
    expect((await head(f.ids.v2Named)).sharing_revision).toBe((before.get(f.ids.v2Named)!.sharing_revision as number) + 1);
    expect((await head(f.ids.v3)).policy_revision).toBe(before.get(f.ids.v3)!.policy_revision);
    expect((await head(f.ids.invalid)).dataset_policy).toEqual({ version: 2, allow: 'everyone' });
  });

  it('keeps every named person\'s access through the share once the policy is v3', async () => {
    const f = await fixture();
    const decisions = async (who: Account) => ({
      read: (await datasetReadAccess(await head(f.ids.v2Named), who)).allowed,
      write: (await datasetWriteAccess(await head(f.ids.v2Named), who)).allowed,
    });
    const people = [f.owner, f.reader, f.writer, f.sharedEditor];
    const pre = await Promise.all(people.map(decisions));
    await migrateDatasetPolicies(await db(), { apply: true });
    expect((await head(f.ids.v2Named)).dataset_policy).toMatchObject({ version: 3 });
    expect(await Promise.all(people.map(decisions))).toEqual(pre);
    expect(pre[2]).toEqual({ read: true, write: true });
    expect(pre[1]).toEqual({ read: true, write: false });
  });

  it('is idempotent: a second apply changes nothing and lists only what it still cannot rewrite', async () => {
    const f = await fixture();
    await migrateDatasetPolicies(await db(), { apply: true });
    const after = await snapshot();
    const again = await migrateDatasetPolicies(await db(), { apply: true });
    expect(await snapshot()).toEqual(after);
    expect(again.counts.outcome).toEqual({ already_v3: 8, invalid_policy: 1 });
    expect(again.datasets.map((d) => d.id)).toEqual([f.ids.invalid]);
  });

  it('is resumable: a limited run takes clean datasets first, and a rerun after a crash finishes the rest', async () => {
    const f = await fixture();
    const first = await migrateDatasetPolicies(await db(), { apply: true, limit: 2 });
    expect(first.counts.outcome.migrated).toBe(2);
    const migrated = (await sql<{ id: string }>(`SELECT id FROM artifacts WHERE format='dataset' AND dataset_policy->>'version'='3' AND id<>$1`, [f.ids.v3])).map((r) => r.id).sort();
    expect(migrated).toEqual([f.ids.none, f.ids.v2Default].sort());

    // The third commit fails mid-run: its transaction rolls back, the others commit, the report names it.
    const real = await getDb();
    let commits = 0;
    const crashing: MigrationDb = {
      query: real.query.bind(real) as Db['query'],
      transaction: (fn) => real.transaction((tx) => fn({ query: async (text: string, params?: unknown[]) => {
        if (text.includes('UPDATE artifacts SET dataset_policy') && ++commits === 3) throw new Error('connection lost');
        return tx.query(text, params);
      } } as never)),
    };
    const crashed = await migrateDatasetPolicies(crashing, { apply: true });
    expect(crashed.counts.outcome).toMatchObject({ migrated: 4, failed: 1 });
    const failed = crashed.datasets.find((d) => d.outcome === 'failed')!;
    expect(failed).toMatchObject({ error: 'connection lost' });
    expect(crashed.attention).toContain(failed.id);
    expect((await head(failed.id)).dataset_policy).not.toMatchObject({ version: 3 });

    const rest = await migrateDatasetPolicies(await db(), { apply: true });
    expect(rest.counts.outcome).toEqual({ migrated: 1, already_v3: 7, invalid_policy: 1 });
    expect((await head(failed.id)).dataset_policy).toMatchObject({ version: 3 });
  });
});
