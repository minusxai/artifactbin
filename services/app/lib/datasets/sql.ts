import { parse, toSql, type SelectStatement } from 'pgsql-ast-parser';
import type { DatasetCatalog, DatasetNotebook } from './types';
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
// The parser/renderer retain escaped double quotes inside identifier AST names.
const astName = (name: string): string => name.replaceAll('"', '""');
const catalogName = (name: string): string => name.replaceAll('""', '"');

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

type Budget = { expanded: number; input: number; columns: number };
const newBudget = (): Budget => ({ expanded: 0, input: 0, columns: 0 });

function readSql(text: string, bind: (name: string) => string, budget: Budget): Node {
  if (typeof text !== 'string' || text.length > 100_000) fail('query is too large');
  if ((budget.input += text.length) > 2_000_000) fail('expanded query is too large');
  const bound = bindParameters(text, bind);
  let statements;
  try { statements = parse(bound); } catch { return fail('unsupported or invalid syntax'); }
  if (statements.length !== 1) fail('exactly one read statement is required');
  return statements[0] as unknown as Node;
}

function render(statement: Node, values: Scalar[]): { sql: string; values: Scalar[] } {
  let sql: string;
  try { sql = toSql.statement(statement as unknown as SelectStatement); }
  catch { return fail('unsupported syntax'); }
  if (sql.length > 2_000_000) fail('expanded query is too large');
  return { sql, values };
}

/** Validate and compose only the target's dependency closure. Unused draft SQL
 * is not parsed; all cell identities and notebook resource limits still apply. */
function notebookStatement(sources: DatasetCatalog, notebook: DatasetNotebook, cellId: string, budget: Budget): Node {
  if (!notebook || !Array.isArray(notebook.cells)) fail('invalid notebook');
  const cells = notebook.cells;
  if (cells.length > 100) fail('too many notebook cells');
  const names = new Map<string, number>(); const ids = new Set<string>();
  let total = 0;
  for (const [index, cell] of cells.entries()) {
    if (!cell || typeof cell.id !== 'string' || !cell.id.length || cell.id.length > 200) fail('invalid notebook cell id');
    // PostgreSQL truncates identifiers at 63 bytes. Refuse names that could
    // silently collide after parsing, while allowing quoted SQL identifiers.
    if (typeof cell.name !== 'string' || !cell.name || cell.name.includes('\0') || new TextEncoder().encode(cell.name).length > 63) fail('invalid notebook cell name');
    if (ids.has(cell.id) || names.has(astName(cell.name))) fail('duplicate notebook cell id or name');
    ids.add(cell.id); names.set(astName(cell.name), index);
    if (typeof cell.sql !== 'string' || cell.sql.length > 100_000) fail('query is too large');
    if ((total += cell.sql.length) > 1_000_000) fail('notebook is too large');
  }
  const target = cells.findIndex(cell => cell.id === cellId);
  if (target < 0) fail('unknown notebook cell');
  const statements = new Map<number, Node>();
  const heights = new Map<number, number>();
  function visit(index: number, depth: number): number {
    if (depth > 32) fail('notebook dependency depth is too large');
    if (heights.has(index)) return heights.get(index)!;
    const statement = readSql(cells[index].sql, () => fail('notebook parameters are not supported'), budget);
    const dependencies = new Set<number>();
    function discover(value: unknown, scope: Set<string>, nesting = 0): void {
      if (nesting > 100) fail('query nesting is too deep');
      if (Array.isArray(value)) { for (const child of value) discover(child, scope, nesting + 1); return; }
      if (!value || typeof value !== 'object') return;
      const node = value as Node;
      if (node.type === 'with') {
        const local = new Set(scope);
        for (const binding of node.bind as Array<{ alias: { name: string }; statement: Node }>) {
          discover(binding.statement, local, nesting + 1);
          local.add(binding.alias.name);
        }
        discover(node.in, local, nesting + 1); return;
      }
      if (node.type === 'table') {
        const name = node.name as { name: string; schema?: string };
        if (!name.schema && !scope.has(name.name) && names.has(name.name)) {
          const dependency = names.get(name.name)!;
          if (dependency >= index) fail('notebook cells may reference earlier cells only, never themselves or later cells');
          dependencies.add(dependency);
        }
      }
      for (const child of Object.values(node)) discover(child, scope, nesting + 1);
    }
    discover(statement, new Set());
    let height = 1;
    for (const dependency of dependencies) height = Math.max(height, 1 + visit(dependency, depth + 1));
    if (height > 32) fail('notebook dependency depth is too large');
    statements.set(index, statement); heights.set(index, height);
    return height;
  }
  visit(target, 1);
  // CTEs retain authored names and are emitted once in notebook order. The
  // existing validator understands CTE scopes, including nested WITH shadowing.
  const composed: Node = {
    type: 'with',
    bind: [...statements.keys()].sort((a, b) => a - b).map(index => ({ alias: { name: astName(cells[index].name) }, statement: statements.get(index)! })),
    in: { type: 'select', columns: [{ expr: { type: 'ref', name: '*' } }], from: [{ type: 'table', name: { name: astName(cells[target].name) } }] },
  };
  return compileStatement(sources, composed, {}, undefined, budget).statement;
}

