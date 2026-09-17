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
 * Measured on the CI agent eval's `data` task: the publish was
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
import { balancedClose, balancedString, doubleWrapped, extraClosing, tripleOpen } from './syntax-error';

/** What was changed on the way in, for the reply to carry. */
export interface SourceRepair {
  code: 'escaped_backtick' | 'unbalanced_braces';
  /** Addressed to the agent that sent it: what was wrong and how to not repeat it. */
  message: string;
  /** How many characters were dropped (backslashes, or stray closing braces). */
  removed: number;
}

/**
 * How many repair passes one document gets. Every pass deletes at least one character and the loop
 * also stops the moment the parser stops moving forward, so this is a belt on a source that already
 * shrinks — it bounds what a pathological document can cost, nothing more.
 */
const MAX_PASSES = 25;

/** What one repaired document accumulated, in the words the reply will carry. */
interface BraceCount { collapsed: string[]; strays: Array<{ attr: string; line: number }>; wrapped: Array<{ attr: string; line: number }>; unwrapped: Array<{ attr: string; line: number }>; removed: number }

/**
 * An attribute holding a JSON VALUE where JSX needs an expression: `viz={"kind": …}` or
 * `viz={[…]}` — the object's own braces used as the expression's, so the object never got a wrapper.
 * The signature is the value's first non-space character: a quoted key followed by `:`, or a `[`.
 * A `{"a"}` with no colon is a legal expression holding a string and is not this.
 *
 * AND THE PARSER MUST HAVE STOPPED INSIDE IT. `options={["day","week"]}` and `value={[{…}]}` are
 * perfectly legal attributes that open with `[`, and they are everywhere in these documents; wrapping
 * one because it merely matches the shape would break a document whose real fault is elsewhere —
 * and, since the wrap then cannot parse, would cost the repair that document actually needed. So the
 * candidate is the attribute the parser itself stopped inside, exactly as the backtick repair asks
 * the parser rather than the text.
 */
