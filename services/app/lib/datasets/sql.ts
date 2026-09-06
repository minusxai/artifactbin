import { parse, toSql, type SelectStatement } from 'pgsql-ast-parser';
import type { DatasetCatalog } from './types';
import type { Scalar } from '@/lib/story/dataflow';
import type { DatasetColumn } from '@/lib/story/dataset-shape';

const FUNCTIONS = new Set(`exists count sum avg min max bool_and bool_or every array_agg string_agg json_agg jsonb_agg json_object_agg jsonb_object_agg
  abs ceil ceiling floor round trunc mod power sqrt exp ln log sign greatest least coalesce nullif
  lower upper length char_length octet_length trim btrim ltrim rtrim substring substr replace concat concat_ws split_part left right position strpos
  date_trunc date_part make_date make_timestamp age to_char to_date to_timestamp now
  row_number rank dense_rank percent_rank cume_dist ntile lag lead first_value last_value nth_value
  json_build_object jsonb_build_object json_build_array jsonb_build_array json_array_length jsonb_array_length json_typeof jsonb_typeof
  to_json to_jsonb array_length cardinality array_to_string`.split(/\s+/));
const TYPES = new Set('text varchar char character bpchar name boolean bool smallint int2 integer int int4 bigint int8 real float4 float8 numeric decimal date timestamp timestamptz time timetz interval uuid json jsonb bytea'.split(' '));
// Multiword parser type names are single AST names.
for (const name of ['character varying', 'double precision', 'timestamp without time zone', 'timestamp with time zone', 'time without time zone', 'time with time zone']) TYPES.add(name);
const BINARY = new Set('OR AND IN NOT IN LIKE NOT LIKE ILIKE NOT ILIKE = != <> > >= < <= + - * / % ^ | & # << >> || @> <@ ? ?| ?& #>> #- && ~ ~* !~ !~* AT TIME ZONE'.split(' '));
for (const op of ['NOT IN', 'NOT LIKE', 'NOT ILIKE', 'AT TIME ZONE']) BINARY.add(op);
const UNARY = new Set(['+', '-', 'NOT', 'IS NULL', 'IS NOT NULL', 'IS TRUE', 'IS FALSE', 'IS NOT TRUE', 'IS NOT FALSE']);
const EXPRESSIONS = new Set(['ref', 'parameter', 'list', 'array', 'array select', 'null', 'extract', 'integer', 'member', 'arrayIndex', 'numeric', 'string', 'case', 'binary', 'unary', 'boolean', 'call', 'ternary', 'overlay', 'substring', 'keyword']);
const JOINS = new Set(['INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN']);
const systemSchema = (schema: string) => schema === 'information_schema' || schema.startsWith('pg_');
const fail = (reason: string): never => { throw new Error(`Dataset SQL: ${reason}`); };
type Node = Record<string, unknown>;

/** Only lexical work happens here: comments/quoted tokens never become parameters.
 * Dollar strings are normalized because the parser supports them only in function bodies. */
