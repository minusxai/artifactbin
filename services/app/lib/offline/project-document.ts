/** Post-hydration projection of validated static markup. Compiled interactive subtrees
 * remain the same DOM nodes and keep their runtime; saved files retain the original
 * code/HTML pair. This never compiles or executes author source. */
import { parseJsx, serializeJsx, type JsxNode, type JsxElement } from '@/lib/jsx';
import { storyBodyFor } from '@/lib/story/document/body';
import { rawBuildProps } from '@/lib/story-ui/interpreter-primitives';

const identity = (node: JsxElement) => node.attributes.find((a) => a.name === 'id')?.value;
const key = (node: JsxElement): string | null => {
  const id = identity(node); return id?.static && typeof id.json === 'string' ? id.json : null;
};
const withoutIds = (node: JsxNode): JsxNode => node.type === 'element' ? { ...node, attributes: node.attributes.filter((a) => a.name !== 'id'), children: node.children.map(withoutIds) } : node;
const signature = (node: JsxElement): string => serializeJsx([withoutIds(node)]);
const dynamic = (node: JsxElement): boolean => node.isComponent || (!!node.control && node.control.kind !== 'fragment')
  || node.attributes.some((a) => !a.value.static) || node.children.some((child) => child.type === 'expression' && !child.value.static);
const shape = (nodes: JsxNode[]): unknown => nodes.map((node): unknown => node.type === 'element'
  ? [node.tag, node.attributes.filter((a) => a.name !== 'id').map((a) => [a.name, a.value]), node.control, shape(node.children)]
  : node.type);

/** The downloaded module cannot compile new widgets without a local compiler.
 * Plain markup and static kit shells are projected; changed interactive trees
 * are refused before the backend adopts source, preserving the recoverable draft. */
export const OFFLINE_COMPONENT_REASON = 'This component needs the local compiler. Open this file with afbin preview to edit it.';
const STATIC_SHELLS = new Set(['Badge', 'Alert', 'AlertTitle', 'AlertDescription', 'Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardAction', 'CardContent', 'CardFooter']);
export function assertProjectionSupported(beforeSource: string, nextSource: string): void {
  const before = parseJsx(beforeSource), next = parseJsx(nextSource);
  if (!before.ok || !next.ok) return; // The owning markup validator reports syntax errors.
  const scripts = (nodes: JsxNode[]): string[] => nodes.flatMap((node): string[] => node.type !== 'element' ? []
    : node.tag === 'script' ? [signature(node)] : scripts(node.children));
  if (JSON.stringify(scripts(before.nodes)) !== JSON.stringify(scripts(next.nodes))) throw new Error(OFFLINE_COMPONENT_REASON);
  const prior = new Map<string, JsxElement>();
  const priorSource = new Set<string>();
  const visit = (nodes: JsxNode[], run: (node: JsxElement) => void) => {
    for (const node of nodes) if (node.type === 'element') { run(node); if (node.tag !== 'Helmet') visit(node.children, run); }
  };
  visit(before.nodes, (node) => { const id = key(node); if (id) prior.set(id, node); if (dynamic(node)) priorSource.add(signature(node)); });
  visit(next.nodes, (node) => {
    if (!dynamic(node) || node.tag === 'Helmet' || node.control?.kind === 'fragment') return;
    const old = key(node) ? prior.get(key(node)!) : undefined;
    if (priorSource.has(signature(node))) return;
    if (old && old.tag === node.tag && STATIC_SHELLS.has(node.tag)
      && serializeJsx([{ ...withoutIds(old) as JsxElement, children: [] }]) === serializeJsx([{ ...withoutIds(node) as JsxElement, children: [] }])) return;
    throw new Error(OFFLINE_COMPONENT_REASON);
  });
}

/** Canonical identity assignment may change IDs after a save, but must not replace newer typing. */
export function sameSourceContent(a: string, b: string): boolean {
  if (a === b) return true;
  const left = parseJsx(a), right = parseJsx(b);
  return left.ok && right.ok && serializeJsx(left.nodes.map(withoutIds)) === serializeJsx(right.nodes.map(withoutIds));
}

