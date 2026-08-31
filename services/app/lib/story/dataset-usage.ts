/**
 * How to USE a dataset, returned at the moment one is created.
 *
 * The deeper cause of the broken-chart bug. `create_artifact` handed back
 * `{id, url, columns}` and nothing else, so an agent had to already know
 * that a dataset is consumed as `data="ref:<id>"`. ChatGPT guessed `source=`,
 * we accepted it, and the page rendered empty.
 *
 * The create response is where the agent has maximum context — it just made
 * this thing and is about to reference it — so the reference and a
 * ready-to-paste embed belong here, bound to the dataset's REAL columns. A
 * placeholder would just be another thing to get wrong.
 *
 * Shared by the REST route and the MCP tool so the two can never drift.
 */

export interface DatasetColumn { name: string; type: string }

const jsonAttr = (value: unknown) => `{${JSON.stringify(value)}}`;

/**
 * A `<Query>` over this dataset plus a `<Question>` bound to it — the shape of
 * nearly every first chart (a non-numeric x, a numeric y); the agent edits
 * from something that works rather than assembling from a description. The
 * SQL names the dataset as its `ref_<id>` table; the chart binds the query.
 */
function datasetUsageExample(id: string, columns: DatasetColumn[]): string {
  const numeric = columns.find((c) => c.type === 'number');
  const categorical = columns.find((c) => c !== numeric);
  const x = categorical ?? columns[0];
  const y = numeric;
  const query = `<Helmet><Query name="rows">{\`select * from ref_${id}\`}</Query></Helmet>`;

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
function datasetMutationExample(id: string, columns: DatasetColumn[]): string {
  const cols = columns.slice(0, 3);
  if (cols.length === 0) return '';
  const values = cols.map((c) => `<Value name="${c.name}" type="${c.type}" />`).join('');
  const names = cols.map((c) => `"${c.name}"`).join(', ');
  const binds = cols.map((c) => `$${c.name}`).join(', ');
  return `<Helmet>${values}<Mutation name="add">{\`insert into ref_${id} (${names}) values (${binds})\`}</Mutation></Helmet>\n`
    + cols.map((c) => `<input value="$${c.name}" placeholder="${c.name}" />`).join('')
    + '\n<Button run="$add">Add</Button>';
}

/** The dataset-specific fields of a create response. */
export function datasetCreateFields(id: string, columns: unknown, rowCount: unknown, meta?: { totalRows?: number; truncated?: boolean }, access: 'read' | 'readwrite' = 'read') {
  const cols = Array.isArray(columns) ? (columns as DatasetColumn[]) : [];
  return {
    columns,
    rowCount,
    // The write ACL, always stated: an agent that reads "read" knows a
    // <Mutation> would be refused, and how to change that.
    access,
    // Surfaced so nobody charts a sample believing it is the whole set.
    ...(meta?.truncated
      ? { totalRows: meta.totalRows, truncated: true,
          note: `Source had ${meta.totalRows} rows; the first ${rowCount} were kept.` }
      : {}),
    // Spelled out, because a bare id is not usable and the `ref:` prefix is the
    // part agents omit.
    ref: `ref:${id}`,
    usage: datasetUsageExample(id, cols)
      + (access === 'readwrite' ? `\n\n${datasetMutationExample(id, cols)}` : ''),
    ...(access === 'read'
      ? { writes: `read-only — a <Mutation> writing ref_${id} is refused at publish. To open it: PATCH /api/my/artifacts/${id} { "access": "readwrite" }, or set access on create/PUT.` }
      : { writes: 'readwrite — documents you publish may insert/update/delete rows through a <Mutation>, for everyone who can read them.' }),
  };
}
