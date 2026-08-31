/**
 * The pure conflict kernel for concurrent artifact edits (see
 * ~/projects/concurrent-artifacts-edits.md).
 *
 * Every edit is a SPLICE — replace `[start, start+removed.length)` of the base
 * text with `inserted` — and conflicts are decided by SOURCE SPANS, not node
 * identity: an edit's "touched span" expands each splice endpoint to the
 * innermost node it falls STRICTLY inside (boundary positions stay put), so
 *   - typing inside a paragraph touches the whole paragraph (same-node edits
 *     are related even at disjoint character ranges),
 *   - inserting a sibling at a child gap touches a zero-width point (never
 *     related to the siblings around it),
 *   - deleting or moving a node covers its whole span (related to anything
 *     inside it — ancestry is automatic because parent spans contain
 *     children's).
 * Two edits are UNRELATED (both apply) iff their touched spans don't overlap;
 * offsets just shift. Related → the later-arriving edit is rejected.
 *
 * Everything here is pure (no DB, no DOM): the module is the unit-testable
 * truth for splice derivation, span expansion, offset shifting, and base-
 * version reconstruction. Offsets are UTF-16 code-unit indexes (plain JS
 * string coordinates) into the STORED source, which is canonical serialize
 * form — see publishJsx — so parser spans index into it exactly.
 */
import { randomBytes } from 'crypto';
import { parseJsx, type JsxNode } from '@/lib/jsx';

/** Replace `[start, start+removed.length)` with `inserted`, in base-version coords. */
export interface Splice {
  start: number;
  /** Exact text removed — '' for a pure insertion. Lengths derive; texts make the log invertible. */
  removed: string;
  /** Exact text inserted — '' for a pure deletion. */
  inserted: string;
}

/** Half-open `[start, end)`; zero-width (start === end) for gap insertions. */
export interface TouchedSpan {
  start: number;
  end: number;
}

/** One accepted edit as logged — splice and span in the coords of ITS base version. */
export interface EditRecord {
  seq: number;
  editId: string;
  splice: Splice;
  span: TouchedSpan;
}

export type DeriveResult =
  | { ok: true; splice: Splice }
  | { ok: false; reason: 'no_match' | 'multiple_matches' | 'identical' };

/**
 * Agent diff → splice: `oldString` must match `base` exactly once (the Edit
 * tool contract agents already know). `identical` when old === new.
 */
export function deriveSpliceFromStrings(base: string, oldString: string, newString: string): DeriveResult {
  if (oldString === newString) return { ok: false, reason: 'identical' };
  // An empty anchor matches at every position — it names no node, so it is
  // ambiguous rather than absent.
  if (oldString === '') return { ok: false, reason: 'multiple_matches' };
  const start = base.indexOf(oldString);
  if (start === -1) return { ok: false, reason: 'no_match' };
  if (base.indexOf(oldString, start + 1) !== -1) return { ok: false, reason: 'multiple_matches' };
  return { ok: true, splice: { start, removed: oldString, inserted: newString } };
}

const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/**
 * Editor whole-doc submission → minimal splice via common prefix/suffix.
 * Null when `next` === `base`. Sound because stored source is canonical
 * (serialize∘parse is a fixpoint), so untouched regions are byte-identical.
 */
