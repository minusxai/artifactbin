/**
 * The one reader and the one writer of a region's HTML. The reader walks an abstract element tree, so the server's
 * parse5 parse (source-html.ts), a browser paste (editor.ts) and an agent's Markdown (markdown.ts) pass through the
 * same rules; the writer is the region's normal form, so `read(write(doc))` writes back byte-identically.
 *
 * Two modes. `refuse` reads authored content (a region as declared, an author's republish, an agent's Markdown):
 * anything outside the kind's content is collected and refused once, by name. `strip` reads what arrives while
 * editing (a paste, the merged state): only schema content survives, script-like elements vanish with their content,
 * wrappers give up their content, attributes outside the schema are dropped. Whitespace collapses as HTML renders it,
 * unless the caller preserves it (a plain-text paste); the writer collapses it either way.
 */
import { escapeText } from '@artifactbin/utils/escape';
import type { Mark, Node as PMNode, Schema } from 'prosemirror-model';
import { LiveRegionRefusal } from './refusal';
import { isNodeId, MAX_DEPTH, regionSchema, safeHref, type ListType, type RegionKind } from './schema';

/** A parsed HTML node, from whichever parser read it. Comments never appear. */
export type SourceNode = { text: string } | SourceElement;
export interface SourceElement { tag: string; attr(name: string): string | null; children: SourceNode[] }
export type ReadMode = 'refuse' | 'strip';

const isText = (node: SourceNode): node is { text: string } => 'text' in node;
/** Dropped with everything inside them, in both modes. */
const OPAQUE = new Set(['script', 'style', 'svg', 'math', 'button', 'input', 'select', 'textarea', 'option', 'optgroup', 'datalist', 'iframe', 'object', 'embed', 'img', 'picture', 'video', 'audio', 'source', 'track', 'canvas', 'template', 'noscript', 'head', 'title', 'meta', 'link', 'base', 'map', 'area', 'frame', 'frameset', 'dialog', 'slot', 'output', 'progress', 'meter']);
const HEADINGS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };
const BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'ul', 'ol', 'li', 'blockquote', 'hr']);
/** Layout wrappers: refused when authored, unwrapped when pasted. */
const WRAPPERS = new Set(['div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'nav', 'figure', 'figcaption', 'details', 'summary', 'center', 'address', 'hgroup', 'search', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col', 'dl', 'dt', 'dd', 'form', 'fieldset', 'legend', 'body', 'html']);
const isBlockTag = (tag: string) => BLOCKS.has(tag) || WRAPPERS.has(tag);
const holdsBlock = (node: SourceElement): boolean =>
  node.children.some((child) => !isText(child) && !OPAQUE.has(child.tag) && (isBlockTag(child.tag) || holdsBlock(child)));

interface Holder { id: string | null }
interface Context {
  quote: boolean; quoteHolder: Holder | null;
  list: ListType | null; depth: number; listHolder: Holder | null;
  itemHolder: Holder | null; item: { blocks: number } | null;
}
const take = (holder: Holder | null): string | null => { if (!holder) return null; const id = holder.id; holder.id = null; return id; };
const ownId = (element: SourceElement): string | null => { const id = element.attr('data-af-id'); return isNodeId(id) ? id : null; };

interface Segment { text: string; marks: readonly Mark[] }
/** HTML's own whitespace rule: ASCII whitespace runs collapse to one space; a block's ends are trimmed. NBSP stays. */
function collapse(segments: Segment[], preserve = false): Segment[] {
  if (preserve) return segments.filter((segment) => segment.text);
  const out: Segment[] = [];
  let afterSpace = true;
  for (const segment of segments) {
    let text = segment.text.replace(/[ \t\n\r\f]+/g, ' ');
    if (afterSpace && text.startsWith(' ')) text = text.slice(1);
    if (!text) continue;
    afterSpace = text.endsWith(' ');
    out.push({ text, marks: segment.marks });
  }
  const last = out.at(-1);
  if (last && last.text.endsWith(' ')) { last.text = last.text.slice(0, -1); if (!last.text) out.pop(); }
  return out;
}

class Reader {
  readonly problems = new Set<string>();
  readonly blocks: PMNode[] = [];
  readonly schema: Schema;
  constructor(readonly kind: RegionKind, readonly mode: ReadMode, readonly preserveWhitespace: boolean) { this.schema = regionSchema(kind); }

