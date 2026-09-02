/** The proxy owns two auth primitives: durable clients and lifecycle-managed credentials. */
import type { Queryable, Table } from '@artifactbin/contracts';
import { ensureTable } from '@artifactbin/utils';

export const PROXY_TABLES: Table[] = [
  {
    name: 'clients',
    columns: [
      { name: 'id', type: 'TEXT', notNull: true },
      { name: 'kind', type: 'TEXT', notNull: true },
      { name: 'metadata', type: 'JSONB', notNull: true, default: "'{}'" },
      { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
      { name: 'updated_at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
      { name: 'revoked_at', type: 'TIMESTAMPTZ' },
    ],
    primaryKey: ['id'],
  },
  {
    name: 'credentials',
    columns: [
      { name: 'kind', type: 'TEXT', notNull: true },
      { name: 'credential_hash', type: 'TEXT', notNull: true },
      { name: 'subject_id', type: 'TEXT' },
      { name: 'group_id', type: 'TEXT' },
      { name: 'payload', type: 'JSONB', notNull: true, default: "'{}'" },
      { name: 'expires_at', type: 'TIMESTAMPTZ', notNull: true },
      { name: 'consumed_at', type: 'TIMESTAMPTZ' },
      { name: 'revoked_at', type: 'TIMESTAMPTZ' },
      { name: 'created_at', type: 'TIMESTAMPTZ', notNull: true, default: 'now()' },
    ],
    primaryKey: ['kind', 'credential_hash'],
    indexes: [
      { name: 'idx_auth_credentials_group', columns: ['group_id'], where: 'group_id IS NOT NULL' },
      { name: 'idx_auth_credentials_expiry', columns: ['expires_at'] },
    ],
  },
];

const tableExists = async (db: Queryable, schema: string, table: string): Promise<boolean> =>
  (await db.query(
    'SELECT 1 AS one FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2',
    [schema, table],
  )).rows.length > 0;

const columnsOf = async (db: Queryable, schema: string, table: string): Promise<Set<string>> =>
  new Set((await db.query<{ column_name: string }>(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
    [schema, table],
  )).rows.map((row) => row.column_name));

/** Additive boot migration; the former auth.codes table becomes the generic auth.credentials table. */
export async function ensureProxySchema(db: Queryable, schema = 'auth'): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`ensureProxySchema: schema ${JSON.stringify(schema)} is not a plain identifier`);
  const exists = (await db.query('SELECT 1 AS one FROM pg_namespace WHERE nspname = $1', [schema])).rows.length > 0;
  if (!exists) await db.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);

  if (await tableExists(db, schema, 'codes') && !await tableExists(db, schema, 'credentials')) {
    await db.query(`ALTER TABLE ${schema}.codes RENAME TO credentials`);
  }
  if (await tableExists(db, schema, 'credentials')) {
    const columns = await columnsOf(db, schema, 'credentials');
    if (columns.has('code_hash') && !columns.has('credential_hash')) {
      await db.query(`ALTER TABLE ${schema}.credentials RENAME COLUMN code_hash TO credential_hash`);
    }
    if (columns.has('subject') && !columns.has('subject_id')) {
      await db.query(`ALTER TABLE ${schema}.credentials RENAME COLUMN subject TO subject_id`);
    }
    await db.query(`ALTER TABLE ${schema}.credentials DROP COLUMN IF EXISTS attempts`);
    await db.query(`DROP INDEX IF EXISTS ${schema}.idx_codes_kind_subject`);
  }
  await ensureTable(db, PROXY_TABLES, { schema });
}
