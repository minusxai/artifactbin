/**
 * A READ-ONLY parse, shared between the callers that diff one source against the next.
 *
 * A pause in typing hands the editor's text to the source, and that one change is then diffed by undo history,
 * by the save diff and by the splice normalizer, each of which parsed the whole document again (ten parses of
 * the same two strings per pause; a few hundred milliseconds each at slow CPUs on a table-heavy document). The
 * last few results are kept here, keyed by the source itself, so each distinct source is parsed once.
 *
 * And a source that differs from a kept one by ONE contiguous change inside an element is not parsed whole: only
 * the smallest element around the change is parsed again, and the nodes after it move by the change's length.
 * The parser is context-free (an element's tree does not depend on what surrounds it), so the result is exactly
 * the whole parse's — a typed sentence costs a paragraph's parse, not a report's.
 *
 * The trees are SHARED: a caller must not mutate them. Graph code stamps keys onto nodes (GraphAstNode), so it
 * parses its own copy with `parseJsx` and never uses this.
 */
import { parseJsx } from './parse';
import type { JsxNode, ParseResult } from './types';

const KEEP = 6;
const recent: Array<{ source: string; result: ParseResult }> = [];

export function parseJsxShared(source: string): ParseResult {
  const index = recent.findIndex((entry) => entry.source === source);
  if (index >= 0) {
    const [hit] = recent.splice(index, 1);
    recent.unshift(hit!);
    return hit!.result;
  }
  const near = recent.find((entry) => entry.result.ok);
  const result = (near && reparse(near.source, near.result, source)) || parseJsx(source);
  recent.unshift({ source, result });
  if (recent.length > KEEP) recent.length = KEEP;
  return result;
}

/** A copy of `node` with every source offset moved by `delta`. */
function shifted(node: JsxNode, delta: number): JsxNode {
  if (node.type !== 'element') return { ...node, start: node.start + delta, end: node.end + delta };
  return {
    ...node,
    start: node.start + delta,
    end: node.end + delta,
    attributes: node.attributes.map((attribute) => ({ ...attribute, start: attribute.start + delta, end: attribute.end + delta })),
    children: node.children.map((child) => shifted(child, delta)),
  };
}

/**
 * `next`'s parse from `previous`'s, when they differ by one change inside an element's children: that element is
 * parsed again by itself, its ancestors are copied, and everything after it moves. Null when the change touches
 * the top level, a tag or a structural (control) node — the caller parses the whole source then.
 */
export function reparse(previous: string, parsed: ParseResult, next: string): ParseResult | null {
  if (!parsed.ok) return null;
  const min = Math.min(previous.length, next.length);
  let from = 0;
  while (from < min && previous.charCodeAt(from) === next.charCodeAt(from)) from++;
  let same = 0;
  while (same < min - from && previous.charCodeAt(previous.length - 1 - same) === next.charCodeAt(next.length - 1 - same)) same++;
  const to = previous.length - same, delta = next.length - previous.length;
  const rebuild = (siblings: JsxNode[]): JsxNode[] | null => {
    const index = siblings.findIndex((node) => node.start <= from && to <= node.end);
    const node = siblings[index];
    if (!node || node.type !== 'element' || node.control) return null;
    const children = node.children;
    let replaced: JsxNode | null = null;
    if (children.length && children[0]!.start <= from && to <= children.at(-1)!.end) {
      const inner = rebuild(children);
      if (inner) replaced = { ...node, end: node.end + delta, children: inner };
    }
    if (!replaced) {
      // The change is inside this element, clear of its first and last character (its tags' brackets).
      if (!(node.start < from && to < node.end)) return null;
      const text = next.slice(node.start, node.end + delta);
      const own = parseJsx(text);
      const only = own.ok && own.nodes.length === 1 ? own.nodes[0]! : null;
      if (!only || only.type !== 'element' || only.control || only.start !== 0 || only.end !== text.length) return null;
      replaced = shifted(only, node.start);
    }
    return [...siblings.slice(0, index), replaced, ...siblings.slice(index + 1).map((sibling) => shifted(sibling, delta))];
  };
  const nodes = rebuild(parsed.nodes);
  return nodes ? { ok: true, nodes } : null;
}
