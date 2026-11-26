/**
 * MARKDOWN → THE MODULE'S DOCUMENT: markdown-it's tokens, converted to Tiptap-shaped JSON by our own converter.
 * One configured markdown-it, CommonMark plus tables, strikethrough and linkify, with these rules of ours:
 *
 * - Raw HTML is never markup (`html: false`): it is text. `<br>` inside a table cell is the one exception, a break.
 * - Bare addresses link only with a scheme or `www.` (fuzzy links other than `www.`, fuzzy email, `ftp:` and `//`
 *   are off), so `README.md` and `example.com` stay text.
 * - A link or image whose address href.ts refuses, and any image while the surface has images off, shows as the
 *   source exactly as typed (link, image, autolink and linkify rules are wrapped; reference definitions naming a
 *   refused address stay text too). markdown-it's own validateLink only ever empties an href, so it accepts all.
 * - Footnote definitions (`[^1]: x`) are not link reference definitions: they stay literal text.
 * - Container nesting is capped at NESTING_CAP levels; what lies deeper becomes one paragraph of its lines, so no
 *   text is lost (markdown-it alone drops it), and hostile nesting stays linear.
 * - Task items (`- [ ] x`, `- [x] x`) are read per item, from an unescaped marker, in bullet lists only, and a
 *   mixed list splits into task and bullet groups (the rule documents use, lib/live-regions/native-markdown.ts).
 * - A list's `tight`, an ordered list's `start` and a link's `title` are attributes, so saving rewrites none of them.
 * - Escaped and entity text is joined here, after task markers are read (markdown-it's text_join is off).
 *
 * The entity decoder markdown-it uses is the slim one (./entities.ts, wired by scripts/lib/slim-entities.mjs).
 */
import MarkdownIt from 'markdown-it';
import type { StateBlock, StateCore, StateInline, Token } from 'markdown-it';
import { imageAllowed, linkAllowed } from './href';
import { MARK_ORDER, type MarkdownDoc, type MarkdownMark, type MarkdownNode, type ParseOptions } from './types';

/** Block containers deeper than this become text (two levels per list: the list and its item). */
export const NESTING_CAP = 100;

interface Env { images: boolean; recoverSpacedTables: boolean; inCell: boolean; cellMode?: boolean; onRefused?: ParseOptions['onRefused']; references?: Record<string, { href: string }> }
type InlineRule = (state: StateInline, silent: boolean) => boolean;
type BlockRule = (state: StateBlock, startLine: number, endLine: number, silent: boolean) => boolean;
const ruleOf = <T>(ruler: unknown, name: string): T =>
  (ruler as { __rules__: Array<{ name: string; fn: T }> }).__rules__.find(rule => rule.name === name)!.fn;

const md = new MarkdownIt('commonmark', { html: false, linkify: true })
  .enable(['strikethrough', 'table', 'linkify']).disable(['text_join']);
// markdown-it's own cap stays above ours, so ours (below) is the one that applies.
Object.assign(md.options, { maxNesting: NESTING_CAP + 20 });
md.validateLink = () => true;

// Bare addresses: schemes http, https and mailto, and `www.` hosts; nothing fuzzy beyond `www.`.
const linkify = md.linkify;
linkify.set({ fuzzyLink: true, fuzzyEmail: false, fuzzyIP: false }).add('ftp:', null).add('//', null);
type LinkifyMatch = NonNullable<ReturnType<typeof linkify.match>>[number];
const wanted = (match: LinkifyMatch) => match.schema !== '' || /^www\./i.test(match.raw);
const matches = (text: string) => { const found = linkify.match(text)?.filter(wanted); return found?.length ? found : null; };
(md as { linkify: typeof linkify }).linkify = Object.assign(Object.create(linkify) as typeof linkify, {
  test: (text: string) => matches(text) !== null,
  match: matches,
  matchAtStart: (text: string) => { const found = linkify.matchAtStart(text); return found && wanted(found) ? found : null; },
});

