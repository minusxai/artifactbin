/**
 * EXPRESSION EXTENTS over significant tokens. The translator rewrites a
 * construct in place, so it must know exactly which text an operator applies
 * to: `a + b::int` casts `b`, `a * b // c` divides `a * b`, `x - interval 1 day`
 * subtracts from `x`. Rather than parse whole statements, this finds the
 * smallest region an expression can live in (bounded by commas, brackets and
 * clause keywords) and runs a precedence-climbing parser over it, with
 * DuckDB's precedence. Bracketed groups, lists and CASE are opaque leaves —
 * a rule that needs their inside asks again at an inner position.
 */
import { word, type SqlToken } from './tokens';

export interface ExprNode {
  kind: 'primary' | 'call' | 'group' | 'list' | 'case' | 'interval' | 'typed' | 'unary' | 'binary' | 'cast' | 'index' | 'postfix';
  /** First and last significant-token index, inclusive. */
  from: number;
  to: number;
  /** The operator token: `::` for a cast, `[` for an index, the (first) operator word or symbol otherwise. */
  op?: number;
  left?: ExprNode;
  right?: ExprNode;
  /** The operand of a unary operator, cast, index or postfix test. */
  operand?: ExprNode;
  /** A cast's type tokens, inclusive. */
  type?: { from: number; to: number };
  parent?: ExprNode;
}

/** Where an expression region starts: the token after one of these (at the same bracket depth). */
const REGION_KEYWORDS = new Set([
  'select', 'from', 'where', 'having', 'on', 'using', 'when', 'then', 'else', 'case', 'set', 'by', 'limit', 'offset',
  'returning', 'values', 'as', 'union', 'intersect', 'except', 'all', 'distinct', 'join', 'into', 'with', 'recursive',
  'window', 'qualify', 'update', 'insert', 'delete', 'group', 'order', 'partition', 'do', 'conflict', 'escape',
]);
/** Words that end an operand: seeing one where an operator could follow means the expression is over. */
export const KEYWORDS = new Set([...REGION_KEYWORDS, 'and', 'or', 'not', 'is', 'in', 'like', 'ilike', 'glob', 'between', 'similar', 'end', 'left', 'right', 'inner', 'outer', 'full', 'cross', 'natural', 'lateral', 'exists', 'null', 'true', 'false', 'interval', 'filter', 'over', 'collate']);
const TYPED_LITERALS = new Set(['date', 'timestamp', 'timestamptz', 'time', 'datetime']);
const INTERVAL_UNITS = /^(?:year|month|week|day|hour|minute|second|millisecond|microsecond|quarter|decade|century|millennium)s?$/;

/** Infix binding powers, DuckDB's order (Postgres's): higher binds tighter. */
function infixPower(tokens: SqlToken[], i: number): number {
  const t = tokens[i];
  const w = word(t);
  if (w === 'or') return 1;
  if (w === 'and') return 2;
  if (w === 'is' || w === 'isnull' || w === 'notnull') return 4;
  if (w === 'not' && ['like', 'ilike', 'glob', 'in', 'between', 'similar'].includes(word(tokens[i + 1]))) return 6;
  if (['like', 'ilike', 'glob', 'in', 'between', 'similar'].includes(w)) return 6;
  if (w === 'collate') return 12;
  if (t?.kind === 'operator') {
    if (['=', '==', '<>', '!=', '<', '>', '<=', '>='].includes(t.text)) return 5;
    if (['+', '-'].includes(t.text)) return 8;
    if (['*', '/', '//', '%'].includes(t.text)) return 9;
    if (['^', '**'].includes(t.text)) return 10;
    if (t.text === '::') return 12;
    if (t.text === ':') return 0;
    return 7;
  }
  if (t?.text === '[') return 12;
  return 0;
}

/** Bracket partners: `pairs[i]` is the index of the bracket matching the one at `i`. Throws when unbalanced. */
export function bracketPairs(tokens: SqlToken[]): Map<number, number> {
  const pairs = new Map<number, number>();
  const open: number[] = [];
  const closer: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  tokens.forEach((t, i) => {
    if (t.kind !== 'punct') return;
    if (t.text === '(' || t.text === '[' || t.text === '{') open.push(i);
    else if (t.text in closer) {
      const at = open.pop();
      if (at === undefined || tokens[at].text !== closer[t.text]) throw new Error(`unbalanced "${t.text}"`);
      pairs.set(at, i).set(i, at);
    }
  });
  if (open.length) throw new Error(`unbalanced "${tokens[open[open.length - 1]].text}"`);
  return pairs;
}

/** The `end` closing the CASE at `i` (or, from an `end`, its CASE when `step` is -1). */
export function caseMatch(tokens: SqlToken[], i: number, step: 1 | -1 = 1): number {
  let depth = 0;
  for (let j = i; j >= 0 && j < tokens.length; j += step) {
    const w = word(tokens[j]);
    if (w === (step === 1 ? 'case' : 'end')) depth++;
    else if (w === (step === 1 ? 'end' : 'case') && --depth === 0) return j;
  }
  return -1;
}