  /** Notes a refusal; true when strip mode should repair instead. */
  private unsupported(what: string): boolean { if (this.mode === 'refuse') this.problems.add(what); return this.mode === 'strip'; }

  rich(nodes: SourceNode[]): PMNode {
    this.walkBlocks(nodes, { quote: false, quoteHolder: null, list: null, depth: 0, listHolder: null, itemHolder: null, item: null });
    if (!this.blocks.length) this.blocks.push(this.schema.nodes.textblock!.create());
    return this.schema.nodes.doc!.create(null, this.blocks);
  }

  text(nodes: SourceNode[]): PMNode {
    let text = '';
    const walk = (list: SourceNode[]) => {
      for (const node of list) {
        if (isText(node)) { text += node.text; continue; }
        if (OPAQUE.has(node.tag)) { this.unsupported(`<${node.tag}>`); continue; }
        if (node.tag === 'br') { if (this.unsupported('<br>')) text += ' '; continue; }
        if (!this.unsupported(`<${node.tag}>`)) continue;
        walk(node.children);
        // A text region is one line: the lines of a pasted paragraph or list join with a space.
        if (isBlockTag(node.tag)) text += ' ';
      }
    };
    walk(nodes);
    if (this.preserveWhitespace) text = text.replace(/[\r\n]+/g, ' ');
    const [segment] = collapse([{ text, marks: [] }], this.preserveWhitespace);
    const line = this.schema.nodes.textblock!.create(null, segment ? this.schema.text(segment.text) : null);
    return this.schema.nodes.doc!.create(null, line);
  }

  private walkBlocks(nodes: SourceNode[], context: Context): void {
    let run: SourceNode[] = [];
    const flush = () => { if (run.length) this.textblock(run, 0, null, context, true); run = []; };
    for (const node of nodes) {
      if (isText(node)) { run.push(node); continue; }
      if (OPAQUE.has(node.tag)) { this.unsupported(`<${node.tag}>`); continue; }
      if (!isBlockTag(node.tag)) {
        if (!holdsBlock(node)) { run.push(node); continue; }
        if (!this.unsupported(`<${node.tag}> holding blocks`)) continue;
        flush(); this.walkBlocks(node.children, context); continue;
      }
      flush();
      this.block(node, context);
    }
    flush();
  }

  private block(element: SourceElement, context: Context): void {
    const { tag } = element;
    if (tag === 'p' || tag in HEADINGS) {
      if (holdsBlock(element)) { if (this.unsupported(`<${tag}> holding blocks`)) this.walkBlocks(element.children, context); return; }
      this.textblock(element.children, HEADINGS[tag] ?? 0, ownId(element), context, false);
      return;
    }
    if (tag === 'pre') { this.codeBlock(element, context); return; }
    if (tag === 'hr') {
      if (context.depth > 0) { this.unsupported('<hr> in a list'); return; }
      this.blocks.push(this.schema.nodes.rule!.create({ quote: context.quote, afId: ownId(element), quoteId: take(context.quoteHolder) }));
      return;
    }
    if (tag === 'blockquote') {
      if (context.quote || context.depth > 0) {
        if (this.unsupported(context.quote ? 'nested <blockquote>' : '<blockquote> in a list')) this.walkBlocks(element.children, context);
        return;
      }
      this.walkBlocks(element.children, { ...context, quote: true, quoteHolder: { id: ownId(element) } });
      return;
    }
    if (tag === 'ul' || tag === 'ol') { this.list(element, context); return; }
    // <li> outside a list, or a layout wrapper.
    if (this.unsupported(tag === 'li' ? '<li> outside a list' : `<${tag}>`)) this.walkBlocks(element.children, context);
  }

  private list(element: SourceElement, context: Context): void {
    const deeper = context.depth < MAX_DEPTH;
    if (!deeper && !this.unsupported(`lists nested deeper than ${MAX_DEPTH}`)) return;
    const itemContext: Context = { ...context, list: element.tag === 'ul' ? 'bullet' : 'ordered', depth: deeper ? context.depth + 1 : context.depth, listHolder: { id: ownId(element) } };
    for (const child of element.children) {
      if (isText(child)) {
        if (!child.text.trim()) continue;
        if (this.unsupported(`text directly in <${element.tag}>`)) this.item([child], null, itemContext);
        continue;
      }
      if (child.tag === 'li') { this.item(child.children, ownId(child), itemContext); continue; }
      if (OPAQUE.has(child.tag)) { this.unsupported(`<${child.tag}>`); continue; }
      if (this.unsupported(`<${child.tag}> directly in <${element.tag}>`)) this.item([child], null, itemContext);
    }
  }