/** A link-making rule whose refused result is replaced by its source as typed. */
const asTypedWhenRefused = (original: InlineRule): InlineRule => (state, silent) => {
  const start = state.pos, from = state.tokens.length;
  const matched = original(state, silent);
  if (!matched || silent) return matched;
  const at = state.tokens.findIndex((token, index) => index >= from && (token.type === 'link_open' || token.type === 'image'));
  if (at < 0) return true;
  const token = state.tokens[at]!, env = state.env as Env, image = token.type === 'image';
  const href = token.attrGet(image ? 'src' : 'href') ?? '';
  if (image ? env.images && imageAllowed(href) : linkAllowed(href)) return true;
  const source = state.src.slice(start, state.pos);
  state.tokens.length = at;
  state.tokens_meta.length = Math.min(state.tokens_meta.length, at);
  state.pending += source;
  env.onRefused?.({ kind: image ? 'image' : 'link', source, href });
  return true;
};
for (const name of ['link', 'image', 'autolink', 'linkify']) md.inline.ruler.at(name, asTypedWhenRefused(ruleOf<InlineRule>(md.inline.ruler, name)));

// `<br>` in a table cell is a break; everywhere else it is text.
md.inline.ruler.before('autolink', 'cell_break', (state, silent) => {
  if (!(state.env as Env).inCell || state.src.charCodeAt(state.pos) !== 0x3c) return false;
  const found = /^<br\s*\/?>/i.exec(state.src.slice(state.pos, state.pos + 8));
  if (!found) return false;
  if (!silent) state.push('hardbreak', 'br', 0);
  state.pos += found[0].length;
  return true;
});
// markdown-it's core inline rule, telling the inline rules when they are inside a table cell.
md.core.ruler.at('inline', (state: StateCore) => {
  const env = state.env as Env;
  state.tokens.forEach((token, index) => {
    if (token.type !== 'inline') return;
    const before = state.tokens[index - 1]?.type;
    env.inCell = env.cellMode ?? (before === 'th_open' || before === 'td_open');
    state.md.inline.parse(token.content, state.md, state.env, token.children ??= []);
  });
  env.inCell = false;
});

// Footnote definitions stay text; a definition naming a refused address is not a definition.
const reference = ruleOf<BlockRule>(md.block.ruler, 'reference');
md.block.ruler.at('reference', (state, startLine, endLine, silent) => {
  const begin = state.bMarks[startLine]! + state.tShift[startLine]!;
  if (state.src.startsWith('[^', begin)) return false;
  const env = state.env as Env, known = new Set(Object.keys(env.references ?? {}));
  if (!reference(state, startLine, endLine, silent)) return false;
  const added = Object.keys(env.references ?? {}).filter(label => !known.has(label));
  if (added.every(label => linkAllowed(env.references![label]!.href))) return true;
  for (const label of added) delete env.references![label];
  state.line = startLine;
  return false;
});

// Beyond the cap, a container's remaining lines are one paragraph of text.
const tokenize = md.block.tokenize.bind(md.block);
md.block.tokenize = (state: StateBlock, startLine: number, endLine: number) => {
  if (state.level < NESTING_CAP) { tokenize(state, startLine, endLine); return; }
  const text = state.getLines(startLine, endLine, state.blkIndent, false).trim();
  if (text) {
    state.push('paragraph_open', 'p', 1).map = [startLine, endLine];
    const inline = state.push('inline', '', 0);
    Object.assign(inline, { content: text, map: [startLine, endLine], children: [] });
    state.push('paragraph_close', 'p', -1);
  }
  state.line = endLine;
};