export class ExpressionReader {
  constructor(readonly tokens: SqlToken[], readonly pairs: Map<number, number>) {}

  /** Index of the first token of the expression region containing token `i`. */
  regionStart(i: number): number {
    const t = this.tokens;
    for (let j = i - 1; j >= 0; j--) {
      const token = t[j];
      if (token.text === ')' || token.text === ']') { j = this.pairs.get(j)!; continue; }
      const w = word(token);
      if (w === 'end') { const start = caseMatch(t, j, -1); if (start >= 0) { j = start; continue; } }
      if (token.kind === 'punct' && ['(', '[', ',', ';', '{'].includes(token.text)) return j + 1;
      if (!REGION_KEYWORDS.has(w)) continue;
      // `IS [NOT] DISTINCT FROM` and `WITHIN GROUP (…)` sit inside an expression.
      if (w === 'from' && word(t[j - 1]) === 'distinct' && ['is', 'not'].includes(word(t[j - 2]))) continue;
      if (w === 'distinct' && ['is', 'not'].includes(word(t[j - 1]))) continue;
      if (w === 'group' && word(t[j - 1]) === 'within') continue;
      return j + 1;
    }
    return 0;
  }

  /** Every node of the expression region around token `i`, or null when the region does not parse through `i`. */
  nodesAround(i: number): ExprNode[] | null {
    const nodes: ExprNode[] = [];
    const parser = new Parser(this.tokens, this.pairs, nodes);
    const root = parser.parse(this.regionStart(i));
    return root && root.to >= i ? nodes : null;
  }

  /** The node whose operator is token `op` (a cast's `::`, a binary operator, an index's `[`). */
  nodeByOperator(op: number): ExprNode | null {
    return this.nodesAround(op)?.find((n) => n.op === op) ?? null;
  }

  /** The node of this kind starting at token `from`. */
  nodeAt(from: number, kind: ExprNode['kind']): ExprNode | null {
    return this.nodesAround(from)?.find((n) => n.from === from && n.kind === kind) ?? null;
  }
}

class Parser {
  private pos = 0;
  constructor(private readonly t: SqlToken[], private readonly pairs: Map<number, number>, private readonly nodes: ExprNode[]) {}

  parse(start: number): ExprNode | null {
    this.pos = start;
    return this.expression(0);
  }

  private node(n: ExprNode): ExprNode {
    for (const child of [n.left, n.right, n.operand]) if (child) child.parent = n;
    this.nodes.push(n);
    return n;
  }

  private expression(power: number): ExprNode | null {
    let left = this.prefix();
    if (!left) return null;
    for (;;) {
      const i = this.pos;
      const p = infixPower(this.t, i);
      if (p <= power) return left;
      const next = this.infix(left, i, p);
      if (!next) { this.pos = i; return left; }
      left = next;
    }
  }

  private closeOf(i: number): number {
    return this.pairs.get(i) ?? i;
  }

  private prefix(): ExprNode | null {
    const t = this.t;
    const i = this.pos;
    const token = t[i];
    if (!token) return null;
    const w = word(token);
    if (token.kind === 'operator' && ['-', '+', '~'].includes(token.text)) {
      this.pos++;
      const operand = this.expression(11);
      return operand && this.node({ kind: 'unary', from: i, to: operand.to, op: i, operand });
    }
    if (w === 'not') {
      this.pos++;
      const operand = this.expression(3);
      return operand && this.node({ kind: 'unary', from: i, to: operand.to, op: i, operand });
    }
    if (w === 'exists' && t[i + 1]?.text === '(') { this.pos = this.closeOf(i + 1) + 1; return this.node({ kind: 'primary', from: i, to: this.pos - 1 }); }
    if (w === 'case') {
      const end = caseMatch(t, i);
      if (end < 0) return null;
      this.pos = end + 1;
      return this.node({ kind: 'case', from: i, to: end });
    }
    if (w === 'interval') {
      const interval = this.interval(i);
      if (interval) return interval;
    }
    if (TYPED_LITERALS.has(w) && t[i + 1]?.kind === 'string') { this.pos = i + 2; return this.node({ kind: 'typed', from: i, to: i + 1 }); }
    if (token.text === '(') { this.pos = this.closeOf(i) + 1; return this.node({ kind: 'group', from: i, to: this.pos - 1 }); }
    if (token.text === '[') { this.pos = this.closeOf(i) + 1; return this.node({ kind: 'list', from: i, to: this.pos - 1 }); }
    if (['number', 'string', 'dollar'].includes(token.kind) || token.text === '*' || ['null', 'true', 'false'].includes(w)) {
      this.pos = i + 1;
      return this.node({ kind: 'primary', from: i, to: i });
    }
    // `left(s, n)` and `right(s, n)` are functions as well as join words.
    if (token.kind === 'word' && KEYWORDS.has(w) && !((w === 'left' || w === 'right') && t[i + 1]?.text === '(')) return null;
    if (token.kind !== 'word' && token.kind !== 'quoted' && token.kind !== 'param') return null;
    // A name, qualified by dots: `t.col`, `"s"."t".c`, `$_row.id`, `t.*`.
    let j = i;
    while (t[j + 1]?.text === '.' && t[j + 2] && (['word', 'quoted'].includes(t[j + 2].kind) || t[j + 2].text === '*')) j += 2;
    if (t[j + 1]?.text !== '(' || token.kind === 'param') { this.pos = j + 1; return this.node({ kind: 'primary', from: i, to: j }); }
    // A call, with its optional FILTER (…), WITHIN GROUP (…) and OVER (…)/OVER name.
    j = this.closeOf(j + 1);
    for (;;) {
      const next = word(t[j + 1]);
      if (next === 'filter' && t[j + 2]?.text === '(') j = this.closeOf(j + 2);
      else if (next === 'within' && word(t[j + 2]) === 'group' && t[j + 3]?.text === '(') j = this.closeOf(j + 3);
      else if (next === 'over' && t[j + 2]?.text === '(') j = this.closeOf(j + 2);
      else if (next === 'over' && t[j + 2]?.kind === 'word') j += 2;
      else break;
    }
    this.pos = j + 1;
    return this.node({ kind: 'call', from: i, to: j });
  }

