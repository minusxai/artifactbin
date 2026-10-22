/** Reading subset adapted from the frozen legacy comment parser at 8eaac6381.
 * Composer commands and framework dependencies are deliberately absent.
 * Text is always data; no HTML parsing, image loading or remote lookup.
 */
import type { MdInline, MdNode, MdListItem } from "./markdown-contracts.ts";
import { MAX_COMMENT_BODY_CHARACTERS } from "./presentation-contracts.ts";
export const isPersonMentionHref = (href: string): boolean =>
  /^\/people\/[A-Za-z0-9_-]{1,128}$/.test(href);
const isSessionMentionHref = (href: string): boolean =>
  /^\/chat\?session=(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-f0-9]{64})$/.test(
    href,
  );
/** The subset's block nesting: a quote inside a quote inside a quote, no deeper. */
const MD_MAX_DEPTH = 3;

const SCHEMES = ["http:", "https:"];
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
  // Session mentions are the one supported relative link; never admit protocol-relative URLs.
  if (isSessionMentionHref(url) || isPersonMentionHref(url)) return url;
  const cleaned = url.replace(URL_NOISE_RE, "");
  const lower = cleaned.toLowerCase();
  if (lower.startsWith("mailto:")) {
    // A single mailbox only: no headers, control escapes or navigation-capable schemes.
    const address = cleaned.slice(7);
    return /^[^@\s<>?%]+@[^@\s<>?%]+$/.test(address) ? cleaned : null;
  }
  if (!SCHEMES.some((scheme) => lower.startsWith(scheme))) return null;
  try {
    const parsed = new URL(cleaned);
    return parsed.hostname ? cleaned : null;
  } catch {
    return null;
  }
}

/* ── inline ──────────────────────────────────────────────────────────── */

/**
 * A failed delimiter search is FINAL: if there is no closing run after `from`,
 * there is none after any later position either. Caching that is what keeps a
 * pathological body (`'*'.repeat(10_000)`) linear instead of quadratic.
 *
 * SOUND ONLY BECAUSE `from` NEVER GOES BACKWARDS. `parseInline` is the only
 * caller and its `i` only grows, so "not found after `from`" stays true for
 * every later query. A backward search through the same Scanner would get a
 * silently wrong -1 — if one is ever wanted, it needs its own instance.
 *
 * The BACKTICK delimiter is deliberately NOT served here: its needle is a run
 * of n backticks whose length differs at every position inside a run, so a
 * cache keyed by the needle can never hit. See `backtickClosers`.
 */
function escapedAt(text: string, at: number): boolean {
  let slashes = 0;
  while (at > 0 && text[--at] === "\\") slashes++;
  return slashes % 2 === 1;
}

class Scanner {
  private readonly exhausted = new Set<string>();

  private readonly src: string;
  constructor(src: string) {
    this.src = src;
  }

  find(needle: string, from: number): number {
    if (this.exhausted.has(needle)) return -1;
    let at = this.src.indexOf(needle, from);
    while (at >= 0 && escapedAt(this.src, at))
      at = this.src.indexOf(needle, at + needle.length);
    if (at === -1) this.exhausted.add(needle);
    return at;
  }
}

const EMPTY_CLOSERS = new Int32Array(0);

/**
 * EVERY BACKTICK RUN IN THE SOURCE, and the longest one at or after each.
 *
 * Built once, lazily — a paragraph with no backtick in it never pays for this.
 * `longestAfter` is what makes the closer search bounded rather than merely
 * faster: it says, before any scanning, the longest fence that COULD still
 * close, so a run asking for a longer one is answered -1 immediately and a run
 * asking for a shorter one stops the moment it meets a run that long.
 * Without it, a body of runs with strictly decreasing lengths made every run
 * scan the whole remainder (measured: 22 ms at 113 KB, 170 ms at 452 KB).
 */
interface BacktickRuns {
  start: Int32Array;
  end: Int32Array;
  /** The longest run at index r or later — 0 past the last run. */
  longestAfter: Int32Array;
  count: number;
}