function jsonAttribute(source: string, pos: number): { attr: string; index: number; open: number; close: number; line: number } | null {
  for (const m of source.matchAll(/([A-Za-z_][\w-]*)=\{/g)) {
    const open = m.index! + m[0].length - 1;
    const rest = source.slice(open + 1);
    const value = rest.match(/^\s*/)![0].length + open + 1;
    const first = source[value];
    const key = first === '"' || first === "'";
    if (!key && first !== '[') continue;
    if (key) {
      const end = balancedString(source, value);
      if (end < 0 || !/^\s*:/.test(source.slice(end + 1))) continue;
    }
    const close = balancedClose(source, open);
    if (close < 0 || pos < open || pos > close) continue;
    return { attr: m[1]!, index: m.index!, open, close, line: source.slice(0, open).split('\n').length };
  }
  return null;
}

/** Where in the source the stray-`}` site that `extraClosing` named begins. */
function siteIndex(source: string, extra: { attr: string; line: number }): number {
  const m = [...source.matchAll(/([A-Za-z_][\w-]*)=\{/g)].find((x) => x[1] === extra.attr && source.slice(0, x.index! + x[0].length - 1).split('\n').length === extra.line);
  return m ? m.index! : -1;
}

/**
 * THE BRACE COUNT, the second fault worth repairing: 15 tasks and 82 model calls went to a
 * `viz={{…}}` with one `}` too many or too few, or a `{{{`
 * opening from wrapping an already-wrapped object. The two unambiguous shapes are repaired — stray
 * `}`s after a closed expression, and `{{{` — found by the same scanners that name them in the
 * refusal, and kept only if the result parses. A missing brace is named, never guessed (see below).
 *
 * ITERATED, because an agent that builds one chart wrongly builds every chart in that document the
 * same way. Repairing only the first occurrence and re-parsing once refused a scrolly carrying TWO
 * `viz={{{` with `fixed:false`, and recovering it took three more calls (claude-code, production
 * run 15). So: fix the EARLIEST remaining fault, re-parse, repeat while the parser's own position
 * advances. Both shapes are counted, and the reply states the totals — "collapsed 1" against a
 * document with two would teach the wrong lesson.
 */
function repairBraces(source: string, count: BraceCount): string {
  let out = source;
  let lastPos = -1;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const parsed = parseJsx(out);
    if (parsed.ok) break;
    // Forward progress is the convergence test: a repair that leaves the parser stuck where it
    // already was is not converging on this document, and guessing further is exactly what the
    // missing-brace rule forbids.
    const pos = typeof parsed.pos === 'number' ? parsed.pos : -1;
    if (pass > 0 && pos <= lastPos) break;
    lastPos = pos;
    const triple = tripleOpen(out);
    const extra = extraClosing(out);
    const extraAt = extra ? siteIndex(out, extra) : -1;
    const json = jsonAttribute(out, pos);
    // The MIRROR of the wrap: the object form on a value that is not an object. Same position gate —
    // `viz={{"kind": …}}` is the correct spelling and a legal `{{…}}` must never be unwrapped, so the
    // candidate is the attribute the parser stopped inside, not every attribute of that shape.
    const doubled = doubleWrapped(out);
    const doubledAt = doubled && pos >= doubled.open && pos <= doubled.close ? doubled.open : -1;
    // The earliest fault first, so the parser's position moves forward with each pass. A `{{{`
    // usually leaves a stray `}` behind at the same site; `<=` repairs the opening before the tail.
    const earliest = Math.min(...[triple?.index, extraAt >= 0 ? extraAt : undefined, json?.index, doubledAt >= 0 ? doubledAt : undefined].filter((at): at is number => typeof at === 'number'));
    if (doubled && doubledAt === earliest) {
      // Delete the inner `{` and its matching `}`: `attr={{[…]}}` becomes `attr={[…]}`.
      out = `${out.slice(0, doubled.inner)}${out.slice(doubled.inner + 1, doubled.close)}${out.slice(doubled.close + 1)}`;
      count.unwrapped.push({ attr: doubled.attr, line: doubled.line });
      continue;
    }
    if (json && json.index === earliest) {
      // The one repair the shape allows: one more brace pair around the whole balanced value.
      out = `${out.slice(0, json.open)}{${out.slice(json.open, json.close + 1)}}${out.slice(json.close + 1)}`;
      count.wrapped.push({ attr: json.attr, line: json.line });
      continue;
    }
    if (triple && triple.index === earliest) {
      out = out.slice(0, triple.index!) + `${triple[1]}={{` + out.slice(triple.index! + triple[0].length);
      count.collapsed.push(triple[1]!);
      continue;
    }
    if (!extra || extraAt < 0) break;
    // Delete the stray `}`s that follow the balanced close of the expression.
    let depth = 0, quote: string | null = null, i = extraAt + out.slice(extraAt).indexOf('{');
    for (; i < out.length; i++) {
      const ch = out[i];
      if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) break; }
    }
    let j = i + 1, dropped = 0;
    while (j < out.length && dropped < extra.extra) { if (out[j] === '}') { out = out.slice(0, j) + out.slice(j + 1); dropped++; } else if (/\s/.test(out[j])) j++; else break; }
    if (!dropped) break;
    count.removed += dropped;
    count.strays.push({ attr: extra.attr, line: extra.line });
  }
  return out;
}

