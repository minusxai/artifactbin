import {LIKES_TABLE} from '@artifactbin/contracts';
import {COLUMN_SQL_TYPES} from './column-types';
import type {
  DuckDBConnection,
  DuckDBPreparedStatement,
} from '@duckdb/node-api';
import type {
  DatasetOperation,
  MutationAnalysis,
  MutationInput,
  Scalar,
  Row,
  InsertPermission,
  UpdatePermission,
  DeletePermission,
} from '@artifactbin/contracts';
import { compilePolicyPredicate, policyValue } from '@artifactbin/utils';

type Node = Record<string, any>; // Native DuckDB JSON AST/plan is validated at the boundary below.
const quote = (v: string) => `"${v.replaceAll('"', '""')}"`;
const literal = (v: string) => `'${v.replaceAll("'", "''")}'`;
export class DatasetPolicyDenied extends Error {}
function refuse(message: string): never {
  throw new DatasetPolicyDenied(`Dataset policy: ${message}`);
}
interface Token {
  text: string;
  start: number;
  end: number;
  depth: number;
  word: boolean;
}
/** Only segments the deliberately small DML envelope. DuckDB binds the entire
 * original statement and parses each extracted SELECT; this is not SQL analysis. */
function lex(sql: string): Token[] {
  const out: Token[] = [];
  let depth = 0;
  for (let i = 0; i < sql.length;) {
    if (/\s/.test(sql[i])) {
      i++;
      continue;
    }
    if (sql.startsWith('--', i)) {
      i = sql.indexOf('\n', i);
      if (i < 0) break;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      i += 2;
      let d = 1;
      while (i < sql.length && d) {
        if (sql.startsWith('/*', i)) {
          d++;
          i += 2;
        } else if (sql.startsWith('*/', i)) {
          d--;
          i += 2;
        } else i++;
      }
      if (d) refuse('unterminated comment');
      continue;
    }
    const start = i;
    let word = false;
    if (sql[i] === "'" || sql[i] === '"') {
      const q = sql[i++];
      let closed = false;
      while (i < sql.length) {
        if (sql[i++] == q) {
          if (sql[i] === q) i++;
          else {
            closed = true;
            break;
          }
        }
      }
      if (!closed) refuse('unterminated quote');
    } else if (sql[i] === '$' && /^(\$[\w]*\$)/.test(sql.slice(i))) {
      const delimiter = /^(\$[\w]*\$)/.exec(sql.slice(i))![0];
      const end = sql.indexOf(delimiter, i + delimiter.length);
      if (end < 0) refuse('unterminated dollar string');
      i = end + delimiter.length;
    } else {
      const match = /^[A-Za-z_][\w$]*/.exec(sql.slice(i));
      if (match) {
        word = true;
        i += match[0].length;
      } else i++;
    }
    const text = sql.slice(start, i);
    if (text === ')') depth--;
    if (depth < 0) refuse('unbalanced expression');
    out.push({
      text: word ? text.toLowerCase() : text,
      start,
      end: i,
      depth,
      word,
    });
    if (text === '(') depth++;
  }
  if (depth) refuse('unbalanced expression');
  return out;
}
async function nativeJson(
  conn: DuckDBConnection,
  fn: string,
  sql: string,
): Promise<Node> {
  const rows = (
    await conn.runAndReadAll(`SELECT ${fn}(${literal(sql)}) AS value`)
  ).getRowObjects();
  const value = JSON.parse(String(rows[0].value));
  if (value.error) refuse(`statement cannot be safely analyzed: ${String(value.error_message??'unsupported statement').split('\n')[0]!.slice(0,240)}`);
  return value;
}
function visit(value: unknown, fn: (node: Node) => void) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((x) => visit(x, fn));
    return;
  }
  fn(value as Node);
  for (const v of Object.values(value)) visit(v, fn);
}
/**
 * THE STATEMENT AS THE PLANNER MUST SEE IT. `json_serialize_plan` plans TEXT,
 * and `$_row.id` cannot be planned unbound — DuckDB answers an internal error,
 * and the analysis below then refuses a row action that executes perfectly:
 * every row button on a viewers-write dataset, for every viewer.
 *
 * So the planning COPY carries what execution binds — the `$_row` struct as a
 * typed struct literal of the dataset's own columns, each scalar as a typed
 * placeholder: its DECLARED type when the caller sent one (`paramTypes`),
 * otherwise inferred from the bound value as before. TYPES ONLY: no caller
 * value ever becomes SQL text, and this
 * copy is planned, never run. Parameter references come from the lexer, so a
 * `$` inside a string or a comment is left alone.
 */
