/** What this command does and how to use it; also printed by --help. */
export const DESCRIPTION = `Print a page's or dataset's tables, or run one SQL statement over them.
Page tables use link names (data-af-name) and _id; a stored dataset ID's one table is named rows
(not its title; another name is HTTP 400); default:DB
reads the install's database. All reads use your current dataset rules.
Usage: node scripts/sql.mjs schema ID|URL|default:DB [--revision N]
       node scripts/sql.mjs query ID|URL|default:DB 'SQL'|--sql-file FILE [--params FILE]
         [--limit N] [--revision N] [--idempotency-key KEY] [--output FILE.csv|FILE.json]
         [--chart FILE --chart-output FILE.png [--chart-width N] [--chart-height N]
         [--chart-theme light|dark]]
Flags: --sql-file FILE reads the statement from FILE instead; --output FILE saves every row
  of a read into a new .csv or .json file and prints {columns, rowCount, sample, output} (a few
  rows, long values cut) in place of the rows: put rows in files this way, never by retyping
  them. --params FILE a JSON object of the $name values the SQL binds; --limit N the most rows a
  read prints (default 1000, at most 10000); --revision N a saved page revision (default:
  current; pages only; it reads only); --idempotency-key KEY replays a page write (default: a
  new key, printed as idempotencyKey); --chart FILE a chart description (the JSON <af-chart>
  takes) drawn over the read's rows into a new --chart-output FILE.png, --chart-width/height N
  pixels (default 640x400), --chart-theme light|dark. Common: --server, --json, --help.
Examples:
  node scripts/sql.mjs schema ID
  node scripts/sql.mjs query ID 'select grp, count(*) as n from entries group by grp'
  node scripts/sql.mjs query default:DB --sql-file monthly.sql --output outputs/monthly.csv
  node scripts/sql.mjs query ID 'update entries set note = $note where _id = $id' --params p.json
Gotchas: quote the SQL in single quotes, so the shell leaves $name alone. schema prints one
  CREATE TABLE per table, columns and types as your role sees them (hidden columns are absent).
  schema --revision needs the exact current page revision; it describes pinned stored links only.
  query runs one statement: a SELECT answers {columns, rows} (a dataset ID's read is paged 100
  rows at a time up to --limit; truncated: true when more rows matched); one INSERT, UPDATE or
  DELETE answers {affected, returning}. Through a page ID it runs as you under each dataset's
  rules, so a write works wherever your role may write, and affected 0 means the rules let you
  change no row it named; a write through a dataset ID needs its owner or an editor and answers
  returning [] (read the rows after it). Pass values in --params, never inside the SQL text.
  Live dataset SQL needs owner/editor; :name or $name binds.
  Exit 5 means a write's outcome is unknown: repeat it with the printed --idempotency-key (a
  page write applies at most once). --chart draws reads only, at most 4 MiB of rows and chart
  (else chart_rows_too_large: aggregate in SQL); the result adds chart: {output, width, height,
  bytes}.
Exit: 0 ok; 1 failed; 2 invocation; 3 auth/access; 4 conflict; 5 unknown write outcome.
  Results never contain credentials.`;

import {randomUUID} from 'node:crypto';
import {
  runTool,
  resolveTarget,
  selectedServer,
  makeClient,
  integer,
  jsonFile,
  ToolError
} from './toolbox-client.mjs';
import {datasetLinks} from './toolbox-check-reply.mjs';
import {chartRequest, drawChart} from './toolbox-chart.mjs';
import {outputRequest, statementOf, writeRows} from './toolbox-rows-file.mjs';

const WRITE = /^\s*(?:insert|update|delete)\b/i;
const ROWS = {default: 1000, max: 10000}, PAGE = 100;
// Transport only; server execution maxima are page 120s, warehouse 900s.
const READ = {safeToRepeat: true, timeoutMs: 140000}, WAREHOUSE_MS = 920000;
const TYPES = {number: 'REAL', boolean: 'BOOLEAN', string: 'TEXT', date: 'DATE',
  timestamp: 'TIMESTAMP', user: 'TEXT'};
const quote = name => '"' + String(name).replaceAll('"', '""') + '"';
/** Visible columns as DDL; user IDs stay text. */
const createTable = (name, columns) => `CREATE TABLE ${name.split('.').map(quote).join('.')} (\n${
  columns.map(c => `  ${quote(c.name)} ${TYPES[c.type] ?? 'TEXT'}${c.type === 'user' ?
    ' -- account ID' : ''}`).join(',\n')}\n);`;

/** Discover head links. */
async function pageOf(client, id, revision) {
  const html = await (await client.request(`/a/${id}/raw${revision ? '?version=' + revision :
    ''}`, {raw: true})).text();
  return {revision: revision ?? String((await client.request('/api/artifacts/' + id)).version),
    links: datasetLinks(html)};
}
/** Page SQL as the reader. */
function pageSql(client, id, body, key) {
  return client.request(`/api/artifacts/${id}/sql`, {method: 'POST', body,
    ...(key ? {headers: {'Idempotency-Key': key}, unsafe: true} :
      READ)});
}
/** Link table names and visible columns. */
async function linkTables(client, id, revision, link) {
  const head = await client.request('/api/artifacts/' + link.id).catch(() => null);
  const tables = head?.meta?.catalog?.tables ?? [];
  const names = tables.length > 1 ? tables.map(t => `${link.name}.${t.name}`) : [link.name];
  return Promise.all(names.map(async name => {
    const read = await pageSql(client, id, {sql: `select * from ${name.split('.').map(quote)
      .join('.')} limit 0`, params: {}, revision, readOnly: true});
    return {name, columns: read.columns};
  }));
}

