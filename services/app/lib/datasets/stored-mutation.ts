import type { DatasetCatalog, DatasetTable } from './types';

interface Token { start: number; end: number; value: string; kind: 'identifier' | 'quoted' | 'literal' | 'symbol' }
function fail(reason: string): never { throw new Error(`Stored mutation: ${reason}`); }
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Read token spans, not a substitute SQL grammar. Expressions remain DuckDB's:
 * the SQL service prepares exactly one write against an isolated target table. */
function tokens(sql: string): Token[] {
  const result: Token[] = [];
  for (let i = 0; i < sql.length;) {
    if (/\s/.test(sql[i])) { i++; continue; }
    if (sql.startsWith('--', i)) { const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end; continue; }
    if (sql.startsWith('/*', i)) {
      let depth = 1; i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) { depth++; i += 2; }
        else if (sql.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) fail('unterminated comment'); continue;
    }
    const start = i;
    if (sql[i] === '"' || sql[i] === "'") {
      const delimiter = sql[i++];
      const escaped = delimiter === "'" && /[eE]/.test(sql[start - 1] ?? '') && (start < 2 || !/[\w$]/.test(sql[start - 2]));
      let closed = false;
      while (i < sql.length) {
        if (escaped && sql[i] === '\\') { i += 2; continue; }
        if (sql[i++] === delimiter) {
          if (sql[i] === delimiter) { i++; continue; }
          closed = true; break;
        }
      }
      if (!closed) fail('unterminated quoted token');
      result.push({ start, end: i, kind: delimiter === '"' ? 'quoted' : 'literal', value: sql.slice(start + 1, i - 1).replaceAll(delimiter + delimiter, delimiter) }); continue;
    }
    const dollar = /^(\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$)/.exec(sql.slice(i))?.[0];
    if (dollar) {
      const end = sql.indexOf(dollar, i + dollar.length);
      if (end < 0) fail('unterminated dollar string');
      i = end + dollar.length; result.push({ start, end: i, kind: 'literal', value: '' }); continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z_0-9$]*/.exec(sql.slice(i))?.[0];
    if (identifier) { i += identifier.length; result.push({ start, end: i, kind: 'identifier', value: identifier.toLowerCase() }); continue; }
    i++; result.push({ start, end: i, kind: 'symbol', value: sql[start] });
  }
  return result;
}

/** Resolve one stored write target without translating expressions or bindings.
 * Explicit aliases survive unchanged; UPDATE/DELETE get the logical table's
 * implicit alias so existing `rows.id` references still resolve after renaming. */
export function compileStoredMutation(catalog: DatasetCatalog, sql: string, targetName: string): { sql: string; table: DatasetTable } {
  if (catalog.kind !== 'stored') fail('only stored datasets are writable');
  if (!targetName || targetName.includes('\0')) fail('invalid physical target');
  if (typeof sql !== 'string' || sql.length > 100_000) fail('invalid or oversized SQL');
  const parts = tokens(sql);
  const semicolons = parts.flatMap((part, index) => part.kind === 'symbol' && part.value === ';' ? [index] : []);
  if (semicolons.length > 1 || (semicolons.length === 1 && semicolons[0] !== parts.length - 1)) fail('exactly one write statement is required');
  if (parts.at(-1)?.value === ';' && parts.at(-1)?.kind === 'symbol') parts.pop();
  const operation = parts[0]?.kind === 'identifier' ? parts[0].value : '';
  let index = 1;
  if (operation === 'insert' || operation === 'delete') {
    const keyword = operation === 'insert' ? 'into' : 'from';
    if (parts[index]?.kind !== 'identifier' || parts[index++].value !== keyword) fail(`expected ${keyword.toUpperCase()}`);
  } else if (operation !== 'update') fail('expected INSERT, UPDATE or DELETE');
  const identifier = (): Token => {
    const token = parts[index++];
    if (!token || !['identifier', 'quoted'].includes(token.kind)) fail('expected a table identifier');
    return token;
  };
  const first = identifier(); let last = first;
  let schema = catalog.defaultSchema; let name = first.value;
  if (parts[index]?.kind === 'symbol' && parts[index].value === '.') {
    index++; last = identifier(); schema = first.value; name = last.value;
  }
  if (parts[index]?.kind === 'symbol' && parts[index].value === '.') fail('only schema.table targets are supported');
  const matches = catalog.tables.filter(table => table.schema === schema && table.name === name);
  if (matches.length !== 1) fail('target is not in the catalog');
  const table = matches[0];
  if (table.sql !== undefined || table.source || !table.objectKey) fail('target must be a stored table, not a model');
  const next = parts[index];
  const hasAlias = next && (next.kind === 'quoted' || (next.kind === 'identifier' && !['set', 'where', 'using', 'returning'].includes(next.value)));
  const alias = operation !== 'insert' && !hasAlias ? ` AS ${quote(name)}` : '';
  return { sql: sql.slice(0, first.start) + quote(targetName) + alias + sql.slice(last.end), table };
}