function plannedSql(input: MutationInput): string {
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const tokens = lex(input.sql);
  for (let i = 0; i < tokens.length - 1; i++) {
    const dollar = tokens[i],
      next = tokens[i + 1];
    if (dollar.text !== '$' || !next.word || next.start !== dollar.end) continue;
    const name = input.sql.slice(next.start, next.end);
    let text: string;
    if (name === '_row') {
      const columns = input.row?.columns ?? [];
      // Nothing to type it with: leave it, and let the planner refuse as before.
      if (!columns.length) continue;
      text = `({${columns
        .map(
          (c) =>
            `${literal(c.name)}: CAST(NULL AS ${COLUMN_SQL_TYPES[c.type]})`,
        )
        .join(',')}})`;
    } else {
      const declared = input.paramTypes?.[name];
      if (declared && Object.hasOwn(COLUMN_SQL_TYPES, declared)) {
        // The DECLARED type wins over the JavaScript value, and applies to a
        // null binding too: a date Value travels as a string, and planning it
        // as VARCHAR refused `coalesce($due, current_date)` for every reader
        // who picked a date while publish, which binds NULLs, planned nothing
        // at all. Typed here, publish sees the clash the click would.
        text = `CAST(NULL AS ${COLUMN_SQL_TYPES[declared]})`;
      } else {
        const value = input.params[name];
        const type =
          typeof value === 'number'
            ? 'DOUBLE'
            : typeof value === 'boolean'
              ? 'BOOLEAN'
              : typeof value === 'string'
                ? 'VARCHAR'
                : null;
        // Undeclared: an absent or null binding stays untyped, exactly as the
        // parameter itself would be resolved — the surrounding column decides.
        text = type ? `CAST(NULL AS ${type})` : 'NULL';
      }
    }
    edits.push({ start: dollar.start, end: next.end, text });
    i++;
  }
  let sql = input.sql;
  for (const edit of edits.reverse())
    sql = sql.slice(0, edit.start) + edit.text + sql.slice(edit.end);
  return sql;
}
async function analysis(conn: DuckDBConnection, input: MutationInput) {
  const p = input.policy!;
  const plan = await nativeJson(conn, 'json_serialize_plan', plannedSql(input));
  if (!Array.isArray(plan.plans) || plan.plans.length !== 1)
    refuse('expected one analyzed write');
  const root = plan.plans[0];
  const operation = (
    {
      LOGICAL_INSERT: 'insert',
      LOGICAL_UPDATE: 'update',
      LOGICAL_DELETE: 'delete',
    } as const
  )[root.type as 'LOGICAL_INSERT'];
  if (!operation || !p.operations.includes(operation))
    refuse('operation is not permitted');
  if (
    root.table_info?.table !== input.table.name ||
    root.table_info?.schema !== 'main'
  )
    refuse('unrecognized write target');
  if (root.return_chunk || (root.action_type && root.action_type !== 'THROW'))
    refuse('RETURNING and conflict clauses are not supported');
  const names = input.table.columns.map((c) => c.name);
  const indices =
    operation === 'insert'
      ? root.column_index_map?.internal_vector?.length
        ? root.column_index_map.internal_vector.flatMap(
            (x: number, i: number) => (Number.isSafeInteger(x) ? [i] : []),
          )
        : names.map((_, i) => i)
      : operation === 'update'
        ? root.columns
        : [];
  if (
    !Array.isArray(indices) ||
    indices.some((i: unknown) => !Number.isInteger(i) || !names[i as number])
  )
    refuse('unrecognized write columns');
  const entries = p.table[`${operation}_permissions`] as
    | Array<{
        role: string;
        permission: InsertPermission | UpdatePermission | DeletePermission;
      }>
    | undefined;
  const permission = entries?.find((e) => e.role === p.role)?.permission;
  if (!permission) refuse('no matching role permission');
  if (
    'columns' in permission &&
    permission.columns !== undefined &&
    permission.columns !== '*' &&
    indices.some((i: number) => !permission.columns?.includes(names[i]))
  )
    refuse('a written column is not permitted');
  const functions = new Set<string>();
  const deny = new Set(
    (p.execution?.functions?.deny ?? []).map((s) => s.toLowerCase()),
  );
  const allow = p.execution?.functions?.allow?.map((s) => s.toLowerCase());
  visit(root, (node) => {
    if (
      node.type === 'LOGICAL_GET' &&
      (node.name !== 'seq_scan' ||
        (node.function_data?.table !== input.table.name && !(input.likes!==undefined && node.function_data?.table===LIKES_TABLE)))
    )
      refuse('opaque or external table functions are not supported');
    if (
      node.expression_class === 'BOUND_FUNCTION' ||
      node.expression_class === 'BOUND_AGGREGATE' ||
      node.expression_class === 'BOUND_WINDOW'
    ) {
      if (typeof node.name !== 'string') refuse('unresolved function');
      const name = node.name.toLowerCase();
      functions.add(name);
      const qualified = `${node.schema_name}.${name}`;
      if (
        deny.has(name) ||
        deny.has(qualified) ||
        (allow && !allow.includes(name) && !allow.includes(qualified))
      )
        refuse(`function ${name} is not permitted`);
    }
  });
  return {
    operation: operation as DatasetOperation,
    permission,
    names,
    evidence: {
      operation: operation as DatasetOperation,
      columns: indices.map((i: number) => names[i]),
      functions: [...functions],
    },
  };
}
/** Rebuild a parsed SELECT with the server predicate as a separate AST child.
 * Never splice policy text into authored SQL or rely on its WHERE clause. */