function indexBacktickRuns(src: string): BacktickRuns {
  const start: number[] = [];
  const end: number[] = [];
  for (let j = 0; j < src.length; j += 1) {
    if (src[j]! !== "`") continue;
    const from = j;
    while (j < src.length && src[j]! === "`") j += 1;
    start.push(from);
    end.push(j);
  }
  const count = start.length;
  const longestAfter = new Int32Array(count + 1);
  for (let r = count - 1; r >= 0; r -= 1)
    longestAfter[r]! = Math.max(longestAfter[r + 1]!, end[r]! - start[r]!);
  return {
    start: Int32Array.from(start),
    end: Int32Array.from(end),
    longestAfter,
    count,
  };
}

/**
 * WHERE EVERY LENGTH OF FENCE CLOSES, for ONE backtick run, in one pass.
 *
 * A run of n backticks asks n questions — the fence at its first position is n
 * long, at its second n-1, and so on down to 1 — and every one of them searches
 * from the SAME place: just past the run. Answering them one at a time is
 * quadratic: it rebuilds an n, n-1, n-2 … character needle at every position (a
 * 3,000-backtick run constructs 4.5 million characters and retains them all in
 * the Scanner's cache), then re-scans for each.
 *
 * So the run is measured ONCE and answered as a table: `closers[len]!` is the
 * first index at or after the run holding `len` consecutive backticks, or -1.
 * The walk fills every length each following run can serve and stops at the
 * longest one still reachable — a closing run of that many backticks answers
 * every shorter question too, since they all start where it does.
 *
 * The table is why the run may NOT simply be skipped when its full fence finds
 * nothing: a shorter fence inside it can still close (`` ``x` `` is a literal
 * backtick followed by `<code>x</code>`), and skipping would produce a
 * different tree. Same answers as the character-by-character search, one pass.
 *
 * `r0` is the first run after this one — the caller advances it monotonically,
 * so finding it costs nothing. A run's own `from` is never inside another run
 * (it is the character after a maximal run), so every candidate is whole.
 */
function backtickClosers(
  runs: BacktickRuns,
  r0: number,
  maxLen: number,
): Int32Array {
  const closers = new Int32Array(maxLen + 1).fill(-1);
  const cap = Math.min(maxLen, runs.longestAfter[Math.min(r0, runs.count)]!!);
  let filled = 0;
  for (let r = r0; r < runs.count && filled < cap; r += 1) {
    const reach = Math.min(runs.end[r]! - runs.start[r]!, cap);
    // Only the lengths nobody has answered yet: an earlier run is closer.
    for (let len = filled + 1; len <= reach; len += 1)
      closers[len]! = runs.start[r]!;
    if (reach > filled) filled = reach;
  }
  return closers;
}

function pushText(out: MdInline[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last?.kind === "text") last.text += text;
  else out.push({ kind: "text", text });
}

/** `[label](url)` at `at`, or null — and then `[` is just a `[`. */
function readLink(
  src: string,
  at: number,
  scanner: Scanner,
): { label: string; url: string; end: number } | null {
  const labelEnd = scanner.find("]", at + 1);
  if (labelEnd === -1 || src[labelEnd + 1]! !== "(") return null;
  const urlEnd = scanner.find(")", labelEnd + 2);
  if (urlEnd === -1) return null;
  const label = src.slice(at + 1, labelEnd);
  if (label.includes("\n")) return null;
  return {
    label,
    url: src.slice(labelEnd + 2, urlEnd).trim(),
    end: urlEnd + 1,
  };
}

/**
 * Inline parse of one paragraph's worth of text. A newline is a HARD BREAK — a
 * comment is written in a textarea, where a return means a new line and
 * nothing else, so markdown's "a single newline is a space" rule would throw
 * away exactly the shape its author typed.
 */