// af-markdown-editor's older saves (lib/html-components/markdown-editor-model.ts): each pipe row in its own
// paragraph. Only explicit rectangular tables are recovered; code blocks, nested prose and other paragraphs stay.
md.core.ruler.after('block', 'spaced_tables', (state: StateCore) => {
  if (!(state.env as Env).recoverSpacedTables || !/\|[ \t]*:?-+:?[ \t]*\|/.test(state.src)) return;
  const tokens = state.tokens, result: Token[] = [];
  const rowAt = (i: number) => {
    if (tokens[i]?.type !== 'paragraph_open' || tokens[i]!.level !== 0) return undefined;
    const text = tokens[i + 1]?.content.trim();
    return text && /^\|[^\n]*\|$/.test(text) ? text : undefined;
  };
  const divider = (row?: string) => !!row && /^\|(?:[ \t]*:?-+:?[ \t]*\|)+$/.test(row);
  const width = (row: string) => row.slice(1, -1).split(/(?<!\\)\|/).length;
  for (let i = 0; i < tokens.length; i++) {
    const header = rowAt(i), rule = rowAt(i + 3);
    if (!header || !rule || !divider(rule) || width(header) !== width(rule)) { result.push(tokens[i]!); continue; }
    const rows = [header, rule];
    let end = i + 6;
    for (let row = rowAt(end); row && width(row) === width(rule); row = rowAt(end)) {
      if (divider(row) || divider(rowAt(end + 3))) break;
      rows.push(row);
      end += 3;
    }
    const parsed: Token[] = [];
    state.md.block.parse(rows.join('\n'), state.md, state.env, parsed);
    if (parsed[0]?.type !== 'table_open') { result.push(tokens[i]!); continue; }
    result.push(...parsed);
    i = end - 1;
  }
  state.tokens = result;
});

const TASK = /^\[([ xX])\](?:[ \t]+|$)/;
const ALIGN = /text-align:(left|center|right)/;
const sameMarks = (a: MarkdownMark[] | undefined, b: MarkdownMark[] | undefined) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

interface InlineContext { breaks: boolean; heading: boolean; cell: boolean }
/** An image's alt text: its label's text, escapes and code included, breaks as spaces. */
const altText = (tokens: readonly Token[]): string => tokens.map(token =>
  token.type === 'image' ? altText(token.children ?? []) : token.type === 'softbreak' || token.type === 'hardbreak' ? ' ' : token.content).join('').replace(/\s*\n\s*/g, ' ');
/** Inline tokens → text, hardBreak and image nodes with their marks, outermost first; equal neighbours joined. */
function inline(children: readonly Token[], context: InlineContext): MarkdownNode[] {
  const out: MarkdownNode[] = [];
  const marks: MarkdownMark[] = [];
  const refusedLinks: boolean[] = [];
  const add = (node: MarkdownNode) => {
    // Nested runs of one mark (`**a **b** c**`) are one mark.
    if (marks.length) node.marks = [...marks].filter((mark, i) => marks.findIndex(other => other.type === mark.type) === i).sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
    const last = out.at(-1);
    if (node.type === 'text' && last?.type === 'text' && sameMarks(last.marks, node.marks)) last.text += node.text!;
    else out.push(node);
  };
  const text = (value: string) => { if (value) add({ type: 'text', text: value }); };
  const open = (type: MarkdownMark['type']) => { marks.push({ type }); };
  const close = (type: MarkdownMark['type']) => { const at = marks.map(mark => mark.type).lastIndexOf(type); if (at >= 0) marks.splice(at, 1); };
  const lineBreak = () => (context.heading ? text(' ') : add({ type: 'hardBreak' }));
  for (const token of children) {
    switch (token.type) {
      case 'text': case 'text_special':
        // Only source shown as typed (a refused link over several lines) carries newlines: they follow the newline rule.
        token.content.split(/[ \t]*\n[ \t]*/).forEach((part, i) => { if (i) { if (context.breaks) lineBreak(); else text(' '); } text(part); });
        break;
      case 'code_inline': {
        marks.push({ type: 'code' });
        // GFM: a pipe escaped to keep it inside a table cell is a plain pipe inside code too.
        text(context.cell ? token.content.replace(/\\\|/g, '|') : token.content);
        close('code');
        break;
      }
      case 'softbreak': if (context.breaks) lineBreak(); else text(' '); break;
      case 'hardbreak': lineBreak(); break;
      case 'strong_open': open('bold'); break;
      case 'strong_close': close('bold'); break;
      case 'em_open': open('italic'); break;
      case 'em_close': close('italic'); break;
      case 's_open': open('strike'); break;
      case 's_close': close('strike'); break;
      case 'link_open': {
        const href = token.attrGet('href') ?? '';
        const allowed = linkAllowed(href);
        refusedLinks.push(!allowed);
        if (allowed) marks.push({ type: 'link', attrs: { href, title: token.attrGet('title') ?? null } });
        break;
      }
      case 'link_close': if (refusedLinks.pop() === false) close('link'); break;
      case 'image': {
        const alt = altText(token.children ?? []);
        add({ type: 'image', attrs: { src: token.attrGet('src') ?? '', alt, title: token.attrGet('title') ?? null } });
        break;
      }
      default: text(token.content);
    }
  }
  return out;
}

