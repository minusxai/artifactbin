/**
 * ONE SYNTAX FAULT IS REPAIRED RATHER THAN REFUSED: the shell-escaped backtick.
 *
 * An agent that holds a document in a shell heredoc, or builds the JSON body in
 * a string, escapes the backticks that open a `<Query>`'s template literal the
 * way a double-quoted shell string requires, and the backslashes arrive with
 * the document:
 *
 *     <Query name="q">{\`select …\`}</Query>
 *
 * Measured on the CI agent eval (run 33868825276's `data` task): the publish was
 * refused with `Expecting Unicode escape sequence \uXXXX (1:311)`, and the agent
 * spent 171s composing that document and another 90s working out what to change
 * — 39% of a 673-second task, over two backslashes, against 226ms of server time
 * for the whole task.
 *
 * WHY THIS ONE, when `</script` in script text is refused outright and a bad
 * number format is refused by name. Two properties, and it needs both:
 *
 *  1. It cannot be meant. A backslash-escaped backtick where an expression must
 *     START is invalid in every document, so there is no valid source this
 *     changes and no author intent to guess at. Inside a template literal the
 *     same two characters ARE legal, and such a document parses, so it never
 *     reaches here — the trigger is the parser's own verdict at its own
 *     position, never a text search.
 *  2. The repair is PROVED, not hoped for. It is kept only if the result then
 *     parses; otherwise the original refusal stands, unchanged.
 *
 * That is the `<p><div>` rewrite rule — "the authors are agents, this is
 * something an LLM emits constantly" — with an accept gate on top. And it is
 * REPORTED: the reply names what was removed, so nothing is changed silently.
 *
 * BOTH escapes go at once, deliberately. Removing only the opening one opens
 * the template literal, at which point the closing `\`` becomes a valid escape
 * INSIDE it and the literal runs to the end of the document — a
 * one-character-at-a-time loop makes the document worse and then gives up.
 */
import { parseJsx } from './parse';
import { extraClosing, tripleOpen } from './syntax-error';

/** What was changed on the way in, for the reply to carry. */
export interface SourceRepair {
  code: 'escaped_backtick' | 'unbalanced_braces';
  /** Addressed to the agent that sent it: what was wrong and how to not repeat it. */
  message: string;
  /** How many characters were dropped (backslashes, or stray closing braces). */
  removed: number;
}

/**
 * THE BRACE COUNT, the second fault worth repairing: 15 tasks and 82 model calls in eval runs
 * 34740707220–34741910427 went to a `viz={{…}}` with one `}` too many or too few, or a `{{{`
 * opening from wrapping an already-wrapped object. The two unambiguous shapes are repaired — stray
 * `}`s after a closed expression, and `{{{` — found by the same scanners that name them in the
 * refusal, applied in order (a `{{{` usually leaves a stray `}` behind) and kept only if the result
 * parses. A missing brace is named, never guessed (see below).
 */
function repairBraces(source: string): { source: string; repair: SourceRepair } | null {
  let out = source; const notes: string[] = []; let removed = 0;
  const triple = tripleOpen(out);
  if (triple) {
    out = out.slice(0, triple.index!) + `${triple[1]}={{` + out.slice(triple.index! + triple[0].length);
    notes.push(`collapsed \`${triple[1]}={{{\` to \`${triple[1]}={{\``);
  }
  const extra = extraClosing(out);
  if (extra) {
    // Delete the stray `}`s that follow the balanced close of the expression.
    const m = [...out.matchAll(/([A-Za-z_][\w-]*)=\{/g)].find((x) => x[1] === extra.attr && out.slice(0, x.index! + x[0].length - 1).split('\n').length === extra.line)!;
    let depth = 0, quote: string | null = null, i = m.index! + m[0].length - 1;
    for (; i < out.length; i++) {
      const ch = out[i];
      if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) break; }
    }
    let j = i + 1, dropped = 0;
    while (j < out.length && dropped < extra.extra) { if (out[j] === '}') { out = out.slice(0, j) + out.slice(j + 1); dropped++; } else if (/\s/.test(out[j])) j++; else break; }
    removed += dropped;
    notes.push(`removed ${dropped} closing brace${dropped === 1 ? '' : 's'} after \`${extra.attr}={\` on line ${extra.line}`);
  }
  // A MISSING brace is not repaired: where it belongs is a guess (an inner object or the outer one),
  // and a wrong guess parses. It stays a named refusal — "never closed, needs N more `}`".
  if (!notes.length || out === source || !parseJsx(out).ok) return null;
  return {
    source: out,
    repair: {
      code: 'unbalanced_braces',
      message: `${notes.join('; ')}. Build the viz object as JSON and serialize it inside ONE JSX expression (viz={{…}}) instead of counting braces by hand.`,
      removed,
    },
  };
}

/**
 * Repair a source the JSX parser rejected, when the fault is one we can fix
 * provably. Null when the source already parses, when the fault is a different
 * one, or when the repair does not make it parse — in every one of those the
 * caller's original error is the right answer.
 */
export function repairJsxSource(source: string): { source: string; repair: SourceRepair } | null {
  // A free bail for every document that does not carry the sequence at all,
  // so an ordinary publish never pays for a second parse. It is only a
  // short-circuit: the DECISION below is still the parser's, at its own
  // position, because these two characters are legal inside a template literal.
  if (!source.includes('\\`')) {
    // Not the backtick shape; a brace fault is the other one worth a repair.
    if (parseJsx(source).ok) return null;
    return repairBraces(source);
  }
  const parsed = parseJsx(source);
  if (parsed.ok) return null;

  // THE SIGNATURE, asked of the parser rather than of the text: it stopped at a
  // backtick, and that backtick is backslash-escaped. Anywhere a template
  // literal may legally hold `\``, the document parses and we are never called.
  const pos = parsed.pos;
  if (typeof pos !== 'number' || source[pos] !== '`' || source[pos - 1] !== '\\') return null;

  const repaired = source.replaceAll('\\`', '`');
  const removed = source.length - repaired.length;
  if (removed === 0 || !parseJsx(repaired).ok) return null;

  return {
    source: repaired,
    repair: {
      code: 'escaped_backtick',
      message:
        `removed ${removed} backslash${removed === 1 ? '' : 'es'} escaping a backtick: a backtick inside a JSX ` +
        'expression must not be written as \\` — send {`select …`}, not {\\`select …\\`}. A shell heredoc or a ' +
        'JSON string builder adds that escape; send the document as a file or let the JSON encoder do the quoting.',
      removed,
    },
  };
}
