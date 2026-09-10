/** Clipboard trust boundary. Both syntaxes converge at mdast, never Markdown text. */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import type { Root as HastRoot, Element as HastElement, RootContent as HastChild } from 'hast';
import type { Root, RootContent } from 'mdast';
import { normalizeLinkHref } from '@/lib/data/story/link-edit';

export type ClipboardKind = 'html' | 'markdown' | 'text';
const markdown = unified().use(remarkParse).use(remarkGfm);
const html = unified().use(rehypeParse, { fragment: true });
const converter = unified().use(rehypeRemark);
const discarded = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'template',
  'input',
  'button',
  'textarea',
  'select',
]);
const elements = new Set([
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'b',
  'em',
  'i',
  'del',
  's',
  'a',
  'img',
  'pre',
  'code',
  'blockquote',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
]);

function cleanHtml(tree: HastRoot | HastElement): void {
  tree.children = tree.children.flatMap((child): HastChild[] => {
    if (child.type === 'text') return [child];
    if (child.type !== 'element' || discarded.has(child.tagName)) return [];
    cleanHtml(child);
    if (!elements.has(child.tagName)) return child.children;
    const p = child.properties;
    child.properties = {};
    // These are dialect semantics, not transferred source attributes.
    if (child.tagName === 'a' && typeof p.href === 'string') {
      const url = normalizeLinkHref(p.href);
      if (url) child.properties.href = url;
    }
    if (child.tagName === 'img' && typeof p.src === 'string' && /^https?:\/\//i.test(p.src)) {
      child.properties.src = p.src;
      if (typeof p.alt === 'string') child.properties.alt = p.alt;
    }
    return [child];
  }) as typeof tree.children;
}

/** Reconstruct allowed fields, rather than deleting a growing denylist of metadata. */
function dialect(node: unknown, definitions: Map<string, string>): RootContent[] {
  if (!node || typeof node !== 'object') return [];
  const n = node as {
    type: string;
    value?: string;
    children?: unknown[];
    depth?: number;
    ordered?: boolean;
    url?: string;
    identifier?: string;
  };
  const children = (n.children ?? []).flatMap((child) => dialect(child, definitions));
  switch (n.type) {
    case 'text':
      return n.value ? [{ type: 'text', value: n.value }] : [];
    // Remote images are not loaded by a text paste. Keep their alternative text;
    // image files use the existing managed upload insertion boundary.
    case 'imageReference':
    case 'image':
      return typeof (n as { alt?: unknown }).alt === 'string'
        ? [{ type: 'text', value: (n as unknown as { alt: string }).alt }]
        : [];
    case 'inlineCode':
      return [{ type: 'inlineCode', value: n.value ?? '' }];
    case 'code':
      return [{ type: 'code', value: n.value ?? '' }];
    case 'break':
      return [{ type: 'break' }];
    case 'thematicBreak':
      return [{ type: 'thematicBreak' }];
    case 'heading':
      return [
        {
          type: 'heading',
          depth: Math.min(6, Math.max(1, n.depth ?? 1)),
          children,
        } as RootContent,
      ];
    case 'paragraph':
    case 'strong':
    case 'emphasis':
    case 'delete':
    case 'blockquote':
    case 'listItem':
    case 'tableRow':
    case 'tableCell':
      return [{ type: n.type, children } as RootContent];
    case 'list':
      return [{ type: 'list', ordered: !!n.ordered, children } as RootContent];
    case 'table':
      return [{ type: 'table', children } as RootContent];
    case 'linkReference':
    case 'link': {
      const target = n.type === 'linkReference' ? definitions.get(n.identifier ?? '') : n.url;
      const url = typeof target === 'string' ? normalizeLinkHref(target) : null;
      return url ? [{ type: 'link', url, children } as RootContent] : children;
    }
    default:
      return [];
  }
}

export function clipboardAst(kind: ClipboardKind, value: string): Root {
  if (value.length > 1_000_000) throw new Error('Paste is too large (maximum 1,000,000 characters).');
  if (kind === 'text')
    return {
      type: 'root',
      children: value.split(/\r?\n/).map((line) => ({
        type: 'paragraph',
        children: line ? [{ type: 'text', value: line }] : [],
      })),
    };
  let tree: Root;
  if (kind === 'html') {
    const parsed = html.parse(value) as HastRoot;
    cleanHtml(parsed);
    tree = converter.runSync(parsed) as unknown as Root;
  } else tree = markdown.parse(value) as Root;
  const definitions = new Map<string, string>();
  const collect = (n: unknown) => {
    const node = n as { type: string; identifier?: string; url?: string; children?: unknown[] };
    if (node.type === 'definition' && node.identifier && node.url && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
    node.children?.forEach(collect);
  };
  collect(tree);
  return { type: 'root', children: tree.children.flatMap((child) => dialect(child, definitions)) };
}
