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

function renderTable(table: Table, qualified: (name: string) => string): string[] {
  const name = qualified(table.name);
  const body = table.columns.map((c) => `  ${renderColumn(c)}`);
  // Table-level PK so the constraint gets the conventional <table>_pkey name.
  body.push(`  PRIMARY KEY (${table.primaryKey.join(', ')})`);
  for (const u of table.uniques ?? []) body.push(`  UNIQUE (${u.join(', ')})`);

  return [
    `CREATE TABLE IF NOT EXISTS ${name} (\n${body.join(',\n')}\n)`,
    // Lets a database built from an older declaration gain newly-declared columns.
    ...table.columns.map((c) => `ALTER TABLE ${name} ADD COLUMN IF NOT EXISTS ${renderColumn(c)}`),
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
  return tables.flatMap((t) => renderTable(t, qualified));
}

/** Apply renderSchema's statements, in order, on every boot. */
export async function ensureTable(db: Queryable, tables: Table[], o: { schema?: string } = {}): Promise<void> {
  for (const stmt of renderSchema(tables, o)) await db.query(stmt);
}
