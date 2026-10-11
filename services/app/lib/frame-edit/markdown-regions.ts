/** Lifecycle of explicit prose regions. Source changes cross the existing checked flow-edit door. */
import { serializeJsx, type JsxElement, type JsxNode } from '@/lib/jsx';
import { markdownSource } from '@/lib/markdown/content';
import { mountMarkdownEditor, type MarkdownEditor } from '@/lib/markdown/editor';
import { AST_PATH_ATTR } from '@/lib/story-ui/ast-path';

interface Entry { node: JsxElement; path: string; el: HTMLElement; view: MarkdownEditor; held: boolean }
function regions(nodes: JsxNode[]): Array<{ node: JsxElement; path: string }> {
  const out: Array<{ node: JsxElement; path: string }> = [];
  const walk = (list: JsxNode[], prefix: string) => list.forEach((node, i) => {
    if (node.type !== 'element') return;
    const path = prefix ? `${prefix}.${i}` : String(i);
    if (node.tag === 'Markdown') out.push({ node, path });
    else if (!node.isComponent || !['For', 'DataTable'].includes(node.tag)) walk(node.children, path);
  });
  walk(nodes, ''); return out;
}
const id = (node: JsxElement) => node.attributes.find(a => a.name === 'id')?.value;
const key = (node: JsxElement) => { const value = id(node); return value?.static && typeof value.json === 'string' ? value.json : null; };
const skeleton = (nodes: JsxNode[]): string => serializeJsx(nodes.map(function strip(node): JsxNode {
  return node.type !== 'element' ? node : { ...node, children: node.tag === 'Markdown' ? [] : node.children.map(strip) };
}));

export function createMarkdownRegions(root: HTMLElement, callbacks: {
  change(path: string, expected: string, replacement: string): void;
  busy(value: boolean): void;
  selection(el: HTMLElement): void;
  error(message: string): void;
}) {
  const entries = new Map<string, Entry>();
  const find = (container: HTMLElement, path: string) => container.querySelector<HTMLElement>(`[data-mx-markdown][${AST_PATH_ATTR}="${CSS.escape(path)}"]`);
  const flush = () => { for (const entry of entries.values()) entry.view.flush(); };
  const unmount = () => { for (const [name, entry] of entries) if (!entry.held) { entry.view.destroy(); entries.delete(name); } };
  return {
    flush,
    busy: () => [...entries.values()].some(entry => entry.view.busy()),
    at: (path: string | null) => [...entries.values()].find(entry => entry.path === path)?.view,
    mount(nodes: JsxNode[]) {
      for (const { node, path } of regions(nodes)) {
        const name = key(node), el = find(root, path);
        if (!name || !el) continue;
        const kept = entries.get(name);
        if (kept?.el === el) { kept.held = false; kept.node = node; kept.path = path; kept.el.setAttribute(AST_PATH_ATTR, path); continue; }
        kept?.view.destroy();
        const entry = { node, path, el, held: false } as Entry;
        entry.view = mountMarkdownEditor(el, {
          source: markdownSource(node) ?? '',
          onChange(source) {
            const expected = serializeJsx([entry.node]);
            entry.node = { ...entry.node, children: [{ type: 'expression', value: { static: true, json: source }, source: JSON.stringify(source), start: 0, end: 0 }] };
            callbacks.change(entry.path, expected, serializeJsx([entry.node]));
          },
          onBusy(value) { callbacks.busy(value || [...entries.values()].some(other => other !== entry && other.view.busy())); },
          onSelection() { if (el.contains(el.ownerDocument.activeElement)) callbacks.selection(el); },
          onError: callbacks.error,
        });
        entries.set(name, entry);
      }
      for (const [name, entry] of entries) if (entry.held) { entry.view.destroy(); entries.delete(name); }
    },
    reconcile(before: JsxNode[], after: JsxNode[], next: JsxNode[]) {
      if (!entries.size || skeleton(before) !== skeleton(after)) return false;
      const desired = regions(next);
      if (desired.length !== entries.size || desired.some(({ node }) => !entries.has(key(node) ?? ''))) return false;
      if (desired.some(({ node }) => { const entry = entries.get(key(node)!)!; return entry.view.busy() && markdownSource(node) !== markdownSource(entry.node); })) return false;
      for (const { node, path } of desired) {
        const entry = entries.get(key(node)!)!;
        entry.view.sync(markdownSource(node) ?? ''); entry.node = node; entry.path = path; entry.el.setAttribute(AST_PATH_ATTR, path);
      }
      return true;
    },
    hold(next: JsxNode[], draft: HTMLElement): Map<string, HTMLElement> {
      const stands = new Map<string, HTMLElement>();
      for (const { node, path } of regions(next)) {
        const entry = entries.get(key(node) ?? ''), target = find(draft, path);
        if (!entry || !target || serializeJsx([entry.node]) !== serializeJsx([node])) continue;
        const stand = draft.ownerDocument.createElement('div'); stand.setAttribute('data-mx-edit-region', path); target.replaceWith(stand);
        entry.path = path; entry.el.setAttribute(AST_PATH_ATTR, path); entry.held = true; stands.set(path, entry.el);
      }
      return stands;
    },
    release() { for (const entry of entries.values()) entry.held = false; },
    unmount,
    destroy() { for (const entry of entries.values()) entry.held = false; unmount(); },
  };
}
