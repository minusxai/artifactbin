/**
 * A DOCUMENT AS MARKDOWN (native-v1 → Markdown), what an agent reads: the native document converted to lib/markdown's
 * document and written by its one serializer (the editor entry's `serialize`), so the shared parse that reads it back
 * (native-markdown.ts) sees exactly what was written. Server-side only: it loads Tiptap's schema and
 * prosemirror-markdown, which the paste chunk must not carry.
 *
 * - Identities, a link's target, rel and class, and other attributes Markdown cannot spell are not written.
 * - A legacy checkbox item (role="checkbox") cannot be written in Markdown and refuses, as before.
 * - An image is written as `![alt](src "title")`, which native-markdown.ts reads back as the same image; a source the
 *   parse respells (a raw space or non-ASCII character, percent-encoded) keeps the document's spelling (keepImageSpelling).
 * - A line break inside a heading, which Markdown cannot hold, is written as a space.
 * - Documents store no list spacing: every list is written tight unless its content needs it loose.
 */
import type { Node as PMNode, Schema } from 'prosemirror-model';
import type { MarkdownMark, MarkdownNode, MarkName } from '../markdown/display';
import { markdownSchema, serialize } from '../markdown/save';
import type { JSONContent } from '@tiptap/core';
import { nativeMarkdownJson } from './native-markdown';
import { LiveRegionRefusal } from './refusal';

const ATTRIBUTES: Record<string, readonly string[]> = { heading: ['level'], orderedList: ['start'], codeBlock: ['language'], taskItem: ['checked'], image: ['src', 'alt', 'title'] };

function markdownNode(node: PMNode, inHeading = false): MarkdownNode {
  if (node.isText) {
    const marks = node.marks.map((mark): MarkdownMark => mark.type.name === 'link'
      ? { type: 'link', attrs: { href: String(mark.attrs.href), title: mark.attrs.title ?? null } }
      : { type: mark.type.name as MarkName });
    return { type: 'text', text: node.text!, ...(marks.length ? { marks } : {}) };
  }
  if (inHeading && node.type.name === 'hardBreak') return { type: 'text', text: ' ' };
  const names = ATTRIBUTES[node.type.name];
  const content: MarkdownNode[] = [];
  node.forEach(child => { content.push(markdownNode(child, node.type.name === 'heading')); });
  return {
    type: node.type.name,
    ...(names ? { attrs: Object.fromEntries(names.map(name => [name, node.attrs[name]])) } : {}),
    ...(content.length ? { content } : {}),
  };
}

let schema: Schema | undefined;
export function writeNativeMarkdown(doc: PMNode): string {
  // CommonMark cannot express attribute presence or disabled ARIA semantics.
  // HTML reads/revisions and native editor saves remain fully lossless.
  doc.descendants(node => { if (node.type.name === 'listItem' && node.attrs.legacyChecked !== null) throw new LiveRegionRefusal('unsupported_content', ['legacy checkbox requires HTML']); });
  schema ??= markdownSchema({ images: true });
  return serialize(schema.nodeFromJSON(markdownNode(doc)));
}

/**
 * Markdown read back from `base` (nativeMarkdownJson's output), with each image source the shared parse respelled given
 * back the spelling `base` stores: sending back what was read must change nothing, and the parse percent-encodes what
 * a browser would (`a b.png` reads as `a%20b.png`).
 */
export function keepImageSpelling(json: JSONContent, base: PMNode): JSONContent {
  const spelled = new Map<string, string>();
  base.descendants(node => {
    if (node.type.name !== 'image') return;
    const src = String(node.attrs.src);
    const read = nativeMarkdownJson(writeNativeMarkdown(base.type.create(null, base.type.schema.nodes.paragraph!.create(null, node)))).content?.[0]?.content?.[0]?.attrs?.src;
    if (typeof read === 'string' && read !== src) spelled.set(read, src);
  });
  if (!spelled.size) return json;
  const respell = (node: JSONContent): JSONContent => node.type === 'image' && spelled.has(String(node.attrs?.src))
    ? { ...node, attrs: { ...node.attrs, src: spelled.get(String(node.attrs!.src)) } }
    : node.content ? { ...node, content: node.content.map(respell) } : node;
  return respell(json);
}
