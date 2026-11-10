/**
 * THE STORED FORM OF A DATASET DEFINITION: canonical JSON, one serialiser for every writer (the app's
 * dataset codec and the boot backfill that rewrote the retired markup), so the same definition is
 * always the same bytes and version comparisons show only what changed.
 *
 * Definition keys in a fixed order (kind, defaultSchema, refreshSeconds, tables; each table schema,
 * name, columns, sql, rows), indented; each column and each row on one line in its own key order,
 * because the first row's key order is the inferred column order.
 */
export interface DatasetDefinitionShape {
  kind: string;
  defaultSchema?: string;
  refreshSeconds?: number;
  tables: ReadonlyArray<{ schema: string; name: string; columns?: readonly unknown[]; sql?: string; rows?: readonly unknown[] }>;
}

/** Expand `depth` levels of objects and arrays; anything deeper is written on one line. */
function format(value: unknown, indent: string, depth: number): string {
  if (depth <= 0 || value === null || typeof value !== 'object') return JSON.stringify(value);
  const inner = `${indent}  `;
  const items = Array.isArray(value)
    ? value.map(item => format(item, inner, depth - 1))
    : Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => `${JSON.stringify(key)}: ${format(item, inner, depth - 1)}`);
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  return items.length ? `${open}\n${items.map(item => inner + item).join(',\n')}\n${indent}${close}` : `${open}${close}`;
}

export function formatDatasetDefinition(definition: DatasetDefinitionShape): string {
  return format({
    kind: definition.kind,
    defaultSchema: definition.defaultSchema,
    refreshSeconds: definition.refreshSeconds,
    tables: definition.tables.map(({ schema, name, columns, sql, rows }) => ({ schema, name, columns, sql, rows })),
  }, '', 4);
}
