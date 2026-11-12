/**
 * ONE STATEMENT, READ AS ITS DATABASE READS IT: a small per-dialect lexer (strings, quoted identifiers, comments,
 * Postgres dollar quotes, MySQL executable comments) and the three things the connectors and the page door decide
 * from its tokens, never from a regular expression over the text:
 *
 *  - `bindStatement`: every `$name` outside literals and comments becomes the dialect's own placeholder (`$1`, `?`,
 *    `@name`) and its value goes to the driver, so a value is never SQL text. A `$name` with no value, a positional
 *    placeholder written by hand, or more than CONNECTOR_LIMITS.params values is refused.
 *  - `readOnlyStatement`: the statement's first keyword is one that reads (SELECT, WITH, VALUES, TABLE, SHOW,
 *    EXPLAIN; MySQL also DESCRIBE), and on MySQL no INTO (`SELECT … INTO OUTFILE` / `@var`) and no `/*!` comment
 *    (MySQL runs its text). The read-only session is the main guard; this one keeps out what a read-only transaction
 *    does not stop (MySQL DDL commits implicitly; SET changes the session a later viewer reuses).
 *  - `qualifierNames` / `mapQualifiers`: the page door's name rule. A page's default-connection link NAME is used in
 *    SQL as a qualifier, `NAME.table`; it is rewritten to the link's namespace, quoted in the dialect (`"sales".table`,
 *    `` `sales`.table ``), or removed when the link names none. Only an unquoted word directly before a `.` and not
 *    itself after one is a qualifier; case-insensitive, as unquoted SQL identifiers are.
 */
import type { ConnectorDialect, ConnectorScalar } from '@artifactbin/contracts';
import { CONNECTOR_LIMITS } from '@artifactbin/contracts';
import { ConnectorFailure } from './errors';

type Kind = 'word' | 'quoted' | 'string' | 'comment' | 'param' | 'positional' | 'punct' | 'space';
interface Token { kind: Kind; text: string }

const WORD_START = /[A-Za-z_\u0080-￿]/, WORD = /[A-Za-z0-9_$\u0080-￿]/;
const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}/;

/** Reads `text` to the end of a quoted run opened at `at` by `quote`; `doubled` escapes by repetition, `backslash` by `\`. */
function quotedEnd(text: string, at: number, quote: string, backslash: boolean): number {
  for (let i = at + 1; i < text.length; i++) {
    const c = text[i];
    if (backslash && c === '\\') { i++; continue; }
    if (c === quote) { if (text[i + 1] === quote) { i++; continue; } return i + 1; }
  }
  throw new ConnectorFailure('invalid_query', 'the statement has an unclosed quote');
}

