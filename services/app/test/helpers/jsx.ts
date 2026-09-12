/**
 * THE ONE JSX-PARSE GUARD for tests whose fixture must parse before anything is asserted.
 *
 * `const parsed = parseJsx(src); if (!parsed.ok) throw new Error(parsed.error);` stood at 73 call
 * sites across the 51 files that now import this helper, in `story-ui`, `story-runtime`, `story`,
 * `editor-v2`, `sql` and `jsx`. Every copy existed for the same reason — `ParseResult` is a
 * discriminated union, so the narrowing is mandatory before `parsed.nodes` is reachable — and the
 * copies had drifted into four different messages, two of which (`'parse'`, `'fixture does not
 * parse'`) threw away the parser's own diagnosis and left a broken fixture looking like a broken
 * assertion.
 *
 * TWO SITES THAT LOOK LIKE THIS AND ARE NOT, deliberately left alone:
 * `lib/jsx/__tests__/syntax-error.test.ts` guards the INVERSE (`if (parsed.ok) throw`), and
 * `lib/data/story/__tests__/jsx-edit-layout.test.ts` asserts `expect(parsed.ok).toBe(true)` before
 * narrowing, which is an assertion rather than a guard.
 *
 * This is a genuine gap rather than a bypassed helper: nothing in `test/helpers/` covered it.
 *
 * It returns the SUCCESS branch of `ParseResult`, so a call site keeps its variable and its
 * `parsed.nodes` reads unchanged — only the guard line goes.
 */
import { expect } from 'vitest';
import { parseJsx, validateJsxSource } from '@/lib/jsx';
import { JSX_STORY_COMPONENT_NAMES } from '@/lib/jsx/components';
import { STORY_HTML_TAGS } from '@/lib/story-ui/component-names';
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

/**
 * EVERY WRITE-BACK RESULT MUST BE VALID, RENDERABLE STORY JSX — the invariant
 * the three `lib/data/story/__tests__/jsx-*edit*.test.ts` files check after
 * each edit. One copy, because the allowlists it validates against are the
 * product's, not a test's.
 */
export function expectValidStoryJsx(source: string) {
  expect(validateJsxSource(source, JSX_STORY_COMPONENT_NAMES, STORY_HTML_TAGS)).toEqual([]);
}