export function deriveSpliceByDiff(base: string, next: string): Splice | null {
  if (base === next) return null;
  const max = Math.min(base.length, next.length);

  let prefix = 0;
  while (prefix < max && base[prefix] === next[prefix]) prefix++;
  // Never cut a surrogate pair in half: a lone surrogate is not valid UTF-8 and
  // cannot round-trip through Postgres TEXT.
  if (prefix > 0 && prefix < max && isLowSurrogate(next.charCodeAt(prefix))) prefix--;

  let suffix = 0;
  while (
    suffix < max - prefix &&
    base[base.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) suffix++;
  if (suffix > 0 && isHighSurrogate(next.charCodeAt(next.length - suffix))) suffix--;

  return {
    start: prefix,
    removed: base.slice(prefix, base.length - suffix),
    inserted: next.slice(prefix, next.length - suffix),
  };
}

/**
 * The innermost node strictly containing `pos`, expanded per the rules above.
 * Null when no node contains it (document edges) — the caller keeps the point.
 */
function expandPoint(nodes: JsxNode[], pos: number): TouchedSpan | null {
  for (const node of nodes) {
    if (!(node.start < pos && pos < node.end)) continue;
    if (node.type !== 'element') return { start: node.start, end: node.end };

    const inner = expandPoint(node.children, pos);
    if (inner) return inner;
    // Inside the element but not inside any child. Between children (or at a
    // child boundary) it is a gap insertion — a zero-width touch that conflicts
    // with nothing. Anywhere else is the element's own tag markup/attributes,
    // which we treat as touching the whole element.
    if (node.children.length > 0) {
      const first = node.children[0].start;
      const last = node.children[node.children.length - 1].end;
      if (first <= pos && pos <= last) return { start: pos, end: pos };
    }
    return { start: node.start, end: node.end };
  }
  return null;
}

/** Span computation against an already-parsed tree (the slide search reuses one parse). */
function spanIn(nodes: JsxNode[], splice: Splice): TouchedSpan {
  const spliceEnd = splice.start + splice.removed.length;
  const head = expandPoint(nodes, splice.start);
  const tail = spliceEnd === splice.start ? head : expandPoint(nodes, spliceEnd);

  let start = splice.start;
  let end = spliceEnd;
  for (const s of [head, tail]) {
    if (!s) continue;
    start = Math.min(start, s.start);
    end = Math.max(end, s.end);
  }
  return { start, end };
}

/**
 * Expand a splice to its touched span against `source` (which must be the
 * splice's own base version). Per endpoint, innermost-first:
 *   - strictly inside a text/expression node → that node's span (two people
 *     typing anywhere in the same paragraph text are related);
 *   - strictly inside an element but NOT within its child region (i.e. in its
 *     tag markup/attributes) → the element's whole span (attribute edits are
 *     related to everything inside the element — conservative);
 *   - at a child gap or node boundary → stays put (inserting a sibling is a
 *     zero-width touch, unrelated to the siblings around it).
 * The result is the union of both expansions with the raw splice range.
 * Unparseable source (never true for stored markup) fails closed to the whole
 * document.
 */
export function touchedSpanFor(source: string, splice: Splice): TouchedSpan {
  const parsed = parseJsx(source);
  if (!parsed.ok) return { start: 0, end: source.length };
  return spanIn(parsed.nodes, splice);
}

/**
 * How far the slide search walks in each direction. Markup only needs a few
 * characters; the cap stops a pathological document (long runs of one
 * character) from turning normalization into a scan of the whole source.
 */
const MAX_SLIDE = 256;

/** The same edit expressed one character to the left, or null if that isn't equivalent. */
function slideLeft(source: string, s: Splice): Splice | null {
  if (s.start === 0) return null;
  const combined = source[s.start - 1] + s.inserted;
  return {
    start: s.start - 1,
    removed: source.slice(s.start - 1, s.start - 1 + s.removed.length),
    inserted: combined.slice(0, s.inserted.length),
  };
}

/** The same edit expressed one character to the right, or null if that isn't equivalent. */
function slideRight(source: string, s: Splice): Splice | null {
  const after = s.start + s.removed.length;
  if (after >= source.length) return null;
  const combined = s.inserted + source[after];
  return {
    start: s.start + 1,
    removed: source.slice(s.start + 1, s.start + 1 + s.removed.length),
    inserted: combined.slice(1),
  };
}

/**
 * Pick the best-placed member of a splice's equivalence class.
 *
 * A prefix/suffix diff is minimal in length but arbitrary in POSITION: with
 * markup's repeated characters, inserting `<p>x</p>` between two paragraphs is
 * just as validly expressed as inserting `p>x</p><` one character later —
 * which lands inside a closing tag and therefore expands to the whole
 * enclosing element. That would make almost every whole-document edit (i.e.
 * every editor flush) conflict with everything, defeating the point of
 * node-scoped concurrency.
 *
 * So slide the splice through every equivalent position and keep the one with
 * the narrowest touched span — for the example above, the child gap, whose
 * span is zero-width and conflicts with nothing. Candidates are accepted only
 * when they reproduce the identical document, so this can never change what
 * the edit means.
 */
export function normalizeSplice(source: string, splice: Splice): Splice {
  const parsed = parseJsx(source);
  if (!parsed.ok) return splice;

  const target = applySplice(source, splice);
  const width = (s: Splice) => {
    const span = spanIn(parsed.nodes, s);
    return span.end - span.start;
  };

  let best = splice;
  let bestWidth = width(splice);
  for (const slide of [slideLeft, slideRight]) {
    let current = splice;
    for (let step = 0; step < MAX_SLIDE; step++) {
      const next = slide(source, current);
      // Equivalence is verified, not assumed: a candidate that would alter the
      // document is not a rewording of this edit.
      if (!next || applySplice(source, next) !== target) break;
      const w = width(next);
      if (w < bestWidth) { best = next; bestWidth = w; }
      current = next;
    }
  }
  return best;
}

/** `[s1,e1)` and `[s2,e2)` overlap — strict, so zero-width spans at a shared boundary do NOT. */
export function spansOverlap(a: TouchedSpan, b: TouchedSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

export function applySplice(text: string, splice: Splice): string {
  return text.slice(0, splice.start) + splice.inserted + text.slice(splice.start + splice.removed.length);
}

export type ShiftResult =
  | { ok: true; splice: Splice; span: TouchedSpan }
  | { ok: false; conflictWith: EditRecord };

/**
 * Walk the intervening edits (oldest→newest, each recorded in its own base
 * coords — which is exactly the frame the incoming edit is in when compared)
 * shifting the incoming splice+span past each: overlap → related → conflict;
 * disjoint-and-before → shift by `inserted.length - removed.length`;
 * disjoint-and-after → untouched. On success the result is in head coords.
 */
export function shiftThroughEdits(
  incoming: { splice: Splice; span: TouchedSpan },
  intervening: EditRecord[],
): ShiftResult {
  let { start, removed, inserted } = incoming.splice;
  let span = { ...incoming.span };

  for (const edit of intervening) {
    if (spansOverlap(span, edit.span)) return { ok: false, conflictWith: edit };
    // Disjoint: the edit is wholly before us (shift) or wholly after (ignore).
    const editEnd = edit.splice.start + edit.splice.removed.length;
    if (editEnd <= start) {
      const delta = edit.splice.inserted.length - edit.splice.removed.length;
      start += delta;
      span = { start: span.start + delta, end: span.end + delta };
    }
  }
  return { ok: true, splice: { start, removed, inserted }, span };
}

/**
 * Rebuild the base version's source from head by inverse-applying the
 * intervening edits newest-first (replace `[start, start+inserted.length)`
 * with `removed`).
 */
export function reconstructBaseSource(head: string, intervening: EditRecord[]): string {
  let source = head;
  for (let i = intervening.length - 1; i >= 0; i--) {
    const { splice } = intervening[i];
    source =
      source.slice(0, splice.start) + splice.removed + source.slice(splice.start + splice.inserted.length);
  }
  return source;
}

/** Unguessable 128-bit edit id — a read-proof, not a sequence number. */
export function newEditId(): string {
  return randomBytes(16).toString('hex');
}
