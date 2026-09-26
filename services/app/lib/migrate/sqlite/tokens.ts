/**
 * A LOSSLESS SQL TOKENIZER for the one-off DuckDB → SQLite migration. Every
 * character of the input belongs to exactly one token, so the translator can
 * rewrite a construct by splicing text between token offsets and leave
 * everything else — whitespace, comments, quoting, case — byte-identical.
 *
 * The app's other SQL lexers (sql/policy, datasets/sql, datasets/stored-mutation,
 * story/sql-reference-tokens) each drop whitespace and comments or lower-case
 * words for their own narrow job; none can give text back, which a rewriter needs.
 */

export type SqlTokenKind =
  | 'space'
  | 'comment'
  /** An unquoted identifier or keyword; compare with {@link word}. */
  | 'word'
  /** A double-quoted identifier, quotes included. */
  | 'quoted'
  /** A single-quoted string literal, quotes included. */
  | 'string'
  /** A dollar-quoted string (`$$…$$`); SQLite has no such thing. */
  | 'dollar'
  | 'number'
  /** `$name`, `$1` or `?`. A field (`$_row.id`) is this token, `.` and a word. */
  | 'param'
  | 'operator'
  /** `( ) [ ] { } , . ;` */
  | 'punct';

export interface SqlToken {
  kind: SqlTokenKind;
  text: string;
  start: number;
  end: number;
}

export class SqlTokenError extends Error {
  constructor(message: string, readonly start: number, readonly end: number) {
    super(message);
  }
}

/** Longest first: the scanner takes the first that matches. */
const OPERATORS = ['->>', '::', '//', '||', '<=', '>=', '<>', '!=', '==', '->', '<<', '>>', '**', '^@', '+', '-', '*', '/', '%', '<', '>', '=', '!', '~', '^', '&', '|', '@', '#', ':'];
const PUNCT = '()[]{},.;';
const WORD = /[\p{L}_][\p{L}\p{N}_$]*/uy;
const NUMBER = /(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const PARAM = /\$(?:[A-Za-z_]\w*|\d+)/y;
const DOLLAR = /\$(?:[A-Za-z_]\w*)?\$/y;
const SPACE = /\s+/y;

function sticky(re: RegExp, sql: string, at: number): string | null {
  re.lastIndex = at;
  return re.exec(sql)?.[0] ?? null;
}

/** Throws {@link SqlTokenError} for an unterminated string, identifier or comment. */
export function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  const push = (kind: SqlTokenKind, end: number) => {
    tokens.push({ kind, text: sql.slice(i, end), start: i, end });
    i = end;
  };
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const space = sticky(SPACE, sql, i);
    if (space) { push('space', i + space.length); continue; }
    if (sql.startsWith('--', i)) {
      const newline = sql.indexOf('\n', i);
      push('comment', newline < 0 ? sql.length : newline);
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const close = sql.indexOf('*/', i + 2);
      if (close < 0) throw new SqlTokenError('unterminated comment', i, sql.length);
      push('comment', close + 2);
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      for (;;) {
        const close = sql.indexOf(c, j);
        if (close < 0) throw new SqlTokenError(c === "'" ? 'unterminated string' : 'unterminated quoted identifier', i, sql.length);
        if (sql[close + 1] === c) { j = close + 2; continue; }
        j = close + 1;
        break;
      }
      push(c === "'" ? 'string' : 'quoted', j);
      continue;
    }
    if (c === '$') {
      const delimiter = sticky(DOLLAR, sql, i);
      if (delimiter) {
        const close = sql.indexOf(delimiter, i + delimiter.length);
        if (close < 0) throw new SqlTokenError('unterminated dollar-quoted string', i, sql.length);
        push('dollar', close + delimiter.length);
        continue;
      }
      const param = sticky(PARAM, sql, i);
      if (param) { push('param', i + param.length); continue; }
    }
    if (c === '?') { push('param', i + 1); continue; }
    const number = sticky(NUMBER, sql, i);
    if (number) { push('number', i + number.length); continue; }
    const word = sticky(WORD, sql, i);
    if (word) { push('word', i + word.length); continue; }
    if (PUNCT.includes(c)) { push('punct', i + 1); continue; }
    const operator = OPERATORS.find((op) => sql.startsWith(op, i));
    push('operator', i + (operator?.length ?? 1));
  }
  return tokens;
}

/** The lower-cased keyword or identifier a token spells, or '' for anything else. */
export const word = (token: SqlToken | undefined): string => (token?.kind === 'word' ? token.text.toLowerCase() : '');

/** The name an identifier token denotes: a word lower-cased, a quoted name unquoted. */
export function identifier(token: SqlToken | undefined): string | null {
  if (token?.kind === 'word') return token.text.toLowerCase();
  if (token?.kind === 'quoted') return token.text.slice(1, -1).replaceAll('""', '"');
  return null;
}

/** Tokens that carry meaning: no whitespace, no comments. */
export const significant = (tokens: SqlToken[]): SqlToken[] => tokens.filter((t) => t.kind !== 'space' && t.kind !== 'comment');