function bindParameters(sql: string, bind: (name: string) => string): string {
  let result = '';
  for (let i = 0; i < sql.length;) {
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i + 2); i = end < 0 ? sql.length : end; result += ' '; continue;
    }
    if (sql.startsWith('/*', i)) {
      let depth = 1; i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) { depth++; i += 2; }
        else if (sql.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) fail('unterminated comment'); result += ' '; continue;
    }
    if (sql[i] === "'" || sql[i] === '"') {
      const start = i; const quote = sql[i++];
      const escaped = quote === "'" && /[eE]/.test(sql[start - 1] ?? '') && (start < 2 || !/[\w$]/.test(sql[start - 2]));
      let closed = false;
      while (i < sql.length) {
        if (escaped && sql[i] === '\\') { i += 2; continue; }
        if (sql[i++] === quote) {
          if (sql[i] === quote) { i++; continue; }
          closed = true; break;
        }
      }
      if (!closed) fail('unterminated quoted token'); result += sql.slice(start, i); continue;
    }
    if (sql[i] === '$') {
      const delimiter = /^(\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$)/.exec(sql.slice(i))?.[0];
      if (delimiter) {
        const end = sql.indexOf(delimiter, i + delimiter.length);
        if (end < 0) fail('unterminated dollar string');
        result += "'" + sql.slice(i + delimiter.length, end).replaceAll("'", "''") + "'";
        i = end + delimiter.length; continue;
      }
      const name = /^\$([A-Za-z_][A-Za-z_0-9]*)/.exec(sql.slice(i));
      if (!name) return fail('only named parameters are supported');
      result += bind(name[1]); i += name[0].length; continue;
    }
    // The AST parser stores numeric literals as JS numbers. Preserve exact decimal
    // and int8 literals as numeric casts before that conversion can round them.
    const number = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(sql.slice(i));
    if (number) {
      const literal = number[0];
      result += /^[0-9]+$/.test(literal) && Number.isSafeInteger(Number(literal)) ? literal : `('${literal}'::numeric)`;
      i += literal.length; continue;
    }
    // Consume identifiers as a token: dollars inside an identifier are not binds.
    const word = /^[A-Za-z_][A-Za-z_0-9$]*/.exec(sql.slice(i));
    if (word) { result += word[0]; i += word[0].length; continue; }
    result += sql[i++];
  }
  return result;
}

/** Compile one read query against the public catalog. Every physical relation is
 * hidden behind a projection, so PostgreSQL itself enforces column visibility in
 * SELECT, predicates, joins, stars and correlated subqueries alike. */