/** One line per shape, with the TOTAL each shape accounted for across the whole document. */
function braceNotes(count: BraceCount): string[] {
  const notes: string[] = [];
  const names = (values: string[]) => [...new Set(values)].join('`/`');
  if (count.wrapped.length) {
    const lines = count.wrapped.map((site) => `line ${site.line}`);
    notes.push(`wrapped ${count.wrapped.length} JSON attribute value${count.wrapped.length === 1 ? '' : 's'} on ${lines.join(', ')} (\`${names(count.wrapped.map((site) => site.attr))}={…}\` → \`${names(count.wrapped.map((site) => site.attr))}={{…}}\`)`);
  }
  if (count.unwrapped.length) {
    const lines = count.unwrapped.map((site) => `line ${site.line}`);
    const attrs = names(count.unwrapped.map((site) => site.attr));
    notes.push(`unwrapped ${count.unwrapped.length} JSON array attribute value${count.unwrapped.length === 1 ? '' : 's'} on ${lines.join(', ')} (\`${attrs}={{[…]}}\` → \`${attrs}={[…]}\`)`);
  }
  if (count.collapsed.length) notes.push(`collapsed ${count.collapsed.length} \`${names(count.collapsed)}={{{\` opening${count.collapsed.length === 1 ? '' : 's'}`);
  if (count.strays.length) {
    // Every site says "line N" in full, never "lines 2, 3": the CLI moves a body line onto its FILE
    // line by rewriting `\bline (\d+)\b` past the YAML fence (cli/src/validation.ts), and a plural
    // "lines" matches none of it — the notice would name lines that are wrong by the fence's height.
    const lines = count.strays.map((site) => `line ${site.line}`);
    notes.push(`removed ${count.removed} closing brace${count.removed === 1 ? '' : 's'} after \`${names(count.strays.map((site) => site.attr))}={\` on ${lines.join(', ')}`);
  }
  return notes;
}

/**
 * Repair a source the JSX parser rejected, when the fault is one we can fix
 * provably. Null when the source already parses, when the fault is a different
 * one, or when the repair does not make it parse — in every one of those the
 * caller's original error is the right answer.
 */
export function repairJsxSource(source: string): { source: string; repair: SourceRepair } | null {
  const parsed = parseJsx(source);
  if (parsed.ok) return null;

  let out = source;
  const notes: string[] = [];
  const advice: string[] = [];
  let removed = 0;
  let code: SourceRepair['code'] | undefined;

  // THE SIGNATURE, asked of the parser rather than of the text: it stopped at a
  // backtick, and that backtick is backslash-escaped. Anywhere a template
  // literal may legally hold `\``, the document parses and we are never called.
  // The `includes` is a free bail for every document without the sequence, so an
  // ordinary publish never pays for the scan.
  const pos = parsed.pos;
  if (source.includes('\\`') && typeof pos === 'number' && source[pos] === '`' && source[pos - 1] === '\\') {
    const repaired = out.replaceAll('\\`', '`');
    const dropped = out.length - repaired.length;
    if (dropped > 0) {
      out = repaired; removed += dropped; code = 'escaped_backtick';
      notes.push(`removed ${dropped} backslash${dropped === 1 ? '' : 'es'} escaping a backtick`);
      advice.push(
        'A backtick inside a JSX expression must not be written as \\` — send {`select …`}, not ' +
        '{\\`select …\\`}. A shell heredoc or a JSON string builder adds that escape; send the document ' +
        'as a file or let the JSON encoder do the quoting.',
      );
    }
  }

  // A brace fault is the other shape worth a repair, and a document can carry BOTH: a heredoc that
  // escaped the backticks of a <Query> is the same document whose charts were wrapped twice. Whatever
  // is repaired is REPORTED — one shape is never fixed silently under the other's name.
  if (!parseJsx(out).ok) {
    const count: BraceCount = { collapsed: [], strays: [], wrapped: [], unwrapped: [], removed: 0 };
    const braced = repairBraces(out, count);
    const braceNotesText = braceNotes(count);
    if (braceNotesText.length) {
      out = braced; removed += count.removed; code ??= 'unbalanced_braces';
      notes.push(...braceNotesText);
      advice.push('Build the viz object as JSON and serialize it inside ONE JSX expression (viz={{…}}) instead of counting braces by hand.');
    }
  }

  // A MISSING brace is not repaired: where it belongs is a guess (an inner object or the outer one),
  // and a wrong guess parses. It stays a named refusal — "never closed, needs N more `}`" — and so
  // does everything else the repairs did not make parse: the caller's original error is the answer,
  // against the ORIGINAL source, so its line numbers still point at the author's file.
  if (!code || out === source || !parseJsx(out).ok) return null;

  return { source: out, repair: { code, message: `${notes.join('; ')}. ${advice.join(' ')}`, removed } };
}