function tokenize(dialect: ConnectorDialect, text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const push = (kind: Kind, end: number) => { out.push({ kind, text: text.slice(i, end) }); i = end; };
  while (i < text.length) {
    const c = text[i]!, next = text[i + 1];
    if (/\s/.test(c)) { let j = i; while (j < text.length && /\s/.test(text[j]!)) j++; push('space', j); continue; }
    if ((c === '-' && next === '-') || (c === '#' && dialect !== 'postgres')) { const j = text.indexOf('\n', i); push('comment', j < 0 ? text.length : j); continue; }
    if (c === '/' && next === '*') {
      if (dialect === 'mysql' && text[i + 2] === '!') throw new ConnectorFailure('invalid_query', 'MySQL executable comments (/*! … */) are refused');
      // Postgres nests block comments; the others end at the first */.
      let depth = 0, j = i;
      for (; j < text.length; j++) {
        if (text[j] === '/' && text[j + 1] === '*') { depth++; j++; }
        else if (text[j] === '*' && text[j + 1] === '/') { depth--; j++; if (depth === 0 || dialect !== 'postgres') { j++; break; } }
      }
      if (depth > 0 && dialect === 'postgres' || j > text.length) throw new ConnectorFailure('invalid_query', 'the statement has an unclosed comment');
      push('comment', j); continue;
    }
    if (c === '\'') { push('string', quotedEnd(text, i, '\'', dialect !== 'postgres')); continue; }
    if (dialect === 'postgres' && (c === 'E' || c === 'e') && next === '\'' && !WORD.test(text[i - 1] ?? ' ')) { i++; const end = quotedEnd(text, i, '\'', true); i--; push('string', end); continue; }
    if (c === '"') { push(dialect === 'postgres' ? 'quoted' : 'string', quotedEnd(text, i, '"', dialect !== 'postgres')); continue; }
    if (c === '`' && dialect !== 'postgres') { push('quoted', quotedEnd(text, i, '`', false)); continue; }
    if (c === '$') {
      const rest = text.slice(i + 1);
      // Postgres dollar quoting: $tag$ … $tag$ (the tag may be empty).
      const tag = dialect === 'postgres' ? /^([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest) : null;
      if (tag) {
        const fence = `$${tag[1] ?? ''}$`, end = text.indexOf(fence, i + fence.length);
        if (end < 0) throw new ConnectorFailure('invalid_query', 'the statement has an unclosed dollar quote');
        push('string', end + fence.length); continue;
      }
      if (/^\d/.test(rest)) throw new ConnectorFailure('invalid_query', 'write parameters as $name, never by position');
      const name = PARAM_NAME.exec(rest);
      if (name) { push('param', i + 1 + name[0].length); continue; }
    }
    if (c === '?' && dialect === 'mysql') throw new ConnectorFailure('invalid_query', 'write parameters as $name, never ?');
    if (c === '@' && dialect === 'bigquery' && PARAM_NAME.test(text.slice(i + 1))) throw new ConnectorFailure('invalid_query', 'write parameters as $name, never @name');
    if (WORD.test(c) && (WORD_START.test(c) || /\d/.test(c))) { let j = i; while (j < text.length && WORD.test(text[j]!)) j++; push('word', j); continue; }
    push('punct', i + 1);
  }
  return out;
}

const significant = (t: Token) => t.kind !== 'space' && t.kind !== 'comment';

/** `$name` → the dialect's placeholder, in order; the values the driver binds. BigQuery keeps names (`@name`). */
export function bindStatement(dialect: ConnectorDialect, text: string, params: Readonly<Record<string, ConnectorScalar>>): { text: string; values: ConnectorScalar[]; names: string[] } {
  if (new TextEncoder().encode(text).length > CONNECTOR_LIMITS.sqlBytes) throw new ConnectorFailure('invalid_query', `a statement is at most ${CONNECTOR_LIMITS.sqlBytes} bytes`);
  if (Object.keys(params).length > CONNECTOR_LIMITS.params) throw new ConnectorFailure('invalid_query', `at most ${CONNECTOR_LIMITS.params} parameters`);
  const order: string[] = [], values: ConnectorScalar[] = [];
  let out = '';
  for (const token of tokenize(dialect, text)) {
    if (token.kind !== 'param') { out += token.text; continue; }
    const name = token.text.slice(1);
    if (!Object.hasOwn(params, name)) throw new ConnectorFailure('invalid_query', `$${name} has no value`);
    const value = params[name]!;
    if (!(value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))) throw new ConnectorFailure('invalid_query', `$${name} must be a string, finite number, boolean or null`);
    if (dialect === 'bigquery') { if (!order.includes(name)) { order.push(name); values.push(value); } out += `@${name}`; continue; }
    if (dialect === 'postgres') {
      let at = order.indexOf(name);
      if (at < 0) { order.push(name); values.push(value); at = order.length - 1; }
      out += `$${at + 1}`;
      continue;
    }
    // MySQL's `?` is positional: one value per use.
    order.push(name); values.push(value); out += '?';
  }
  return { text: out, values, names: order };
}

/**
 * `:name` parameters (a live dataset's SQL, as people write it in most SQL tools) as `$name`, read from the tokens: a
 * `:` directly followed by a name, and neither directly after nor before another `:` (Postgres `x::text` is a cast),
 * outside literals, quoted identifiers and comments. Everything else is kept byte for byte, so `bindStatement` then
 * binds both spellings. Answers the text and the names it used.
 */
export function colonParameters(dialect: ConnectorDialect, text: string): { text: string; names: string[] } {
  const tokens = tokenize(dialect, text), names: string[] = [];
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!, next = tokens[i + 1];
    if (t.kind === 'punct' && t.text === ':' && tokens[i - 1]?.text !== ':' && next?.kind === 'word' && PARAM_NAME.exec(next.text)?.[0] === next.text) {
      out += `$${next.text}`; if (!names.includes(next.text)) names.push(next.text); i++; continue;
    }
    if (t.kind === 'param') { const name = t.text.slice(1); if (!names.includes(name)) names.push(name); }
    out += t.text;
  }
  return { text: out, names };
}

