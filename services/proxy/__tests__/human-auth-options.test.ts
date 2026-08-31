/**
 * humanAuthOptions IS THE OPTIONS, AND NOTHING ELSE (P2 §G.3). The schema
 * renderer and the runtime (createHumanAuth) must build
 * Better Auth's config from ONE object — a renderer that holds a copy of
 * fifty load-bearing options is a copy that drifts. So the options builder is
 * PURE: no schema opened, no migration run, no discovery fetched. Everything
 * with a side effect stays in createHumanAuth.
 */
import { PGlite } from '@electric-sql/pglite';
import { Kysely } from 'kysely';
import { KyselyPGlite } from 'kysely-pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { humanAuthOptions } from '../src/auth/human';

let pg: PGlite;
beforeAll(async () => { pg = new PGlite(); });
afterAll(async () => { await pg.close(); });

describe('humanAuthOptions', () => {
  it('is pure: it opens no schema, runs no migration and fetches no discovery', async () => {
    const before = await pg.query<{ nspname: string }>("select nspname from pg_namespace where nspname not in ('pg_catalog','information_schema','pg_toast')");
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('humanAuthOptions must not fetch'));
    const dialect = new KyselyPGlite(pg as ConstructorParameters<typeof KyselyPGlite>[0]).dialect;
    const db = new Kysely<Record<string, unknown>>({ dialect });
    const options = humanAuthOptions(
      {
        secret: 'pure-secret'.padEnd(32, '0'), baseURL: 'http://localhost:4794', mail: { send: async () => {} },
        // Explicit endpoints on purpose: a discoveryUrl would make the purity of this function the only thing standing between boot and a network call.
        oidc: { providerId: 'acme', clientId: 'cid', clientSecret: 'sec', authorizationUrl: 'http://127.0.0.1:1/authorize', tokenUrl: 'http://127.0.0.1:1/token' },
      },
      db.withSchema('auth'),
    );
    expect(options).toBeTruthy();
    expect(options.baseURL).toBe('http://localhost:4794');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    const after = await pg.query<{ nspname: string }>("select nspname from pg_namespace where nspname not in ('pg_catalog','information_schema','pg_toast')");
    expect(after.rows.map((r) => r.nspname)).toEqual(before.rows.map((r) => r.nspname));
    expect((await pg.query<{ n: string }>("select count(*)::text n from information_schema.tables where table_schema = 'auth'")).rows[0].n).toBe('0');
  });
});
