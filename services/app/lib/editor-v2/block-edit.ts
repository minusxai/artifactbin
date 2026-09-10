/** Structural commands are all-or-none source operations. Geometry is authored data. */
import { gridCols } from '@/lib/story-ui/grid-layout';
import { parseJsx, serializeJsx, type JsxElement, type JsxNode } from '@/lib/jsx';
import { setStaticJsxAttr } from '@/lib/data/story/jsx-edit';
import { bodyPathToSourcePath } from '@/lib/story/edit-compose';
import { resolveJsxNodeAtPath } from '@/lib/story-ui/host-classify';
export type BlockEdit =
  | { kind: 'delete'; paths: string[] }
  | { kind: 'divider'; path: string; width: number }
  | { kind: 'move'; path: string; target: string }
  | {
      kind: 'resize';
      path: string;
      width: number;
      height: number;
      grid?: boolean;
      axis?: 'width' | 'height';
    }
  | { kind: 'auto-height'; path: string };
export function editBlock(source: string, command: BlockEdit): string {
  const parsed = parseJsx(source);
  if (!parsed.ok) return source;
  const locate = (bodyPath: string) => {
    const path = bodyPathToSourcePath(source, bodyPath),
      parts = path.split('.'),
      index = Number(parts.pop());
    const parent = parts.length ? resolveJsxNodeAtPath(parsed.nodes, parts.join('.')) : null;
    const siblings = parts.length ? (parent?.type === 'element' ? parent.children : []) : parsed.nodes;
    const node = siblings[index];
    return node?.type === 'element' ? { node, index, siblings, parent } : null;
  };
  if (command.kind === 'delete') {
    if (!command.paths.length) return source;
    const targets = command.paths.map(locate);
    if (targets.some((t) => !t)) return source;
    const removed = new Set<JsxNode>(targets.map((t) => t!.node));
    const prune = (nodes: JsxNode[]): JsxNode[] =>
      nodes
        .filter((n) => !removed.has(n))
        .map((n) => {
          if (n.type !== 'element') return n;
          const children = prune(n.children);
          if (
            ['GridItem', 'Slide', 'div', 'section', 'article', 'td', 'th'].includes(n.tag) &&
            n.children.length > 0 &&
            !children.some((c) => c.type === 'element' || (c.type === 'text' && c.value.trim()))
          )
            children.push({
              type: 'element',
              tag: 'p',
              isComponent: false,
              attributes: [
                {
                  name: 'id',
                  value: {
                    static: true,
                    json: `e${crypto.randomUUID().replaceAll('-', '')}`,
                  },
                  start: 0,
                  end: 0,
                },
              ],
              children: [],
              selfClosing: false,
              start: 0,
              end: 0,
            });
          return { ...n, children };
        });
    const result = prune(parsed.nodes);
    if (!result.some((n) => (n.type === 'element' && n.tag !== 'Helmet') || (n.type === 'text' && n.value.trim()))) {
      const placeholder = parseJsx(`<p id="e${crypto.randomUUID().replaceAll('-', '')}"></p>`);
      if (placeholder.ok) result.push(...placeholder.nodes);
    }
    return serializeJsx(result);
  }
  const current = locate(command.path);
  if (!current) return source;
  const node = current.node;
  if (command.kind === 'divider') {
    if (
      current.parent?.type !== 'element' ||
      current.parent.tag !== 'Grid' ||
      value(current.parent, 'mode') !== 'flow' ||
      node.tag !== 'GridItem' ||
      !Number.isFinite(command.width)
    )
      return source;
    const next = current.siblings.slice(current.index + 1).find((n) => n.type === 'element');
    if (next?.type !== 'element' || next.tag !== 'GridItem') return source;
    const cols = gridCols(value(current.parent, 'cols'));
    const span = (n: JsxElement) => Math.min(cols, Math.max(1, Number(value(n, 'w')) || cols));
    // Only adjacent members of the same source row share a divider.
    let used = 0;
    for (const sibling of current.siblings.slice(0, current.index)) {
      if (sibling.type !== 'element' || sibling.tag !== 'GridItem') continue;
      const w = span(sibling);
      used = used + w > cols ? w : used + w;
      if (used === cols) used = 0;
    }
    if (used + span(node) + span(next) > cols) return source;
    const total = span(node) + span(next),
      width = Math.max(1, Math.min(total - 1, Math.round(command.width)));
    setStaticJsxAttr(node, 'w', width);
    setStaticJsxAttr(next, 'w', total - width);
  } else if (command.kind === 'move') {
    const target = locate(command.target);
    if (!target || current.siblings !== target.siblings || current.node === target.node) return source;
    current.siblings.splice(current.index, 1);
    current.siblings.splice(target.index, 0, node);
  } else if (command.kind === 'resize') {
    if (!Number.isFinite(command.width) || !Number.isFinite(command.height)) return source;
    if (command.grid) {
      if (node.tag !== 'GridItem') return source;
      if (command.axis !== 'height')
        setStaticJsxAttr(
          node,
          'w',
          Math.max(
            1,
            Math.min(
              gridCols(current.parent?.type === 'element' ? value(current.parent, 'cols') : undefined),
              Math.round(command.width),
            ),
          ),
        );
      if (command.axis === 'width') return serializeJsx(parsed.nodes);
      if (current.parent?.type === 'element' && value(current.parent, 'mode') === 'flow')
        setStaticJsxAttr(node, 'minHeight', Math.max(0, Math.min(10000, Math.round(command.height))));
      else setStaticJsxAttr(node, 'h', Math.max(1, Math.min(1000, Math.round(command.height))));
    } else {
      const w = Math.max(40, Math.min(4000, Math.round(command.width))),
        h = Math.max(0, Math.min(10000, Math.round(command.height)));
      const remaining = classes(node).filter(
        (c) =>
          !(command.axis !== 'height' && /^w-|^max-w-/.test(c)) &&
          !(command.axis !== 'width' && /^h-|^min-h-|^max-h-|^overflow-(?:hidden|clip)$/.test(c)),
      );
      if (command.axis !== 'height') remaining.push(`w-[${w}px]`, 'max-w-full');
      if (command.axis !== 'width') remaining.push(`min-h-[${h}px]`);
      setStaticJsxAttr(node, 'className', remaining.join(' '));
    }
  } else {
    if (node.tag === 'GridItem') setStaticJsxAttr(node, 'minHeight', undefined);
    else
      setStaticJsxAttr(
        node,
        'className',
        classes(node)
          .filter((c) => !/^min-h-\[/.test(c))
          .join(' '),
      );
  }
  return serializeJsx(parsed.nodes);
}
function classes(node: JsxElement): string[] {
  const value = node.attributes.find((a) => ['className', 'class'].includes(a.name))?.value;
  return value?.static && typeof value.json === 'string' ? value.json.split(/\s+/).filter(Boolean) : [];
}

function value(node: JsxElement, name: string): unknown {
  const a = node.attributes.find((a) => a.name === name)?.value;
  return a?.static ? a.json : undefined;
}
