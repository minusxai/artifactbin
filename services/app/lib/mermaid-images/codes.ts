/**
 * The Mermaid codes a document draws — every `<Mermaid>` with a static code
 * the kit would render, once each, in document order. Pure: shared by the
 * reader paths (which drawings to look up) and the harvest (which drawings to
 * expect).
 */
import type { JsxNode } from '@/lib/jsx';
import { mermaidSourceError } from '@/lib/jsx/mermaid-source';

export function mermaidCodesOf(nodes: readonly JsxNode[]): string[] {
  const codes = new Set<string>();
  const walk = (list: readonly JsxNode[]) => {
    for (const node of list) {
      if (node.type !== 'element') continue;
      if (node.isComponent && node.tag === 'Mermaid') {
        const code = node.attributes.find((a) => a.name === 'code')?.value;
        if (code?.static && typeof code.json === 'string' && !mermaidSourceError(code.json)) codes.add(code.json);
      }
      walk(node.children);
    }
  };
  walk(nodes);
  return [...codes];
}
