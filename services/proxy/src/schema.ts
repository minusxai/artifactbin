/**
 * THE PROXY'S OWN TABLES — one table, in the proxy's schema. `tokens` is the
 * APP's (lib/schema declares it; this package only SELECTs it through utils'
 * createTokenReader), and the doors are in-memory, so the one table the proxy
 * owns is `codes`: its one-time OAuth codes (and nothing else — the app owns
 * an identical `app.codes` for its own kinds; same DDL, one owner each).
 *
 * Declared as data and rendered by utils' `renderSchema`/`ensureTable` — the
 * same additive story as the app's schema, and the same source
 * `scripts/render-schema.mjs` reads for SCHEMA.sql.
 */
import type { Queryable, Table } from '@artifactbin/contracts';
import { ensureTable } from '@artifactbin/utils';

export const PROXY_TABLES: Table[] = [
  {
    name: 'codes',
    columns: [
      { name: 'kind', type: 'TEXT', notNull: true },
      { name: 'code_hash', type: 'TEXT', notNull: true }, // sha256 hex; plaintext never stored
      { name: 'subject', type: 'TEXT' }, // what the code is bound to; NULL = unbound (oauth)
      { name: 'payload', type: 'JSONB', notNull: true, default: "'{}'" }, // handed back on claim
      { name: 'attempts', type: 'INTEGER', notNull: true, default: '0' }, // guess counter; only subject-lookup kinds use it
      { name: 'expires_at', type: 'TIMESTAMPTZ', notNull: true },
      { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
    ],
    primaryKey: ['kind', 'code_hash'],
    indexes: [
      // One live code per subject; re-issue supersedes. NULL subjects never collide, so unbound kinds insert freely.
      { name: 'idx_codes_kind_subject', columns: ['kind', 'subject'], unique: true },
    ],
  },
];

/**
 * Applied on every boot, additive. The schema itself is asked-for before it is
 * created (`CREATE SCHEMA` needs a privilege a least-privileged deployment has
 * no reason to grant when the schema was made for it) — the same rule
 * createHumanAuth holds.
 */
export async function ensureProxySchema(db: Queryable, schema = 'auth'): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`ensureProxySchema: schema ${JSON.stringify(schema)} is not a plain identifier`);
  const exists = (await db.query('SELECT 1 AS one FROM pg_namespace WHERE nspname = $1', [schema])).rows.length > 0;
  if (!exists) await db.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await ensureTable(db, PROXY_TABLES, { schema });
}
