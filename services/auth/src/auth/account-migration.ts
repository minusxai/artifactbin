import {sql, type Kysely} from 'kysely';

const guidance = 'Stop all auth/account writers, verify a restorable backup, then explicitly run migrateHumanAccountSchema with writesPausedAndBackupVerified: true. See services/auth/ACCOUNT-MIGRATION.md. Startup never applies this migration.';
const identifier = (schema: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Invalid authentication schema identifier');
  return sql.id(schema, 'account');
};

async function inspect(db: Kysely<Record<string, unknown>>, schema: string) {
  identifier(schema);
  const columns = await sql<{column_name: string; is_nullable: string; data_type: string; column_default: string | null; is_generated: string}>`
    SELECT column_name, is_nullable, data_type, column_default, is_generated FROM information_schema.columns
    WHERE table_schema = ${schema} AND table_name = 'account'`.execute(db);
  const indexes = await sql<{indisunique: boolean; indisvalid: boolean; indisready: boolean; plain: boolean; method: string; keys: string[]; constraint_owned: boolean; on_account: boolean; default_ordering: boolean; default_collation: boolean}>`
    SELECT i.indisunique, i.indisvalid, i.indisready,
      i.indrelid = to_regclass(${schema + '.account'}) AS on_account,
      (i.indoption::text = '0 0' AND NOT EXISTS (
        SELECT 1 FROM unnest(i.indclass) AS cls(oid) JOIN pg_opclass op ON op.oid = cls.oid WHERE NOT op.opcdefault
      )) AS default_ordering,
      (i.indpred IS NULL AND i.indexprs IS NULL AND i.indnatts = 2 AND i.indnkeyatts = 2) AS plain,
      am.amname AS method,
      NOT EXISTS (SELECT 1 FROM unnest(i.indkey, i.indcollation) AS k(attnum, collid)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
        WHERE k.collid <> a.attcollation) AS default_collation,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum ORDER BY k.ord) AS keys,
      EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid) AS constraint_owned
    FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = idx.relnamespace JOIN pg_am am ON am.oid = idx.relam
    WHERE n.nspname = ${schema} AND idx.relname = 'account_issuer_accountId_uidx'`.execute(db);
  return {columns: columns.rows, indexes: indexes.rows};
}

async function assertNoIdentityCollisions(db: Kysely<Record<string, unknown>>, schema: string): Promise<void> {
  const collision = await sql`SELECT 1 FROM ${identifier(schema)} GROUP BY "providerId", "accountId" HAVING count(*) > 1 LIMIT 1`.execute(db);
  if (collision.rows.length) throw new Error('Duplicate authentication provider/account identities; stop all auth/account writers and resolve ownership under review without merging or deleting identities automatically. See services/auth/ACCOUNT-MIGRATION.md.');
}

/** Read-only startup guard. The operator, never a mixed-version startup, owns DDL. */
export async function assertHumanAccountSchema(db: Kysely<Record<string, unknown>>, schema = 'auth'): Promise<void> {
  const state = await inspect(db, schema);
  if (state.columns.some(c => c.column_name === 'issuer' && c.is_nullable === 'NO') || state.indexes.length) {
    throw new Error(`Authentication account schema requires the Better Auth 1.7.3 upgrade. ${guidance}`);
  }
  if (state.columns.length) await assertNoIdentityCollisions(db, schema);
}

/** Explicit coordinated operation; preserves issuer values and refuses ambiguous identity/schema. */
export async function migrateHumanAccountSchema(db: Kysely<Record<string, unknown>>, options: {
  writesPausedAndBackupVerified: true; schema?: string;
}): Promise<{changed: boolean}> {
  if (options.writesPausedAndBackupVerified !== true) throw new Error(guidance);
  const schema = options.schema ?? 'auth';
  const table = identifier(schema);
  return db.transaction().execute(async tx => {
    // Every query uses this transaction's connection (including the PGLite bridge).
    const present = await sql<{present: boolean}>`SELECT to_regclass(${schema + '.account'}) IS NOT NULL AS present`.execute(tx);
    if (!present.rows[0]?.present) return {changed: false};
    await sql`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`.execute(tx);
    const state = await inspect(tx, schema);
    for (const name of ['providerId', 'accountId']) {
      if (!state.columns.some(c => c.column_name === name && c.data_type === 'text' && c.is_nullable === 'NO')) {
        throw new Error('Unexpected authentication account identity columns; migration refused');
      }
    }
    const issuer = state.columns.find(c => c.column_name === 'issuer');
    if (issuer && (issuer.data_type !== 'text' || issuer.column_default !== null || issuer.is_generated !== 'NEVER')) {
      throw new Error('Unexpected authentication issuer column; migration refused');
    }
    const index = state.indexes[0];
    if (state.indexes.length > 1 || (index && (!issuer || !index.on_account || !index.default_ordering || !index.default_collation || !index.indisunique || !index.indisvalid || !index.indisready || !index.plain || index.method !== 'btree' || index.constraint_owned || index.keys.join(',') !== 'issuer,accountId'))) {
      throw new Error('Unexpected legacy authentication index; migration refused');
    }
    await assertNoIdentityCollisions(tx, schema);
    if (issuer?.is_nullable === 'NO') await sql`ALTER TABLE ${table} ALTER COLUMN issuer DROP NOT NULL`.execute(tx);
    if (index) await sql`DROP INDEX ${sql.id(schema, 'account_issuer_accountId_uidx')}`.execute(tx);
    return {changed: issuer?.is_nullable === 'NO' || !!index};
  });
}

// probe: pull request lane type check timing
