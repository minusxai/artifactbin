import {nativeHtml} from '@/__tests__/native-html-fixture';
import {artifactState} from '@/lib/artifacts';
import {getArtifactById} from '@/lib/artifacts';
/**
 * SCHEMA REPLAY SAFETY — the boot path, not the fresh-install path.
 *
 * The whole migration story is ADDITIVE DDL applied to the CURRENT schema on
 * every boot (`CREATE TABLE IF NOT EXISTS` + per-column `ALTER TABLE ... ADD
 * COLUMN IF NOT EXISTS`). There is deliberately no legacy upgrade path: this
 * is a pre-production service, so breaking changes replace old shapes outright
 * rather than being migrated forward. What must hold is narrower and runs on
 * every single start-up — replaying the statements against a database that
 * already has them must be a no-op, and the service must work afterwards.
 *
 * The second half covers a row with NO entries in `artifact_edits`. That is
 * not a legacy artifact — the edit log is prunable by design, so any document
 * whose log has been trimmed reaches exactly this state, and the head fast
 * path has to keep working without a log to read.
 */
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { artifactPage } from '@/test/helpers/pages';
import { PUT as editRoute } from '@/app/api/artifacts/[id]/route';
import { GET as readRoute } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { mintAccountToken } from '@/__tests__/harness';
import { resetAllowances } from '@/lib/allowances';
import { getDb, resetDb } from '@/lib/platform';
import { SCHEMA_STATEMENTS } from '@/lib/platform';
import { ensureIdentitySchema } from '@artifactbin/auth/identity-store';
import type { Queryable, TransactionalQueryable } from '@artifactbin/contracts';
import { request } from '@/__tests__/harness';

// harness-exempt: reset builds fresh PGlite databases to test schema replay and upgrade behavior
// harness-exempt: wipe clears the deliberately hand-built schema between upgrade scenarios


const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

interface Wire { id: string; edit_id: string; html: string | null; version: number }

const mint = async (): Promise<string> => {
  return (await mintAccountToken('mxmx_test_fixture')).token;
};

beforeEach(async () => {
  resetAllowances();
  const db = await getDb();
  for (const table of ['artifact_edits', 'artifact_versions', 'artifacts', 'tokens']) {
    await db.query(`DELETE FROM ${table}`);
  }
});

afterAll(async () => {
  await resetDb();
});

