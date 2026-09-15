/** Native DuckDB catalog admission. SQL bytes are never round-tripped through
 * JSON: native ASTs establish access/dependencies, the original query executes.
 * The caller supplies an already isolated connection with external access off. */
import type { DuckDBConnection } from '@duckdb/node-api';
import type { DatasetColumn, Row, RunInput, Scalar, SqlReadCatalog } from '@artifactbin/contracts';
import { COLUMN_SQL_TYPES } from './column-types';

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const key = (schema: string, name: string) => JSON.stringify([schema.toLowerCase(), name.toLowerCase()]);
const fail = (reason: string): never => { throw new Error(`Dataset SQL: ${reason}`); };
type Node = Record<string, unknown>;
function identifier(name: string): void {
  if (!name || name.length > 255 || name.includes('\0')) fail('invalid catalog identifier');
}
function schemaName(name: string): void {
  identifier(name);
  if (name.toLowerCase() === 'information_schema' || name.toLowerCase().startsWith('pg_')) fail('system schemas are not allowed');
}

/** Only typed parameter tokens change. Strings, comments, quoted identifiers,
 * dollar strings and numeric literals retain their exact authored bytes. */
function catalogSql(sql: string, types: SqlReadCatalog['paramTypes'], params: Record<string, Scalar>): string {
  let out = '', i = 0;
  while (i < sql.length) {
    const start = i;
    if (sql.startsWith('--', i)) { const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end; }
    else if (sql.startsWith('/*', i)) {
      let depth = 1; i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) { depth++; i += 2; }
        else if (sql.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
    } else if (sql[i] === "'" || sql[i] === '"') {
      const delimiter = sql[i++];
      const escaped = delimiter === "'" && /[eE]/.test(sql[start - 1] ?? '') && (start < 2 || !/[\w$]/.test(sql[start - 2]));
      while (i < sql.length) {
        if (escaped && sql[i] === '\\') { i += 2; continue; }
        if (sql[i++] === delimiter) { if (sql[i] === delimiter) i++; else break; }
      }
    } else if (sql[i] === '$') {
      const delimiter = /^(\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$)/.exec(sql.slice(i))?.[0];
      if (delimiter) { const end = sql.indexOf(delimiter, i + delimiter.length); i = end < 0 ? sql.length : end + delimiter.length; }
      else {
        const token = /^\$([A-Za-z_][A-Za-z_0-9]*|[0-9]+)/.exec(sql.slice(i));
        if (!token) { i++; }
        else {
          if (!types) { out += token[0]; i += token[0].length; continue; }
          const name = token[1]!;
          if (!Object.hasOwn(types, name) || !Object.hasOwn(COLUMN_SQL_TYPES, types[name]!)) fail(`missing parameter type for $${name}`);
          if (!Object.hasOwn(params, name)) fail(`missing parameter $${name}`);
          const type = types[name]!, value = params[name];
          const expected = type === 'number' ? 'number' : type === 'boolean' ? 'boolean' : 'string';
          if (value !== null && (typeof value !== expected || (typeof value === 'number' && !Number.isFinite(value)))) fail(`parameter $${name} does not match its declared type`);
          out += `CAST(${token[0]} AS ${COLUMN_SQL_TYPES[type]})`; i += token[0].length; continue;
        }
      }
    } else if (sql[i] === ';') { i++; continue; } else {
      const word = /^[A-Za-z_][A-Za-z_0-9$]*/.exec(sql.slice(i));
      i += word ? word[0].length : 1;
    }
    out += sql.slice(start, i);
  }
  return out + '\n';
}

/** Mount only logical catalog tables, with only approved columns. Model views
 * are created lazily and never materialized with a row cap. */
