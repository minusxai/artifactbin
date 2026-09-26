/** Canonical authoring examples shared by create responses and catalog copy UI. */
import type { DatasetCatalog } from '@/lib/datasets/types';
import type { DatasetColumn } from '@/lib/story/dataset-shape';

const defaultTable = (catalog?: DatasetCatalog) => catalog?.tables.find(t => t.schema === catalog.defaultSchema) ?? catalog?.tables[0];
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const tableName = (catalog?: DatasetCatalog) => {
  const table = defaultTable(catalog);
  return `${quote(table?.schema ?? 'public')}.${quote(table?.name ?? 'rows')}`;
};
const templateSql = (sql: string) => sql.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
/** The name a stored dataset is imported under in these examples. */
const IMPORT = 'data';
/** The default table as the import exposes it: `data."orders"`, `data."rows"` for a flat upload. */
const importedTable = (importName: string, catalog?: DatasetCatalog) => `${importName}.${quote(defaultTable(catalog)?.name ?? 'rows')}`;
const importTag = (importName: string, id: string) => `<Import name="${importName}" src="ref:${id}" />`;

/**
 * Read this dataset: a stored one is IMPORTED (its tables read as
 * `<import>.<table>`); a connected Postgres database runs the query inside
 * itself (`source=`), over its stable logical table names — never the
 * connection's physical ones.
 */
export function datasetQuerySnippet(id: string, catalog?: DatasetCatalog, name = 'rows'): string {
  if (catalog?.kind === 'postgres') return `<Query name="${name}" source="ref:${id}">{\`SELECT * FROM ${templateSql(tableName(catalog))}\`}</Query>`;
  const importName = name === IMPORT ? 'dataset' : IMPORT;
  return `${importTag(importName, id)}<Query name="${name}">{\`SELECT * FROM ${templateSql(importedTable(importName, catalog))}\`}</Query>`;
}

const jsonAttr = (value: unknown) => `{${JSON.stringify(value)}}`;

/**
 * A `<Query>` over this dataset plus a `<Question>` bound to it — the shape of
 * nearly every first chart (a non-numeric x, a numeric y); the agent edits
 * from something that works rather than assembling from a description. The
 * SQL names a stable table of the imported dataset; the chart binds the query.
 */
function datasetUsageExample(id: string, columns: DatasetColumn[], catalog?: DatasetCatalog): string {
  const numeric = columns.find((c) => c.type === 'number');
  const categorical = columns.find((c) => c !== numeric);
  const x = categorical ?? columns[0];
  const y = numeric;
  const query = `<Helmet>${datasetQuerySnippet(id, catalog)}</Helmet>`;

  if (!x || !y) {
    // No quantitative column: a table is the honest default, and it is also
    // what <Question> renders when `viz` is absent.
    return `${query}\n<Question title="Rows" data="$rows" />`;
  }
  const spec = {
    kind: 'vega-lite',
    spec: {
      mark: 'bar',
      encoding: {
        x: { field: x.name, type: (x.type === 'date' || x.type === 'timestamp') ? 'temporal' : 'nominal' },
        y: { field: y.name, type: 'quantitative' },
      },
    },
  };
  return `${query}\n<Question title="${y.name} by ${x.name}" data="$rows" viz=${jsonAttr(spec)} height="430px" />`;
}

/**
 * A `<Mutation>` over this dataset, bound to its real columns, plus the button
 * that runs it — the write half of the usage hint, and only for a dataset that
 * is actually writable. Same reasoning as the read example above: an agent
 * that has just made a writable dataset is about to write to it, and the
 * shape (a Helmet declaration, `$params` from `<Value>`s, `run=` on a Button)
 * is the part it would otherwise have to guess.
 */
function datasetMutationExample(id: string, columns: DatasetColumn[], catalog?: DatasetCatalog): string {
  const cols = columns.filter(c => /^[A-Za-z_]\w*$/.test(c.name)).slice(0, 3);
  if (cols.length === 0) return '';
  const values = cols.map((c) => `<Value name="${c.name}" type="${c.type}" />`).join('');
  const names = cols.map((c) => quote(c.name)).join(', ');
  const binds = cols.map((c) => `$${c.name}`).join(', ');
  return `<Helmet>${importTag(IMPORT, id)}${values}<Mutation name="add">{\`insert into ${templateSql(importedTable(IMPORT, catalog))} (${names}) values (${binds})\`}</Mutation></Helmet>\n`
    + cols.map((c) => `<input value="$${c.name}" placeholder="${c.name}" />`).join('')
    + '\n<Button run="$add">Add</Button>';
}

/** The dataset-specific fields of a create response. */
export function datasetCreateFields(id: string, columns: unknown, rowCount: unknown, meta?: { totalRows?: number; truncated?: boolean; catalog?: DatasetCatalog }, access: 'read' | 'readwrite' = 'read') {
  const cols = defaultTable(meta?.catalog)?.columns ?? (Array.isArray(columns) ? (columns as DatasetColumn[]) : []);
  const postgres = meta?.catalog?.kind === 'postgres';
  const effectiveAccess = postgres ? 'read' : access;
  return {
    columns,
    rowCount,
    // The write ACL, always stated: an agent that reads "read" knows a
    // <Mutation> would be refused, and how to change that.
    access: effectiveAccess,
    // Surfaced so nobody charts a sample believing it is the whole set.
    ...(meta?.truncated
      ? { totalRows: meta.totalRows, truncated: true,
          note: `Source had ${meta.totalRows} rows; the first ${rowCount} were kept.` }
      : {}),
    // The id to import: <Import name="…" src="ref:<id>" />, as the usage example below teaches.
    ref: `ref:${id}`,
    usage: datasetUsageExample(id, cols, meta?.catalog)
      + (effectiveAccess === 'readwrite' ? `\n\n${datasetMutationExample(id, cols, meta?.catalog)}` : ''),
    ...(postgres ? { writes: 'PostgreSQL database rows are read-only. Editors can manage the connection, notebook and whitelist. Viewers can query exposed data.' } : effectiveAccess === 'read'
      ? { writes: `read-only — a <Mutation> writing its import (<Import src="ref:${id}">) is refused at publish. To open it: afbin push <file> --type dataset --access readwrite (API: PATCH /api/my/artifacts/${id} { "access": "readwrite" }, or set access on create/PUT).` }
      : { writes: 'readwrite — viewers with edit access may insert/update/delete rows through a <Mutation>.' }),
  };
}