  /** `interval 'n unit'`, `interval 'n' unit`, `interval n unit`, `interval (expr) unit`, `interval $p unit`. */
  private interval(i: number): ExprNode | null {
    const t = this.t;
    const amount = t[i + 1];
    if (!amount) return null;
    const unitAt = (k: number) => (INTERVAL_UNITS.test(word(t[k])) ? k : -1);
    let end = -1;
    if (amount.kind === 'string') end = unitAt(i + 2) >= 0 ? i + 2 : i + 1;
    else if (amount.kind === 'number' || amount.kind === 'param') end = unitAt(i + 2);
    else if (amount.text === '(') end = unitAt(this.closeOf(i + 1) + 1);
    if (end < 0) return null;
    this.pos = end + 1;
    return this.node({ kind: 'interval', from: i, to: end });
  }

  private infix(left: ExprNode, i: number, power: number): ExprNode | null {
    const t = this.t;
    const token = t[i];
    const w = word(token);
    if (token.text === '::') {
      // A type: words (`double precision`, `timestamp with time zone`), an optional `(p, s)`, any `[]`s.
      let j = i + 1;
      if (t[j]?.kind !== 'word' && t[j]?.kind !== 'quoted') return null;
      while (['precision', 'varying', 'with', 'without', 'time', 'zone'].includes(word(t[j + 1]))) j++;
      if (t[j + 1]?.text === '(') j = this.closeOf(j + 1);
      while (t[j + 1]?.text === '[') j = this.closeOf(j + 1);
      this.pos = j + 1;
      return this.node({ kind: 'cast', from: left.from, to: j, op: i, operand: left, type: { from: i + 1, to: j } });
    }
    if (token.text === '[') {
      this.pos = this.closeOf(i) + 1;
      return this.node({ kind: 'index', from: left.from, to: this.pos - 1, op: i, operand: left });
    }
    if (w === 'collate') {
      if (!t[i + 1]) return null;
      this.pos = i + 2;
      return this.node({ kind: 'postfix', from: left.from, to: i + 1, op: i, operand: left });
    }
    if (w === 'isnull' || w === 'notnull') { this.pos = i + 1; return this.node({ kind: 'postfix', from: left.from, to: i, op: i, operand: left }); }
    if (w === 'is') {
      let j = i + 1;
      if (word(t[j]) === 'not') j++;
      if (word(t[j]) === 'distinct' && word(t[j + 1]) === 'from') j += 2;
      this.pos = j;
      const right = this.expression(power);
      return right && this.node({ kind: 'binary', from: left.from, to: right.to, op: i, left, right });
    }
    let j = i;
    if (w === 'not') j++;
    const w2 = word(t[j]);
    if (w2 === 'between') {
      this.pos = j + 1;
      const low = this.expression(power);
      if (!low || word(t[this.pos]) !== 'and') return null;
      this.pos++;
      const high = this.expression(power);
      return high && this.node({ kind: 'binary', from: left.from, to: high.to, op: i, left, right: high });
    }
    if (w2 === 'similar') { if (word(t[j + 1]) !== 'to') return null; j++; }
    this.pos = j + 1;
    const right = this.expression(power);
    if (!right) return null;
    let to = right.to;
    if (['like', 'ilike', 'similar'].includes(w2) && word(t[this.pos]) === 'escape') {
      this.pos++;
      const escape = this.expression(power);
      if (!escape) return null;
      to = escape.to;
    }
    return this.node({ kind: 'binary', from: left.from, to, op: i, left, right });
  }
}
