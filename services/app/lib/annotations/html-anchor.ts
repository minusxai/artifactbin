/** Native HTML identities and selected words, independent of compiler coordinates. */
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { htmlTextFingerprint, type HtmlNodeAnchor } from '@artifactbin/contracts';

type HtmlNode = DefaultTreeAdapterMap['node'];
export interface HtmlCommentNode { nodeId: string; text: string }
export interface HtmlAnchorResolution { node: HtmlCommentNode | null; quoteFound: boolean | null }
const canonical = (text: string) => text.replace(/\s+/g, ' ').trim();
/** Mirrors the browser textContent ordering without running source or scripts. */
export function htmlCommentNodes(html: string): Map<string, HtmlCommentNode> {
  const nodes = new Map<string, HtmlCommentNode>();
  const duplicates = new Set<string>();
  const stack: HtmlNode[] = [parse(html)];
  const textOf = (root: HtmlNode): string => {
    const pending: HtmlNode[] = [root];
    const parts: string[] = [];
    while (pending.length) {
      const node = pending.pop()!;
      if ('value' in node) parts.push(node.value);
      else if ('childNodes' in node) for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]!);
    }
    return parts.join('');
  };
  while (stack.length) {
    const node = stack.pop()!;
    if ('tagName' in node) {
      const id = node.attrs.find(attr => attr.name === 'data-af-id')?.value;
      if (id && !duplicates.has(id)) {
        if (nodes.has(id)) { nodes.delete(id); duplicates.add(id); }
        else {
          let text: string | undefined;
          nodes.set(id, { nodeId: id, get text() { return text ??= textOf(node); } });
        }
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) stack.push(child);
  }
  return nodes;
}
/** A missing identity never falls back to the same words elsewhere. */
export function resolveHtmlCommentAnchor(nodes: ReadonlyMap<string, HtmlCommentNode>, anchor: HtmlNodeAnchor): HtmlAnchorResolution {
  const node = anchor.nodeId ? nodes.get(anchor.nodeId) ?? null : null;
  return { node, quoteFound: anchor.quote ? !!node && validHtmlCommentRange(node, anchor) && canonical(node.text).includes(canonical(anchor.quote)) : null };
}

/** A newly captured range must describe the selected node's exact text. */
export function validHtmlCommentRange(node: HtmlCommentNode, anchor: HtmlNodeAnchor): boolean {
  const range = anchor.range;
  return !range || range.length === node.text.length && range.fingerprint === htmlTextFingerprint(node.text) && canonical(node.text.slice(range.start, range.end)) === canonical(anchor.quote);
}