export function compileDatasetSql(catalog: DatasetCatalog, sql: string, params: Record<string, Scalar> = {}, paramTypes?: Record<string, DatasetColumn['type']>): { sql: string; values: Scalar[] } {
  const values: Scalar[] = []; const bindings = new Map<string, string>();
  const bindingTypes = new Map<string, string>();
  // Schema-qualified names must be the catalog names, not SQL aliases:
  // pg_catalog.float8 is DOUBLE PRECISION; pg_catalog.bool is BOOLEAN.
  const parameterCasts: Record<DatasetColumn['type'], string> = { string: 'text', number: 'float8', boolean: 'bool', date: 'date' };
  let expanded = 0;
  function read(text: string): Node {
    if (typeof text !== 'string' || text.length > 100_000) fail('query is too large');
    const bound = bindParameters(text, name => {
      if (!Object.hasOwn(params, name)) fail(`undeclared parameter $${name}`);
      const value = params[name];
      if (!(value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))) fail('invalid parameter');
      if (paramTypes !== undefined) {
        if (!Object.hasOwn(paramTypes, name)) fail(`missing parameter type for $${name}`);
        const kind = paramTypes[name];
        if (!Object.hasOwn(parameterCasts, kind)) fail('invalid parameter type');
        const expectedKind = kind === 'date' ? 'string' : kind;
        if (value !== null && typeof value !== expectedKind) fail(`parameter $${name} does not match its declared type`);
      }
      if (!bindings.has(name)) {
        values.push(value); const position = `$${values.length}`; bindings.set(name, position);
        if (paramTypes !== undefined) bindingTypes.set(position, parameterCasts[paramTypes[name]]);
      }
      return bindings.get(name)!;
    });
    let statements;
    try { statements = parse(bound); } catch { return fail('unsupported or invalid syntax'); }
    if (statements.length !== 1) fail('exactly one read statement is required');
    return statements[0] as unknown as Node;
  }
  function dataType(value: unknown): void {
    if (!value || typeof value !== 'object') fail('unsupported cast');
    const node = value as Node;
    if (node.kind === 'array') { dataType(node.arrayOf); return; }
    if (node.schema || !TYPES.has(String(node.name))) fail('cast type is not allowed');
  }
  function walk(value: unknown, scope: Set<string>, stack: string[], depth = 0): unknown {
    if (depth > 100) fail('query nesting is too deep');
    if (Array.isArray(value)) return value.map(child => walk(child, scope, stack, depth + 1));
    if (!value || typeof value !== 'object') return value;
    const node = value as Node;
    if (node.type === 'parameter') {
      const name = bindingTypes.get(String(node.name));
      // Construct trusted casts after parsing. Authored schema-qualified casts
      // still pass through dataType's rejection path; parameters are never SQL.
      return name ? { type: 'cast', operand: node, to: { schema: 'pg_catalog', name } } : node;
    }
    if (node.type === 'with') {
      const local = new Set(scope);
      const bind = (node.bind as Array<{ alias: { name: string }; statement: Node }>).map(binding => {
        const statement = query(binding.statement, local, stack, depth + 1);
        local.add(binding.alias.name); return { ...binding, statement };
      });
      return { ...node, bind, in: query(node.in as Node, local, stack, depth + 1) };
    }
    if (node.type === 'select' && (node.for || node.skip || node.into)) fail('locking and SELECT INTO are not allowed');
    if (node.type === 'table') {
      const name = node.name as { name: string; schema?: string; alias?: string; columnNames?: unknown };
      if (name.columnNames || node.lateral) fail('unsupported relation alias');
      if (!name.schema && scope.has(name.name)) return { ...node, join: walk(node.join, scope, stack, depth + 1) };
      const schema = name.schema ?? catalog.defaultSchema;
      if (systemSchema(schema)) fail('system schemas are not allowed');
      const matches = catalog.tables.filter(t => t.schema === schema && t.name === name.name);
      if (matches.length !== 1) fail('relation is not in the catalog');
      const table = matches[0]; const key = JSON.stringify([schema, name.name]);
      if (stack.includes(key)) fail('model cycle detected');
      if (++expanded > 200) fail('too many model expansions');
      if (!table.columns.length || table.columns.some(c => c.name === '*')) fail('invalid exposed columns');
      let from: Node;
      if (table.sql && !table.source) {
        from = { type: 'statement', alias: '_dataset_model', statement: query(read(table.sql), new Set(), [...stack, key], depth + 1) };
      } else if (table.source && !table.sql) {
        if (systemSchema(table.source.schema)) fail('system sources are not allowed');
        from = { type: 'table', name: { schema: table.source.schema, name: table.source.table } };
      } else return fail('table requires exactly one source');
      return { type: 'statement', alias: name.alias ?? name.name, join: walk(node.join, scope, stack, depth + 1), statement: {
        type: 'select', columns: table.columns.map(column => ({ expr: { type: 'ref', name: column.name } })), from: [from],
      } };
    }
    if (node.type === 'statement') {
      return { ...node, statement: query(node.statement as Node, scope, stack, depth + 1), join: walk(node.join, scope, stack, depth + 1) };
    }
    if (node.type === 'select' && Array.isArray(node.from) && node.from.some(f => (f as Node).type === 'call')) fail('table functions are not allowed');
    if (node.type === 'call') {
      const fn = node.function as { name: string; schema?: string };
      if (fn.schema || !FUNCTIONS.has(fn.name)) fail('function is not allowed');
    }
    if (node.type === 'cast' || node.type === 'constant') {
      dataType(node.type === 'cast' ? node.to : node.dataType);
      return node.type === 'cast' ? { ...node, operand: walk(node.operand, scope, stack, depth + 1) } : node;
    }
    if (node.type === 'binary' && (node.opSchema || !BINARY.has(String(node.op)))) fail('operator is not allowed');
    if (node.type === 'unary' && (node.opSchema || !UNARY.has(String(node.op)))) fail('operator is not allowed');
    if (node.type === 'keyword' && !['current_date', 'current_timestamp', 'current_time', 'localtimestamp', 'localtime'].includes(String(node.keyword))) fail('keyword is not allowed');
    if (node.type && !['select', 'union', 'union all'].includes(String(node.type)) && !EXPRESSIONS.has(String(node.type)) && !JOINS.has(String(node.type))) fail('only supported read expressions are allowed');
    return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child, scope, stack, depth + 1)]));
  }
  function query(node: Node, scope: Set<string>, stack: string[], depth = 0): Node {
    if (!['select', 'union', 'union all', 'with'].includes(String(node.type))) fail('only read statements are allowed');
    return walk(node, scope, stack, depth) as Node;
  }
  const statement = query(read(sql), new Set(), []);
  try { return { sql: toSql.statement(statement as unknown as SelectStatement), values }; }
  catch { return fail('unsupported syntax'); }
}
