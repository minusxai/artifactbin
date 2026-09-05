import type { JsxNode } from '@/lib/jsx';
import type { StoryInterpreterOptions } from '@/lib/story-ui/interpreter';
import { cloneElement } from 'react';
import type { ReactElement } from 'react';

const TOKEN_IDREF_PROPS = new Set([
  'aria-activedescendant', 'aria-controls', 'aria-describedby', 'aria-details',
  'aria-errormessage', 'aria-flowto', 'aria-labelledby', 'aria-owns',
  'headers', 'htmlFor',
]);
const FRAGMENT_PROPS = new Set(['href', 'xlinkHref']);
const SVG_URL_PROPS = new Set([
  'fill', 'stroke', 'clipPath', 'mask', 'filter',
  'markerStart', 'markerMid', 'markerEnd',
]);

function idsIn(nodes: JsxNode[]): Set<string> {
  const ids = new Set<string>();
  const visit = (node: JsxNode): void => {
    if (node.type !== 'element') return;
    const attr = node.attributes.find((candidate) => candidate.name.toLowerCase() === 'id');
    if (attr?.value.static && typeof attr.value.json === 'string') ids.add(attr.value.json);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return ids;
}

/** A CSS-fragment-safe, injective spelling for an arbitrary React useId/key. */
function encoded(value: string): string {
  return [...value].map((char) => char.codePointAt(0)!.toString(16).padStart(6, '0')).join('');
}

function rewriteTokens(value: string, mapping: ReadonlyMap<string, string>): string {
  return value.replace(/\S+/g, (token) => mapping.get(token) ?? token);
}

function rewriteSvgUrls(value: string, mapping: ReadonlyMap<string, string>): string {
  return value.replace(/url\(\s*(["']?)#([^\s"')]+)\1\s*\)/g, (whole, quote: string, id: string) => {
    const replacement = mapping.get(id);
    return replacement ? `url(${quote}#${replacement}${quote})` : whole;
  });
}

/** One allocator per rail instance. All document IDs exclude collisions; each
 * local tree gets its own stable namespace. Only local references are rewritten.
 * No mutation of the input AST, source IDs, or React keys is permitted. */
export function createPreviewIdentityAllocator(documentNodes: JsxNode[], instanceKey: string):
  (localNodes: JsxNode[], previewKey: string) => NonNullable<StoryInterpreterOptions['decorateElement']> {
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

    const decorate: NonNullable<StoryInterpreterOptions['decorateElement']> = (element) => {
      const props = element.props as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      if (typeof props.id === 'string' && mapping!.has(props.id)) patch.id = mapping!.get(props.id);
      for (const [name, value] of Object.entries(props)) {
        if (typeof value !== 'string') continue;
        if (TOKEN_IDREF_PROPS.has(name)) patch[name] = rewriteTokens(value, mapping!);
        else if (FRAGMENT_PROPS.has(name) && value.startsWith('#')) {
          const replacement = mapping!.get(value.slice(1));
          if (replacement) patch[name] = `#${replacement}`;
        } else if (SVG_URL_PROPS.has(name)) {
          const rewritten = rewriteSvgUrls(value, mapping!);
          if (rewritten !== value) patch[name] = rewritten;
        }
      }
      return Object.keys(patch).length ? cloneElement(element as ReactElement<Record<string, unknown>>, patch) : element;
    };
    return decorate;
  };
}
