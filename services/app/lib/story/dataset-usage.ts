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

/** A stable logical table, never the connection's physical source names. */
export function datasetQuerySnippet(id: string, catalog?: DatasetCatalog, name = 'rows'): string {
  return `<Query name="${name}" source="${id}">{\`SELECT * FROM ${templateSql(tableName(catalog))}\`}</Query>`;
}

const jsonAttr = (value: unknown) => `{${JSON.stringify(value)}}`;

/**
 * A `<Query>` over this dataset plus a `<Question>` bound to it — the shape of
 * nearly every first chart (a non-numeric x, a numeric y); the agent edits
 * from something that works rather than assembling from a description. The
 * SQL names a stable table inside the sourced dataset; the chart binds the query.
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
        x: { field: x.name, type: x.type === 'date' ? 'temporal' : 'nominal' },
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
  return `<Helmet>${values}<Mutation name="add" source="${id}">{\`insert into ${templateSql(tableName(catalog))} (${names}) values (${binds})\`}</Mutation></Helmet>\n`
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
    // Legacy wire field retained; new authoring uses source="id" below.
    ref: `ref:${id}`,
    usage: datasetUsageExample(id, cols, meta?.catalog)
      + (effectiveAccess === 'readwrite' ? `\n\n${datasetMutationExample(id, cols, meta?.catalog)}` : ''),
    ...(postgres ? { writes: 'PostgreSQL database rows are read-only. Editors can manage the connection, notebook and whitelist. Viewers can query exposed data.' } : effectiveAccess === 'read'
      ? { writes: `read-only — a <Mutation source="${id}"> is refused at publish. To open it: PATCH /api/my/artifacts/${id} { "access": "readwrite" }, or set access on create/PUT.` }
      : { writes: 'readwrite — viewers with edit access may insert/update/delete rows through a <Mutation>.' }),
  };
}