export function projectDocument(root: HTMLElement, nodes: JsxNode[], priorSource: string): void {
  // Compiled data-mx-ast paths address the canonical reader body, never the
  // source's Helmet. Indexing the full source shifts every widget and would
  // replace healthy hydrated controls with unavailable fallbacks.
  const prior = storyBodyFor(priorSource);
  if (!prior || JSON.stringify(shape(prior.body)) === JSON.stringify(shape(nodes))) return;
  const byId = new Map<string, { node: JsxElement; path: string }>();
  const bySource = new Map<string, { node: JsxElement; path: string }>();
  const index = (items: JsxNode[], parent = '') => items.forEach((node, i) => {
    if (node.type !== 'element') return;
    const path = parent ? `${parent}.${i}` : String(i);
    const id = key(node); if (id) byId.set(id, { node, path });
    bySource.set(signature(node), { node, path }); index(node.children, path);
  });
  index(prior.body);
  const existing = new Map([...root.querySelectorAll<HTMLElement>('[data-mx-ast]')].map((el) => [el.getAttribute('data-mx-ast')!, el]));
  const build = (items: JsxNode[], parent = '', svg = false): DocumentFragment => {
    const fragment = document.createDocumentFragment();
    items.forEach((node, i) => {
      const path = parent ? `${parent}.${i}` : String(i);
      if (node.type === 'text') { fragment.append(document.createTextNode(node.value)); return; }
      if (node.type === 'expression') {
        if (node.value.static && node.value.json !== null && typeof node.value.json !== 'boolean') fragment.append(document.createTextNode(String(node.value.json)));
        return;
      }
      if (node.tag === 'Helmet') return;
      if (node.control?.kind === 'fragment') { fragment.append(build(node.children, path, svg)); return; }
      const old = (key(node) ? byId.get(key(node)!) : undefined) ?? bySource.get(signature(node));
      const retained = old ? existing.get(old.path) : undefined;
      if (dynamic(node) && retained && signature(old!.node) === signature(node)) {
        for (const el of [retained, ...retained.querySelectorAll<HTMLElement>('[data-mx-ast]')]) {
          const before = el.getAttribute('data-mx-ast')!;
          if (before === old!.path || before.startsWith(`${old!.path}.`)) el.setAttribute('data-mx-ast', path + before.slice(old!.path.length));
        }
        fragment.append(retained); return;
      }
      // Static component shells keep their published recipe styling. Dynamic components
      // not available in the downloaded compile have an explicit fallback, never stale output.
      if (dynamic(node) && !retained) {
        const unavailable = document.createElement('div'); unavailable.setAttribute('data-mx-ast', path);
        const id = key(node); if (id) unavailable.id = id;
        unavailable.textContent = `${node.tag}: preview this changed component locally with afbin preview.`;
        fragment.append(unavailable); return;
      }
      const inSvg = svg || node.tag === 'svg';
      const el = node.isComponent ? retained!.cloneNode(false) as HTMLElement : inSvg
        ? document.createElementNS('http://www.w3.org/2000/svg', node.tag) : document.createElement(node.tag);
      const props = rawBuildProps(node.attributes, node.isComponent, node.tag, path);
      for (const [name, value] of Object.entries(props)) {
        if (name === 'style' && value && typeof value === 'object') {
          for (const [property, css] of Object.entries(value)) {
            if (property.startsWith('--')) (el as HTMLElement).style.setProperty(property, String(css));
            else Object.assign((el as HTMLElement).style, { [property]: css });
          }
          continue;
        }
        if (value === null || value === undefined || typeof value === 'object' || value === false) continue;
        const attr = name === 'className' ? 'class' : name === 'htmlFor' ? 'for' : name === 'defaultValue' ? 'value' : name === 'defaultChecked' ? 'checked' : name;
        el.setAttribute(attr, value === true ? '' : String(value));
      }
      el.append(build(node.children, path, inSvg)); fragment.append(el);
    });
    return fragment;
  };
  root.replaceChildren(build(nodes));
}
