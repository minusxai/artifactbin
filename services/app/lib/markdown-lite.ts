/**
 * MARKDOWN-LITE — a STRICT, owned subset of markdown for comment bodies.
 *
 * A comment body is plain TEXT on every wire (the `annotations.body` column,
 * `GET /api/artifacts/<id>`, the MCP `annotate` tool). Nothing here changes
 * that: this module is the READING half — the page parses the text it was
 * given and renders React elements from the result. The wire never carries
 * markup, so an agent keeps writing exactly what it already writes.
 *
 * Why own the parser rather than take a dependency: the corpus is small
 * (paragraphs, emphasis, code, lists, quotes, links), and every real markdown
 * library admits raw HTML — which would drag a sanitizer in behind it, on the
 * app's own origin, over text an AGENT wrote. Refusing HTML at the PARSER is
 * one rule with nothing to configure: `<` is a character, never a tag, and
 * the renderer emits elements only (no `dangerouslySetInnerHTML` anywhere).
 *
 * Three rules the subset lives by:
 *   · NO raw HTML, no images, no headings, no tables — anything unrecognised
 *     is text, so an unclosed construct degrades to what was typed.
 *   · A LINK is `http:`, `https:` or `mailto:` and nothing else. Any other
 *     scheme renders as the literal source it was written as, so a
 *     `javascript:` URL is visible rather than clickable.
 *   · BOUNDED. Linear in the input: a delimiter search that fails caches its
 *     failure (there is no closer later if there is none now), so a body of
 *     10,000 lone asterisks costs one scan rather than ten thousand.
 *
 * Pure — no DOM, no React. `components/MarkdownLite.tsx` is the renderer;
 * `plainText` is what the COMPACT surfaces show (a preview clamped to two
 * lines must read as a sentence, not as syntax).
 */

export type MdInline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: MdInline[] }
  | { kind: 'em'; children: MdInline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: MdInline[] }
  | { kind: 'break' };

export interface MdListItem {
  /** A paragraph, and — one level deep only — a nested list under it. */
  children: MdNode[];
}

export type MdNode =
  | { kind: 'paragraph'; children: MdInline[] }
  | { kind: 'code_block'; lang: string | null; text: string }
  | { kind: 'list'; ordered: boolean; items: MdListItem[] }
  | { kind: 'quote'; children: MdNode[] };

/** The composer toolbar's five verbs; `wrapSelection` is the whole edit. */
export type MdMarker = 'bold' | 'italic' | 'code' | 'link' | 'list';

export interface MdSelection {
  text: string;
  start: number;
  end: number;
}

/** The subset's block nesting: a quote inside a quote inside a quote, no deeper. */
export const MD_MAX_DEPTH = 3;

const SCHEMES = ['http:', 'https:', 'mailto:'];
/** Everything a browser strips out of a URL before it reads the scheme. */
const URL_NOISE_RE = /[\u0000-\u0020\u007f]/g;

/**
 * Is this a URL a comment may LINK to?
 *
 * The scheme is read after control characters and whitespace are removed,
 * because a browser removes them too: `java\tscript:alert(1)` navigates, and a
 * check against the raw string would pass it straight through.
 */
export function safeHref(url: string): string | null {
  const cleaned = url.replace(URL_NOISE_RE, '');
  const lower = cleaned.toLowerCase();
  return SCHEMES.some((scheme) => lower.startsWith(scheme)) ? cleaned : null;
}

/* ── inline ──────────────────────────────────────────────────────────── */

/**
 * A failed delimiter search is FINAL: if there is no closing run after `from`,
 * there is none after any later position either. Caching that is what keeps a
 * pathological body (`'*'.repeat(10_000)`) linear instead of quadratic.
 */
class Scanner {
  private readonly exhausted = new Set<string>();

  constructor(private readonly src: string) {}

  find(needle: string, from: number): number {
    if (this.exhausted.has(needle)) return -1;
    const at = this.src.indexOf(needle, from);
    if (at === -1) this.exhausted.add(needle);
    return at;
  }
}

/** How many `ch` repeat at `at`. */
function runLength(src: string, at: number, ch: string): number {
  let n = 0;
  while (src[at + n] === ch) n += 1;
  return n;
}

function pushText(out: MdInline[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last?.kind === 'text') last.text += text;
  else out.push({ kind: 'text', text });
}

/** `[label](url)` at `at`, or null — and then `[` is just a `[`. */
function readLink(src: string, at: number, scanner: Scanner): { label: string; url: string; end: number } | null {
  const labelEnd = scanner.find(']', at + 1);
  if (labelEnd === -1 || src[labelEnd + 1] !== '(') return null;
  const urlEnd = scanner.find(')', labelEnd + 2);
  if (urlEnd === -1) return null;
  const label = src.slice(at + 1, labelEnd);
  if (label.includes('\n')) return null;
  return { label, url: src.slice(labelEnd + 2, urlEnd).trim(), end: urlEnd + 1 };
}

