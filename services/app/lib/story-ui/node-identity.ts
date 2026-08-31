/**
 * Stable identity for a document's nodes across re-parses — the keys React
 * reconciles with.
 *
 * A document is re-parsed on every change, so the tree handed to the renderer
 * is always a fresh set of objects. Keying those by AST path (`0.2.1`) makes
 * identity POSITIONAL: deleting one paragraph renumbers every sibling after
 * it, their keys change, and React unmounts and remounts them and everything
 * below — the chart three paragraphs down is disposed and rebuilt because
 * something above it was removed.
 *
 * So identity is carried, not derived: each new tree is ALIGNED against the
 * previous one, and a node that matched inherits the key it already had. What
 * moved keeps its DOM, its embeds and their state; only what genuinely arrived
 * is new.
 *
 * Alignment is an LCS over a node SIGNATURE (kind + tag), per sibling list,
 * recursing into matched pairs. Deliberately coarse: two `<p>`s that swap
 * content still match, and matching them is right — React updates the text in
 * place, which is the outcome we want. A `<Question>` never matches a
 * `<Number>`, because a component's identity is what holds a chart's view.
 *
 * With no previous tree the keys are a pure function of the tree (the paths),
 * which is what keeps SSR and hydration in agreement: both ends compute the
 * first generation the same way, from the same nodes, with no history.
 */
import type { JsxNode } from '@/lib/jsx';

/** The keys for ONE tree: the AST path of a node → the key React should use. */
export interface NodeKeys {
  /** The stable key for the node at this path. Unknown paths fall back to the path itself. */
  keyFor(path: string): string;
  /**
   * Which generation minted the fresh keys in this table. Internal to the
   * scheme (a later generation never collides with an earlier one); exposed
   * because the caller carries a table forward and tests read it.
   */
  readonly generation: number;
}

/** A tree and the keys assigned to it — what a renderer holds between renders. */
export interface KeyedTree {
  nodes: JsxNode[];
  keys: NodeKeys;
}

/**
 * Assign keys to `next`, inheriting from `prev` wherever the two trees align.
 *
 * Pure: same inputs, same output. With `prev` absent (or empty) the result is
 * deterministic from `next` alone — the SSR/hydration case.
 */
export function assignNodeKeys(next: JsxNode[], prev?: KeyedTree | null): NodeKeys {
  const table = new Map<string, string>();
  const generation = prev ? prev.keys.generation + 1 : 0;
  let minted = 0;
  // A fresh key names its generation, so it can never collide with one
  // inherited from an earlier one — including generation 0, whose keys are the
  // paths themselves (the deterministic, history-free SSR case).
  const mint = () => `g${generation}.${minted++}`;

  const assign = (
    nextNodes: JsxNode[],
    nextBase: string,
    from: { nodes: JsxNode[]; base: string } | null,
  ): void => {
    const pairs = from ? alignBySignature(from.nodes, nextNodes) : new Map<number, number>();
    nextNodes.forEach((node, i) => {
      const path = childPath(nextBase, i);
      const matched = pairs.get(i);
      const inherited = from && matched !== undefined
        ? (prev as KeyedTree).keys.keyFor(childPath(from.base, matched))
        : null;
      table.set(path, inherited ?? (generation === 0 ? path : mint()));
      if (node.type !== 'element') return;
      const prevChild = from && matched !== undefined ? from.nodes[matched] : undefined;
      assign(
        node.children,
        path,
        prevChild && prevChild.type === 'element'
          ? { nodes: prevChild.children, base: childPath(from!.base, matched!) }
          : null,
      );
    });
  };

  assign(next, '', prev ? { nodes: prev.nodes, base: '' } : null);
  return {
    generation,
    keyFor: (path: string) => table.get(path) ?? path,
  };
}

/** The interpreter's own path scheme: roots are `0`, `1`, …; children are `<parent>.<i>`. */
const childPath = (base: string, i: number): string => (base === '' ? String(i) : `${base}.${i}`);

/**
 * What makes two nodes "the same node" for alignment: their KIND and tag, and
 * nothing else. Coarse on purpose — two paragraphs whose text differs should
 * match, because updating text in place is exactly what we want React to do —
 * but never across the component boundary, since a component's identity is
 * what holds a chart's view or a table's measurement.
 */
const signatureOf = (node: JsxNode): string =>
  node.type === 'element' ? `${node.isComponent ? 'C' : 'e'}:${node.tag.toLowerCase()}` : node.type;

/**
 * The full content of a node — tag, attributes and everything below it. Two
 * nodes with the same one are the same node *unless* the document holds
 * several of them, which is why only a signature unique on BOTH sides anchors
 * a pair. This is what lets identity follow content rather than position: with
 * three paragraphs and the middle one deleted, the survivors match themselves
 * instead of shifting up onto their neighbours' keys.
 */
function contentOf(node: JsxNode): string {
  if (node.type === 'text') return `t:${node.value.trim()}`;
  if (node.type === 'expression') return `x:${node.source}`;
  const attrs = node.attributes
    .map((a) => `${a.name}=${JSON.stringify(a.value)}`)
    .sort()
    .join(',');
  return `${signatureOf(node)}[${attrs}](${node.children.map(contentOf).join('')})`;
}

/**
 * Which node in `next` corresponds to which in `prev`, in two passes:
 *
 *  1. CONTENT anchors — a node whose entire content appears exactly once on
 *     each side is itself, wherever it has moved to.
 *  2. everything still unpaired aligns by LCS over the coarse signature, in
 *     order. This is the pass that matches an EDITED node to its old self: its
 *     content changed, so no anchor could, but its tag and its place among the
 *     remaining siblings still identify it.
 *
 * Sibling lists are small (a document's children, not its nodes), so the
 * quadratic table is the right trade for an exact alignment.
 */
function alignBySignature(prev: JsxNode[], next: JsxNode[]): Map<number, number> {
  const pairs = new Map<number, number>();
  if (prev.length === 0 || next.length === 0) return pairs;

  const once = (nodes: JsxNode[]) => {
    const seen = new Map<string, number | null>();
    nodes.forEach((node, i) => {
      const c = contentOf(node);
      seen.set(c, seen.has(c) ? null : i); // a repeat poisons the entry: ambiguous
    });
    return seen;
  };
  const prevOnce = once(prev);
  const nextOnce = once(next);
  const takenPrev = new Set<number>();
  for (const [content, j] of nextOnce) {
    const i = prevOnce.get(content);
    if (j === null || i === null || i === undefined) continue;
    pairs.set(j, i);
    takenPrev.add(i);
  }

  // Pass 2 — LCS over what the anchors left behind, in document order.
  const prevRest = prev.map((n, i) => i).filter((i) => !takenPrev.has(i));
  const nextRest = next.map((n, j) => j).filter((j) => !pairs.has(j));
  const n = prevRest.length;
  const m = nextRest.length;
  if (n === 0 || m === 0) return pairs;

  const a = prevRest.map((i) => signatureOf(prev[i]));
  const b = nextRest.map((j) => signatureOf(next[j]));
  // dp[i][j] = LCS length of prev[i..] and next[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.set(nextRest[j], prevRest[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}
