/** Runtime transactions address a checked sibling region, never arbitrary DOM HTML. */
import { parseJsx, serializeJsx, type JsxNode } from '@/lib/jsx';
import { parseJsxShared } from '@/lib/jsx/parse-shared';
import { validateJsx } from '@/lib/jsx/validate';
import { bodyPathToSourcePath } from '@/lib/document/edit-compose';
import { resolveJsxNodeAtPath } from '@/lib/story-ui/host-classify';
import { isProseTree } from './model';
import { sourceChanges } from '@/lib/document/source-changes';
import { rebaseEditBatch } from '@/lib/document/edit-batch';
import { markdownSource } from '@/lib/markdown/content';

export function replaceProseRegion(source: string, path: string, expected: string, replacement: string): string {
  // Cached, incremental parsing keeps typing proportional to the changed block. An exact byte
  // match must also be an actual prose sibling range: comments and expression strings can contain
  // the old JSX after a collaborator has deleted its real target.
  const parsed = parseJsxShared(source), old = parseJsx(expected), next = parseJsx(replacement);
  if (parsed.ok && old.ok && next.ok && old.nodes.length === 1 && old.nodes[0].type === 'element' && old.nodes[0].tag === 'Markdown') {
    const previous = old.nodes[0], updated = next.nodes[0];
    if (next.nodes.length !== 1 || updated?.type !== 'element' || updated.tag !== 'Markdown'
      || markdownSource(updated) === null || validateJsx([updated], { components: ['Markdown'] }).length) return source;
    const attrs = (node: typeof previous) => JSON.stringify(node.attributes.map(a => [a.name, a.value]));
    if (attrs(previous) !== attrs(updated)) return source; // This channel changes only Markdown content.
    const id = previous.attributes.find(a => a.name === 'id')?.value;
    if (!id?.static || typeof id.json !== 'string') return source;
    const candidates: typeof previous[] = [];
    const walk = (nodes: JsxNode[]) => { for (const node of nodes) if (node.type === 'element') {
      if (node.tag === 'Markdown' && node.attributes.some(a => a.name === 'id' && a.value.static && a.value.json === id.json)) candidates.push(node);
      else walk(node.children);
    } };
    walk(parsed.nodes);
    if (candidates.length !== 1 || markdownSource(candidates[0]) !== markdownSource(previous)) return source;
    const target = candidates[0];
    return source.slice(0, target.start) + serializeJsx([{ ...target, children: updated.children }]) + source.slice(target.end);
  }
  if (!parsed.ok || !old.ok || !next.ok || !old.nodes.length || !next.nodes.every(isProseTree)) return source;
  if (validateJsx(next.nodes, { components: [] }).length) return source;
  const at = expected && /\bid=["{]/.test(expected) ? source.indexOf(expected) : -1;
  if (at >= 0) {
    if (source.indexOf(expected, at + 1) >= 0) return source;
    const isRegion = (siblings: JsxNode[]): boolean => {
      const start = siblings.findIndex(node => node.start === at);
      const selected = start >= 0 ? siblings.slice(start, start + old.nodes.length) : [];
      if (selected.length === old.nodes.length && selected.at(-1)!.end === at + expected.length && selected.every(isProseTree)) return true;
      return siblings.some(node => node.type === 'element' && isRegion(node.children));
    };
    if (!isRegion(parsed.nodes)) return source;
    return source.slice(0, at) + serializeJsx(next.nodes) + source.slice(at + expected.length);
  }
  const parts = bodyPathToSourcePath(source, path).split('.');
  const start = Number(parts.pop());
  const parent = parts.length ? resolveJsxNodeAtPath(parsed.nodes, parts.join('.')) : null;
  const siblings = parts.length ? (parent?.type === 'element' ? parent.children : []) : parsed.nodes;
  const selected = siblings.slice(start, start + old.nodes.length);
  const before = serializeJsx(old.nodes);
  if (selected.length && serializeJsx(selected) === before && selected.every(isProseTree)) {
    return source.slice(0, selected[0].start) + serializeJsx(next.nodes) + source.slice(selected.at(-1)!.end);
  }
  // A runtime emits its whole prose region. Rebase only its actual local changes onto the latest
  // region, using the same atomic conflict kernel as persistence and undo. Root identities must
  // still resolve uniquely; a deleted/replaced/ambiguous region is a recoverable conflict.
  const id = (node: JsxNode) => {
    if (node.type !== 'element') return undefined;
    const value = node.attributes.find(attribute => attribute.name === 'id')?.value;
    return value?.static && typeof value.json === 'string' ? value.json : undefined;
  };
  const ids = old.nodes.map(id);
  if (ids.some(value => !value) || new Set(ids).size !== ids.length) return source;
  const candidates: JsxNode[][] = [];
  const locate = (siblings: JsxNode[]) => {
    for (let index = 0; index < siblings.length; index++) {
      const region = siblings.slice(index, index + ids.length);
      if (region.length === ids.length && region.every((node, i) => id(node) === ids[i]) && region.every(isProseTree)) candidates.push(region);
      const node = siblings[index];
      if (node.type === 'element') locate(node.children);
    }
  };
  locate(parsed.nodes);
  if (candidates.length !== 1) return source;
  const region = candidates[0], head = serializeJsx(region);
  const intervening = sourceChanges(before, head).reverse().map((change, seq) => ({ ...change, seq, editId: `region-remote-${seq}` }));
  const merged = rebaseEditBatch(head, sourceChanges(before, serializeJsx(next.nodes)), intervening);
  if (!merged.ok) return source;
  const checked = parseJsx(merged.source);
  if (!checked.ok || !checked.nodes.every(isProseTree) || validateJsx(checked.nodes, { components: [] }).length) return source;
  return source.slice(0, region[0].start) + serializeJsx(checked.nodes) + source.slice(region.at(-1)!.end);
}
