/**
 * Schema as data → idempotent DDL: CREATE TABLE IF NOT EXISTS + per-column ADD COLUMN IF NOT EXISTS
 * (so a database built from an older declaration gains new columns) + DROP NOT NULL for retired
 * columns + DROP COLUMN IF EXISTS for dropped ones + CREATE [UNIQUE] INDEX IF NOT EXISTS (with an
 * optional access method and expression columns), optionally schema-qualified, + DROP TABLE IF
 * EXISTS for tables no declaration carries any more. Every statement individually executable, in order.
 */
import type { Column, Table } from '@artifactbin/contracts/schema';
import type { Queryable } from '@artifactbin/contracts/db';

function renderColumn(col: Column): string {
  const parts = [col.name, col.type];
  if (col.notNull) parts.push('NOT NULL');
  if (col.default !== undefined) parts.push(`DEFAULT ${col.default}`);
  return parts.join(' ');
}

/**
 * A DECLARED RENAME (Column.renamedFrom), as ONE guarded block beside the
 * ordinary `ADD COLUMN IF NOT EXISTS` that already added the new column: if
 * the OLD column is still there, copy it across and drop it.
 *
 * Three properties, each load-bearing. It is GUARDED on
 * `information_schema.columns`, so from the second boot onward the whole block
 * is a no-op — plpgsql prepares a statement only when it executes, so the body
 * naming a column that no longer exists is never even parsed. It COPIES before
 * it drops (`WHERE <new> IS NULL AND <old> IS NOT NULL`, so a half-migrated
 * database is left alone): an add beside a bare drop would silently discard
 * the data, which for `revoked_at` means un-revoking every revoked token. And
 * it is DDL like everything else here, so the boot IS the migration and there
 * is no script to remember to run.
 */
function renderRename(qualified: string, table: string, schemaExpr: string, col: Column): string {
  const old = col.renamedFrom as string;
  return `DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = ${schemaExpr} AND table_name = '${table}' AND column_name = '${old}'
  ) THEN
    UPDATE ${qualified} SET ${col.name} = ${old} WHERE ${col.name} IS NULL AND ${old} IS NOT NULL;
    ALTER TABLE ${qualified} DROP COLUMN IF EXISTS ${old};
  END IF;
END $$`;
}

/**
 * A DECLARED TOAST compression (Column.compression): set only while the column
 * still has another, so a boot that finds it set takes no table lock; a server
 * without the method (PGLite has no lz4) keeps its default.
 */
function renderCompression(qualified: string, col: Column): string {
  return `DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = to_regclass('${qualified}') AND attname = '${col.name}' AND attcompression IS DISTINCT FROM '${col.compression === 'lz4' ? 'l' : 'p'}'
  ) THEN
    ALTER TABLE ${qualified} ALTER COLUMN ${col.name} SET COMPRESSION ${col.compression};
  END IF;
EXCEPTION WHEN feature_not_supported THEN NULL;
END $$`;
}

interface InstalledTable {
  columns: Map<string, {attnotnull: boolean; attcompression: string}>;
  indexes: Set<string>;
}

