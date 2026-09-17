/**
 * Schema as data → idempotent DDL: CREATE TABLE IF NOT EXISTS + per-column ADD COLUMN IF NOT EXISTS
 * (so a database built from an older declaration gains new columns) + DROP NOT NULL for retired
 * columns + DROP COLUMN IF EXISTS for dropped ones + CREATE [UNIQUE] INDEX IF NOT EXISTS (with an
 * optional access method and expression columns). Moved from lib/schema.ts renderTable, logic
 * verbatim, plus an optional schema qualifier. Every statement individually executable, in order.
 */
import type { Column, Queryable, Table } from '@artifactbin/contracts';

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

function renderTable(table: Table, qualified: (name: string) => string, schemaExpr: string): string[] {
  const name = qualified(table.name);
  const body = table.columns.map((c) => `  ${renderColumn(c)}`);
  // Table-level PK so the constraint gets the conventional <table>_pkey name.
  body.push(`  PRIMARY KEY (${table.primaryKey.join(', ')})`);
  for (const u of table.uniques ?? []) body.push(`  UNIQUE (${u.join(', ')})`);

  return [
    `CREATE TABLE IF NOT EXISTS ${name} (\n${body.join(',\n')}\n)`,
    // Lets a database built from an older declaration gain newly-declared columns.
    ...table.columns.map((c) => `ALTER TABLE ${name} ADD COLUMN IF NOT EXISTS ${renderColumn(c)}`),
    // A DECLARED rename: copy the old column across and drop it, guarded so
    // the second boot is a no-op. AFTER the adds (the new column must exist to
    // be written into) and BEFORE the drops and the indexes.
    ...table.columns
      .filter((c) => c.renamedFrom)
      .map((c) => renderRename(name, table.name, schemaExpr, c)),
    // Relax constraints an older declaration applied — see Column.retired.
    ...table.columns
      .filter((c) => c.retired)
      .map((c) => `ALTER TABLE ${name} ALTER COLUMN ${c.name} DROP NOT NULL`),
    // Columns the declaration no longer carries (Table.dropped) — the whole
    // migration for a retired column, and idempotent, so it is safe on every
    // boot. It runs BEFORE the indexes: dropping a column takes any index over
    // it with it, so the other order would create one this statement removes.
    ...(table.dropped ?? []).map((c) => `ALTER TABLE ${name} DROP COLUMN IF EXISTS ${c}`),
    // `using` picks the access method (gin, gist, …); a column entry that is
    // not a plain name is an EXPRESSION and rides through verbatim — the
    // declaration owns its parentheses — which is what lets an index be over
    // `f(col)` with nothing stored twice.
    ...(table.indexes ?? []).map(
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

/** Apply renderSchema's statements, in order, on every boot. */
export async function ensureTable(db: Queryable, tables: Table[], o: { schema?: string } = {}): Promise<void> {
  for (const stmt of renderSchema(tables, o)) await db.query(stmt);
}