export function parseInline(src: string, depth = 0): MdInline[] {
  if (src.length > MAX_COMMENT_BODY_CHARACTERS || depth >= MD_MAX_DEPTH)
    return [{ kind: "text", text: src }];
  const out: MdInline[] = [];
  const scanner = new Scanner(src);
  let plain = 0;
  let i = 0;
  const flush = (upto: number) => {
    pushText(out, src.slice(plain, upto));
  };
  // The backtick run `i` is currently inside, measured once on entry. `i` only
  // grows, so `i >= runEnd` is exactly "this is a run we have not measured";
  // `nextRun` walks the run index forward and never back.
  let runs: BacktickRuns | null = null;
  let nextRun = 0;
  let runEnd = -1;
  let closers: Int32Array = EMPTY_CLOSERS;

  while (i < src.length) {
    const ch = src[i]!;

    if (
      ch === "\\" &&
      i + 1 < src.length &&
      /[\\`*_\[\]()>.+#-]/.test(src[i + 1]!)
    ) {
      flush(i);
      pushText(out, src[i + 1]!);
      i += 2;
      plain = i;
      continue;
    }

    if (ch === "\n") {
      flush(i);
      // Markdown's "two trailing spaces" break is honoured by dropping them:
      // the break is the newline itself either way.
      const last = out[out.length - 1];
      if (last?.kind === "text") {
        last.text = last.text.replace(/[ \t]+$/, "");
        if (!last.text) out.pop();
      }
      out.push({ kind: "break" });
      i += 1;
      plain = i;
      continue;
    }

    if (ch === "`") {
      if (i >= runEnd) {
        runs ??= indexBacktickRuns(src);
        while (nextRun < runs.count && runs.end[nextRun]! <= i) nextRun += 1;
        runEnd = runs.end[nextRun]!;
        closers = backtickClosers(runs, nextRun + 1, runEnd - i);
      }
      // O(1) here, always: the fence is `runEnd - i` backticks and the table
      // already knows where one of that length is. No needle is built.
      const len = runEnd - i;
      const close = closers[len]!;
      // A backtick with no partner is a backtick.
      if (close > runEnd) {
        flush(i);
        out.push({ kind: "code", text: src.slice(runEnd, close).trim() });
        i = close + len;
        plain = i;
        continue;
      }
    }

    if (ch === "*" || ch === "_") {
      const strong = ch === "*" && src.startsWith("**", i);
      const marker = strong ? "**" : ch;
      const close = scanner.find(marker, i + marker.length);
      if (close > i + marker.length) {
        const inner = src.slice(i + marker.length, close);
        // Emphasis never wraps nothing, and never opens or closes on a space.
        if (!inner.startsWith(" ") && !inner.endsWith(" ")) {
          flush(i);
          const children = parseInline(inner, depth + 1);
          out.push(
            strong ? { kind: "strong", children } : { kind: "em", children },
          );
          i = close + marker.length;
          plain = i;
          continue;
        }
      }
    }

    if (ch === "[") {
      const link = readLink(src, i, scanner);
      if (link) {
        flush(i);
        const href = safeHref(link.url);
        // A refused scheme is shown AS WRITTEN — visible, never clickable.
        if (href)
          out.push({
            kind: "link",
            href,
            children: parseInline(link.label, depth + 1),
          });
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

const HEADING_RE = /^\s{0,3}(#{1,6})(?:[ \t]+(.*)|$)$/;
const FENCE_RE = /^\s{0,3}```(.*)$/;
const FENCE_CLOSE_RE = /^\s{0,3}```\s*$/;
const QUOTE_RE = /^\s{0,3}> ?(.*)$/;
const QUOTE_MARKERS_RE = /^\s*(?:>\s?)+/gm;
const LIST_RE = /^(\s*)(?:([-*])|(\d{1,9})[.)])\s+(.*)$/;
const BLANK_RE = /^\s*$/;

const startsBlock = (line: string) =>
  BLANK_RE.test(line) ||
  HEADING_RE.test(line) ||
  FENCE_RE.test(line) ||
  QUOTE_RE.test(line) ||
  LIST_RE.test(line);

const listItem = (content: string): MdListItem => ({
  children: [{ kind: "paragraph", children: parseInline(content) }],
});

/**
 * One list, ONE level of nesting. An item indented past the first item's own
 * indent joins a sub-list under the item above it; anything deeper joins that
 * same sub-list rather than growing a tree the renderer has no styling for.
 */
function readList(
  lines: string[],
  from: number,
): { list: Extract<MdNode, { kind: "list" }>; next: number } {
  const first = LIST_RE.exec(lines[from]!)!;
  const baseIndent = first[1]!.length;
  const ordered = first[3] !== undefined;
  const items: MdListItem[] = [];
  let i = from;

  while (i < lines.length) {
    if (BLANK_RE.test(lines[i]!)) {
      // One blank line inside a list is spacing; anything else ends it.
      if (i + 1 >= lines.length || !LIST_RE.test(lines[i + 1]!)) break;
      i += 1;
      continue;
    }
    const match = LIST_RE.exec(lines[i]!);
    if (!match) break;
    const indent = match[1]!.length;
    const isOrdered = match[3] !== undefined;

    if (indent > baseIndent && items.length > 0) {
      const parent = items[items.length - 1]!;
      const nested = parent.children[1];
      if (nested?.kind === "list") nested.items.push(listItem(match[4]!));
      else
        parent.children.push({
          kind: "list",
          ordered: isOrdered,
          items: [listItem(match[4]!)],
        });
      i += 1;
      continue;
    }
    // A marker of the other kind starts a NEW list rather than joining this one.
    if (isOrdered !== ordered) break;
    items.push(listItem(match[4]!));
    i += 1;
  }
  return { list: { kind: "list", ordered, items }, next: i };
}

/**
 * Text → blocks. `depth` bounds quote nesting: a body of 500 `>` markers must
 * not recurse 500 frames deep, so at the cap the remaining markers are simply
 * stripped and what they held is read as prose.
 */
export function parseMarkdownLite(text: string, depth = 0): MdNode[] {
  if (text.length > MAX_COMMENT_BODY_CHARACTERS)
    return [{ kind: "paragraph", children: [{ kind: "text", text }] }];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: MdNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (BLANK_RE.test(line)) {
      i += 1;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      out.push({
        kind: "heading",
        level: heading[1]!.length,
        children: parseInline(
          (heading[2] ?? "").replace(/[ \t]+#+[ \t]*$/, ""),
        ),
      });
      i += 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      // An UNTERMINATED fence runs to the END of the body: what was typed is
      // what is shown, rather than a fence silently becoming prose.
      while (i < lines.length && !FENCE_CLOSE_RE.test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) i += 1;
      out.push({
        kind: "code_block",
        lang: fence[1]!.trim() || null,
        text: body.join("\n"),
      });
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && !BLANK_RE.test(lines[i]!)) {
        const quoted = QUOTE_RE.exec(lines[i]!);
        if (!quoted) break;
        inner.push(quoted[1]!);
        i += 1;
      }
      const body = inner.join("\n");
      out.push(
        depth >= MD_MAX_DEPTH
          ? {
              kind: "paragraph",
              children: parseInline(body.replace(QUOTE_MARKERS_RE, "")),
            }
          : { kind: "quote", children: parseMarkdownLite(body, depth + 1) },
      );
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
    while (i < lines.length && !startsBlock(lines[i]!)) {
      para.push(lines[i]!);
      i += 1;
    }
    out.push({ kind: "paragraph", children: parseInline(para.join("\n")) });
  }
  return out;
}

/* ── the flat reading ────────────────────────────────────────────────── */

function inlineText(nodes: MdInline[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "text":
          return node.text;
        case "code":
          return node.text;
        case "break":
          return "\n";
        default:
          return inlineText(node.children);
      }
    })
    .join("");
}

/**
 * The body with its markup taken off — what the COMPACT surfaces show. Two
 * clamped lines are not room for a fenced block, and a preview reading
 * "```ts" previews the syntax rather than the comment.
 */
export function plainText(nodes: MdNode[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "heading":
        case "paragraph":
          return inlineText(node.children);
        case "code_block":
          return node.text;
        case "quote":
          return plainText(node.children);
        case "list":
          return node.items.map((item) => plainText(item.children)).join("\n");
      }
    })
    .filter(Boolean)
    .join("\n");
}
