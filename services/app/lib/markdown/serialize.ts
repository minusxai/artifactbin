/**
 * THE EDITOR'S DOCUMENT → MARKDOWN, on prosemirror-markdown's MarkdownSerializer for blocks, with our own inline
 * writer. The aim is that `parse(serialize(doc))` is the same document, and that canonical text comes back byte for
 * byte (`- ` bullets, `1.` numbers, `**`/`*`/`~~`, fenced code, `---`, `| --- |` delimiter rows).
 *
 * - Escaping is minimal and contextual: a character is escaped only where it would start markup there (line-start
 *   markers after a break, `]` before `(`/`[`, emphasis characters at a run's edge, a decodable `&...;`, an
 *   autolink-shaped `<...>`, a task marker at a bullet item's start, a heading's closing `#`s, `|` in a cell).
 * - Whitespace Markdown would drop (a line's leading or trailing space, a space just inside an emphasis run) and an
 *   alphanumeric neighbour that would stop a run from opening or closing are written as numeric references.
 * - Links are written bare when the bare text reads back as the same link, else `<href>` when that does, else
 *   `[text](href "title")`. Code is a complete span per text node, innermost, with enough backticks.
 * - With `breaks` (the default) a hard break is a newline, or a backslash line when one is needed; in a table
 *   cell it is `<br>`. A break at the very end of a paragraph cannot be written and is dropped.
 * - Lists keep `tight` unless their content cannot stay tight (listCanBeTight, which the editor also enforces); two
 *   neighbouring lists that must stay apart get different markers (`-`/`*`, `.`/`)`).
 * - Empty paragraphs between blocks cannot be written in Markdown and are not kept.
 *
 * Lists use MarkdownSerializerState's `closed`, `inTightList` and `flushClose`, members prosemirror-markdown 1.13.9
 * keeps for its own renderList but does not declare.
 */
import { MarkdownSerializer, type MarkdownSerializerState } from 'prosemirror-markdown';
import { Fragment, type Mark, type Node as PMNode } from 'prosemirror-model';
import { decodeHTML } from './entities';
import { inlineContent, readsAsLink } from './parse';

export interface SerializeOptions {
  /** A hard break is a newline (the default, matching parse's), else a backslash line. */
  breaks?: boolean;
}
type State = MarkdownSerializerState & { closed: PMNode | null; inTightList: boolean; flushClose(size?: number): void };
const breaksOf = (state: MarkdownSerializerState) => (state.options as { breaks?: boolean }).breaks !== false;

const LIST_ITEMS = new Set(['listItem', 'taskItem']);
const BULLET_LISTS = new Set(['bulletList', 'taskList']);
const CONTAINERS = new Set(['bulletList', 'orderedList', 'taskList', 'blockquote']);
/**
 * Whether a paragraph on the next line would continue `node`: its own paragraph or table row, or (inside a list or
 * quote) a lazy line of the paragraph it ends with.
 */
const continues = (node: PMNode, direct = true): boolean => (node.type.name === 'paragraph' && node.content.size > 0)
  || (direct && node.type.name === 'table')
  || ((CONTAINERS.has(node.type.name) || LIST_ITEMS.has(node.type.name)) && !!node.lastChild && continues(node.lastChild, false));
/** A bullet or ordered list whose first item is blank (a task marker is content), which cannot interrupt a paragraph. */
const startsBlank = (list: PMNode) => list.type.name !== 'taskList' && list.firstChild?.childCount === 1 && list.firstChild.firstChild!.type.name === 'paragraph' && list.firstChild.firstChild!.content.size === 0;

/**
 * Whether a list can be written tight, its item's blocks on consecutive lines: not when a paragraph would continue
 * the block before it, two quotes or two tables would merge, an ordered list not starting at 1 follows a paragraph
 * (it cannot interrupt one), or a list starting with a blank item follows a paragraph (it cannot interrupt one either).
 */