function renderTable(table: Table, qualified: (name: string) => string, schemaExpr: string, installed?: InstalledTable): string[] {
  const name = qualified(table.name);
  const body = table.columns.map((c) => `  ${renderColumn(c)}`);
  // Table-level PK so the constraint gets the conventional <table>_pkey name.
  body.push(`  PRIMARY KEY (${table.primaryKey.join(', ')})`);
  for (const u of table.uniques ?? []) body.push(`  UNIQUE (${u.join(', ')})`);

  return [
    ...(installed ? [] : [`CREATE TABLE IF NOT EXISTS ${name} (\n${body.join(',\n')}\n)`]),
    // Lets a database built from an older declaration gain newly-declared columns.
    ...table.columns.filter(c => !installed?.columns.has(c.name)).map((c) => `ALTER TABLE ${name} ADD COLUMN IF NOT EXISTS ${renderColumn(c)}`),
    ...(table.checks??[]).map(check=>`DO $check$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='${name}'::regclass AND conname='${check.name}') THEN ALTER TABLE ${name} ADD CONSTRAINT ${check.name} CHECK (${check.expression}); END IF; END $check$`),
    // A DECLARED rename: copy the old column across and drop it, guarded so
    // the second boot is a no-op. AFTER the adds (the new column must exist to
    // be written into) and BEFORE the drops and the indexes.
    ...table.columns
      .filter((c) => c.renamedFrom && (!installed || installed.columns.has(c.renamedFrom)))
      .map((c) => renderRename(name, table.name, schemaExpr, c)),
    ...table.columns
      .filter((c) => c.compression && installed?.columns.get(c.name)?.attcompression !== 'l')
      .map((c) => renderCompression(name, c)),
    // Relax constraints an older declaration applied — see Column.retired.
    ...table.columns
      .filter((c) => (c.retired || c.relaxNotNull) && (!installed || (installed.columns.get(c.name)?.attnotnull ?? c.notNull)))
      .map((c) => `ALTER TABLE ${name} ALTER COLUMN ${c.name} DROP NOT NULL`),
    // Columns the declaration no longer carries (Table.dropped) — the whole
    // migration for a retired column, and idempotent, so it is safe on every
    // boot. It runs BEFORE the indexes: dropping a column takes any index over
    // it with it, so the other order would create one this statement removes.
    ...(table.dropped ?? []).filter(column => !installed || installed.columns.has(column)).map((c) => `ALTER TABLE ${name} DROP COLUMN IF EXISTS ${c}`),
    // `using` picks the access method (gin, gist, …); a column entry that is
    // not a plain name is an EXPRESSION and rides through verbatim — the
    // declaration owns its parentheses — which is what lets an index be over
    // `f(col)` with nothing stored twice.
    ...(table.indexes ?? []).filter(index => !installed?.indexes.has(index.name)).map(
      (i) => `CREATE ${i.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${i.name} ON ${name}${i.using ? ` USING ${i.using}` : ''} (${i.columns.join(', ')})${i.where ? ` WHERE ${i.where}` : ''}`,
    ),
  ];
}

/** Ordered, individually-executable DDL statements (no splitting needed). */
export function renderSchema(tables: Table[], o: { schema?: string } = {}): string[] {
  const qualified = (name: string) => (o.schema ? `${o.schema}.${name}` : name);
  // The catalog is asked by NAME, so an unqualified declaration has to name
  // the schema the connection is actually in rather than assume `public`.
  const schemaExpr = o.schema ? `'${o.schema}'` : 'current_schema()';
  return tables.flatMap((t) => renderTable(t, qualified, schemaExpr));
}

/**
 * Tables a package no longer declares: `DROP TABLE IF EXISTS`, idempotent, so the boot is the whole
 * migration. Use it only for genuinely dead data: a drop cannot be undone by a boot.
 */
export function renderDroppedTables(names: readonly string[], o: { schema?: string } = {}): string[] {
  return names.map((name) => `DROP TABLE IF EXISTS ${o.schema ? `${o.schema}.${name}` : name}`);
}

/**
 * PostgreSQL takes the table lock before checking IF [NOT] EXISTS. Inspect the installed
 * definitions first so an ordinary restart can run beside the existing readers and writers.
 * Fresh databases and changed declarations use the same DDL renderer as the bootstrap SQL.
 */
export async function ensureTable(db: Queryable, tables: Table[], o: { schema?: string } = {}): Promise<void> {
  const installed = new Map<string, InstalledTable>();
  const schema = o.schema ?? null;
  const columns = await db.query<{table_name:string; attname:string; attnotnull:boolean; attcompression:string}>(`
    SELECT c.relname AS table_name,a.attname,a.attnotnull,a.attcompression
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
      WHERE n.nspname=COALESCE($1,current_schema()) AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped`, [schema]);
  for (const row of columns.rows) {
    let table = installed.get(row.table_name);
    if (!table) { table={columns:new Map(),indexes:new Set()}; installed.set(row.table_name,table); }
    table.columns.set(row.attname,row);
  }
  const indexes=await db.query<{tablename:string; indexname:string}>(
    'SELECT tablename,indexname FROM pg_indexes WHERE schemaname=COALESCE($1,current_schema())',[schema]);
  for (const row of indexes.rows) installed.get(row.tablename)?.indexes.add(row.indexname);
  const qualify=(name:string)=>o.schema ? o.schema+'.'+name : name;
  for (const table of tables) {
    const statements=renderTable(table,qualify,o.schema ? `'${o.schema}'` : 'current_schema()',installed.get(table.name));
    for (const statement of statements) await db.query(statement);
  }
}