  private item(children: SourceNode[], id: string | null, context: Context): void {
    const before = this.blocks.length;
    const item = { blocks: 0 };
    this.walkBlocks(children, { ...context, itemHolder: { id }, item });
    if (this.blocks.length === before) this.textblock([], 0, null, { ...context, itemHolder: { id }, item }, false);
  }

  private structure(context: Context) {
    if (context.item && ++context.item.blocks > 1) this.unsupported('several blocks in one <li>');
    return { list: context.list, depth: context.depth, quote: context.quote, itemId: take(context.itemHolder), listId: take(context.listHolder), quoteId: take(context.quoteHolder) };
  }

  private textblock(nodes: SourceNode[], level: number, afId: string | null, context: Context, implicit: boolean): void {
    const raw = this.inline(nodes, []);
    if (implicit && raw.every((segment) => !/[^ \t\n\r\f]/.test(segment.text))) return;
    const segments = collapse(raw, this.preserveWhitespace);
    const content = segments.map((segment) => this.schema.text(segment.text, segment.marks));
    this.blocks.push(this.schema.nodes.textblock!.create({ level, afId, ...this.structure(context) }, content));
  }

  private codeBlock(element: SourceElement, context: Context): void {
    let text = '';
    const walk = (nodes: SourceNode[]) => {
      for (const node of nodes) {
        if (isText(node)) { text += node.text; continue; }
        if (node.tag === 'br') { text += '\n'; continue; }
        if (OPAQUE.has(node.tag)) { this.unsupported(`<${node.tag}>`); continue; }
        if (node.tag === 'code' || this.unsupported(`<${node.tag}> in <pre>`)) walk(node.children);
      }
    };
    walk(element.children);
    text = text.replace(/\r\n?/g, '\n');
    this.blocks.push(this.schema.nodes.code_block!.create({ afId: ownId(element), ...this.structure(context) }, text ? this.schema.text(text) : null));
  }

  private inline(nodes: SourceNode[], marks: readonly Mark[]): Segment[] {
    const out: Segment[] = [];
    const { marks: types } = this.schema;
    for (const node of nodes) {
      if (isText(node)) { out.push({ text: node.text, marks }); continue; }
      const { tag } = node;
      if (OPAQUE.has(tag)) { this.unsupported(`<${tag}>`); continue; }
      if (tag === 'br') { if (this.unsupported('<br>')) out.push({ text: ' ', marks }); continue; }
      let next: readonly Mark[] | null = null;
      if (tag === 'strong' || tag === 'b') next = types.strong!.create().addToSet(marks);
      else if (tag === 'em' || tag === 'i') next = types.em!.create().addToSet(marks);
      else if (tag === 'code') next = types.code!.create().addToSet(marks);
      else if (tag === 'a') {
        const raw = node.attr('href');
        const href = safeHref(raw);
        if (href) next = types.link!.create({ href }).addToSet(marks);
        else if (!this.unsupported(raw === null ? '<a> without href' : `unsafe link ${JSON.stringify(raw.slice(0, 40))}`)) continue;
      } else if (!this.unsupported(`<${tag}>`)) continue;
      out.push(...this.inline(node.children, next ?? marks));
    }
    return out;
  }
}

/**
 * Reads parsed region content into the kind's document. In `refuse` mode a `LiveRegionRefusal`
 * (`unsupported_content`) names everything the kind cannot hold; `strip` mode never refuses.
 */
export function readRegion(kind: RegionKind, nodes: SourceNode[], mode: ReadMode, { preserveWhitespace = false } = {}): PMNode {
  const reader = new Reader(kind, mode, preserveWhitespace);
  const doc = kind === 'rich' ? reader.rich(nodes) : reader.text(nodes);
  if (reader.problems.size) throw new LiveRegionRefusal('unsupported_content', [...reader.problems]);
  return doc;
}