export function listCanBeTight(list: PMNode): boolean {
  let ok = true;
  list.forEach(item => item.forEach((child, _offset, index) => {
    if (!index) return;
    const before = item.child(index - 1), name = child.type.name;
    if (name === 'paragraph' && continues(before)) ok = false;
    if ((name === 'blockquote' || name === 'table') && before.type.name === name) ok = false;
    if (before.type.name === 'paragraph' && CONTAINERS.has(name) && name !== 'blockquote' && ((name === 'orderedList' && child.attrs.start !== 1) || startsBlank(child))) ok = false;
  }));
  return ok;
}

/* ── inline ──────────────────────────────────────────────────────────── */

/** One piece of a line: a text character (which a later pass may still re-encode), or written markup. */
type Piece = { kind: 'char'; char: string; out: string } | { kind: 'delim'; out: string; side: 'open' | 'close' } | { kind: 'raw'; out: string };
interface InlineContext { cell: boolean; heading: boolean; itemStart: boolean; breaks: boolean }

const PUNCT = /[\p{P}\p{S}]/u;
const SPACE = /\s/u;
const reference = (char: string) => `&#${char.codePointAt(0)};`;
const DELIMS: Record<string, string> = { bold: '**', italic: '*', strike: '~~' };
const RANK = ['link', 'bold', 'italic', 'strike'];
const kindOf = (char: string) => (char === '' || SPACE.test(char) ? 'space' : PUNCT.test(char) ? 'punct' : 'word');

/** The text characters of `text`, escaped where they would start markup in this place. */
function textPieces(text: string, at: { lineStart: boolean; brackets: boolean; cell: boolean; itemStart: boolean; last: boolean }): Piece[] {
  const chars = Array.from(text);
  const out: Piece[] = [];
  const line = chars.join('');
  const startEscape = at.lineStart && !at.cell ? lineStartEscape(line, at.itemStart) : -1;
  let offset = 0;
  chars.forEach((char, i) => {
    const before = chars[i - 1] ?? '', after = chars[i + 1] ?? '';
    const edge = i === 0 || i === chars.length - 1;
    let escaped = false;
    switch (char) {
      case '\\': escaped = !/\w/.test(after); break;
      case '`': escaped = true; break;
      case '*': escaped = edge || !(SPACE.test(before) && SPACE.test(after)); break;
      case '_': escaped = edge || !((/\w/.test(before) && /\w/.test(after)) || (SPACE.test(before) && SPACE.test(after))); break;
      case '~': escaped = edge || before === '~' || after === '~'; break;
      case '[': escaped = at.brackets; break;
      case ']': escaped = at.brackets || after === '(' || after === '[' || (i === chars.length - 1 && !at.last); break;
      case '|': escaped = at.cell; break;
      case '<': escaped = sticky(AUTOLINK_SHAPED, line, offset) !== null || (at.cell && sticky(CELL_BREAK, line, offset) !== null); break;
      case '&': { const found = sticky(REFERENCE_SHAPED, line, offset); escaped = found !== null && decodeHTML(found) !== found; break; }
    }
    offset += char.length;
    if (i === startEscape) escaped = true;
    // A no-break space is written as a reference: raw, it lets linkify start a link after it.
    out.push({ kind: 'char', char, out: char === '\u00a0' ? '&nbsp;' : (escaped ? '\\' : '') + char });
  });
  // A definition-shaped line (`[label]: x`, footnotes aside) would vanish.
  if (at.lineStart && /^\[(?!\^)[^\]]*\]:/.test(line)) { const close = chars.indexOf(']'); out[close] = { kind: 'char', char: ']', out: '\\]' }; }
  return out;
}
const AUTOLINK_SHAPED = /<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[^\s<>@]+@[^\s<>]+)>/y;
const REFERENCE_SHAPED = /&(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/y;
const CELL_BREAK = /<br\s*\/?>/iy;
const sticky = (pattern: RegExp, text: string, at: number): string | null => { pattern.lastIndex = at; return pattern.exec(text)?.[0] ?? null; };

/** Index of the character to escape so a line's start is not markup there, or -1. */
function lineStartEscape(line: string, itemStart: boolean): number {
  if (itemStart && /^\[[ xX]\](?:[ \t]|$)/.test(line)) return 0;
  if (/^#{1,6}(?:[ \t]|$)/.test(line) || /^>/.test(line) || /^[-+](?:[ \t]|$)/.test(line) || /^-+[ \t]*$/.test(line)) return 0;
  if (/^=+[ \t]*$/.test(line) || /^~{3,}/.test(line)) return 0;
  if (/^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/.test(line) && /[|:]/.test(line[0] ?? '')) return 0;
  const ordered = /^(\d{1,9})[.)](?:[ \t]|$)/.exec(line);
  return ordered ? ordered[1]!.length : -1;
}

function codeSpan(text: string, cell: boolean): string {
  const body = cell ? text.replace(/\|/g, '\\|') : text;
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map(run => run.length));
  const fence = '`'.repeat(longest + 1);
  // markdown-it strips one space from each end of a span that begins and ends with one.
  const pad = body.startsWith('`') || body.endsWith('`') || (body.startsWith(' ') && body.endsWith(' ')) ? ' ' : '';
  return fence + pad + body + pad + fence;
}