/**
 * Inline parse of one paragraph's worth of text. A newline is a HARD BREAK — a
 * comment is written in a textarea, where a return means a new line and
 * nothing else, so markdown's "a single newline is a space" rule would throw
 * away exactly the shape its author typed.
 */
export function parseInline(src: string): MdInline[] {
  const out: MdInline[] = [];
  const scanner = new Scanner(src);
  let plain = 0;
  let i = 0;
  const flush = (upto: number) => { pushText(out, src.slice(plain, upto)); };

  while (i < src.length) {
    const ch = src[i];

    if (ch === '\n') {
      flush(i);
      // Markdown's "two trailing spaces" break is honoured by dropping them:
      // the break is the newline itself either way.
      const last = out[out.length - 1];
      if (last?.kind === 'text') {
        last.text = last.text.replace(/[ \t]+$/, '');
        if (!last.text) out.pop();
      }
      out.push({ kind: 'break' });
      i += 1;
      plain = i;
      continue;
    }

    if (ch === '`') {
      const fence = '`'.repeat(runLength(src, i, '`'));
      const close = scanner.find(fence, i + fence.length);
      // A backtick with no partner is a backtick.
      if (close > i + fence.length) {
        flush(i);
        out.push({ kind: 'code', text: src.slice(i + fence.length, close).trim() });
        i = close + fence.length;
        plain = i;
        continue;
      }
    }

    if (ch === '*' || ch === '_') {
      const strong = ch === '*' && src.startsWith('**', i);
      const marker = strong ? '**' : ch;
      const close = scanner.find(marker, i + marker.length);
      if (close > i + marker.length) {
        const inner = src.slice(i + marker.length, close);
        // Emphasis never wraps nothing, and never opens or closes on a space.
        if (!inner.startsWith(' ') && !inner.endsWith(' ')) {
          flush(i);
          const children = parseInline(inner);
          out.push(strong ? { kind: 'strong', children } : { kind: 'em', children });
          i = close + marker.length;
          plain = i;
          continue;
        }
      }
    }

    if (ch === '[') {
      const link = readLink(src, i, scanner);
      if (link) {
        flush(i);
        const href = safeHref(link.url);
        // A refused scheme is shown AS WRITTEN — visible, never clickable.
        if (href) out.push({ kind: 'link', href, children: parseInline(link.label) });
        else pushText(out, src.slice(i, link.end));
        i = link.end;
        plain = i;
        continue;
      }
    }

    i += 1;
  }
  flush(src.length);
  return out;
}

/* ── blocks ──────────────────────────────────────────────────────────── */

const FENCE_RE = /^\s{0,3}```(.*)$/;
const FENCE_CLOSE_RE = /^\s{0,3}```\s*$/;
const QUOTE_RE = /^\s{0,3}> ?(.*)$/;
const QUOTE_MARKERS_RE = /^\s*(?:>\s?)+/gm;
const LIST_RE = /^(\s*)(?:([-*])|(\d{1,9})[.)])\s+(.*)$/;
const BLANK_RE = /^\s*$/;

const startsBlock = (line: string) =>
  BLANK_RE.test(line) || FENCE_RE.test(line) || QUOTE_RE.test(line) || LIST_RE.test(line);

const listItem = (content: string): MdListItem => ({ children: [{ kind: 'paragraph', children: parseInline(content) }] });

/**
 * One list, ONE level of nesting. An item indented past the first item's own
 * indent joins a sub-list under the item above it; anything deeper joins that
 * same sub-list rather than growing a tree the renderer has no styling for.
 */
function readList(lines: string[], from: number): { list: Extract<MdNode, { kind: 'list' }>; next: number } {
  const first = LIST_RE.exec(lines[from])!;
  const baseIndent = first[1].length;
  const ordered = first[3] !== undefined;
  const items: MdListItem[] = [];
  let i = from;

  while (i < lines.length) {
    if (BLANK_RE.test(lines[i])) {
      // One blank line inside a list is spacing; anything else ends it.
      if (i + 1 >= lines.length || !LIST_RE.test(lines[i + 1])) break;
      i += 1;
      continue;
    }
    const match = LIST_RE.exec(lines[i]);
    if (!match) break;
    const indent = match[1].length;
    const isOrdered = match[3] !== undefined;

    if (indent > baseIndent && items.length > 0) {
      const parent = items[items.length - 1];
      const nested = parent.children[1];
      if (nested?.kind === 'list') nested.items.push(listItem(match[4]));
      else parent.children.push({ kind: 'list', ordered: isOrdered, items: [listItem(match[4])] });
      i += 1;
      continue;
    }
    // A marker of the other kind starts a NEW list rather than joining this one.
    if (isOrdered !== ordered) break;
    items.push(listItem(match[4]));
    i += 1;
  }
  return { list: { kind: 'list', ordered, items }, next: i };
}