const escape = (text: string) => escapeText(text).replace(/ /g, '&nbsp;');
const listTag = (list: ListType) => (list === 'ordered' ? 'ol' : 'ul');
const asList = (value: unknown): ListType | null => (value === 'bullet' || value === 'ordered' ? value : null);
const asInt = (value: unknown, min: number, max: number, fallback: number) => (Number.isInteger(value) ? Math.min(max, Math.max(min, value as number)) : fallback);

/**
 * The region's normal form. Tolerant of any attribute values (the merged state is untrusted): each is coerced to
 * what the schema allows, an id that is invalid or already written is left off, an unsafe link loses its mark.
 */
export function writeRegion(kind: RegionKind, doc: PMNode): string {
  if (kind === 'text') return escape(collapse([{ text: doc.textContent, marks: [] }])[0]?.text ?? '');
  const blocks: PMNode[] = [];
  doc.forEach((block) => { blocks.push(block); });
  const only = blocks[0];
  if (blocks.length === 1 && only && only.type.name === 'textblock' && !only.content.size && !only.attrs.level && !asList(only.attrs.list) && only.attrs.quote !== true && !['afId', 'itemId', 'listId', 'quoteId'].some((name) => isNodeId(only.attrs[name]))) return '';
  const used = new Set<string>();
  const id = (value: unknown) => { if (!isNodeId(value) || used.has(value)) return ''; used.add(value); return ` data-af-id="${value}"`; };
  let out = '';
  let quoted = false;
  const open: ListType[] = [];
  const closeTo = (depth: number) => { while (open.length > depth) out += `</li></${listTag(open.pop()!)}>`; };
  for (const block of blocks) {
    const { attrs } = block;
    const rule = block.type.name === 'rule';
    const list = rule ? null : asList(attrs.list);
    const depth = list ? asInt(attrs.depth, 1, MAX_DEPTH, 1) : 0;
    const quote = attrs.quote === true;
    if (quote !== quoted) { closeTo(0); out += quoted ? '</blockquote>' : `<blockquote${id(attrs.quoteId)}>`; quoted = quote; }
    if (open.length > depth) closeTo(depth);
    if (list && open.length === depth) {
      if (open[depth - 1] === list) out += `</li><li${id(attrs.itemId)}>`;
      else closeTo(depth - 1);
    }
    while (list && open.length < depth) {
      const own = open.length + 1 === depth;
      out += `<${listTag(list)}${own ? id(attrs.listId) : ''}><li${own ? id(attrs.itemId) : ''}>`;
      open.push(list);
    }
    if (rule) out += `<hr${id(attrs.afId)}>`;
    else if (block.type.name === 'code_block') out += `<pre${id(attrs.afId)}><code>${escape(block.textContent)}</code></pre>`;
    else {
      const level = asInt(attrs.level, 0, 6, 0);
      const tag = level ? `h${level}` : 'p';
      out += `<${tag}${id(attrs.afId)}>${writeInline(block)}</${tag}>`;
    }
  }
  closeTo(0);
  if (quoted) out += '</blockquote>';
  return out;
}

function writeInline(block: PMNode): string {
  const segments: Segment[] = [];
  block.forEach((child) => {
    if (!child.isText) return;
    segments.push({ text: child.text ?? '', marks: child.marks.filter((mark) => mark.type.name !== 'link' || safeHref(mark.attrs.href) === mark.attrs.href) });
  });
  let out = '';
  const open: Mark[] = [];
  for (const segment of collapse(segments)) {
    let keep = 0;
    while (keep < open.length && keep < segment.marks.length && open[keep]!.eq(segment.marks[keep]!)) keep++;
    while (open.length > keep) out += closeMark(open.pop()!);
    for (const mark of segment.marks.slice(keep)) { out += openMark(mark); open.push(mark); }
    out += escape(segment.text);
  }
  while (open.length) out += closeMark(open.pop()!);
  return out;
}

const MARK_TAGS: Record<string, string> = { link: 'a', strong: 'strong', em: 'em', code: 'code' };
const openMark = (mark: Mark) => (mark.type.name === 'link' ? `<a href="${escapeText(mark.attrs.href).replace(/"/g, '&quot;')}">` : `<${MARK_TAGS[mark.type.name]}>`);
const closeMark = (mark: Mark) => `</${MARK_TAGS[mark.type.name]}>`;
