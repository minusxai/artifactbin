/**
 * A syntax error the caller can act on.
 *
 * acorn gives a message and an offset; an agent holds a document in a shell
 * heredoc and can do nothing with `(1:92)`. Measured on the agent eval: one
 * dashboard run failed publish SEVEN times, re-sending the whole document each
 * attempt, because the refusal named no text — and every retry replayed a
 * context that by then carried ~65 KB of docs. Every other refusal in this
 * codebase names its fix; this builds the same courtesy for the one that fires
 * hardest, on the largest documents.
 *
 * The position is already in the CALLER's coordinates (lib/jsx/parse subtracts
 * the `<>…</>` wrapper), so line, column and snippet are all counted against
 * the source that was actually sent.
 */
import type { ParseResult, ValidationError } from './types';

/** How much source rides either side of the fault. Enough to recognise, short enough to read. */
const CONTEXT = 60;

/**
 * The commonest fault by a wide margin, and the one the parser describes
 * worst: an attribute expression that is never closed. `viz={{…}}` nests four
 * or five levels, an agent writes it on one line, one `}` goes missing — and
 * acorn then reports where it NOTICED, which is the end of the element and
 * tells the author nothing about where the mistake is.
 *
 * Measured across three harnesses: Claude Code failed a deck 21 times over one
 * brace (and resorted to publishing tiny probe documents to bisect it), Codex
 * recovered in one retry, OpenCode gave up after two and failed CI.
 *
 * So the OPENING is found and named instead — which attribute, which line, and
 * how many braces short. Scanning for it is unambiguous: strings and template
 * literals are skipped, so a `}` inside SQL or a label cannot be miscounted.
 */
export function unclosedExpression(source: string): { attr: string; line: number; missing: number } | null {
  let best: { attr: string; line: number; missing: number } | null = null;
  for (const m of source.matchAll(/([A-Za-z_][\w-]*)=\{/g)) {
    const open = m.index! + m[0].length - 1;
    let depth = 0;
    let quote: string | null = null;
    for (let i = open; i < source.length; i++) {
      const ch = source[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) break; }
    }
    // Depth still open at the end of the source: this expression never closed.
    // The FIRST such match is the author's mistake — `matchAll` runs left to
    // right, and anything after it is only unclosed because this one swallowed
    // the rest of the document.
    if (depth > 0 && !best) {
      best = { attr: m[1], line: source.slice(0, open).split('\n').length, missing: depth };
    }
  }
  return best;
}

/**
 * The mirror image: an attribute expression that CLOSES and is then followed by stray `}`s, or that
 * opens with `{{{`. Unclosed braces are named above; these two shapes used to get only "Unexpected
 * token" — pi counted braces by hand for ten model calls (eval run 34741910427, report).
 */