export async function prepareReadCatalog(
  conn: DuckDBConnection,
  input: RunInput,
  register: (name: string, table: {rows: Row[]; columns: DatasetColumn[]}, schema: string) => Promise<void>,
): Promise<(sql: string) => Promise<string>> {
  const catalog = input.catalog!;
  if (input.queries.length !== 1) fail('a catalog read requires exactly one query');
  if (catalog.tables.length > 1000) fail('catalog is too large');
  schemaName(catalog.defaultSchema);
  const tables = new Map<string, SqlReadCatalog['tables'][number]>();
  for (const table of catalog.tables) {
    schemaName(table.schema); identifier(table.name);
    const id = key(table.schema, table.name);
    if (tables.has(id)) fail('duplicate catalog table');
    if ((typeof table.source === 'string') === (typeof table.sql === 'string')) fail('table requires exactly one source');
    tables.set(id, table);
  }
  for (const schema of new Set([catalog.defaultSchema, ...catalog.tables.map(t => t.schema)])) await conn.run(`CREATE SCHEMA IF NOT EXISTS ${quote(schema)}`);
  await conn.run(`SET schema = ${literal(catalog.defaultSchema)}`);
  for (const table of catalog.tables) {
    if (table.source === undefined) continue;
    const source = Object.hasOwn(input.tables, table.source) ? input.tables[table.source] : undefined;
    if (!source) fail('catalog table data is unavailable');
    if (table.columns.some(column => !source!.columns.some(c => c.name === column.name && c.type === column.type))) fail('catalog column is unavailable');
    await register(table.name, {rows:source!.rows,columns:table.columns}, table.schema);
  }

  const ready = new Set<string>(), active = new Set<string>();
  let totalSql = 0;
  async function analyze(sql: string): Promise<Set<string>> {
    if (typeof sql !== 'string' || sql.length > 100_000 || (totalSql += sql.length) > 2_000_000) fail('query is too large');
    const rows = (await conn.runAndReadAll('SELECT json_serialize_sql($sql::VARCHAR) AS ast', {sql})).getRowObjects();
    const parsed = JSON.parse(String(rows[0]?.ast)) as {error?:boolean;error_message?:string;statements?:Array<{node:Node}>};
    if (parsed.error) fail(`unsupported or invalid DuckDB syntax (${parsed.error_message ?? 'parse failed'})`);
    if (parsed.statements?.length !== 1) fail('exactly one read statement is required');
    const refs = new Set<string>();
    function walk(value: unknown, scope: Set<string>, depth = 0): void {
      if (depth > 100) fail('query nesting is too deep');
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { for (const child of value) walk(child, scope, depth + 1); return; }
      const node = value as Node;
      const ctes = (node.cte_map as {map?:Array<{key:string;value:unknown}>} | undefined)?.map;
      const nested = ctes?.length ? new Set([...scope, ...ctes.map(cte => cte.key.toLowerCase())]) : scope;
      if (node.type === 'TABLE_FUNCTION') fail('table functions are not allowed');
      if (node.type === 'BASE_TABLE') {
        if (node.catalog_name) fail('cross-catalog relations are not allowed');
        const schema = String(node.schema_name || catalog.defaultSchema), name = String(node.table_name);
        schemaName(schema);
        if (!node.schema_name && nested.has(name.toLowerCase())) return;
        const id = key(schema, name);
        if (!tables.has(id)) fail(`relation is not in the catalog: ${schema}.${name}`);
        refs.add(id);
      }
      // Qualified functions could select an implementation outside this engine's builtins.
      if ((node.class === 'FUNCTION' || node.class === 'WINDOW') && (node.schema || node.catalog)) fail('qualified functions are not allowed');
      for (const child of Object.values(node)) walk(child, nested, depth + 1);
    }
    walk(parsed.statements![0]!.node, new Set());
    return refs;
  }
  async function model(id: string): Promise<void> {
    const table = tables.get(id)!;
    if (!table.sql || ready.has(id)) return;
    if (active.has(id) || active.size >= 32) fail('invalid or cyclic model dependencies');
    active.add(id);
    for (const dependency of await analyze(table.sql)) await model(dependency);
    const prepared = await conn.prepare(table.sql);
    if (prepared.parameterCount) fail('stored models cannot bind reader parameters');
    const columns = table.columns.length ? table.columns.map(c => quote(c.name)).join(', ') : '*';
    await conn.run(`CREATE VIEW ${quote(table.schema)}.${quote(table.name)} AS SELECT ${columns} FROM (${catalogSql(table.sql, undefined, {})}) AS _model`);
    active.delete(id); ready.add(id);
  }
  return async (sql: string) => {
    for (const dependency of await analyze(sql)) await model(dependency);
    return catalogSql(sql, catalog.paramTypes, input.params);
  };
}
