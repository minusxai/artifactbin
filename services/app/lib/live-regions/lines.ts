/**
 * A region's shared text: ONE Y.Text in the Quill-delta shape. Every block is a line: its characters, then a "\n"
 * whose attributes are the block's (`level`, `list`, `depth`, `quote`, `codeBlock`, `rule` and its ids); marks are
 * the characters' attributes (`bold`, `italic`, `code`, `link`). A code block is consecutive code lines, all but its
 * last marked `codeContinues`; a rule is an empty line marked `rule`.
 *
 * Split, join, a type change and a block deletion are then a "\n" inserted, deleted or reformatted: no block is ever
 * recreated, so nobody's concurrent typing is lost or copied. The ProseMirror document is the same content seen
 * through the flat schema (schema.ts), position for position: a block's opening token has no width, its closing
 * token is its "\n", and a code block's text is its lines' text with their inner "\n"s.
 */
import type { Mark, Node as PMNode } from 'prosemirror-model';
import type * as Y from 'yjs';
import { ID_ATTRS, isNodeId, MAX_DEPTH, regionSchema, safeHref, type RegionKind } from './schema';

export type Attrs = Record<string, string | number | boolean>;
/** One UTF-16 code unit of the region with its attributes (both Y.Text and ProseMirror count code units). */
export interface Unit { ch: string; attrs: Attrs }

const CHAR_KEYS = ['bold', 'italic', 'code', 'link'] as const;
const BLOCK_KEYS = ['checked', 'level', 'list', 'depth', 'quote', 'codeBlock', 'codeContinues', 'rule', ...ID_ATTRS] as const;
/** The attribute keys a unit of this character owns: block keys on a "\n", marks on anything else. */
export const keysOf = (ch: string): readonly string[] => (ch === '\n' ? BLOCK_KEYS : CHAR_KEYS);

const MARK_KEY: Record<string, string> = { strong: 'bold', em: 'italic', code: 'code', link: 'link' };
function charAttrs(marks: readonly Mark[]): Attrs {
  const attrs: Attrs = {};
  for (const mark of marks) attrs[MARK_KEY[mark.type.name]!] = mark.type.name === 'link' ? mark.attrs.href : true;
  return attrs;
}
function structure(node: PMNode): Attrs {
  const attrs: Attrs = {};
  if (node.attrs.list) { attrs.list = node.attrs.list; attrs.depth = node.attrs.depth; }
  if (node.type.name === "textblock" && node.attrs.list === "bullet" && typeof node.attrs.checked === "boolean") attrs.checked = node.attrs.checked;
  if (node.attrs.quote) attrs.quote = true;
  return attrs;
}
function ids(node: PMNode): Attrs {
  const attrs: Attrs = {};
  for (const name of ID_ATTRS) if (typeof node.attrs[name] === 'string') attrs[name] = node.attrs[name];
  return attrs;
}
/** The attributes of a block's closing "\n". */
function endAttrs(kind: RegionKind, node: PMNode): Attrs {
  if (kind === 'text') return {};
  if (node.type.name === 'rule') return { rule: true, ...(node.attrs.quote ? { quote: true } : {}), ...ids(node) };
  if (node.type.name === 'code_block') return { codeBlock: true, ...structure(node), ...ids(node) };
  return { ...(node.attrs.level ? { level: node.attrs.level } : {}), ...structure(node), ...ids(node) };
}

