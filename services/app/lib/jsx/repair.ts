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

/** What was changed on the way in, for the reply to carry. */
export interface SourceRepair {
  code: 'escaped_backtick';
  /** Addressed to the agent that sent it: what was wrong and how to not repeat it. */
  message: string;
  /** How many backslashes were dropped. */
  removed: number;
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
  if (!source.includes('\\`')) return null;
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