const textblock = (type: string, content: MarkdownNode[], attrs?: Record<string, unknown>): MarkdownNode =>
  ({ type, ...(attrs ? { attrs } : {}), ...(content.length ? { content } : {}) });

/** Split a bullet list holding task items into consecutive task and bullet groups. */
function groups(list: MarkdownNode): MarkdownNode[] {
  const items = list.content ?? [];
  if (!items.some(item => item.type === 'taskItem')) return [list];
  const out: MarkdownNode[] = [];
  for (const item of items) {
    const type = item.type === 'taskItem' ? 'taskList' : 'bulletList';
    const last = out.at(-1);
    if (last?.type === type) last.content!.push(item);
    else out.push({ type, attrs: { tight: list.attrs!.tight }, content: [item] });
  }
  return out;
}

/** The task marker of a bullet item's first paragraph, removed from its tokens; null when it has none. */
function taskMarker(tokens: readonly Token[], at: number): boolean | null {
  if (tokens[at + 1]?.type !== 'paragraph_open') return null;
  const children = tokens[at + 2]?.children ?? [];
  const first = children[0];
  if (first?.type !== 'text') return null;
  const found = TASK.exec(first.content);
  if (!found || (found[0].length === first.content.length && !/[ \t]$/.test(found[0]) && children.length > 1)) return null;
  first.content = first.content.slice(found[0].length);
  if (!first.content) children.shift();
  return found[1] !== ' ';
}