describe('the additive DDL is replay-safe', () => {
  it('moves identity tables left in the app schema into the identity module\'s, rows and indexes kept, new columns NULL, reads through the views', async () => {
    const legacy = new PGlite();
    try {
      // A database from before the identity module owned its tables: tokens, users and a group in the app's schema.
      await legacy.exec(`
        CREATE TABLE tokens (
          id TEXT PRIMARY KEY,
          token_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX idx_tokens_hash ON tokens (token_hash);
        INSERT INTO tokens (id, token_hash) VALUES ('tok_legacy', 'legacy-hash');
        CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, kind TEXT NOT NULL DEFAULT 'account');
        INSERT INTO users (id, email) VALUES ('usr_legacy', 'legacy@example.com');
        CREATE TABLE groups (id TEXT PRIMARY KEY, handle TEXT NOT NULL, name TEXT NOT NULL, created_by TEXT NOT NULL);
        INSERT INTO groups (id, handle, name, created_by) VALUES ('grp_legacy', 'legacy', 'Legacy', 'usr_legacy');
      `);
      for (const stmt of SCHEMA_STATEMENTS) await legacy.exec(stmt);
      const db = { query: legacy.query.bind(legacy), transaction: <T,>(fn: (tx: Queryable) => Promise<T>) => legacy.transaction((tx) => fn(tx as unknown as Queryable)) } as unknown as TransactionalQueryable;
      const schemas = { auth: 'auth', app: 'public', read: 'identity' };
      await ensureIdentitySchema(db, schemas);
      // Replayed, as on every boot: a no-op.
      await ensureIdentitySchema(db, schemas);
      await legacy.exec("SET search_path TO public, identity");
      const where = await legacy.query<{ schema: string; name: string; kind: string }>(
        "SELECT n.nspname AS schema, c.relname AS name, c.relkind::text AS kind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname IN ('tokens','users','groups') AND n.nspname IN ('public','auth','identity') ORDER BY 1, 2");
      expect(where.rows).toEqual([
        { schema: 'auth', name: 'groups', kind: 'r' }, { schema: 'auth', name: 'tokens', kind: 'r' }, { schema: 'auth', name: 'users', kind: 'r' },
        { schema: 'identity', name: 'groups', kind: 'v' }, { schema: 'identity', name: 'tokens', kind: 'v' }, { schema: 'identity', name: 'users', kind: 'v' },
      ]);
      const rows = await legacy.query<{ id: string; expires_at: Date | null; last_used_at: Date | null; audience: string | null; scope: string | null }>(
        'SELECT id, expires_at, last_used_at, audience, scope FROM tokens WHERE id = $1',
        ['tok_legacy'],
      );
      expect(rows.rows).toEqual([{ id: 'tok_legacy', expires_at: null, last_used_at: null, audience: null, scope: null }]);
      expect((await legacy.query('SELECT id, email FROM users')).rows).toEqual([{ id: 'usr_legacy', email: 'legacy@example.com' }]);
      expect((await legacy.query('SELECT id, deleted_at, parent_id FROM groups')).rows).toEqual([{ id: 'grp_legacy', deleted_at: null, parent_id: null }]);
      // The index moved with its table; the hash is the base table's alone.
      expect((await legacy.query("SELECT schemaname FROM pg_indexes WHERE indexname = 'idx_tokens_hash'")).rows).toEqual([{ schemaname: 'auth' }]);
      await expect(legacy.query('SELECT token_hash FROM tokens')).rejects.toThrow(/token_hash/);
    } finally {
      await legacy.close();
    }
  });

  it('applies twice to a fresh database with no error, leaving the tables in place', async () => {
    // A throwaway instance so the replay is observed in isolation, exactly as
    // it happens on a cold boot.
    const fresh = new PGlite();
    for (const stmt of SCHEMA_STATEMENTS) await fresh.exec(stmt);
    // The second pass is the one that matters: it runs on every restart.
    for (const stmt of SCHEMA_STATEMENTS) await fresh.exec(stmt);

    for (const table of ['artifacts', 'artifact_versions', 'artifact_edits', 'annotations']) {
      const present = await fresh.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1',
        [table],
      );
      expect(present.rows[0].n, `${table} must survive the replay`).toBe(1);
    }

    const annotationColumns = await fresh.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'annotations'
       ORDER BY ordinal_position`,
    );
    expect(annotationColumns.rows.map((row) => row.column_name)).toEqual([
      'revision', 'id', 'seq', 'artifact_id', 'root_id', 'body',
      'author_kind', 'author_token_id', 'author_user_id', 'author_label',
      'author_transport',
      'status', 'resolved_at', 'anchor_key', 'anchor_version', 'snippet', 'created_at',
      // The exact selection, appended after created_at: an older database grows
      // these two by ALTER TABLE on boot, so their ordinal position follows it.
      'quote', 'range','html_anchor',
      // Saved UI context is optional; ordinary comments keep this column NULL.
      'view_state',
      // The soft-delete stamp every adopted table carries, appended LAST for
      // the same reason. Nothing writes it on this table yet (a comment is
      // erased, not trashed); the gate in lib/annotations is what it buys.
      'deleted_at', 'author_remote',
      // When the author last rewrote the body; appended on upgrade like the rest.
      'edited_at',
    ]);
    // Provenance is APPENDED, never inserted: a fork's parent is a column the
    // additive DDL adds on the next boot, with nothing to backfill (NULL is
    // "authored here", which every existing row is).
    const artifactColumns = await fresh.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'artifacts'
       ORDER BY ordinal_position`,
    );
    expect(artifactColumns.rows.map((row) => row.column_name)).toEqual(expect.arrayContaining(['forked_from', 'deleted_at']));
    // The LAST column is whatever was appended most recently — the trash stamp
    // now, provenance before it. What the assertion is really about is that
    // new columns go on the END, so an existing database grows them by ALTER
    // rather than needing its rows rewritten.
    expect(artifactColumns.rows.slice(-2).map((row) => row.column_name)).toEqual(['forked_from', 'deleted_at']);
    // Identity's tables are not the app's to declare.
    expect((await fresh.query("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN ('tokens','users','groups')")).rows).toEqual([]);
    await fresh.close();
  });

  it('gives every row its OWN edit_id — the default is per-row, not one shared secret', async () => {
    const fresh = new PGlite();
    for (const stmt of SCHEMA_STATEMENTS) await fresh.exec(stmt);

    // Rows written without an explicit head pointer fall to the column
    // default. A CONSTANT default would hand every artifact the same head,
    // and one caller's edit_id would then be a valid write proof for every
    // document in the database.
    for (const id of ['aaa111', 'bbb222', 'ccc333']) {
      await fresh.query('INSERT INTO artifacts (id, token_id) VALUES ($1, $2)', [id, 'tok_x']);
    }
    const rows = await fresh.query<{ edit_id: string }>('SELECT edit_id FROM artifacts ORDER BY id');
    const heads = rows.rows.map((r) => r.edit_id);
    expect(heads).toHaveLength(3);
    expect(new Set(heads).size).toBe(3);
    for (const head of heads) expect(head).toBeTruthy();

    // Replaying the DDL must not disturb heads that already exist.
    for (const stmt of SCHEMA_STATEMENTS) await fresh.exec(stmt);
    const again = await fresh.query<{ edit_id: string }>('SELECT edit_id FROM artifacts ORDER BY id');
    expect(again.rows.map((r) => r.edit_id)).toEqual(heads);
    await fresh.close();
  });

  it('leaves the live database serving after the statements are re-applied to it', async () => {
    const db = await getDb();
    // The real boot path, run a second time against the database the route
    // handlers below are about to use.
    for (const stmt of SCHEMA_STATEMENTS) await db.query(stmt);

    const token = await mint();
    const res = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: token, json: { visibility: 'public', title: 'after replay', html:nativeHtml('<section><p>alpha text</p></section>') } }),
    );
    expect(res.status).toBe(201);
    const doc = (await res.json()) as Wire;
    expect(doc.id).toMatch(/^[a-zA-Z0-9]{6}$/);

    const read = await readRoute(request(`/api/artifacts/${doc.id}`, { token: token }), params({ id: doc.id }));
    expect(read.status).toBe(200);
    expect((await read.json()).html).toContain('alpha text');
  });
});