export async function sqlCommand({sub, values, positionals}, options = {}) {
  const [target, given, ...extra] = positionals;
  const statement = await statementOf(values, sub, given);
  if (!target || extra.length || (sub === 'schema') !== (statement === undefined))
    throw new ToolError('invalid_arguments', sub === 'schema' ? 'schema takes one ID.' :
      'query takes an ID and one SQL statement.', 2, 'Read --help.');
  const chart = await chartRequest(values, sub, WRITE.test(statement ?? ''));
  const saved = await outputRequest(values, sub, WRITE.test(statement ?? ''));
  /** The read, its chart when --chart asks for one, and its rows in a file for --output. */
  const drawn = async (client, read) => {
    const done = chart ? {...read, chart: await drawChart(client, chart, read)} : read;
    return saved ? writeRows(saved, done) : done;
  };
  if (target.startsWith('default:')) {
    const client = makeClient(selectedServer(values, options.env), options);
    return drawn(client, await client.request('/api/default-connection/sql', {method: 'POST',
      safeToRepeat: true, timeoutMs: WAREHOUSE_MS, body: {sql: statement,
        namespace: target.slice(8), params: values.params && await jsonFile(values.params)}}));
  }
  const {server, id} = resolveTarget(target, selectedServer(values, options.env)),
    client = makeClient(server, options);
  const revision = values.revision ? String(integer(values.revision, 'revision')) : undefined;
  const head = await client.request('/api/artifacts/' + id);
  const page = head.format === 'html';
  if (!page && (revision || values['idempotency-key']))
    throw new ToolError('dataset_flag_unsupported', 'A dataset serves its current rows; ' +
      'only page writes take a key.', 2, 'Drop --revision and --idempotency-key for a dataset ID.');
  if (sub === 'schema') {
    if (page && revision) {
      const read = await client.request(`/api/artifacts/${id}/sql/schema?revision=${revision}`,
        READ);
      const tables = read.tables.map(t => ({name: t.schema === 'main' ? t.name :
        `${t.schema}.${t.name}`, columns: t.columns}));
      return {target: 'page', revision: read.revision, tables,
        schema: tables.map(t => createTable(t.name, t.columns)).join('\n')};
    }
    if (head.meta?.connection) return {target: 'live dataset', ...await client.request(
      `/api/artifacts/${id}/connection/schema`)};
    if (!page) {
      const read = await client.request(`/api/artifacts/${id}/query`, {method: 'POST',
        body: {sql: 'select * from rows limit 0'}, ...READ});
      const columns = read.results?.[0]?.columns ?? [];
      return {target: 'dataset', tables: [{name: 'rows', columns}],
        schema: createTable('rows', columns)};
    }
    const {revision: at, links} = await pageOf(client, id, revision);
    const tables = (await Promise.all(links.map(link => linkTables(client, id, at, link)))).flat();
    return {target: 'page', revision: at, tables,
      schema: tables.map(t => createTable(t.name, [{name: '_id', type: 'string'},
        ...t.columns.filter(c => c.name !== '_id')])).join('\n')};
  }
  const params = values.params ? await jsonFile(values.params) : {};
  if (!params || typeof params !== 'object' || Array.isArray(params))
    throw new ToolError('invalid_params', '--params must be a JSON object.', 2);
  const write = WRITE.test(statement);
  const limit = values.limit === undefined ? ROWS.default :
    integer(values.limit, 'limit', 1, ROWS.max);
  if (!page && write) {
    const done = await client.request(`/api/artifacts/${id}/mutate`, {method: 'POST',
      body: {sql: statement, values: params}, unsafe: true});
    return {affected: done.affected, returning: [], version: done.version};
  }
  if (!page) return drawn(client, await datasetRead(client, id, statement, params, limit));
  if (write && revision) throw new ToolError('revision_read_only',
    'A saved revision reads only.', 2, 'Drop --revision to write to the current page.');
  const at = revision ?? String(head.version);
  const key = write ? values['idempotency-key'] ?? randomUUID().replaceAll('-', '') : undefined;
  try {
    const result = await pageSql(client, id, {sql: statement, params, revision: at}, key);
    if (key)
      return {affected: result.affected, returning: result.returning ?? [], idempotencyKey: key};
    return drawn(client, {columns: result.columns, rows: result.rows.slice(0, limit),
      ...result.rows.length > limit ? {truncated: true} : {}});
  } catch (error) {
    if (key && error instanceof ToolError) {
      if (error.exit === 5) error.recovery = 'Read the rows before any other write, or repeat ' +
        `it with --idempotency-key ${key}: it applies at most once.`;
      error.details = {...error.details ?? {}, idempotencyKey: key};
    }
    throw error;
  }
}
/** Page dataset query results up to LIMIT. */
async function datasetRead(client, id, sql, values, limit) {
  const rows = [];
  let columns = [], cursor;
  do {
    const read = await client.request(`/api/artifacts/${id}/query`, {method: 'POST',
      ...READ,
      body: {sql, values, limit: PAGE, ...cursor ? {cursor} : {}}});
    var table = read.results?.[0] ?? {};
    columns = table.columns ?? columns;
    rows.push(...table.rows ?? []);
    cursor = table.next_cursor;
  } while (cursor && rows.length < limit);
  const truncated = !!cursor || rows.length > limit || !!table.truncated;
  return {columns, rows: rows.slice(0, limit), ...truncated ? {truncated: true} : {}};
}
await runTool('sql', import.meta.url, sqlCommand);