interface Block { pos: number; size: number; offset: number; length: number; node: PMNode }
/** A ProseMirror document seen as the region's linear text: positions ↔ offsets, and units of any range. */
export class Linear {
  readonly blocks: Block[] = [];
  readonly length: number;
  constructor(readonly kind: RegionKind, readonly doc: PMNode) {
    let offset = 0;
    doc.forEach((node, pos) => {
      const length = node.isLeaf ? 1 : node.content.size + 1;
      this.blocks.push({ pos, size: node.nodeSize, offset, length, node });
      offset += length;
    });
    this.length = offset;
  }
  private blockAtPos(pos: number): Block {
    let low = 0, high = this.blocks.length - 1;
    while (low < high) { const mid = (low + high + 1) >> 1; if (this.blocks[mid]!.pos <= pos) low = mid; else high = mid - 1; }
    return this.blocks[low]!;
  }
  private indexAtOffset(offset: number): number {
    let low = 0, high = this.blocks.length - 1;
    while (low < high) { const mid = (low + high + 1) >> 1; if (this.blocks[mid]!.offset <= offset) low = mid; else high = mid - 1; }
    return low;
  }
  private blockAtOffset(offset: number): Block { return this.blocks[this.indexAtOffset(offset)]!; }
  /** The block holding the unit at `offset`. */
  blockAt(offset: number): PMNode { return this.blockAtOffset(offset).node; }
  /** Offset just past the closing "\n" of the block holding `offset` (a code block's last line, not its inner ones). */
  blockEnd(offset: number): number {
    if (offset >= this.length) return this.length;
    const block = this.blockAtOffset(offset);
    return block.offset + block.length;
  }
  /** Document position → offset. A block's opening has no width; its closing is its "\n". */
  offset(pos: number): number {
    if (pos >= this.doc.content.size) return this.length;
    const block = this.blockAtPos(pos);
    if (pos === block.pos) return block.offset;
    return block.offset + Math.min(pos - block.pos - (block.node.isLeaf ? 0 : 1), block.length);
  }
  /** Offset → the document position of that place in a text block (a rule's offset → the position after it). */
  pos(offset: number): number {
    if (offset >= this.length) return this.doc.content.size;
    const block = this.blockAtOffset(offset);
    if (block.node.isLeaf) return block.pos + (offset > block.offset ? 1 : 0);
    return block.pos + 1 + Math.min(offset - block.offset, block.length - 1);
  }
  units(from: number, to: number): Unit[] {
    const out: Unit[] = [];
    if (from >= to) return out;
    for (let index = this.indexAtOffset(from); index < this.blocks.length; index++) {
      const block = this.blocks[index]!;
      if (block.offset >= to) break;
      const { node } = block;
      const start = Math.max(from, block.offset) - block.offset, end = Math.min(to, block.offset + block.length) - block.offset;
      if (node.isLeaf) { if (start === 0 && end > 0) out.push({ ch: '\n', attrs: endAttrs(this.kind, node) }); continue; }
      const code = node.type.name === 'code_block';
      const inner = code ? { codeBlock: true, codeContinues: true, ...structure(node) } : null;
      let at = 0;
      node.forEach((child) => {
        const text = child.text ?? '';
        const from = Math.max(start, at), to = Math.min(end, at + text.length);
        if (from < to) {
          const attrs = code ? {} : charAttrs(child.marks);
          for (let i = from - at; i < to - at; i++) {
            const ch = text[i]!;
            if (code && ch === '\n') out.push({ ch, attrs: inner! });
            else out.push({ ch: ch === '\n' && this.kind === 'rich' ? ' ' : ch, attrs });
          }
        }
        at += text.length;
      });
      if (end === block.length) out.push({ ch: '\n', attrs: endAttrs(this.kind, node) });
    }
    return out;
  }
}

interface Line { runs: { text: string; attrs: Attrs }[]; attrs: Attrs; text: string }
/** The region's lines from a Y.Text. An unterminated last line (concurrent deletions can leave one) is a plain line. */
function readLines(text: Y.Text): { lines: Line[]; terminated: boolean } {
  const lines: Line[] = [];
  let current: Line = { runs: [], attrs: {}, text: '' };
  for (const op of text.toDelta() as { insert: unknown; attributes?: Attrs }[]) {
    if (typeof op.insert !== 'string') continue;
    const parts = op.insert.split('\n');
    parts.forEach((part, index) => {
      if (part) { current.runs.push({ text: part, attrs: op.attributes ?? {} }); current.text += part; }
      if (index < parts.length - 1) { current.attrs = op.attributes ?? {}; lines.push(current); current = { runs: [], attrs: {}, text: '' }; }
    });
  }
  const terminated = !current.runs.length;
  if (!terminated || !lines.length) lines.push(current);
  return { lines, terminated };
}