/** Kept in this module so notebook composition shares the same AST validator;
 * generated ASTs never pass back through the authored SQL parameter lexer. */
export function compileNotebookSql(sources: DatasetCatalog, notebook: DatasetNotebook, cellId: string): { sql: string; values: Scalar[] } {
  return render(notebookStatement(sources, notebook, cellId, newBudget()), []);
}

/** Compile one read query against the public catalog. Every physical relation is
 * hidden behind a projection, so PostgreSQL itself enforces column visibility in
 * SELECT, predicates, joins, stars and correlated subqueries alike. */
export function compileDatasetSql(catalog: DatasetCatalog, sql: string, params: Record<string, Scalar> = {}, paramTypes?: Record<string, DatasetColumn['type']>): { sql: string; values: Scalar[] } {
  const { statement, values } = compileStatement(catalog, sql, params, paramTypes, newBudget());
  return render(statement, values);
}

function compileStatement(catalog: DatasetCatalog, input: string | Node, params: Record<string, Scalar>, paramTypes: Record<string, DatasetColumn['type']> | undefined, budget: Budget): { statement: Node; values: Scalar[] } {
  const values: Scalar[] = []; const bindings = new Map<string, string>();
  const bindingTypes = new Map<string, string>();
  // Schema-qualified names must be the catalog names, not SQL aliases:
  // pg_catalog.float8 is DOUBLE PRECISION; pg_catalog.bool is BOOLEAN.
  const parameterCasts: Record<DatasetColumn['type'], string> = { string: 'text', number: 'float8', boolean: 'bool', date: 'date' };
  function read(text: string): Node {
    return readSql(text, name => {
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
    }, budget);
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
      const schema = name.schema === undefined ? catalog.defaultSchema : catalogName(name.schema);
      if (systemSchema(schema)) fail('system schemas are not allowed');
      const matches = catalog.tables.filter(t => t.schema === schema && t.name === catalogName(name.name));
      if (matches.length !== 1) fail('relation is not in the catalog');
      const table = matches[0]; const key = JSON.stringify([schema, name.name]);
      if (stack.includes(key)) fail('model cycle detected');
      if (++budget.expanded > 200) fail('too many model expansions');
      if (!table.columns.length || table.columns.some(c => c.name === '*')) fail('invalid exposed columns');
      if ((budget.columns += table.columns.length) > 20_000) fail('too many projected columns');
      if ([table.sql, table.source, table.modelCellId].filter(value => value !== undefined).length !== 1) fail('table requires exactly one source');
      let from: Node;
      if (table.modelCellId) {
        if (!catalog.notebook || !catalog.notebookSources) return fail('missing notebook source metadata');
        const sources: DatasetCatalog = {
          kind: catalog.kind, defaultSchema: 'public', refreshSeconds: 0,
          tables: catalog.notebookSources.map(source => ({ schema: source.schema, name: source.name, columns: source.columns, source: { schema: source.schema, table: source.name } })),
        };
        from = { type: 'statement', alias: '_dataset_model', statement: notebookStatement(sources, catalog.notebook, table.modelCellId, budget) };
      } else if (table.sql && !table.source) {
        from = { type: 'statement', alias: '_dataset_model', statement: query(read(table.sql), new Set(), [...stack, key], depth + 1) };
      } else if (table.source && !table.sql) {
        if (systemSchema(table.source.schema)) fail('system sources are not allowed');
        from = { type: 'table', name: { schema: astName(table.source.schema), name: astName(table.source.table) } };
      } else return fail('table requires exactly one source');
      return { type: 'statement', alias: name.alias ?? name.name, join: walk(node.join, scope, stack, depth + 1), statement: {
        type: 'select', columns: table.columns.map(column => ({ expr: { type: 'ref', name: astName(column.name) } })), from: [from],
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
  return { statement: query(typeof input === 'string' ? read(input) : input, new Set(), []), values };
}
