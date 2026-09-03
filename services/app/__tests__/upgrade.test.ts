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
import { POST as editRoute } from '@/app/api/artifacts/[id]/edits/route';
import { GET as readRoute } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as mintTokenRoute } from '@/app/api/tokens/route';
import { resetRateLimit } from '@/lib/auth';
import { getDb, resetDb } from '@/lib/db';
import { SCHEMA_STATEMENTS } from '@/lib/schema';
import { request } from '@/__tests__/harness';

// harness-exempt: reset builds fresh PGlite databases to test schema replay and upgrade behavior
// harness-exempt: wipe clears the deliberately hand-built schema between upgrade scenarios

const BASE = 'http://localhost:3000';
const SECRET = 'test-secret';

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

interface Wire { id: string; edit_id: string; markup: string | null; version: number }

const mint = async (): Promise<string> => {
  const res = await mintTokenRoute(request('/api/tokens', { method: 'POST', json: { name: 't' }, headers: { ...(SECRET ? { 'x-shared-secret': SECRET } : {}) } }));
  return ((await res.json()) as { token: string }).token;
};

beforeEach(async () => {
  resetRateLimit();
  const db = await getDb();
  for (const table of ['artifact_edits', 'artifact_versions', 'artifacts', 'tokens']) {
    await db.query(`DELETE FROM ${table}`);
  }
});

afterAll(async () => {
  await resetDb();
});

describe('the additive DDL is replay-safe', () => {
  it('preserves a pre-lifecycle token with the new lifecycle columns NULL', async () => {
    const legacy = new PGlite();
    try {
      await legacy.exec(`
        CREATE TABLE tokens (
          id TEXT PRIMARY KEY,
          token_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        INSERT INTO tokens (id, token_hash) VALUES ('tok_legacy', 'legacy-hash');
      `);
      for (const stmt of SCHEMA_STATEMENTS) await legacy.exec(stmt);
      const rows = await legacy.query<{ id: string; expires_at: Date | null; last_used_at: Date | null; audience: string | null; scope: string | null }>(
        'SELECT id, expires_at, last_used_at, audience, scope FROM tokens WHERE id = $1',
        ['tok_legacy'],
      );
      expect(rows.rows).toEqual([{ id: 'tok_legacy', expires_at: null, last_used_at: null, audience: null, scope: null }]);
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

    for (const table of ['artifacts', 'artifact_versions', 'artifact_edits', 'annotations', 'tokens', 'users']) {
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
      'id', 'seq', 'artifact_id', 'root_id', 'body',
      'author_kind', 'author_token_id', 'author_user_id', 'author_label',
      'author_transport',
      'status', 'resolved_at', 'anchor_key', 'anchor_version', 'snippet', 'created_at',
      // The exact selection, appended LAST: an older database grows these two
      // by ALTER TABLE on boot, so their ordinal position is after created_at.
      'quote', 'range',
    ]);
    // Provenance is APPENDED, never inserted: a fork's parent is a column the
    // additive DDL adds on the next boot, with nothing to backfill (NULL is
    // "authored here", which every existing row is).
    const artifactColumns = await fresh.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'artifacts'
       ORDER BY ordinal_position`,
    );
    expect(artifactColumns.rows.map((row) => row.column_name)).toEqual(expect.arrayContaining(['forked_from']));
    expect(artifactColumns.rows[artifactColumns.rows.length - 1].column_name).toBe('forked_from');
    const tokenColumns = await fresh.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'tokens'`,
    );
    expect(tokenColumns.rows.map((row) => row.column_name)).toEqual(expect.arrayContaining(['client_harness', 'audience', 'scope']));
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
      await fresh.query('INSERT INTO artifacts (id, token_id, content) VALUES ($1, $2, $3)', [id, 'tok_x', '<p>x</p>']);
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
      request('/api/artifacts', { method: 'POST', token: token, json: { title: 'after replay', markup: '<section><p>alpha text</p></section>' } }),
    );
    expect(res.status).toBe(201);
    const doc = (await res.json()) as Wire;
    expect(doc.id).toMatch(/^[a-zA-Z0-9]{6}$/);

    const read = await readRoute(request(`/api/artifacts/${doc.id}`, { token: token }), params({ id: doc.id }));
    expect(read.status).toBe(200);
    expect((await read.json()).markup).toContain('alpha text');
  });
});

describe('an artifact whose edit log has been pruned', () => {
  /** Trim the log the way pruning does, leaving a row with no entries at all. */
  async function withPrunedLog(token: string): Promise<Wire> {
    const res = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: token, json: { title: 'pruned', markup: '<section><p>alpha text</p><p>beta text</p></section>' } }),
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
    expect((await read.json()).markup).toContain('alpha text');
  });

  it('accepts an edit on its head with no log rows (the head fast path needs no log)', async () => {
    const token = await mint();
    const doc = await withPrunedLog(token);
    const res = await editRoute(
      request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: token, json: { edit_id: doc.edit_id, old_string: 'alpha text', new_string: 'ALPHA' } }),
      params({ id: doc.id }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as Wire).markup).toContain('ALPHA');
  });

  it('SELF-HEALS a stale base instead of looping: reject once, then the re-read works', async () => {
    const token = await mint();
    const doc = await withPrunedLog(token);
    // Someone else moves head first, so the caller's base is now stale AND
    // unresolvable (there is no log entry to reconstruct that version from).
    const first = await editRoute(
      request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: token, json: { edit_id: doc.edit_id, old_string: 'beta text', new_string: 'BETA' } }),
      params({ id: doc.id }),
    );
    expect(first.status).toBe(200);

    const stale = await editRoute(
      request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: token, json: { edit_id: doc.edit_id, old_string: 'alpha text', new_string: 'ALPHA' } }),
      params({ id: doc.id }),
    );
    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body.error).toBe('stale_edit_id');

    // The critical part: retrying on the head it just handed back SUCCEEDS.
    // If it did not, a pruned artifact would be permanently uneditable.
    const retry = await editRoute(
      request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: token, json: { edit_id: body.edit_id, old_string: 'alpha text', new_string: 'ALPHA' } }),
      params({ id: doc.id }),
    );
    expect(retry.status).toBe(200);
    const final = (await retry.json()) as Wire;
    expect(final.markup).toContain('ALPHA');
    expect(final.markup).toContain('BETA');
  });

  it('a second document with a pruned log edits too', async () => {
    const token = await mint();
    const res = await createArtifactRoute(
      request('/api/artifacts', { method: 'POST', token: token, json: { title: 'h', markup: '<h1>hello</h1>' } }),
    );
    const doc = (await res.json()) as Wire;
    const db = await getDb();
    await db.query('DELETE FROM artifact_edits WHERE artifact_id = $1', [doc.id]);

    const edit = await editRoute(
      request(`/api/artifacts/${doc.id}/edits`, { method: 'POST', token: token, json: { edit_id: doc.edit_id, old_string: 'hello', new_string: 'goodbye' } }),
      params({ id: doc.id }),
    );
    expect(edit.status).toBe(200);
    expect((await edit.json()).markup).toContain('goodbye');
  });
});