export function extraClosing(source: string): { attr: string; line: number; extra: number } | null {
  for (const m of source.matchAll(/([A-Za-z_][\w-]*)=\{/g)) {
    const open = m.index! + m[0].length - 1;
    let depth = 0;
    let quote: string | null = null;
    let i = open;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) continue;
    let extra = 0;
    for (let j = i + 1; j < source.length; j++) {
      const ch = source[j];
      if (ch === '}') extra++;
      else if (ch === ' ' || ch === '\n' || ch === '\t') continue;
      else break;
    }
    if (extra > 0) return { attr: m[1], line: source.slice(0, open).split('\n').length, extra };
  }
  return null;
}
export const tripleOpen = (source: string) => /([A-Za-z_][\w-]*)=\{\{\{/.exec(source);

/** Where the expression that opens at `open` closes, counting braces and skipping strings. */
export function balancedClose(source: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Where the string opening at `at` ends, or -1 when it never closes. */
export function balancedString(source: string, at: number): number {
  const quote = source[at];
  for (let i = at + 1; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue; }
    if (source[i] === quote) return i;
  }
  return -1;
}

/**
 * THE OBJECT FORM ON SOMETHING THAT IS NOT AN OBJECT: `columns={{[{"col":"team"}]}}`.
 *
 * `viz={{…}}` is the spelling every doc shows, so an agent that has written it fifty times writes it
 * for a column LIST too — and `{ {[…]} }` is a block holding an array, which the parser could only
 * call "Unexpected token" at a column in the middle of line 117 (claude-code dashboard, live leg
 * local23: two calls to inspect and fix). The outer pair is one brace too many on each side.
 *
 * The signature is what follows `attr={{`: an array, a string that is not a KEY (no `:` after it), a
 * number, or `true`/`false`/`null`. A string followed by `:` is the legal object form and is not
 * this; `{{{` is the other fault and `tripleOpen` names it.
 */
export function doubleWrapped(source: string): { attr: string; line: number; open: number; inner: number; close: number } | null {
  for (const m of source.matchAll(/([A-Za-z_][\w-]*)=\{\{/g)) {
    const open = m.index! + m[0].length - 2;
    const inner = open + 1;
    const value = source.slice(inner + 1).match(/^\s*/)![0].length + inner + 1;
    const first = source[value];
    if (first === undefined) continue;
    if (first === '"' || first === "'") {
      const end = balancedString(source, value);
      if (end < 0 || /^\s*:/.test(source.slice(end + 1))) continue;
    } else if (!'[-0123456789'.includes(first) && !/^(true|false|null)\b/.test(source.slice(value))) continue;
    const close = balancedClose(source, inner);
    if (close < 0) continue;
    return { attr: m[1]!, line: source.slice(0, open).split('\n').length, open, inner, close };
  }
  return null;
}

export function syntaxErrorDetail(source: string, parsed: Extract<ParseResult, { ok: false }>): ValidationError {
  const bare = parsed.error.replace(/\s*\(\d+:\d+\)\s*$/, '');
  if (typeof parsed.pos !== 'number' || parsed.pos > source.length) {
    return { message: `JSX syntax error: ${bare}` };
  }
  const before = source.slice(0, parsed.pos);
  const line = before.split('\n').length;
  const column = parsed.pos - (before.lastIndexOf('\n') + 1) + 1;
  const from = Math.max(0, parsed.pos - CONTEXT);
  const to = Math.min(source.length, parsed.pos + CONTEXT);
  const snippet =
    (from > 0 ? '…' : '') +
    source.slice(from, parsed.pos) + '▶' + source.slice(parsed.pos, to) +
    (to < source.length ? '…' : '');
  // Name the OPENING when the fault is an expression that never closed — the
  // parser's position is where it noticed, which is somewhere else entirely.
  const unclosed = unclosedExpression(source);
  const extra = unclosed ? null : extraClosing(source);
  const triple = tripleOpen(source);
  const doubled = unclosed || triple ? null : doubleWrapped(source);
  const missingObject = /([A-Za-z_][\w-]*)=\{\s*["'][^"']+["']\s*:/.exec(source);
  const objectHint = missingObject ? ` The ${missingObject[1]} attribute is missing its object opening brace: JSX needs ${missingObject[1]}={{...}}, one expression wrapper around the complete JSON object.` : '';
  const brace = unclosed
    ? ` The \`${unclosed.attr}={\` opened on line ${unclosed.line} is never closed — it needs ${unclosed.missing} more \`}\`.`
    : triple
      ? ` \`${triple[1]}={{{\` opens three braces: write \`${triple[1]}={{…}}\` — one expression wrapper around the complete JSON object.`
      : doubled
        ? ` The \`${doubled.attr}={{\` on line ${doubled.line} wraps a value that is not an object in an extra brace pair — the double braces belong to \`viz={{…}}\`, an object; write \`${doubled.attr}={[…]}\`, one expression wrapper around the array.`
        : extra
        ? ` The \`${extra.attr}={\` expression on line ${extra.line} closes and is followed by ${extra.extra} more \`}\` than it opened — ${extra.extra === 1 ? 'one `}` too many' : `${extra.extra} too many`}; delete ${extra.extra === 1 ? 'it' : 'them'}.`
        : '';
  return {
    message: `JSX syntax error at line ${line}, column ${column}: ${bare} — see \`snippet\`, where ▶ marks the character.${brace}${objectHint}${(unclosed?.attr === 'viz' || missingObject?.[1] === 'viz') ? ' Build the viz object separately, then serialize it with JSON.stringify/json.dumps inside one JSX expression; do not hand-count closing braces. See markup-data.md.' : ''}`,
    start: parsed.pos,
    end: parsed.pos,
    snippet,
  };
}
