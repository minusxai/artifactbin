import type { JsxNode } from '@/lib/jsx';

const TOKEN_REFS = new Set(['aria-activedescendant', 'aria-controls', 'aria-describedby', 'aria-details', 'aria-errormessage', 'aria-flowto', 'aria-labelledby', 'aria-owns', 'headers', 'htmlFor']);
const FRAGMENT_REFS = new Set(['href', 'xlinkHref']);
const SVG_REFS = new Set(['fill', 'stroke', 'clipPath', 'mask', 'filter', 'markerStart', 'markerMid', 'markerEnd']);

const idsIn = (nodes: JsxNode[]): Set<string> => {
  const ids = new Set<string>();
  const visit = (node: JsxNode): void => {
    if (node.type !== 'element') return;
    const id = node.attributes.find((a) => a.name.toLowerCase() === 'id')?.value;
    if (id?.static && typeof id.json === 'string') ids.add(id.json);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return ids;
};

const encoded = (value: string): string => [...value].map((char) => char.codePointAt(0)!.toString(16).padStart(6, '0')).join('');

/** One rail instance owns its collision set; each thumbnail gets a stable local ID namespace. */
export function createPreviewPropsAllocator(documentNodes: JsxNode[], instanceKey: string):
  (localNodes: JsxNode[], previewKey: string) => (props: Record<string, unknown>) => Record<string, unknown> {
  const occupied = idsIn(documentNodes);
  const mappings = new Map<string, ReadonlyMap<string, string>>();
  return (localNodes, previewKey) => {
    let mapping = mappings.get(previewKey);
    if (!mapping) {
      const next = new Map<string, string>();
      for (const id of idsIn(localNodes)) {
        const base = `mx-preview-${encoded(instanceKey)}-${encoded(previewKey)}-${encoded(id)}`;
        let candidate = base;
        let collision = 0;
        while (occupied.has(candidate)) candidate = `${base}-${++collision}`;
        occupied.add(candidate);
        next.set(id, candidate);
      }
      mapping = next;
      mappings.set(previewKey, mapping);
    }
    return (props) => {
      const patch: Record<string, unknown> = {};
      if (typeof props.id === 'string' && mapping!.has(props.id)) patch.id = mapping!.get(props.id);
      for (const [name, value] of Object.entries(props)) {
        if (typeof value !== 'string') continue;
        if (TOKEN_REFS.has(name)) patch[name] = value.replace(/\S+/g, (token) => mapping!.get(token) ?? token);
        else if (FRAGMENT_REFS.has(name) && value.startsWith('#')) {
          const replacement = mapping!.get(value.slice(1));
          if (replacement) patch[name] = `#${replacement}`;
        } else if (SVG_REFS.has(name)) {
          const rewritten = value.replace(/url\(\s*(["']?)#([^\s"')]+)\1\s*\)/g, (whole, quote: string, id: string) => {
            const replacement = mapping!.get(id);
            return replacement ? `url(${quote}#${replacement}${quote})` : whole;
          });
          if (rewritten !== value) patch[name] = rewritten;
        }
      }
      return Object.keys(patch).length ? { ...props, ...patch } : props;
    };
  };
}
