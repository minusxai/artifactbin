/**
 * A READ-ONLY parse, shared between the callers that diff one source against the next.
 *
 * A pause in typing hands the editor's text to the source, and that one change is then diffed by undo history,
 * by the save diff and by the splice normalizer, each of which parsed the whole document again (ten parses of
 * the same two strings per pause; a few hundred milliseconds each at slow CPUs on a table-heavy document). The
 * last few results are kept here, keyed by the source itself, so each distinct source is parsed once.
 *
 * The trees are SHARED: a caller must not mutate them. Graph code stamps keys onto nodes (GraphAstNode), so it
 * parses its own copy with `parseJsx` and never uses this.
 */
import { parseJsx } from './parse';
import type { ParseResult } from './types';

const KEEP = 6;
const recent: Array<{ source: string; result: ParseResult }> = [];

export function parseJsxShared(source: string): ParseResult {
  const index = recent.findIndex((entry) => entry.source === source);
  if (index >= 0) {
    const [hit] = recent.splice(index, 1);
    recent.unshift(hit!);
    return hit!.result;
  }
  const result = parseJsx(source);
  recent.unshift({ source, result });
  if (recent.length > KEEP) recent.length = KEEP;
  return result;
}
