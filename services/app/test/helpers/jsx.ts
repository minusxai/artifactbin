/**
 * THE ONE JSX-PARSE GUARD for tests whose fixture must parse before anything is asserted.
 *
 * `const parsed = parseJsx(src); if (!parsed.ok) throw new Error(parsed.error);` appeared at 75
 * call sites across 52 files in `story-ui`, `story-runtime` and `story`. Every copy exists for the
 * same reason — `ParseResult` is a discriminated union, so the narrowing is mandatory before
 * `parsed.nodes` is reachable — and the copies had drifted into four different messages, two of
 * which (`'parse'`, `'fixture does not parse'`) throw away the parser's own diagnosis and leave a
 * broken fixture looking like a broken assertion.
 *
 * This is a genuine gap rather than a bypassed helper: nothing in `test/helpers/` covered it.
 *
 * It returns the SUCCESS branch of `ParseResult`, so a call site keeps its variable and its
 * `parsed.nodes` reads unchanged — only the guard line goes.
 */
import { parseJsx } from '@/lib/jsx';
import type { ParseResult } from '@/lib/jsx/types';

/** The success branch: `{ ok: true; nodes: JsxNode[] }`. */
export type ParsedJsx = Extract<ParseResult, { ok: true }>;

/**
 * Parses, or throws with the parser's OWN error and the offending source — the two things you
 * need when a fixture stops parsing, and the two things the hand-rolled copies kept losing.
 */
export function parseJsxOrThrow(source: string): ParsedJsx {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(`fixture does not parse: ${parsed.error}\n${source}`);
  return parsed;
}