const references = (text: string) => text.replace(/&(?=(?:#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});)/g, (amp, at: number) => {
  const found = sticky(REFERENCE_SHAPED, text, at);
  return found && decodeHTML(found) !== found ? '\\&' : amp;
});
const linkTarget = (href: string) => references(/[\s<>]/.test(href) || /[()]/.test(href) && !balanced(href) ? `<${href.replace(/[<>]/g, char => encodeURIComponent(char))}>` : href.replace(/[()\\]/g, '\\$&'));
const balanced = (href: string) => { let depth = 0; for (const char of href) { if (char === '(') depth++; else if (char === ')' && --depth < 0) return false; } return depth === 0; };
const title = (value: unknown) => (value ? ` "${references(String(value).replace(/["\\]/g, '\\$&'))}"` : '');

/**
 * A textblock's inline content as Markdown lines (`\n` between lines). Links written bare or as `<href>` are checked
 * by reading the whole line back (linkify can reach past its neighbours); if it differs, every link gets brackets.
 */
function inlineMarkdown(parent: PMNode, context: InlineContext): string {
  const short = writeInline(parent, context, true);
  if (!short.shortLinks) return short.markdown;
  const nodes: PMNode[] = [];
  parent.forEach(child => { nodes.push(child); });
  if (!context.cell) while (nodes.at(-1)?.type.name === 'hardBreak') nodes.pop();
  try {
    const schema = parent.type.schema;
    const read = Fragment.fromJSON(schema, inlineContent(short.markdown, { ...context, images: !!schema.nodes.image }));
    if (read.eq(Fragment.fromArray(nodes))) return short.markdown;
  } catch { /* content the schema refuses reads back differently */ }
  return writeInline(parent, context, false).markdown;
}

function writeInline(parent: PMNode, context: InlineContext, shortLinks: boolean): { markdown: string; shortLinks: boolean } {
  const nodes: PMNode[] = [];
  parent.forEach(child => { nodes.push(child); });
  if (!context.cell) while (nodes.at(-1)?.type.name === 'hardBreak') nodes.pop();
  const pieces: Piece[] = [];
  const open: Mark[] = [];
  let lineStart = true;
  /** The last character written so far. */
  const lastWritten = () => { for (let i = pieces.length - 1; i >= 0; i--) if (pieces[i]!.out) return Array.from(pieces[i]!.out).at(-1)!; return ''; };
  const delimiters = new Map<Mark, string>();
  const closeMark = (mark: Mark) => {
    if (mark.type.name === 'link') {
      const run = linkRuns.get(mark);
      pieces.push({ kind: 'raw', out: run === 'bare' ? '' : run === 'angle' ? '>' : `](${linkTarget(mark.attrs.href)}${title(mark.attrs.title)})` });
    } else pieces.push({ kind: 'delim', out: delimiters.get(mark)!, side: 'close' });
  };
  const linkRuns = new Map<Mark, 'bare' | 'angle' | 'brackets'>();
  const lineBreak = () => {
    const previous = pieces.at(-1);
    // A backslash line where a newline alone would not do: a second break, or right after an opening run (whose
    // delimiter must not be followed by whitespace).
    const backslash = !context.breaks || lineStart || previous?.out.endsWith('\n') || (previous?.kind === 'delim' && previous.side === 'open');
    pieces.push({ kind: 'raw', out: context.cell ? '<br>' : backslash ? '\\\n' : '\n' });
    if (!context.cell) lineStart = true;
  };
  nodes.forEach((node, index) => {
    const code = node.marks.some(mark => mark.type.name === 'code') && node.isText;
    const wanted = node.marks.filter(mark => mark.type.name !== 'code').sort((a, b) => RANK.indexOf(a.type.name) - RANK.indexOf(b.type.name));
    let keep = 0;
    while (keep < open.length && open[keep]!.isInSet(wanted)) keep++;
    while (open.length > keep) closeMark(open.pop()!);
    // Of the marks opening here, the one that lasts longest goes outermost, so fewer runs close and reopen.
    const lasts = (mark: Mark) => { let end = index; while (end + 1 < nodes.length && mark.isInSet(nodes[end + 1]!.marks)) end++; return end; };
    for (const mark of wanted.filter(mark => !mark.isInSet(open)).sort((a, b) => lasts(b) - lasts(a) || RANK.indexOf(a.type.name) - RANK.indexOf(b.type.name))) {
      if (mark.type.name === 'link') {
        const shape = !shortLinks || pieces.at(-1)?.kind === 'delim' ? 'brackets' : linkShape(nodes, index, mark, lastWritten());
        linkRuns.set(mark, shape);
        pieces.push({ kind: 'raw', out: shape === 'bare' ? '' : shape === 'angle' ? '<' : '[' });
      } else {
        // `*` right after a closing `*` run would join it (`**a***b*`): this run uses `_` instead.
        const previous = pieces.at(-1);
        const delimiter = previous?.kind === 'delim' && previous.side === 'close' && previous.out.endsWith('*') ? DELIMS[mark.type.name]!.replace(/\*/g, '_') : DELIMS[mark.type.name]!;
        delimiters.set(mark, delimiter);
        pieces.push({ kind: 'delim', out: delimiter, side: 'open' });
      }
      open.push(mark);
      lineStart = false;
    }
    const inLink = open.some(mark => mark.type.name === 'link');
    const linkShapeNow = inLink ? linkRuns.get(open.find(mark => mark.type.name === 'link')!) : undefined;
    if (node.type.name === 'hardBreak') { lineBreak(); return; }
    if (node.type.name === 'image') {
      const alt = textPieces(String(node.attrs.alt ?? ''), { lineStart: false, brackets: true, cell: context.cell, itemStart: false, last: true }).map(piece => piece.out).join('');
      pieces.push({ kind: 'raw', out: `![${alt}](${linkTarget(String(node.attrs.src ?? ''))}${title(node.attrs.title)})` });
      lineStart = false;
      return;
    }
    if (!node.isText) return;
    if (code) { pieces.push({ kind: 'raw', out: codeSpan(node.text!, context.cell) }); lineStart = false; return; }
    if (linkShapeNow === 'bare' || linkShapeNow === 'angle') { pieces.push({ kind: 'raw', out: node.text! }); lineStart = false; return; }
    const lines = node.text!.split('\n');
    lines.forEach((text, line) => {
      if (line) lineBreak();
      if (!text) return;
      for (const piece of textPieces(text, { lineStart: lineStart && !context.heading, brackets: inLink, cell: context.cell, itemStart: context.itemStart && index === 0 && line === 0, last: index === nodes.length - 1 && line === lines.length - 1 })) pieces.push(piece);
      lineStart = false;
    });
  });
  while (open.length) closeMark(open.pop()!);
  fixWhitespaceAndFlanking(pieces, context);
  return { markdown: pieces.map(piece => piece.out).join(''), shortLinks: [...linkRuns.values()].some(shape => shape !== 'brackets') };
}

/** How a link whose run starts at `index` is written: bare or `<href>` only when that reads back as this link. */
function linkShape(nodes: PMNode[], index: number, mark: Mark, previous: string): 'bare' | 'angle' | 'brackets' {
  const node = nodes[index]!, next = nodes[index + 1];
  if (mark.attrs.title || !node.isText || node.marks.length !== 1) return 'brackets';
  if (next && next.marks.some(other => other.eq(mark))) return 'brackets';
  const following = nodes[index + 2];
  // The first character as it will be written: escaped, or a reference for whitespace that ends its line.
  const lineEndSpace = next?.isText && /^\s+$/.test(next.text!) && (!following || following.type.name === 'hardBreak');
  const after = !next ? '' : next.type.name === 'hardBreak' ? '\n' : next.isText && !next.marks.length && !lineEndSpace
    ? textPieces(next.text!, { lineStart: false, brackets: false, cell: false, itemStart: false, last: !following }).slice(0, 2).map(piece => piece.out).join('') : null;
  if (after === null) return 'brackets';
  if (readsAsLink(previous, node.text!, after === '\n' ? '' : after, mark.attrs.href, node.text!)) return 'bare';
  return /^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*$/.test(mark.attrs.href) && readsAsLink(previous, `<${mark.attrs.href}>`, after === '\n' ? '' : after, mark.attrs.href, node.text!) ? 'angle' : 'brackets';
}

/**
 * Encode whitespace Markdown would strip (at a line's ends, just inside an emphasis run) and fix runs that would not
 * open or close: a delimiter must be left-flanking to open and right-flanking to close (CommonMark 6.2).
 */
function fixWhitespaceAndFlanking(pieces: Piece[], context: InlineContext): void {
  const encode = (piece: Piece | undefined) => { if (piece?.kind === 'char') piece.out = reference(piece.char); };
  const lineEnds = pieces.map((piece, i) => (piece.kind === 'raw' && /\n$|^<br>$/.test(piece.out) ? i : -1)).filter(i => i >= 0);
  // Leading and trailing whitespace of each line (and of a table cell), which Markdown trims.
  for (const [from, to] of lineRanges(pieces.length, lineEnds)) {
    const chars = pieces.slice(from, to).map((piece, i) => ({ piece, i: i + from })).filter(entry => entry.piece.out !== '');
    const first = chars[0], last = chars.at(-1);
    if (first?.piece.kind === 'char' && SPACE.test(first.piece.char)) encode(first.piece);
    if (last?.piece.kind === 'char' && SPACE.test(last.piece.char)) encode(last.piece);
  }
  if (context.heading) {
    // A heading's closing sequence (` ##`) is not content.
    const tail = pieces.filter(piece => piece.out !== '');
    let end = tail.length;
    while (end && tail[end - 1]!.kind === 'char' && /^[ \t]$/.test((tail[end - 1] as { char: string }).char)) end--;
    let start = end;
    while (start && tail[start - 1]!.kind === 'char' && (tail[start - 1] as { char: string }).char === '#' && tail[start - 1]!.out === '#') start--;
    if (start < end && (start === 0 || (tail[start - 1]!.kind === 'char' && /^[ \t]$/.test((tail[start - 1] as { char: string }).char)))) tail[start]!.out = '\\#';
  }
  const neighbour = (i: number, step: -1 | 1): { piece?: Piece; char: string } => {
    for (let j = i + step; j >= 0 && j < pieces.length; j += step) {
      const piece = pieces[j]!;
      if (!piece.out) continue;
      return { piece, char: step < 0 ? Array.from(piece.out).at(-1)! : Array.from(piece.out)[0]! };
    }
    return { char: '' };
  };
  pieces.forEach((piece, i) => {
    if (piece.kind !== 'delim') return;
    // Whitespace just inside the run.
    const inside = neighbour(i, piece.side === 'open' ? 1 : -1);
    if (inside.piece?.kind === 'char' && SPACE.test(inside.piece.char)) encode(inside.piece);
    const insideNow = neighbour(i, piece.side === 'open' ? 1 : -1), outside = neighbour(i, piece.side === 'open' ? -1 : 1);
    // Punctuation inside and a letter outside: the run would not open (close); make the outside character a reference.
    // A `_` run never opens after, or closes before, a letter.
    if ((kindOf(insideNow.char) === 'punct' || piece.out.startsWith('_')) && kindOf(outside.char) === 'word') encode(outside.piece);
  });
  // `!` written right before a link's `[` would make an image.
  pieces.forEach((piece, i) => { if (piece.kind === 'char' && piece.char === '!' && piece.out === '!' && pieces[i + 1]?.out.startsWith('[')) piece.out = '\\!'; });
}
const lineRanges = (length: number, ends: number[]): Array<[number, number]> => {
  const ranges: Array<[number, number]> = [];
  let from = 0;
  for (const end of ends) { ranges.push([from, end]); from = end + 1; }
  ranges.push([from, length]);
  return ranges;
};

/* ── blocks ──────────────────────────────────────────────────────────── */

function writeLines(state: State, markdown: string): void {
  markdown.split('\n').forEach((line, i) => { if (i) state.write('\n'); state.write(line); });
}

/** The markers of the bullet lists being written, innermost last ('' for an ordered list). */
const markers: string[] = [];
const bulletMarker = (parent: PMNode, index: number): string => {
  const node = parent.child(index), before = index ? parent.child(index - 1) : null;
  // A bullet list opening its item takes the other marker, so `- - -` is never read as a rule.
  if (!before || !BULLET_LISTS.has(before.type.name)) return !index && LIST_ITEMS.has(parent.type.name) && markers.at(-1) === '-' ? '*' : '-';
  const previous = bulletMarker(parent, index - 1);
  const merges = before.type !== node.type && before.attrs.tight === node.attrs.tight;
  return merges ? previous : previous === '-' ? '*' : '-';
};
const orderedDelimiter = (parent: PMNode, index: number): string => {
  const before = index ? parent.child(index - 1) : null;
  return before?.type.name === 'orderedList' ? (orderedDelimiter(parent, index - 1) === '.' ? ')' : '.') : '.';
};

function renderList(state: State, node: PMNode, parent: PMNode, index: number, marker: (item: number) => string): void {
  const tight = node.attrs.tight !== false && listCanBeTight(node);
  const before = index ? parent.child(index - 1) : null;
  // A task group right after a bullet group of the same list (or the reverse) continues it.
  if (before && BULLET_LISTS.has(before.type.name) && BULLET_LISTS.has(node.type.name) && before.type !== node.type && bulletMarker(parent, index) === bulletMarker(parent, index - 1)) state.flushClose(tight ? 1 : 2);
  else if (state.inTightList) state.flushClose(1);
  const outer = state.inTightList;
  state.inTightList = tight;
  markers.push(BULLET_LISTS.has(node.type.name) ? marker(0).trim() : '');
  node.forEach((child, _offset, item) => {
    if (item && tight) state.flushClose(1);
    const first = marker(item);
    state.wrapBlock(' '.repeat(first.length), first, node, () => state.render(child, node, item));
  });
  markers.pop();
  state.inTightList = outer;
}

/** An item's blocks: in a tight list without the blank line between them that would make the list loose. */
function itemContent(state: State, node: PMNode): void {
  node.forEach((child, _offset, index) => {
    // Two bullet groups of one list meet without a gap of their own: renderList writes what joins them.
    const groups = index > 0 && BULLET_LISTS.has(child.type.name) && BULLET_LISTS.has(node.child(index - 1).type.name);
    if (index && state.inTightList && !groups) state.flushClose(1);
    state.render(child, node, index);
  });
}

const serializer = new MarkdownSerializer({
  doc: (state, node) => state.renderContent(node),
  paragraph: (state, node, parent, index) => {
    const itemStart = parent.type.name === 'listItem' && index === 0;
    writeLines(state as State, inlineMarkdown(node, { cell: false, heading: false, itemStart, breaks: breaksOf(state) }));
    state.closeBlock(node);
  },
  heading: (state, node) => {
    state.write(`${'#'.repeat(node.attrs.level)} `);
    state.write(inlineMarkdown(node, { cell: false, heading: true, itemStart: false, breaks: breaksOf(state) }));
    state.closeBlock(node);
  },
  blockquote: (state, node) => state.wrapBlock('> ', null, node, () => state.renderContent(node)),
  codeBlock: (state, node) => {
    const text = node.textContent;
    const language = String(node.attrs.language ?? '');
    const char = language.includes('`') ? '~' : '`';
    const longest = Math.max(0, ...(text.match(new RegExp(`^ {0,3}${char === '`' ? '`' : '~'}+`, 'gm')) ?? []).map(run => run.trim().length));
    const fence = char.repeat(Math.max(3, longest + 1));
    state.write(`${fence}${references(language.replace(/\\(?=[!-/:-@[-`{-~])/g, '\\\\'))}\n`);
    if (text) state.text(`${text}\n`, false);
    state.write(fence);
    state.closeBlock(node);
  },
  // In a list item `---` could underline a paragraph or join its marker in a rule (`- ---`); `***` could join `* `.
  horizontalRule: (state, node, parent, index) => {
    state.write(!LIST_ITEMS.has(parent.type.name) ? '---' : !index && markers.at(-1) === '*' ? '---' : '***');
    state.closeBlock(node);
  },
  bulletList: (state, node, parent, index) => { const marker = bulletMarker(parent, index); renderList(state as State, node, parent, index, () => `${marker} `); },
  taskList: (state, node, parent, index) => { const marker = bulletMarker(parent, index); renderList(state as State, node, parent, index, () => `${marker} `); },
  orderedList: (state, node, parent, index) => {
    const start = Number(node.attrs.start ?? 1), delimiter = orderedDelimiter(parent, index);
    renderList(state as State, node, parent, index, item => `${start + item}${delimiter} `);
  },
  listItem: (state, node) => itemContent(state as State, node),
  taskItem: (state, node) => { state.write(node.attrs.checked ? '[x] ' : '[ ] '); itemContent(state as State, node); },
  table: (state, node) => {
    const rows: string[][] = [];
    const aligns: Array<string | null> = [];
    node.forEach((row, _offset, r) => {
      const cells: string[] = [];
      row.forEach(cell => {
        if (!r) aligns.push(cell.attrs.align ?? null);
        cells.push(inlineMarkdown(cell, { cell: true, heading: false, itemStart: false, breaks: true }));
      });
      rows.push(cells);
    });
    const width = Math.max(1, ...rows.map(cells => cells.length));
    const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
    const rule = `| ${Array.from({ length: width }, (_, i) => ({ left: ':--', center: ':-:', right: '--:' } as Record<string, string>)[aligns[i] ?? ''] ?? '---').join(' | ')} |`;
    [line(rows[0] ?? []), rule, ...rows.slice(1).map(line)].forEach((text, i) => { if (i) state.ensureNewLine(); state.write(text); });
    state.closeBlock(node);
  },
}, {}, { strict: true });

/** The document (the editor's ProseMirror doc, on the editor entry's schema) as Markdown. */
export function serialize(doc: PMNode, options: SerializeOptions = {}): string {
  markers.length = 0;
  return serializer.serialize(doc, { breaks: options.breaks ?? true } as Parameters<typeof serializer.serialize>[1]);
}
