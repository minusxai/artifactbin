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
function unclosedExpression(source: string): { attr: string; line: number; missing: number } | null {
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
  const brace = unclosed
    ? ` The \`${unclosed.attr}={\` opened on line ${unclosed.line} is never closed — it needs ${unclosed.missing} more \`}\`.`
    : '';
  return {
    message: `JSX syntax error at line ${line}, column ${column}: ${bare} — see \`snippet\`, where ▶ marks the character.${brace}`,
    start: parsed.pos,
    end: parsed.pos,
    snippet,
  };
}