describe('an artifact whose edit log has been pruned', () => {
  /** Trim the log the way pruning does, leaving a row with no entries at all. */
  async function withPrunedLog(token: string): Promise<Wire> {
    const res = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: token, json: { visibility: 'public', title: 'pruned', html:nativeHtml('<section><p>alpha text</p><p>beta text</p></section>') } }),
    );
    expect(res.status).toBe(201);
    const doc = (await res.json()) as Wire;
    const db = await getDb();
    await db.query('DELETE FROM artifact_edits WHERE artifact_id = $1', [doc.id]);
    return doc;
  }

  it('still serves its page', async () => {
    const token = await mint();
    const doc = await withPrunedLog(token);
    // The page's data must resolve on a row with no reconstructable history
    // behind its head — it renders, rather than 404ing or throwing.
    expect((await artifactPage(doc.id)).kind).toBe('render');
    const read = await readRoute(request(`/api/artifacts/${doc.id}`, { token: token }), params({ id: doc.id }));
    expect(read.status).toBe(200);
    expect((await read.json()).html).toContain('alpha text');
  });

  it('accepts an edit on its head with no log rows (the head fast path needs no log)', async () => {
    const token = await mint();
    const doc = await withPrunedLog(token);
    const res = await editRoute(
      request(`/api/artifacts/${doc.id}`, { method: 'PUT', token: token, json: await replacement(doc.id,'alpha text','ALPHA') }),
      params({ id: doc.id }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as Wire).html).toContain('ALPHA');
  });

  it('rejects stale whole-file saves even when history has been pruned',async()=>{
    const token=await mint(),doc=await withPrunedLog(token),base=(await getArtifactById(doc.id))!;
    const submit=(html:string)=>editRoute(request(`/api/artifacts/${doc.id}`,{method:'PUT',token,json:{html,expectedVersion:base.version,expectedState:artifactState(base)}}),params({id:doc.id}));
    expect((await submit(base.source!.replace('beta text','BETA'))).status).toBe(200);
    const independent=await submit(base.source!.replace('alpha text','ALPHA'));expect(independent.status).toBe(409);
    const read=await readRoute(request(`/api/artifacts/${doc.id}`,{token}),params({id:doc.id}));
    const head=await read.json();expect(head.html).toContain('BETA');expect(head.html).not.toContain('ALPHA');expect(head.version).toBe(2);
  });

  it('a second document with a pruned log edits too', async () => {
    const token = await mint();
    const res = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: token, json: { title: 'h', html:nativeHtml('<h1>hello</h1>') } }),
    );
    const doc = (await res.json()) as Wire;
    const db = await getDb();
    await db.query('DELETE FROM artifact_edits WHERE artifact_id = $1', [doc.id]);

    const edit = await editRoute(
      request(`/api/artifacts/${doc.id}`, { method: 'PUT', token: token, json: await replacement(doc.id,'hello','goodbye') }),
      params({ id: doc.id }),
    );
    expect(edit.status).toBe(200);
    expect((await edit.json()).html).toContain('goodbye');
  });
});

async function replacement(id:string,old:string,value:string){const row=(await getArtifactById(id))!;return {html:row.source!.replace(old,value),expectedVersion:row.version,expectedState:artifactState(row)};}
