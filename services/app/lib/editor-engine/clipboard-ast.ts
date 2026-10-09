/** Independent insertion gate: converter output is untrusted until its dialect shape is checked. */
import type { Root } from 'mdast';
import { normalizeLinkHref } from '@/lib/data/story/link-edit';
const blocks = new Set(['paragraph', 'heading', 'blockquote', 'list', 'table', 'code', 'thematicBreak']);
const inline = new Set(['text', 'strong', 'emphasis', 'delete', 'inlineCode', 'link', 'break']);
export function validateClipboardAst(root: Root): void {
  let count = 0;
  const visit = (value: unknown, allowed: ReadonlySet<string>, depth: number) => {
    if (++count > 50000 || depth > 64) throw Error('Paste is too complex. Paste a smaller section.');
    if (!value || typeof value !== 'object') throw Error('Invalid paste fragment.');
    const node = value as Record<string, unknown>,
      type = node.type;
    if (typeof type !== 'string' || !allowed.has(type)) throw Error('Unsupported paste structure.');
    const keys = ['type'];
    let children: ReadonlySet<string> | null = null;
    switch (type) {
      case 'root':
      case 'blockquote':
      case 'listItem':
        children = blocks;
        break;
      case 'paragraph':
      case 'strong':
      case 'emphasis':
      case 'delete':
      case 'tableCell':
        children = inline;
        break;
      case 'heading':
        if (!Number.isInteger(node.depth) || Number(node.depth) < 1 || Number(node.depth) > 6)
          throw Error('Invalid heading.');
        keys.push('depth');
        children = inline;
        break;
      case 'list':
        if (typeof node.ordered !== 'boolean') throw Error('Invalid list.');
        keys.push('ordered');
        children = new Set(['listItem']);
        break;
      case 'table':
        children = new Set(['tableRow']);
        break;
      case 'tableRow':
        children = new Set(['tableCell']);
        break;
      case 'link':
        if (typeof node.url !== 'string' || normalizeLinkHref(node.url) !== node.url)
          throw Error('Unsafe pasted link.');
        keys.push('url');
        children = inline;
        break;
      case 'text':
      case 'inlineCode':
      case 'code':
        if (typeof node.value !== 'string') throw Error('Invalid pasted text.');
        keys.push('value');
        break;
    }
    if (children) {
      keys.push('children');
      if (!Array.isArray(node.children)) throw Error('Invalid paste children.');
      for (const child of node.children) visit(child, children, depth + 1);
    }
    if (Object.keys(node).some((key) => !keys.includes(key))) throw Error('Paste contains unsupported properties.');
  };
  visit(root, new Set(['root']), 0);
}
