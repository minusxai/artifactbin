/**
 * A region as Markdown, for agents: what they read, edit and send back (applyRegionRevision reads it with
 * source-html.ts markdownSource). The flat blocks (schema.ts) are rebuilt into prosemirror-markdown's nested tree,
 * quotes outermost and lists inside them as html.ts writes them, and written by its CommonMark serializer, so the
 * parser it is read back with sees exactly what was written: reading a region's Markdown back changes nothing.
 *
 * Markdown has no empty paragraph: an empty block is not written, and Markdown sent back without it removes it.
 * Server-side only (it reads the saved HTML through parse5).
 */
import { defaultMarkdownSerializer, schema as markdown } from 'prosemirror-markdown';
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { readRegion } from './html';
import { MAX_DEPTH, type RegionKind } from './schema';
import { htmlSource } from './source-html';

const listOf = (block: PMNode): 'bullet' | 'ordered' | null => (block.type.name !== 'rule' && (block.attrs.list === 'bullet' || block.attrs.list === 'ordered') ? block.attrs.list : null);
const depthOf = (block: PMNode): number => (listOf(block) ? Math.min(MAX_DEPTH, Math.max(1, Number(block.attrs.depth) || 1)) : 0);

function marksOf(marks: readonly Mark[]): Mark[] {
  return marks.map((mark) => (mark.type.name === 'link' ? markdown.marks.link!.create({ href: mark.attrs.href }) : markdown.marks[mark.type.name]!.create()));
}

/** One flat block as a Markdown leaf (its list and quote structure is the caller's). */
function leaf(block: PMNode): PMNode {
  if (block.type.name === 'rule') return markdown.nodes.horizontal_rule!.create();
  if (block.type.name === 'code_block') return markdown.nodes.code_block!.create(null, block.textContent ? markdown.text(block.textContent) : null);
  const inline: PMNode[] = [];
  block.forEach((child) => { if (child.isText && child.text) inline.push(markdown.text(child.text, marksOf(child.marks))); });
  const level = Number(block.attrs.level) || 0;
  return level ? markdown.nodes.heading!.create({ level }, inline) : markdown.nodes.paragraph!.create(null, inline);
}

/** The list starting at `blocks[start]`, at `depth`, with everything nested under its items; and where it ends. */
function list(blocks: readonly PMNode[], start: number, depth: number): [PMNode, number] {
  const type = listOf(blocks[start]!)!;
  const items: PMNode[] = [];
  let at = start;
  while (at < blocks.length && depthOf(blocks[at]!) >= depth) {
    const block = blocks[at]!;
    const content: PMNode[] = [];
    if (depthOf(block) === depth) {
      if (items.length && listOf(block) !== type) break;
      content.push(leaf(block));
      at++;
    }
    while (at < blocks.length && depthOf(blocks[at]!) > depth) {
      const [nested, next] = list(blocks, at, depth + 1);
      content.push(nested);
      at = next;
    }
    items.push(markdown.nodes.list_item!.create(null, content));
  }
  const node = type === 'ordered' ? markdown.nodes.ordered_list!.create({ order: 1, tight: true }, items) : markdown.nodes.bullet_list!.create({ tight: true }, items);
  return [node, at];
}

/** Blocks of one quote state as Markdown blocks, consecutive list blocks gathered into lists. */
function structured(blocks: readonly PMNode[]): PMNode[] {
  const out: PMNode[] = [];
  for (let at = 0; at < blocks.length;) {
    const block = blocks[at]!;
    if (!listOf(block)) {
      if (!(block.type.name === 'textblock' && !block.content.size)) out.push(leaf(block));
      at++;
      continue;
    }
    const [node, next] = list(blocks, at, 1);
    out.push(node);
    at = next;
  }
  return out;
}

/** The region's saved HTML (its normal form, as stored in the page) as Markdown. */
export function regionMarkdown(kind: RegionKind, html: string): string {
  const doc = readRegion(kind, htmlSource(html), 'strip');
  if (kind === 'text') return defaultMarkdownSerializer.serialize(markdown.nodes.doc!.create(null, markdown.nodes.paragraph!.create(null, doc.textContent ? markdown.text(doc.textContent) : null)));
  const blocks: PMNode[] = [];
  doc.forEach((block) => { blocks.push(block); });
  const out: PMNode[] = [];
  for (let at = 0; at < blocks.length;) {
    const quoted = blocks[at]!.attrs.quote === true;
    let end = at;
    while (end < blocks.length && (blocks[end]!.attrs.quote === true) === quoted) end++;
    const inner = structured(blocks.slice(at, end));
    if (quoted && inner.length) out.push(markdown.nodes.blockquote!.create(null, inner));
    else out.push(...inner);
    at = end;
  }
  return out.length ? defaultMarkdownSerializer.serialize(markdown.nodes.doc!.create(null, out)) : '';
}