const asList = (value: unknown) => (value === 'bullet' || value === 'ordered' ? value : null);
const asInt = (value: unknown, min: number, max: number, fallback: number) => (Number.isInteger(value) ? Math.min(max, Math.max(min, value as number)) : fallback);
const idAttrs = (attrs: Attrs) => Object.fromEntries(ID_ATTRS.map((name) => [name, isNodeId(attrs[name]) ? attrs[name] : null]));
const structureOf = (attrs: Attrs) => {
  const list = asList(attrs.list);
  return { list, depth: list ? asInt(attrs.depth, 1, MAX_DEPTH, 1) : 0, quote: attrs.quote === true };
};
const sameStructure = (a: Attrs, b: Attrs) => JSON.stringify(structureOf(a)) === JSON.stringify(structureOf(b));

/**
 * The document a region's text shows: the one reader of shared state, for editors and the server alike. Tolerant of
 * anything a peer wrote: unknown attributes are ignored, values coerced, unsafe links unlinked, and a rule line that
 * holds text is a text block (the text is never dropped). Each block's text has exactly its lines' code units.
 */
function linesToDoc(kind: RegionKind, lines: readonly Line[]): PMNode {
  const schema = regionSchema(kind);
  const { nodes, marks } = schema;
  const inline = (line: Line) => line.runs.map((run) => {
    if (kind === 'text') return schema.text(run.text);
    const set: Mark[] = [];
    if (run.attrs.bold === true) set.push(marks.strong!.create());
    if (run.attrs.italic === true) set.push(marks.em!.create());
    if (run.attrs.code === true) set.push(marks.code!.create());
    const href = safeHref(run.attrs.link);
    if (href && href === run.attrs.link) set.push(marks.link!.create({ href }));
    return schema.text(run.text, sortMarks(set));
  });
  if (kind === 'text') {
    const text = lines.map((line) => line.text).join('\n');
    return nodes.doc!.create(null, nodes.textblock!.create(null, text ? schema.text(text) : null));
  }
  const blocks: PMNode[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const { attrs } = line;
    if (attrs.rule === true && !line.text) {
      blocks.push(nodes.rule!.create({ quote: attrs.quote === true, afId: idAttrs(attrs).afId, quoteId: idAttrs(attrs).quoteId }));
      continue;
    }
    if (attrs.codeBlock === true) {
      let text = line.text;
      let last = line;
      while (last.attrs.codeContinues === true && index + 1 < lines.length && lines[index + 1]!.attrs.codeBlock === true && sameStructure(lines[index + 1]!.attrs, attrs)) {
        last = lines[++index]!;
        text += `\n${last.text}`;
      }
      blocks.push(nodes.code_block!.create({ ...structureOf(attrs), ...idAttrs(last.attrs) }, text ? schema.text(text) : null));
      continue;
    }
    blocks.push(nodes.textblock!.create({ checked: attrs.list === "bullet" && typeof attrs.checked === "boolean" ? attrs.checked : null, level: asInt(attrs.level, 0, 6, 0), ...structureOf(attrs), ...idAttrs(attrs) }, inline(line)));
  }
  return nodes.doc!.create(null, blocks);
}
const sortMarks = (set: Mark[]) => set.reduce<readonly Mark[]>((all, mark) => mark.addToSet(all), []) as Mark[];

/** The document of a region's Y.Text, and whether its last line is terminated. */
export function readText(kind: RegionKind, text: Y.Text): { doc: PMNode; terminated: boolean } {
  const { lines, terminated } = readLines(text);
  return { doc: linesToDoc(kind, lines), terminated };
}

/** Writes units into a Y.Text at `offset`, each run with exactly its attributes. */
export function insertUnits(text: Y.Text, offset: number, units: readonly Unit[]): void {
  let at = offset;
  for (let start = 0; start < units.length;) {
    let end = start + 1;
    while (end < units.length && JSON.stringify(units[end]!.attrs) === JSON.stringify(units[start]!.attrs)) end++;
    const run = units.slice(start, end).map((unit) => unit.ch).join('');
    text.insert(at, run, { ...units[start]!.attrs });
    at += run.length;
    start = end;
  }
}

/** A document's whole content as units (server-side builds and diffs). */
export const documentUnits = (kind: RegionKind, doc: PMNode): Unit[] => { const linear = new Linear(kind, doc); return linear.units(0, linear.length); };
