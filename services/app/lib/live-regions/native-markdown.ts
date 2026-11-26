/**
 * MARKDOWN INTO A DOCUMENT (native-v1): lib/markdown's one parser (its display entry: no ProseMirror, no Tiptap),
 * fitted to the native schema. The editor's plain-text paste (the `@afbin/native-markdown` chunk) and agents' Markdown
 * writes (state.ts applyRegionRevision) both read Markdown here; native-markdown-save.ts writes it back.
 *
 * The shared rules apply as everywhere (lib/markdown/display.ts): a single newline is a line break, bare addresses
 * link only with a scheme or `www.`, raw HTML is text. The fit, for what the document schema cannot hold:
 * - an image (the shared rule's sources: https, relative or an upload `ref:<id>`; any other stays the text it was typed
 *   as) is kept with its alt and title, but no mark: a document's image carries none (native-schema.ts), so one inside
 *   a link or bold is kept alone;
 * - a mark the schema lacks (strikethrough) is dropped and its text kept;
 * - inline code keeps its text and only the code mark (documents' code mark excludes every other);
 * - a link the document refuses (live-regions/href.ts safeHref, which has no `tel:`) is dropped and its text kept,
 *   and a link or image title is cut to 512 characters, as a pasted one is;
 * - a table becomes one paragraph per row, its cells joined with ` | ` (tables stay out of documents);
 * - a code block's language is kept only in the form the document stores (`[-\w+]{1,64}`);
 * - a list item opens with a paragraph or heading, as the schema requires (an empty one is added before anything
 *   else, which is what the previous parser did too);
 * - `tight` list spacing, which documents do not store, is dropped.
 * Task lists split from bullet groups and nested lists keep their structure, as the shared parse reads them.
 */
import type { JSONContent } from '@tiptap/core';
import type { MarkdownMark, MarkdownNode } from '../markdown/display';
import { parse } from '../markdown/parse';
import { safeHref } from './href';

const TITLE_MAX = 512;
const title = (value: unknown) => (typeof value === 'string' ? value.slice(0, TITLE_MAX) : null);
const LANGUAGE = /^[-\w+]{1,64}$/;
const OPENS_ITEM = new Set(['paragraph', 'heading']);

type NativeMark = NonNullable<JSONContent['marks']>[number];
function fitMarks(marks: readonly MarkdownMark[] = []): NativeMark[] {
  if (marks.some(mark => mark.type === 'code')) return [{ type: 'code' }];
  return marks.flatMap((mark): NativeMark[] => {
    if (mark.type === 'bold' || mark.type === 'italic') return [{ type: mark.type }];
    if (mark.type !== 'link') return [];
    const href = mark.attrs?.href ?? '';
    if (safeHref(href) !== href) return [];
    return [{ type: 'link', attrs: { href, title: title(mark.attrs?.title) } }];
  });
}

/** Inline content: text with its fitted marks (neighbours whose marks now match joined), hard breaks and images. */
function fitInline(nodes: readonly MarkdownNode[] = []): JSONContent[] {
  const out: JSONContent[] = [];
  for (const node of nodes) {
    if (node.type === 'hardBreak') { out.push({ type: 'hardBreak' }); continue; }
    if (node.type === 'image') { out.push({ type: 'image', attrs: { src: String(node.attrs?.src ?? ''), alt: String(node.attrs?.alt ?? ''), title: title(node.attrs?.title) } }); continue; }
    if (node.type !== 'text' || !node.text) continue;
    const marks = fitMarks(node.marks), last = out.at(-1);
    if (last?.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(marks)) last.text += node.text;
    else out.push({ type: 'text', text: node.text, ...(marks.length ? { marks } : {}) });
  }
  return out;
}

const textblock = (type: string, content: JSONContent[], attrs?: Record<string, unknown>): JSONContent =>
  ({ type, ...(attrs ? { attrs } : {}), ...(content.length ? { content } : {}) });

function fitBlock(node: MarkdownNode): JSONContent[] {
  const children = node.content ?? [];
  switch (node.type) {
    case 'paragraph': return [textblock('paragraph', fitInline(children))];
    case 'heading': return [textblock('heading', fitInline(children), { level: node.attrs?.level })];
    case 'blockquote': return [{ type: 'blockquote', content: fitBlocks(children) }];
    case 'bulletList': case 'taskList': return [{ type: node.type, content: children.flatMap(fitBlock) }];
    case 'orderedList': return [{ type: 'orderedList', attrs: { start: node.attrs?.start ?? 1 }, content: children.flatMap(fitBlock) }];
    case 'listItem': case 'taskItem': {
      const content = fitBlocks(children);
      if (!OPENS_ITEM.has(content[0]?.type ?? '')) content.unshift({ type: 'paragraph' });
      return [{ type: node.type, ...(node.type === 'taskItem' ? { attrs: { checked: node.attrs?.checked === true } } : {}), content }];
    }
    case 'codeBlock': {
      const language = node.attrs?.language;
      return [textblock('codeBlock', children.flatMap(child => (child.text ? [{ type: 'text', text: child.text }] : [])), { language: typeof language === 'string' && LANGUAGE.test(language) ? language : null })];
    }
    case 'horizontalRule': return [{ type: 'horizontalRule' }];
    case 'table': return children.map(row => textblock('paragraph', fitInline((row.content ?? []).flatMap((cell, i) => [...(i ? [{ type: 'text', text: ' | ' }] : []), ...(cell.content ?? [])]))));
    default: return [];
  }
}
const fitBlocks = (nodes: readonly MarkdownNode[]): JSONContent[] => {
  const out = nodes.flatMap(fitBlock);
  return out.length ? out : [{ type: 'paragraph' }];
};

/** Markdown as a native-v1 document's JSON (`{type: 'doc', content}`), for `nativeSchema.nodeFromJSON`. */
export function nativeMarkdownJson(source: string): JSONContent {
  return { type: 'doc', content: fitBlocks(parse(source, { images: true }).content) };
}