async function filteredSelect(
  conn: DuckDBConnection,
  sql: string,
  filter: string,
): Promise<string> {
  const parsed = await nativeJson(conn, 'json_serialize_sql', sql);
  const condition = await nativeJson(
    conn,
    'json_serialize_sql',
    `SELECT 1 WHERE ${filter}`,
  );
  const node = parsed.statements?.[0]?.node;
  if (parsed.statements?.length !== 1 || node?.type !== 'SELECT_NODE')
    refuse('unsupported selection');
  const server = condition.statements[0].node.where_clause;
  node.where_clause = node.where_clause
    ? {
        class: 'CONJUNCTION',
        type: 'CONJUNCTION_AND',
        alias: '',
        query_location: 0,
        children: [node.where_clause, server],
      }
    : server;
  visit(parsed, (node) => {
    if ('query_location' in node) node.query_location = 0;
  });
  const result = (
    await conn.runAndReadAll(
      `SELECT json_deserialize_sql(${literal(JSON.stringify(parsed))}) AS sql`,
    )
  ).getRowObjects();
  return String(result[0].sql);
}
export async function runPolicyMutation(
  conn: DuckDBConnection,
  input: MutationInput,
  bind: (
    statement: DuckDBPreparedStatement,
    params: Record<string, Scalar>,
  ) => Promise<void>,
): Promise<{ affected: number; analysis: MutationAnalysis; userWrites?: Row[] }> {
  const { operation, permission, names, evidence } = await analysis(
    conn,
    input,
  );
  const p = input.policy!;
  if (
    names.some(
      (n) =>
        n.toLowerCase() === 'rowid' || n.toLowerCase().startsWith('__policy_'),
    ) ||
    Object.keys(input.params).some((n) =>
      n.toLowerCase().startsWith('__policy_'),
    )
  )
    refuse('reserved policy identifier');
  const tokens = lex(input.sql);
  if (tokens.at(-1)?.text === ';') tokens.pop();
  if (
    tokens.some(
      (t) =>
        t.text === ';' ||
        (t.word && ['returning', 'conflict'].includes(t.text)),
    )
  )
    refuse('unsupported write clause');
  if (tokens[0]?.text !== operation)
    refuse('CTE-prefixed mutations are not supported');
  let index = operation === 'update' ? 1 : 2;
  const targetStart = tokens[index]?.start;
  index++;
  if (tokens[index]?.text === '.') {
    index += 2;
  }
  const targetEnd = tokens[index - 1]?.end;
  if (targetStart === undefined || targetEnd === undefined)
    refuse('missing target');
  const end = tokens.at(-1)!.end;
  let selection: string;
  const originalTarget = input.sql.slice(targetStart, targetEnd);
  if (operation === 'insert') {
    let columns = names;
    if (tokens[index]?.text === '(') {
      const open = index++;
      const close = tokens.findIndex(
        (t, i) => i > open && t.text === ')' && t.depth === 0,
      );
      if (close < 0) refuse('invalid column list');
      columns = tokens
        .slice(index, close)
        .filter((t) => t.text !== ',')
        .map((t) => {
          const name = t.text.startsWith('"')
            ? t.text.slice(1, -1).replaceAll('""', '"')
            : t.text;
          return (
            names.find((n) => n.toLowerCase() === name.toLowerCase()) ?? name
          );
        });
      index = close + 1;
    }
    const source = input.sql.slice(tokens[index]?.start ?? end, end);
    if (tokens[index]?.text === 'default')
      selection = `SELECT ${names.map((n) => `NULL AS ${quote(n)}`).join(',')}`;
    else {
      if (!['values', 'select', 'with'].includes(tokens[index]?.text))
        refuse('unsupported insert source');
      selection = `SELECT ${names.map((n) => (columns.includes(n) ? quote(n) : `NULL AS ${quote(n)}`)).join(',')} FROM (${source}) AS __policy_input(${columns.map(quote).join(',')})`;
    }
  } else {
    const where = tokens.find(
      (t) => t.depth === 0 && t.word && t.text === 'where',
    );
    if (operation === 'delete')
      selection = `SELECT rowid AS __policy_rowid FROM ${input.sql.slice(targetStart, where?.start ?? end)}${where ? input.sql.slice(where.start, end) : ''}`;
    else {
      const setIndex = tokens.findIndex(
        (t) => t.depth === 0 && t.word && t.text === 'set',
      );
      if (setIndex < 0) refuse('missing SET');
      // The word FROM also ENDS an operator phrase. `IS [NOT] DISTINCT FROM`
      // is the one that reaches depth 0 — and it is the optimistic-concurrency
      // idiom every `set_*` example in the markup reference teaches, so
      // refusing it refused the documented way to write a row action. The
      // call forms (`extract`/`substring`/`trim`/`overlay` … FROM …) carry
      // their FROM inside the call's own parentheses, which this depth-0 scan
      // already steps over.
      const operatorFrom = (i: number) =>
        tokens[i - 1]?.text === 'distinct' &&
        (tokens[i - 2]?.text === 'is' ||
          (tokens[i - 2]?.text === 'not' && tokens[i - 3]?.text === 'is'));
      if (
        tokens.some(
          (t, i) =>
            i > setIndex &&
            t.depth === 0 &&
            t.word &&
            t.text === 'from' &&
            !operatorFrom(i),
        )
      )
        refuse('UPDATE FROM is not supported');
      const assignments = tokens
        .slice(setIndex + 1)
        .filter((t) => t.start < (where?.start ?? end));
      const segments: Token[][] = [];
      let group: Token[] = [];
      for (const t of assignments) {
        if (t.text === ',' && t.depth === 0) {
          segments.push(group);
          group = [];
        } else group.push(t);
      }
      segments.push(group);
      const replacements = segments.map((ts) => {
        if (ts[1]?.text !== '=' || !ts[2]) refuse('unsupported SET target');
        return `${input.sql.slice(ts[2].start, ts.at(-1)!.end)} AS ${ts[0].text.startsWith('"') ? ts[0].text : quote(ts[0].text)}`;
      });
      selection = `SELECT rowid AS __policy_rowid, * REPLACE (${replacements.join(',')}) FROM ${input.sql.slice(targetStart, tokens[setIndex].start)}${where ? input.sql.slice(where.start, end) : ''}`;
    }
  }
  // Preserve named calls that DuckDB lowers to operators or expands as macros,
  // in addition to the resolved dependencies checked in the bound write plan.
  const syntax = await nativeJson(conn, 'json_serialize_sql', selection);
  visit(syntax, (node) => {
    const name =
      typeof node.function_name === 'string'
        ? node.function_name.toLowerCase()
        : node.type === 'OPERATOR_COALESCE'
          ? 'coalesce'
          : undefined;
    if (!name) return;
    const qualified = `${node.schema || 'main'}.${name}`,
      f = p.execution?.functions;
    if (
      f?.deny?.some((n) => [name, qualified].includes(n.toLowerCase())) ||
      (f?.allow &&
        !f.allow.some((n) => [name, qualified].includes(n.toLowerCase())))
    )
      refuse(`function ${name} is not permitted`);
    // Also HERE, not only in the bound plan: a call whose arguments are all
    // parameters is a constant expression once they are typed placeholders,
    // and DuckDB folds such a call out of the plan it serializes.
    if (!evidence.functions.includes(name)) evidence.functions.push(name);
  });
  const filter = compilePolicyPredicate(
    'filter' in permission ? permission.filter : {},
    names,
    p.session,
    '__policy_filter',
  );
  if (operation !== 'insert')
    selection = await filteredSelect(conn, selection, filter.sql);
  if (input.policyPreview) return { affected: 0, analysis: evidence };
  const temp = '__policy_candidates';
  const shape =
    operation === 'delete'
      ? 'rowid AS __policy_rowid'
      : operation === 'update'
        ? 'rowid AS __policy_rowid, *'
        : '*';
  await conn.run(
    `CREATE TEMP TABLE ${temp} AS SELECT ${shape} FROM ${originalTarget} WHERE FALSE`,
  );
  const statement = await conn.prepare(`INSERT INTO ${temp} ${selection}`);
  await bind(statement, { ...input.params, ...filter.params });
  await statement.run();
  if ('set' in permission && permission.set) {
    const params: Record<string, Scalar> = {};
    const sets = Object.entries(permission.set).map(([name, v], i) => {
      if (!names.includes(name)) refuse('unknown preset column');
      params[`__policy_set_${i}`] = policyValue(v, p.session);
      return `${quote(name)}=$__policy_set_${i}`;
    });
    if (sets.length) {
      const s = await conn.prepare(`UPDATE ${temp} SET ${sets.join(',')}`);
      await bind(s, params);
      await s.run();
    }
  }
  if ('check' in permission && permission.check) {
    const check = compilePolicyPredicate(
      permission.check,
      names,
      p.session,
      '__policy_check',
    );
    const s = await conn.prepare(
      `SELECT count(*) AS n FROM ${temp} WHERE (${check.sql}) IS NOT TRUE`,
    );
    await bind(s, check.params);
    if (Number((await s.runAndReadAll()).getRowObjects()[0].n))
      refuse('a resulting row failed its check');
  }
  // Inspect candidate assignments, including same-value writes and policy presets.
  // Unwritten historical identity fields are deliberately absent.
  const written = new Set(operation === 'insert' ? names : [...evidence.columns, ...('set' in permission ? Object.keys(permission.set ?? {}) : [])]);
  const userColumns = operation === 'delete' ? [] : input.table.columns.filter(c => c.type === 'user' && written.has(c.name));
  const userWrites = userColumns.length
    ? (await conn.runAndReadAll(`SELECT ${userColumns.map(c => quote(c.name)).join(',')} FROM ${temp}`)).getRowObjects()
    : [];
  const affected = Number(
    (
      await conn.runAndReadAll(`SELECT count(*) AS n FROM ${temp}`)
    ).getRowObjects()[0].n,
  );
  if (operation === 'insert')
    await conn.run(
      `INSERT INTO ${quote(input.table.name)} SELECT * FROM ${temp}`,
    );
  else if (operation === 'delete')
    await conn.run(
      `DELETE FROM ${quote(input.table.name)} WHERE rowid IN (SELECT __policy_rowid FROM ${temp})`,
    );
  else
    await conn.run(
      `UPDATE ${quote(input.table.name)} AS target SET ${names.map((n) => `${quote(n)}=candidate.${quote(n)}`).join(',')} FROM ${temp} AS candidate WHERE target.rowid=candidate.__policy_rowid`,
    );
  return { affected, analysis: evidence, userWrites };
}