export function parse(markdown: string, options: ParseOptions = {}): MarkdownDoc {
  const env: Env = { images: options.images ?? false, recoverSpacedTables: options.recoverSpacedTables ?? false, inCell: false, onRefused: options.onRefused };
  const tokens = md.parse(markdown ?? '', env);
  const breaks = options.breaks ?? true;
  const root: MarkdownDoc = { type: 'doc', content: [] };
  const stack: MarkdownNode[] = [root];
  /** Whether each open list has met a paragraph yet (markdown-it marks a tight list's paragraphs hidden). */
  const seen = new WeakSet<MarkdownNode>();
  const top = () => stack.at(-1)!;
  const add = (node: MarkdownNode) => { (top().content ??= []).push(node); };
  const enter = (node: MarkdownNode) => { add(node); stack.push(node); };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    switch (token.type) {
      case 'paragraph_open': {
        const item = top(), list = stack.at(-2);
        if ((item.type === 'listItem' || item.type === 'taskItem') && list && !seen.has(list)) { seen.add(list); list.attrs!.tight = !!token.hidden; }
        add(textblock('paragraph', inline(tokens[i + 1]!.children ?? [], { breaks, heading: false, cell: false })));
        i += 2;
        break;
      }
      case 'heading_open':
        add(textblock('heading', inline(tokens[i + 1]!.children ?? [], { breaks, heading: true, cell: false }), { level: Number(token.tag.slice(1)) }));
        i += 2;
        break;
      case 'blockquote_open': enter({ type: 'blockquote', content: [] }); break;
      case 'bullet_list_open': enter({ type: 'bulletList', attrs: { tight: true }, content: [] }); break;
      case 'ordered_list_open': enter({ type: 'orderedList', attrs: { start: Number(token.attrGet('start') ?? 1), tight: true }, content: [] }); break;
      case 'list_item_open': {
        const checked = top().type === 'bulletList' ? taskMarker(tokens, i) : null;
        enter(checked === null ? { type: 'listItem', content: [] } : { type: 'taskItem', attrs: { checked }, content: [] });
        break;
      }
      case 'list_item_close': { const item = stack.pop()!; if (!item.content!.length) item.content!.push({ type: 'paragraph' }); break; }
      case 'bullet_list_close': {
        const list = stack.pop()!, parent = top().content!;
        parent.splice(parent.length - 1, 1, ...groups(list));
        break;
      }
      case 'ordered_list_close': case 'blockquote_close': case 'table_close': case 'tr_close': stack.pop(); break;
      case 'fence': case 'code_block': {
        const language = md.utils.unescapeAll(token.info).trim().split(/\s+/)[0] || null;
        const text = token.content.replace(/\n$/, '');
        add({ type: 'codeBlock', attrs: { language }, ...(text ? { content: [{ type: 'text', text }] } : {}) });
        break;
      }
      case 'hr': add({ type: 'horizontalRule' }); break;
      case 'table_open': enter({ type: 'table', content: [] }); break;
      case 'tr_open': enter({ type: 'tableRow', content: [] }); break;
      case 'th_open': case 'td_open': {
        const align = ALIGN.exec(token.attrGet('style') ?? '')?.[1] ?? null;
        add(textblock(token.type === 'th_open' ? 'tableHeader' : 'tableCell', inline(tokens[i + 1]!.children ?? [], { breaks, heading: false, cell: true }), { align }));
        i += 2;
        break;
      }
    }
  }
  if (!root.content.length) root.content.push({ type: 'paragraph' });
  return root;
}

/**
 * Whether `written`, between `before` and `after`, reads back as exactly that text around one link to `href` whose
 * text is `text` (the serializer's check before writing a link bare or as `<href>`).
 */
export function readsAsLink(before: string, written: string, after: string, href: string, text: string): boolean {
  const env: Env = { images: false, recoverSpacedTables: false, inCell: false };
  const tokens = md.parseInline(before + written + after, env)[0]?.children ?? [];
  const open = tokens.findIndex(token => token.type === 'link_open');
  if (open < 0 || tokens.filter(token => token.type === 'link_open').length !== 1 || tokens[open]!.attrGet('href') !== href) return false;
  const close = tokens.findIndex(token => token.type === 'link_close');
  const join = (list: Token[]) => list.map(token => token.content).join('');
  const inside = tokens.slice(open + 1, close);
  return inside.every(token => token.type === 'text' || token.type === 'text_special') && join(inside) === text
    && join(tokens.slice(0, open)) === before && join(tokens.slice(close + 1)) === after
    && tokens.every(token => ['text', 'text_special', 'link_open', 'link_close'].includes(token.type));
}

/** Inline Markdown (one textblock's content) as the converter reads it, for the serializer's read-back check. */
export function inlineContent(markdown: string, context: { cell: boolean; heading: boolean; breaks: boolean; images: boolean }): MarkdownNode[] {
  const env: Env = { images: context.images, recoverSpacedTables: false, inCell: context.cell, cellMode: context.cell };
  return inline(md.parseInline(markdown, env)[0]?.children ?? [], context);
}
