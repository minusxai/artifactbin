/** Runtime transactions address a checked sibling region, never arbitrary DOM HTML. */
import { parseJsx, serializeJsx } from '@/lib/jsx';
import { validateJsx } from '@/lib/jsx/validate';
import { bodyPathToSourcePath } from '@/lib/story/document/edit-compose';
import { resolveJsxNodeAtPath } from '@/lib/story-ui/host-classify';
import { isProseTree } from './model';

export function replaceProseRegion(source: string, path: string, expected: string, replacement: string): string {
  // The region as the editor last wrote it is, verbatim and once, in the source (its blocks carry their unique
  // ids): replace it there without parsing the whole document — a report's worth of tables is not the edit.
  const at = expected && /\bid=["{]/.test(expected) ? source.indexOf(expected) : -1;
  if (at >= 0 && source.indexOf(expected, at + 1) < 0) {
    const next = parseJsx(replacement);
    if (!next.ok || !next.nodes.every(isProseTree) || validateJsx(next.nodes, { components: [] }).length) return source;
    return source.slice(0, at) + serializeJsx(next.nodes) + source.slice(at + expected.length);
  }
  const parsed = parseJsx(source),
    old = parseJsx(expected),
    next = parseJsx(replacement);
  if (!parsed.ok || !old.ok || !next.ok || !old.nodes.length || !next.nodes.every(isProseTree)) return source;
  if (validateJsx(next.nodes, { components: [] }).length) return source;
  const parts = bodyPathToSourcePath(source, path).split('.');
  const start = Number(parts.pop());
  const parent = parts.length ? resolveJsxNodeAtPath(parsed.nodes, parts.join('.')) : null;
  const siblings = parts.length ? (parent?.type === 'element' ? parent.children : []) : parsed.nodes;
  const selected = siblings.slice(start, start + old.nodes.length);
  if (!selected.length || serializeJsx(selected) !== serializeJsx(old.nodes)) return source;
  if (!selected.every(isProseTree)) return source;
  return source.slice(0, selected[0].start) + serializeJsx(next.nodes) + source.slice(selected.at(-1)!.end);
}
