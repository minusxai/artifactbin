/**
 * THE AUTHORIZATION LOCKS on a real PostgreSQL 17 (a disposable `postgres:17-alpine`), across two connections: what
 * PGLite (one serialized connection) can never interleave. The guarded side is the production code: the artifact
 * locks (`lockAuthorization`), then the decision's facts (`transactionAccessFacts`, each locking what it reads).
 *
 *  - Correctness: a revocation of a fact the decision read waits for its commit; one committed first is what the
 *    decision reads.
 *  - The normal path: the global order (page first, artifacts by `lockOrder`, memberOf documents in the page tier,
 *    read-only facts) never deadlocks against sharing edits, publishing or a second reader of the same page.
 *  - The safety net: writers that cannot follow it (group-owned publish, group deletion, test-user erasure) can
 *    deadlock with a guarded write; with both sides' whole transactions under lib/platform `retryOnConflict`, both
 *    complete, and the guarded decision is the one the state it finally read gives.
 *
 * Only the tables and columns these statements touch are created. Runs in the `integration` project; skipped
 * without the image.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { Queryable } from '@artifactbin/contracts';
import { retryOnConflict } from '@/lib/platform';
import { datasetWriteAccess } from '@/lib/dataset-permissions';
import type { ArtifactRow } from '../scopes';
import { transactionAccessFacts } from '../access-facts';
import { lockAuthorization, lockOrder } from '../locks';

const dockerAvailable = spawnSync('docker', ['image', 'inspect', 'postgres:17-alpine'], { stdio: 'ignore' }).status === 0;
const ACTOR = { userId: 'u1', tokenId: null, email: null, documentEditor: false };

describe.skipIf(!dockerAvailable)('authorization locks on PostgreSQL', () => {
  let container = '', port = 0;
  const clients: pg.Client[] = [];
  const connect = async () => { const c = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'pw', database: 'postgres' }); await c.connect(); clients.push(c); return c; };
  const tx = (c: pg.Client, before?: (sql: string) => Promise<void>): Queryable => ({ query: async (sql: string, args?: unknown[]) => { await before?.(sql); const r = await c.query(sql, args as never[]); return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length }; } } as unknown as Queryable);
  /** Whether `p` settles within `ms`. */
  const settles = (p: Promise<unknown>, ms: number) => Promise.race([p.then(() => true, () => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);
  /** One whole transaction on `c`: BEGIN, the work, COMMIT; ROLLBACK and rethrow on any failure. */
  const transaction = async <T,>(c: pg.Client, work: () => Promise<T>): Promise<T> => {
    await c.query('BEGIN');
    try { const out = await work(); await c.query('COMMIT'); return out; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  };
  const code = (e: { code?: string }) => e.code ?? String(e);
  /** This disposable server's own rows, reset per case (not the app harness database). */
  const seed = async () => {
    await clients[0]!.query(`TRUNCATE artifact_group_shares, artifact_shares, group_members, groups, users, artifacts;
      INSERT INTO artifacts VALUES ('page'), ('data'), ('data2'), ('Bdata'), ('adata'); INSERT INTO users VALUES ('u1', 'u1@example.com', 'account');
      INSERT INTO groups VALUES ('g1', NULL); INSERT INTO group_members VALUES ('g1', 'u1', 'viewer');
      INSERT INTO artifact_shares VALUES ('page', 'u1', 'u1@example.com', 'viewer'); INSERT INTO artifact_group_shares VALUES ('data', 'g1', 'editor');`);
  };

  beforeAll(async () => {
    container = execFileSync('docker', ['run', '--rm', '-d', '-e', 'POSTGRES_PASSWORD=pw', '-p', '127.0.0.1::5432', 'postgres:17-alpine', '-c', 'deadlock_timeout=100ms'], { encoding: 'utf8' }).trim();
    port = Number(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }).trim().split('\n')[0]!.split(':').at(-1));
    for (let attempt = 0; ; attempt++) {
      if (spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], { stdio: 'ignore' }).status === 0) {
        try { const c = await connect(); await c.query('select 1'); break; } catch { /* still starting */ }
      }
      if (attempt > 120) throw Error('postgres:17-alpine never became ready');
      await new Promise((r) => setTimeout(r, 500));
    }
    await clients[0]!.query(`
      CREATE TABLE artifacts (id text PRIMARY KEY);
      CREATE TABLE users (id text PRIMARY KEY, email text, kind text);
      CREATE TABLE groups (id text PRIMARY KEY, deleted_at timestamptz);
      CREATE TABLE group_members (group_id text REFERENCES groups(id), user_id text REFERENCES users(id), role text, PRIMARY KEY (group_id, user_id));
      CREATE TABLE artifact_shares (artifact_id text REFERENCES artifacts(id), user_id text, email text, role text, PRIMARY KEY (artifact_id, email));
      CREATE TABLE artifact_group_shares (artifact_id text REFERENCES artifacts(id), group_id text REFERENCES groups(id), role text, PRIMARY KEY (artifact_id, group_id));`);
  }, 120_000);
  afterAll(async () => {
    for (const c of clients) await c.end().catch(() => {});
    if (container) spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
  });

  it('a membership insert cannot revoke the policy used by an in-flight commit', async () => {
    await seed();
    await clients[0]!.query("DELETE FROM group_members; UPDATE artifact_group_shares SET role='viewer'");
    const writer = await connect(), grantor = await connect();
    const row = {
      id: 'data', user_id: 'another-owner', token_id: null, group_id: null,
      format: 'dataset', visibility: 'unlisted', link_role: 'viewer', access: 'readwrite',
      meta: { columns: [{ name: 'name', type: 'string' }], objectKey: 'unused' },
      dataset_policy: { version: 3, tables: [{ table: { schema: 'public', name: 'rows' },
        insert_permissions: [{ role: 'signed_in', permission: { columns: '*', check: {} } }],
      }] },
    } as unknown as ArtifactRow;
    await writer.query('BEGIN');
    try {
      await lockAuthorization(tx(writer), { write: 'data' });
      const before = await datasetWriteAccess(row, ACTOR, { tx: tx(writer) });
      expect(before).toMatchObject({ allowed: true, role: 'signed_in' });
      // Invitation acceptance holds the group before inserting, just as lib/groups does.
      const grant = transaction(grantor, async () => {
        await grantor.query("SELECT id FROM groups WHERE id='g1' FOR UPDATE");
        await grantor.query("INSERT INTO group_members VALUES ('g1', 'u1', 'viewer')");
      });
      const slipped = await settles(grant, 150);
      const after = slipped ? await datasetWriteAccess(row, ACTOR, { tx: tx(writer) }) : before;
      await writer.query('COMMIT');
      await grant;
      expect({ slipped, allowed: after.allowed, role: after.role }).toEqual({
        slipped: false, allowed: true, role: 'signed_in',
      });
    } finally { await writer.query('ROLLBACK'); }
  });

  /**
   * THE ABSENCE AUDIT. Dataset rules match exactly one role, so an INSERT can narrow it: each absent fact the decision
   * reads, inserted the way its production writer inserts it while a write is in flight, must not commit before that
   * write does. Each writer locks a parent row first; the decision holds that row (artifact) or takes it (group).
   */
  it.each([
    // lib/groups acceptGroupInvitations / lib/deployment: the group FOR UPDATE, then the membership.
    ['an owning-group membership', { group_id: 'g3' }, "INSERT INTO groups VALUES ('g3', NULL)", ["SELECT id FROM groups WHERE id='g3' FOR UPDATE", "INSERT INTO group_members VALUES ('g3', 'u1', 'viewer')"]],
    // lib/artifacts writeShares / membership invites: the artifact FOR UPDATE, then the named share.
    ['a named share', {}, '', ["SELECT id FROM artifacts WHERE id='data' FOR UPDATE", "INSERT INTO artifact_shares VALUES ('data', NULL, 'u1@example.com', 'viewer')"]],
    // lib/artifacts setArtifactGroupShare: the artifact FOR UPDATE NOWAIT, then the group share (a group the actor is in).
    ['a group share', {}, "INSERT INTO groups VALUES ('g2', NULL); INSERT INTO group_members VALUES ('g2', 'u1', 'viewer')", ["SELECT id FROM artifacts WHERE id='data' FOR UPDATE NOWAIT", "INSERT INTO artifact_group_shares VALUES ('data', 'g2', 'viewer')"]],
    // lib/artifacts updateSharingFor: link role and visibility live on the artifact row itself.
    ['a link role or visibility change', {}, '', ["SELECT id FROM artifacts WHERE id='data' FOR UPDATE", "UPDATE artifacts SET id = id WHERE id='data'"]],
  ] as const)('an insert of %s cannot narrow the role of an in-flight commit', async (_name, patch, setup, grantSql) => {
    await seed();
    await clients[0]!.query("DELETE FROM group_members; UPDATE artifact_group_shares SET role='viewer'");
    if (setup) await clients[0]!.query(setup);
    const writer = await connect(), grantor = await connect();
    const row = {
      id: 'data', user_id: 'another-owner', token_id: null, group_id: null, ...patch,
      format: 'dataset', visibility: 'unlisted', link_role: 'viewer', access: 'readwrite',
      meta: { columns: [{ name: 'name', type: 'string' }], objectKey: 'unused' },
      dataset_policy: { version: 3, tables: [{ table: { schema: 'public', name: 'rows' }, insert_permissions: [{ role: 'signed_in', permission: { columns: '*', check: {} } }] }] },
    } as unknown as ArtifactRow;
    await writer.query('BEGIN');
    try {
      await lockAuthorization(tx(writer), { write: 'data' });
      const before = await datasetWriteAccess(row, ACTOR, { tx: tx(writer) });
      expect(before).toMatchObject({ allowed: true, role: 'signed_in' });
      const grant = transaction(grantor, async () => { for (const statement of grantSql) await grantor.query(statement); }).then(() => 'ok', code);
      // A grant that waits (or fails fast, NOWAIT) has not slipped in; one that commits now would have.
      const settled = await settles(grant, 150);
      const slipped = settled && (await grant) === 'ok';
      const after = slipped ? await datasetWriteAccess(row, ACTOR, { tx: tx(writer) }) : before;
      await writer.query('COMMIT');
      await grant;
      expect({ slipped, allowed: after.allowed, role: after.role }).toEqual({ slipped: false, allowed: true, role: 'signed_in' });
    } finally { await writer.query('ROLLBACK'); }
  });

  it('a revocation of a fact the decision read waits for its commit', async () => {
    await seed();
    const writer = await connect(), revoker = await connect();
    await writer.query('BEGIN');
    await lockAuthorization(tx(writer), { page: 'page', write: 'data' });
    expect(await transactionAccessFacts(ACTOR, tx(writer)).groupShareRole('data')).toBe('editor');
    const revoke = revoker.query("DELETE FROM group_members WHERE group_id='g1' AND user_id='u1'");
    expect(await settles(revoke, 300)).toBe(false);
    await writer.query('COMMIT');
    await revoke;
    expect((await revoker.query("SELECT 1 FROM group_members WHERE user_id='u1'")).rowCount).toBe(0);
  });

  it('a revocation committed first is what the decision reads', async () => {
    await seed();
    const writer = await connect(), revoker = await connect();
    await revoker.query('BEGIN');
    await revoker.query("DELETE FROM group_members WHERE group_id='g1' AND user_id='u1'");
    await writer.query('BEGIN');
    await lockAuthorization(tx(writer), { page: 'page', write: 'data' });
    const role = transactionAccessFacts(ACTOR, tx(writer)).groupShareRole('data');
    // The membership row is being deleted: the decision waits on it, then reads the committed state.
    expect(await settles(role, 300)).toBe(false);
    await revoker.query('COMMIT');
    expect(await role).toBe('none');
    await writer.query('COMMIT');
  });

  it('the global order never deadlocks against a sharing edit; the old inverted order does', async () => {
    await seed();
    {
      const writer = await connect(), editor = await connect();
      await writer.query('BEGIN'); await editor.query('BEGIN');
      const written = lockAuthorization(tx(writer), { page: 'page', write: 'data' }).then(() => transactionAccessFacts(ACTOR, tx(writer)).namedRole('page')).then(() => writer.query('COMMIT')).then(() => 'ok', code);
      await new Promise((r) => setTimeout(r, 20));
      const edited = editor.query("SELECT id FROM artifacts WHERE id='page' FOR UPDATE").then(() => editor.query("DELETE FROM artifact_shares WHERE artifact_id='page'")).then(() => editor.query('COMMIT')).then(() => 'ok', code);
      const codes = await Promise.all([written, edited]);
      for (const [c, result] of [[writer, codes[0]], [editor, codes[1]]] as const) if (result !== 'ok') await c.query('ROLLBACK');
      expect(codes).toEqual(['ok', 'ok']);
    }
    await seed();
    {
      // The inverted order the guard once used: the page's shares first, then the page.
      const writer = await connect(), editor = await connect();
      await writer.query('BEGIN');
      await writer.query("SELECT 1 FROM artifact_shares WHERE artifact_id='page' FOR SHARE");
      await editor.query('BEGIN');
      await editor.query("SELECT id FROM artifacts WHERE id='page' FOR UPDATE");
      const edited = editor.query("DELETE FROM artifact_shares WHERE artifact_id='page'").then(() => 'ok', code);
      const written = writer.query("SELECT id FROM artifacts WHERE id='page' FOR SHARE").then(() => 'ok', code);
      expect(await Promise.all([written, edited])).toContain('40P01');
      for (const c of [writer, editor]) await c.query('ROLLBACK');
    }
  }, 30_000);

  // Review 4's competing writers: each locks against the global order. The guarded write pauses (first attempt only)
  // right before its decision reads its facts; the competitor takes its first lock and goes for its second.
  it.each([
    // A true cycle: the group FOR UPDATE against the decision's group lock, the dataset against the commit's: one retries.
    ['group-owned publication', "SELECT id FROM groups WHERE id='g1' FOR UPDATE", "SELECT id FROM artifacts WHERE id='data' FOR UPDATE", true],
    // Lock-on-read: the decision has not locked the share yet, so these revoke first and the decision reads that.
    ['group deletion', "SELECT id FROM groups WHERE id='g1' FOR UPDATE", "DELETE FROM artifact_group_shares WHERE group_id='g1'", false],
    ['test-user erasure', "SELECT id FROM users WHERE id='u1' FOR UPDATE", "DELETE FROM artifact_group_shares WHERE artifact_id='data'", false],
  ] as const)('review4: %s and a guarded write both complete under retryOnConflict', async (_name, first, second, cycle) => {
    await seed();
    const writer = await connect(), other = await connect();
    let arrived!: () => void, release!: () => void, paused = false, attempts = 0;
    const reached = new Promise<void>((r) => { arrived = r; }), resume = new Promise<void>((r) => { release = r; });
    // The guarded write: what it decided, and whether the group share still existed in the snapshot it decided on.
    const guarded = retryOnConflict(() => transaction(writer, async () => {
      attempts++;
      await lockAuthorization(tx(writer), { page: 'page', write: 'data' });
      const facts = transactionAccessFacts(ACTOR, tx(writer, async (sql) => { if (!paused && /FROM artifact_group_shares/.test(sql)) { paused = true; arrived(); await resume; } }));
      const role = await facts.groupShareRole('data');
      const share = (await writer.query("SELECT 1 FROM artifact_group_shares WHERE artifact_id='data'")).rowCount;
      return { role, share };
    }));
    await reached;
    let competitorAttempts = 0;
    const competing = retryOnConflict(() => transaction(other, async () => { competitorAttempts++; await other.query(first); await other.query(second); }));
    await new Promise((r) => setTimeout(r, 50));
    release();
    const [{ role, share }] = await Promise.all([guarded, competing]);
    // Both committed (whichever Postgres aborted was retried whole), and the decision matches the state it read.
    expect([role, share]).toEqual(share ? ['editor', 1] : ['none', 0]);
    // A cycle is a real 40P01 that one side survived by retrying its whole transaction.
    expect(attempts + competitorAttempts > 2).toBe(cycle);
  }, 30_000);

  it('review4: memberOf documents are locked in the page tier, before the dataset, so publishing never deadlocks', async () => {
    await seed();
    const writer = await connect(), publisher = await connect();
    await writer.query('BEGIN'); await publisher.query('BEGIN');
    // A direct dataset mutation whose user column names the page in memberOf: the commit's plan names it.
    await lockAuthorization(tx(writer), { write: 'data', documents: ['page'] });
    const published = publisher.query("SELECT id FROM artifacts WHERE id='page' FOR UPDATE").then(() => publisher.query("SELECT id FROM artifacts WHERE id='data' FOR UPDATE")).then(() => 'ok', code);
    expect(await settles(published, 100)).toBe(false);
    // The validation's own lock (lib/datasets memberIds) re-takes what the plan holds.
    const validated = writer.query('SELECT id FROM artifacts WHERE id=ANY($1::text[]) ORDER BY id COLLATE "C" FOR SHARE', [['page']]).then(() => writer.query('COMMIT')).then(() => 'ok', code);
    expect(await Promise.all([validated, published])).toEqual(['ok', 'ok']);
    await publisher.query('COMMIT');
  });

  it('review4: two guarded readers of one page never upgrade a share lock (facts are read-only)', async () => {
    await seed();
    await clients[0]!.query("UPDATE artifact_shares SET user_id=NULL WHERE artifact_id='page'");
    const a = await connect(), b = await connect();
    const read = (c: pg.Client, write: string) => transaction(c, async () => {
      await lockAuthorization(tx(c), { page: 'page', write });
      // An unresolved invitation (matched by the account's email): read, never stamped inside the transaction.
      return transactionAccessFacts(ACTOR, tx(c, async (sql) => { if (/^\s*UPDATE/i.test(sql)) throw Error(`a decision wrote: ${sql}`); })).namedRole('page');
    });
    expect(await Promise.all([read(a, 'data'), read(b, 'data2')])).toEqual(['viewer', 'viewer']);
  });

  it('review4: publishing and authorization take mixed-case dataset ids in the one lockOrder', async () => {
    await seed();
    await clients[0]!.query("INSERT INTO artifacts VALUES ('page2')");
    const ids = ['Bdata', 'adata'];
    expect([...ids].sort(lockOrder)).toEqual(['Bdata', 'adata']);
    expect([...ids].sort(lockOrder)).not.toEqual([...ids].sort((x, y) => x.localeCompare(y)));
    const writer = await connect(), publisher = await connect();
    await writer.query('BEGIN'); await publisher.query('BEGIN');
    // The guarded write pauses between its two dataset locks; another page's publish (lib/artifacts
    // bindCurrentUserScopes: its own page, then the datasets by lockOrder) then goes for both datasets.
    let arrived!: () => void, release!: () => void, datasets = 0;
    const reached = new Promise<void>((r) => { arrived = r; }), resume = new Promise<void>((r) => { release = r; });
    const guarded = lockAuthorization(tx(writer, async (sql) => { if (/FROM artifacts/.test(sql) && ++datasets === 3) { arrived(); await resume; } }), { page: 'page', write: 'Bdata', read: ids })
      .then(() => writer.query('COMMIT')).then(() => 'ok', code);
    await reached;
    const published = (async () => {
      await publisher.query("SELECT id FROM artifacts WHERE id='page2' FOR UPDATE");
      for (const id of [...ids].sort(lockOrder)) await publisher.query('SELECT id FROM artifacts WHERE id=$1 FOR UPDATE', [id]);
      await publisher.query('COMMIT');
    })().then(() => 'ok', code);
    await new Promise((r) => setTimeout(r, 100));
    release();
    const codes = await Promise.all([guarded, published]);
    for (const [c, result] of [[writer, codes[0]], [publisher, codes[1]]] as const) if (result !== 'ok') await c.query('ROLLBACK');
    expect(codes).toEqual(['ok', 'ok']);
  });
});
