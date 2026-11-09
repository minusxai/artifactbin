/**
 * Server-side readers of region content: HTML through parse5 (the parser lib/html-page publishes with) and
 * Markdown through prosemirror-markdown's CommonMark parser (raw HTML off), both into html.ts's element tree.
 */
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { defaultMarkdownParser } from 'prosemirror-markdown';
import type { Mark, Node as PMNode } from 'prosemirror-model';
import type { SourceElement, SourceNode } from './html';
import type { RegionKind } from './schema';

type Parse5Node = DefaultTreeAdapterMap['childNode'];

function fromParse5(nodes: readonly Parse5Node[]): SourceNode[] {
  const out: SourceNode[] = [];
  for (const node of nodes) {
    if (node.nodeName === '#text') { out.push({ text: (node as DefaultTreeAdapterMap['textNode']).value }); continue; }
    if (!('tagName' in node)) continue;
    const attrs = node.attrs;
    out.push({ tag: node.tagName.toLowerCase(), attr: (name) => attrs.find((attr) => attr.name === name)?.value ?? null, children: node.tagName === 'template' ? [] : fromParse5(node.childNodes) });
  }
  return out;
}

/** Region inner HTML as parsed content. */
export const htmlSource = (html: string): SourceNode[] => fromParse5(parseFragment(html).childNodes);

const MARKDOWN_BLOCKS: Record<string, string> = { paragraph: 'p', blockquote: 'blockquote', bullet_list: 'ul', ordered_list: 'ol', list_item: 'li', horizontal_rule: 'hr', hard_break: 'br', image: 'img' };
const MARKDOWN_MARKS: Record<string, string> = { strong: 'strong', em: 'em', code: 'code', link: 'a' };
const element = (tag: string, children: SourceNode[], attrs: Record<string, string> = {}): SourceElement => ({ tag, attr: (name) => attrs[name] ?? null, children });

function fromMarkdownNode(node: PMNode): SourceNode {
  if (node.isText) {
    return [...node.marks].reverse().reduce<SourceNode>((inner, mark: Mark) =>
      element(MARKDOWN_MARKS[mark.type.name] ?? mark.type.name, [inner], mark.type.name === 'link' ? { href: String(mark.attrs.href ?? '') } : {}), { text: node.text ?? '' });
  }
  let checked: boolean | null = null;
  if (node.type.name === "list_item") {
    const first = node.firstChild;
    const marker = first?.type.name === "paragraph" ? /^\[([ xX])\]\s/.exec(first.textContent) : null;
    if (marker && first?.firstChild?.isText && first.firstChild.text!.startsWith(marker[0])) {
      checked = marker[1]!.toLowerCase() === "x";
      node = node.copy(node.content.replaceChild(0, first.copy(first.content.cut(marker[0].length))));
    }
  }
  const children: SourceNode[] = [];
  node.forEach((child) => { children.push(fromMarkdownNode(child)); });
  if (node.type.name === 'heading') return element(`h${node.attrs.level}`, children);
  if (node.type.name === 'code_block') return element('pre', [element('code', children)]);
  return element(MARKDOWN_BLOCKS[node.type.name] ?? node.type.name, children, checked === null ? {} : { role: "checkbox", "aria-checked": String(checked), "aria-disabled": "true" });
}

/**
 * An agent's Markdown (CommonMark, raw HTML read as text) as parsed content. A text region is one line of plain
 * text, so its Markdown is one paragraph, read as that paragraph's content (anything more is refused by name).
 */
export function markdownSource(markdown: string, kind: RegionKind = 'rich'): SourceNode[] {
  const doc = defaultMarkdownParser.parse(markdown);
  const out: SourceNode[] = [];
  doc.forEach((child) => { out.push(fromMarkdownNode(child)); });
  const only = out[0];
  if (kind === 'text' && out.length === 1 && only && 'tag' in only && only.tag === 'p') return only.children;
  return out;
}