/**
 * Text → blocks. `depth` bounds quote nesting: a body of 500 `>` markers must
 * not recurse 500 frames deep, so at the cap the remaining markers are simply
 * stripped and what they held is read as prose.
 */
export function parseMarkdownLite(text: string, depth = 0): MdNode[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: MdNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (BLANK_RE.test(line)) { i += 1; continue; }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      // An UNTERMINATED fence runs to the END of the body: what was typed is
      // what is shown, rather than a fence silently becoming prose.
      while (i < lines.length && !FENCE_CLOSE_RE.test(lines[i])) { body.push(lines[i]); i += 1; }
      if (i < lines.length) i += 1;
      out.push({ kind: 'code_block', lang: fence[1].trim() || null, text: body.join('\n') });
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && !BLANK_RE.test(lines[i])) {
        const quoted = QUOTE_RE.exec(lines[i]);
        if (!quoted) break;
        inner.push(quoted[1]);
        i += 1;
      }
      const body = inner.join('\n');
      out.push(depth >= MD_MAX_DEPTH
        ? { kind: 'paragraph', children: parseInline(body.replace(QUOTE_MARKERS_RE, '')) }
        : { kind: 'quote', children: parseMarkdownLite(body, depth + 1) });
      continue;
    }

    if (LIST_RE.test(line)) {
      const read = readList(lines, i);
      out.push(read.list);
      i = read.next;
      continue;
    }

    const para: string[] = [line];
    i += 1;
    while (i < lines.length && !startsBlock(lines[i])) { para.push(lines[i]); i += 1; }
    out.push({ kind: 'paragraph', children: parseInline(para.join('\n')) });
  }
  return out;
}

/* ── the flat reading ────────────────────────────────────────────────── */

function inlineText(nodes: MdInline[]): string {
  return nodes.map((node) => {
    switch (node.kind) {
      case 'text': return node.text;
      case 'code': return node.text;
      case 'break': return '\n';
      default: return inlineText(node.children);
    }
  }).join('');
}

/**
 * The body with its markup taken off — what the COMPACT surfaces show. Two
 * clamped lines are not room for a fenced block, and a preview reading
 * "```ts" previews the syntax rather than the comment.
 */
export function plainText(nodes: MdNode[]): string {
  return nodes.map((node) => {
    switch (node.kind) {
      case 'paragraph': return inlineText(node.children);
      case 'code_block': return node.text;
      case 'quote': return plainText(node.children);
      case 'list': return node.items.map((item) => plainText(item.children)).join('\n');
    }
  }).filter(Boolean).join('\n');
}

/* ── the composer's toolbar ──────────────────────────────────────────── */

const WRAPPERS: Record<'bold' | 'italic' | 'code', string> = { bold: '**', italic: '_', code: '`' };

/**
 * Apply one toolbar verb at the caret, answering the text AND the selection to
 * restore — React re-renders a controlled textarea from scratch, so the caret
 * has to be put back deliberately or every press sends it to the end.
 *
 * Wrapping is a TOGGLE: a second press on already-bold words unwraps them,
 * which is what anyone who has pressed the button twice expects.
 */
export function wrapSelection(text: string, start: number, end: number, marker: MdMarker): MdSelection {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  const selected = text.slice(from, to);

  if (marker === 'link') {
    const label = selected || 'text';
    const urlAt = from + label.length + 3;
    return { text: `${text.slice(0, from)}[${label}](url)${text.slice(to)}`, start: urlAt, end: urlAt + 3 };
  }

  if (marker === 'list') {
    // A list is a LINE verb: it starts at the beginning of the caret's own
    // line and marks every line the selection touches.
    const lineStart = text.lastIndexOf('\n', from - 1) + 1;
    const nextBreak = text.indexOf('\n', to);
    const lineEnd = nextBreak === -1 ? text.length : nextBreak;
    const marked = text.slice(lineStart, lineEnd).split('\n')
      .map((line) => (line.startsWith('- ') ? line : `- ${line}`))
      .join('\n');
    return { text: `${text.slice(0, lineStart)}${marked}${text.slice(lineEnd)}`, start: lineStart, end: lineStart + marked.length };
  }

  const wrap = WRAPPERS[marker];
  const before = text.slice(0, from);
  const after = text.slice(to);
  if (before.endsWith(wrap) && after.startsWith(wrap)) {
    return {
      text: `${before.slice(0, before.length - wrap.length)}${selected}${after.slice(wrap.length)}`,
      start: from - wrap.length,
      end: to - wrap.length,
    };
  }
  return { text: `${before}${wrap}${selected}${wrap}${after}`, start: from + wrap.length, end: to + wrap.length };
}
