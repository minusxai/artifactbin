/**
 * THE INLINE READER'S NODE POLICY, AS DATA (lib/compiled-page/styles/inline-css isolateStoryNodes).
 *
 * The server applies the CSS policy to a document's static inline style values
 * (and its font-family aliases) once per version. Almost every node comes out
 * unchanged, so what the reader is sent is the RAW tree plus the few attribute
 * values the policy rewrote, addressed by path. Applying them needs no CSS
 * parser, so the reader renders exactly the tree the server rendered while
 * css-tree stays out of its bundle (lib/__tests__/reader-bundle-hygiene).
 *
 * The raw tree is what every edit and annotation session already classifies
 * selections against; only the render sees the rewritten values.
 */
import type { JsxAttribute, JsxNode } from '@/lib/jsx';

/** `[child-index path "0.3.1", attribute index, the attribute's rewritten value]`. */
export type StyleOverride = [path: string, attribute: number, value: JsxAttribute['value']];

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** The attribute values `isolated` (isolateStoryNodes of `raw`) differs from `raw` in. */
export function styleOverrides(raw: readonly JsxNode[], isolated: readonly JsxNode[]): StyleOverride[] {
  const out: StyleOverride[] = [];
  const visit = (a: readonly JsxNode[], b: readonly JsxNode[], prefix: string) => {
    a.forEach((node, index) => {
      const other = b[index];
      if (node.type !== 'element' || other?.type !== 'element') return;
      const path = prefix ? `${prefix}.${index}` : String(index);
      node.attributes.forEach((attr, at) => {
        const next = other.attributes[at];
        if (next && !same(attr.value, next.value)) out.push([path, at, next.value]);
      });
      visit(node.children, other.children, path);
    });
  };
  visit(raw, isolated, '');
  return out;
}

/** `nodes` with each override applied; untouched subtrees keep their identity. */
export function applyStyleOverrides(nodes: JsxNode[], overrides: readonly StyleOverride[] | null | undefined): JsxNode[] {
  if (!overrides?.length) return nodes;
  const root = nodes.slice();
  for (const [path, at, value] of overrides) {
    let list = root;
    const steps = path.split('.').map(Number);
    for (let depth = 0; depth < steps.length; depth++) {
      const index = steps[depth]!;
      const node = list[index];
      if (!node || node.type !== 'element') break;
      const copy = { ...node, children: node.children.slice(), attributes: node.attributes.slice() };
      list[index] = copy;
      if (depth === steps.length - 1) {
        const attr = copy.attributes[at];
        if (attr) copy.attributes[at] = { ...attr, value };
      }
      list = copy.children;
    }
  }
  return root;
}