const READS: Record<ConnectorDialect, ReadonlySet<string>> = {
  postgres: new Set(['select', 'with', 'values', 'table', 'show', 'explain']),
  mysql: new Set(['select', 'with', 'values', 'table', 'show', 'explain', 'describe', 'desc']),
  bigquery: new Set(['select', 'with']),
};

/** Refuses anything but one reading statement (see the header). */
export function readOnlyStatement(dialect: ConnectorDialect, text: string, autocommit = false): void {
  const tokens = tokenize(dialect, text).filter(significant);
  const first = tokens.find((t) => !(t.kind === 'punct' && t.text === '('));
  if (!first || first.kind !== 'word' || !READS[dialect].has(first.text.toLowerCase())) throw new ConnectorFailure('read_only', 'only a read runs here: SELECT, WITH, VALUES, TABLE, SHOW or EXPLAIN');
  const semicolon = tokens.findIndex((t) => t.kind === 'punct' && t.text === ';');
  if (semicolon >= 0 && semicolon < tokens.length - 1) throw new ConnectorFailure('invalid_query', 'one statement at a time');
  // An autocommit analytics engine has no read-only transaction to reject a write behind WITH or EXPLAIN.
  // Inspect tokens, not quoted values/identifiers. A SELECT-only database account remains the authority.
  if (autocommit && tokens.some(t => t.kind === 'word' && /^(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|call|load)$/i.test(t.text)))
    throw new ConnectorFailure('read_only', 'only a read runs here: writes inside WITH or EXPLAIN are refused');
  if (dialect === 'mysql' && tokens.some((t) => t.kind === 'word' && t.text.toLowerCase() === 'into')) throw new ConnectorFailure('read_only', 'SELECT … INTO is refused: it writes a file or a session variable');
  // The viewer guard, an extra one only (see the package header for what a database can rely on): a statement
  // never sets a session value itself, so it cannot name another person in app.viewer_* / @app_viewer_*.
  if (dialect === 'postgres' && tokens.some((t) => t.kind === 'word' && t.text.toLowerCase() === 'set_config')) throw new ConnectorFailure('read_only', 'set_config is refused: a statement never changes the session');
  if (dialect === 'mysql' && tokens.some((t, i) => t.text === ':' && tokens[i + 1]?.text === '=')) throw new ConnectorFailure('read_only', ':= is refused: a statement never assigns a session variable');
}

/** Unquoted words used as a qualifier (`word.`), lower-cased: what `mapQualifiers` rewrites. */
export function qualifierNames(dialect: ConnectorDialect, text: string): Set<string> {
  const tokens = tokenize(dialect, text).filter(significant), found = new Set<string>();
  tokens.forEach((t, i) => { if (t.kind === 'word' && tokens[i + 1]?.text === '.' && tokens[i - 1]?.text !== '.') found.add(t.text.toLowerCase()); });
  return found;
}

/** Unquoted words not after a `.` (a table, a qualifier, a keyword, an alias), lower-cased. */
export function leadingWords(dialect: ConnectorDialect, text: string): Set<string> {
  const tokens = tokenize(dialect, text).filter(significant), found = new Set<string>();
  tokens.forEach((t, i) => { if (t.kind === 'word' && tokens[i - 1]?.text !== '.') found.add(t.text.toLowerCase()); });
  return found;
}

/** The dialect's quoted identifier. */
function quoteIdentifier(dialect: ConnectorDialect, name: string): string {
  return dialect === 'postgres' ? `"${name.replaceAll('"', '""')}"` : `\`${name.replaceAll('`', '``')}\``;
}

/** Rewrites each qualifier in `map` (lower-cased name → namespace, '' to remove it); everything else is kept byte for byte. */
export function mapQualifiers(dialect: ConnectorDialect, text: string, map: ReadonlyMap<string, string>): string {
  const tokens = tokenize(dialect, text);
  const next = (i: number) => { for (let j = i + 1; j < tokens.length; j++) if (significant(tokens[j]!)) return j; return -1; };
  const prev = (i: number) => { for (let j = i - 1; j >= 0; j--) if (significant(tokens[j]!)) return j; return -1; };
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!, dot = next(i), before = prev(i);
    const target = t.kind === 'word' && dot >= 0 && tokens[dot]!.text === '.' && (before < 0 || tokens[before]!.text !== '.') ? map.get(t.text.toLowerCase()) : undefined;
    if (target === undefined) { out += t.text; continue; }
    if (target) { out += quoteIdentifier(dialect, target); continue; }
    // Removed: the qualifier, anything between it and its dot, and the dot.
    i = dot;
  }
  return out;
}
