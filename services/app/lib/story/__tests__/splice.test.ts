/**
 * The pure conflict kernel, exhaustively: splice derivation (both doors),
 * span expansion semantics, overlap, shifting across coordinate frames, and
 * base reconstruction. Offsets are computed from the fixture, never hardcoded,
 * and the fixture is asserted canonical (serialize∘parse fixpoint) first —
 * the same invariant publish enforces on stored source.
 */
import { describe, expect, it } from 'vitest';
import { parseJsx, serializeJsx } from '@/lib/jsx';
import {
  applySplice,
  deriveSpliceByDiff,
  deriveSpliceFromStrings,
  newEditId,
  normalizeSplice,
  reconstructBaseSource,
  shiftThroughEdits,
  spansOverlap,
  touchedSpanFor,
  type EditRecord,
  type Splice,
} from '@/lib/story/splice';

const DOC =
  '<section className="wrap"><p>alpha text</p><p>beta text</p><div><span>gamma</span></div></section>';

const at = (needle: string) => {
  const i = DOC.indexOf(needle);
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
};

const record = (seq: number, splice: Splice, span: { start: number; end: number }): EditRecord => ({
  seq,
  editId: `e${seq}`,
  splice,
  span,
});

it('fixture is canonical (serialize∘parse fixpoint) — the stored-source invariant', () => {
  const p = parseJsx(DOC);
  expect(p.ok).toBe(true);
  if (p.ok) expect(serializeJsx(p.nodes)).toBe(DOC);
});

describe('deriveSpliceFromStrings', () => {
  it('unique match → exact splice', () => {
    const r = deriveSpliceFromStrings(DOC, 'alpha text', 'ALPHA TEXT');
    expect(r).toEqual({ ok: true, splice: { start: at('alpha text'), removed: 'alpha text', inserted: 'ALPHA TEXT' } });
  });

  it('zero matches → no_match', () => {
    expect(deriveSpliceFromStrings(DOC, 'delta', 'x')).toEqual({ ok: false, reason: 'no_match' });
  });

  it('multiple matches → multiple_matches (" text" appears twice)', () => {
    expect(deriveSpliceFromStrings(DOC, ' text', 'x')).toEqual({ ok: false, reason: 'multiple_matches' });
  });

  it('empty old_string anchors nowhere → multiple_matches', () => {
    expect(deriveSpliceFromStrings(DOC, '', 'x')).toEqual({ ok: false, reason: 'multiple_matches' });
  });

  it('old === new → identical', () => {
    expect(deriveSpliceFromStrings(DOC, 'alpha', 'alpha')).toEqual({ ok: false, reason: 'identical' });
  });

  it('empty new_string → a pure deletion splice', () => {
    const r = deriveSpliceFromStrings(DOC, '<p>beta text</p>', '');
    expect(r).toEqual({ ok: true, splice: { start: at('<p>beta'), removed: '<p>beta text</p>', inserted: '' } });
  });
});

describe('deriveSpliceByDiff', () => {
  it('identical → null', () => {
    expect(deriveSpliceByDiff(DOC, DOC)).toBeNull();
  });

  it('mid-doc replacement → minimal splice', () => {
    const next = DOC.replace('beta', 'BETA');
    expect(deriveSpliceByDiff(DOC, next)).toEqual({ start: at('beta'), removed: 'beta', inserted: 'BETA' });
  });

  // A prefix/suffix diff is minimal in LENGTH but not unique in position: with
  // repeated markup around the change ("<p>"), an equivalent splice can sit a
  // few chars over. Pin the semantics — empty side, minimal length, exact
  // round-trip — not one arbitrary representation.
  it('pure insertion → removed is empty, inserted is exactly the added length', () => {
    const gap = at('<p>beta');
    const next = DOC.slice(0, gap) + '<p>new</p>' + DOC.slice(gap);
    const s = deriveSpliceByDiff(DOC, next);
    expect(s).not.toBeNull();
    expect(s!.removed).toBe('');
    expect(s!.inserted).toHaveLength('<p>new</p>'.length);
    expect(applySplice(DOC, s!)).toBe(next);
  });

  it('pure deletion → inserted is empty, removed is exactly the cut length', () => {
    const next = DOC.replace('<p>beta text</p>', '');
    const s = deriveSpliceByDiff(DOC, next);
    expect(s).not.toBeNull();
    expect(s!.inserted).toBe('');
    expect(s!.removed).toHaveLength('<p>beta text</p>'.length);
    expect(applySplice(DOC, s!)).toBe(next);
  });

  it('change at the very start and very end', () => {
    expect(deriveSpliceByDiff('abc', 'Xbc')).toEqual({ start: 0, removed: 'a', inserted: 'X' });
    expect(deriveSpliceByDiff('abc', 'abX')).toEqual({ start: 2, removed: 'c', inserted: 'X' });
  });

  it('prefix/suffix overlap does not double-count ("aa" → "a")', () => {
    const s = deriveSpliceByDiff('aa', 'a');
    expect(s).not.toBeNull();
    expect(applySplice('aa', s!)).toBe('a');
    expect(s!.removed.length - s!.inserted.length).toBe(1);
  });

  it('never splits a surrogate pair (lone surrogates are unstorable in Postgres TEXT)', () => {
    // Both strings end with an astral char; a naive suffix scan would match the
    // shared trailing low surrogate and cut the pair in half.
    const s = deriveSpliceByDiff('<p>🚀</p>', '<p>🎉</p>');
    expect(s).not.toBeNull();
    for (const text of [s!.removed, s!.inserted]) {
      expect(text).toBe(Array.from(text).join('')); // no lone surrogates survive iteration
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)).toBe(false);
    }
    expect(applySplice('<p>🚀</p>', s!)).toBe('<p>🎉</p>');
  });

  it('round-trips any sample: applySplice(base, diff) === next', () => {
    const cases: Array<[string, string]> = [
      [DOC, DOC.replace('gamma', 'γ🚀mma')],
      ['<p>a 🚀 rocket</p>', '<p>a 🚀 ship</p>'],
      ['abc', ''],
      ['', 'abc'],
    ];
    for (const [base, next] of cases) {
      const s = deriveSpliceByDiff(base, next);
      expect(s === null ? base : applySplice(base, s)).toBe(next);
    }
  });
});

describe('touchedSpanFor — endpoint expansion semantics', () => {
  it('edit strictly inside paragraph text → the whole text node span', () => {
    const s: Splice = { start: at('alpha'), removed: 'alpha', inserted: 'ALPHA' };
    expect(touchedSpanFor(DOC, s)).toEqual({ start: at('alpha text'), end: at('alpha text') + 'alpha text'.length });
  });

  it('zero-width insertion strictly inside text → the whole text node span', () => {
    const s: Splice = { start: at('alpha text') + 2, removed: '', inserted: 'X' };
    expect(touchedSpanFor(DOC, s)).toEqual({ start: at('alpha text'), end: at('alpha text') + 'alpha text'.length });
  });

  it('attribute edit → the whole element span (conservative: related to its subtree)', () => {
    const s: Splice = { start: at('wrap'), removed: 'wrap', inserted: 'wide' };
    expect(touchedSpanFor(DOC, s)).toEqual({ start: 0, end: DOC.length });
  });

  it('sibling-gap insertion → zero-width span, NOT the parent', () => {
    const gap = at('<p>beta');
    const s: Splice = { start: gap, removed: '', inserted: '<p>new</p>' };
    expect(touchedSpanFor(DOC, s)).toEqual({ start: gap, end: gap });
  });

  it('insertion before the first child (right after the opening tag) stays zero-width', () => {
    const pos = at('<p>alpha');
    const s: Splice = { start: pos, removed: '', inserted: '<p>zero</p>' };
    expect(touchedSpanFor(DOC, s)).toEqual({ start: pos, end: pos });
  });

  it('deleting exactly one sibling → exactly its span (neighbours untouched)', () => {
    const s: Splice = { start: at('<p>beta'), removed: '<p>beta text</p>', inserted: '' };
    expect(touchedSpanFor(DOC, s)).toEqual({ start: at('<p>beta'), end: at('<p>beta') + '<p>beta text</p>'.length });
  });

  it('range crossing nodes → union of both endpoint expansions with the raw range', () => {
    const start = at('text</p>'); // strictly inside alpha's text node
    const end = at('gamma') + 2; // strictly inside gamma's text node
    const s: Splice = { start, removed: DOC.slice(start, end), inserted: 'x' };
    expect(touchedSpanFor(DOC, s)).toEqual({ start: at('alpha text'), end: at('gamma') + 'gamma'.length });
  });

  it('unparseable source fails closed to the whole document', () => {
    expect(touchedSpanFor('<div', { start: 1, removed: 'd', inserted: 'D' })).toEqual({ start: 0, end: 4 });
  });

  it('edit strictly inside an expression child → the whole expression span', () => {
    const doc = '<div><p>{`hello world`}</p><p>tail</p></div>';
    const p = parseJsx(doc);
    expect(p.ok).toBe(true);
    if (p.ok) expect(serializeJsx(p.nodes)).toBe(doc); // canonical fixture
    const exprStart = doc.indexOf('{`');
    const exprEnd = doc.indexOf('`}') + 2;
    const s: Splice = { start: doc.indexOf('world'), removed: 'world', inserted: 'earth' };
    expect(touchedSpanFor(doc, s)).toEqual({ start: exprStart, end: exprEnd });
  });

  it('append at the very end of the document stays zero-width', () => {
    const s: Splice = { start: DOC.length, removed: '', inserted: '<p>tail</p>' };
    expect(touchedSpanFor(DOC, s)).toEqual({ start: DOC.length, end: DOC.length });
  });
});

describe('normalizeSplice — position within the equivalence class', () => {
  it('slides a sibling insertion off the closing tag onto the child gap', () => {
    // The raw prefix/suffix diff for appending a paragraph lands INSIDE
    // "</section>" (equivalent, but expands to the whole document).
    const gap = at('<div>');
    const next = DOC.slice(0, gap) + '<p>new</p>' + DOC.slice(gap);
    const raw = deriveSpliceByDiff(DOC, next)!;
    const rawWidth = touchedSpanFor(DOC, raw);

    const norm = normalizeSplice(DOC, raw);
    expect(applySplice(DOC, norm)).toBe(next); // same document, always
    const span = touchedSpanFor(DOC, norm);
    expect(span.end - span.start).toBeLessThan(rawWidth.end - rawWidth.start);
    expect(span).toEqual({ start: gap, end: gap }); // the clean gap: conflicts with nothing
  });

  it('appending after the last child lands on the child-region edge, not the closing tag', () => {
    const end = DOC.indexOf('</section>');
    const next = DOC.slice(0, end) + '<p>tail</p>' + DOC.slice(end);
    const norm = normalizeSplice(DOC, deriveSpliceByDiff(DOC, next)!);
    expect(applySplice(DOC, norm)).toBe(next);
    expect(touchedSpanFor(DOC, norm)).toEqual({ start: end, end });
  });

  it('leaves an already-minimal text edit alone', () => {
    const s = deriveSpliceFromStrings(DOC, 'alpha text', 'ALPHA');
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(normalizeSplice(DOC, s.splice)).toEqual(s.splice);
  });

  it('never changes the resulting document, for any sample', () => {
    const cases = [
      DOC.replace('<p>beta text</p>', ''),
      DOC.replace('gamma', 'gamma gamma'),
      DOC.slice(0, at('<p>beta')) + '<p>beta text</p>' + DOC.slice(at('<p>beta')),
      DOC.replace('</section>', '<p>z</p></section>'),
    ];
    for (const next of cases) {
      const raw = deriveSpliceByDiff(DOC, next);
      expect(raw).not.toBeNull();
      expect(applySplice(DOC, normalizeSplice(DOC, raw!))).toBe(next);
    }
  });

  it('unparseable source is returned untouched (no parse, no slide)', () => {
    const s: Splice = { start: 1, removed: 'd', inserted: 'D' };
    expect(normalizeSplice('<div', s)).toEqual(s);
  });
});

describe('spansOverlap', () => {
  const span = (start: number, end: number) => ({ start, end });

  it('disjoint and touching-at-boundary → false', () => {
    expect(spansOverlap(span(0, 5), span(6, 9))).toBe(false);
    expect(spansOverlap(span(0, 5), span(5, 9))).toBe(false);
  });

  it('contained and partial → true', () => {
    expect(spansOverlap(span(0, 9), span(2, 3))).toBe(true);
    expect(spansOverlap(span(0, 5), span(4, 9))).toBe(true);
  });

  it('zero-width at a boundary → false; strictly inside → true; twin points → false', () => {
    expect(spansOverlap(span(5, 5), span(0, 5))).toBe(false);
    expect(spansOverlap(span(5, 5), span(5, 9))).toBe(false);
    expect(spansOverlap(span(3, 3), span(0, 5))).toBe(true);
    expect(spansOverlap(span(5, 5), span(5, 5))).toBe(false);
  });
});

describe('shiftThroughEdits', () => {
  const incoming = { splice: { start: 8, removed: '8', inserted: 'X' }, span: { start: 8, end: 9 } };

  it('no intervening edits → unchanged', () => {
    expect(shiftThroughEdits(incoming, [])).toEqual({ ok: true, ...incoming });
  });

  it('disjoint insertion before → shifted right by its growth', () => {
    const e = record(1, { start: 2, removed: '', inserted: 'AB' }, { start: 2, end: 2 });
    const r = shiftThroughEdits(incoming, [e]);
    expect(r).toEqual({ ok: true, splice: { ...incoming.splice, start: 10 }, span: { start: 10, end: 11 } });
  });

  it('disjoint deletion before → shifted left', () => {
    const e = record(1, { start: 0, removed: '01', inserted: '' }, { start: 0, end: 2 });
    const r = shiftThroughEdits(incoming, [e]);
    expect(r).toEqual({ ok: true, splice: { ...incoming.splice, start: 6 }, span: { start: 6, end: 7 } });
  });

  it('disjoint edit after → untouched', () => {
    const e = record(1, { start: 9, removed: '9', inserted: 'ZZZ' }, { start: 9, end: 10 });
    expect(shiftThroughEdits(incoming, [e])).toEqual({ ok: true, ...incoming });
  });

  it('overlapping span → conflict naming the first conflicting record', () => {
    // e1 inserts one char at 0, so the incoming edit is at [9,10) in e2's frame —
    // which is exactly where the clash lands.
    const clash = record(2, { start: 9, removed: '8', inserted: 'Y' }, { start: 9, end: 10 });
    const later = record(3, { start: 0, removed: '0', inserted: '' }, { start: 0, end: 1 });
    const r = shiftThroughEdits(incoming, [
      record(1, { start: 0, removed: '', inserted: 'Q' }, { start: 0, end: 0 }),
      clash,
      later,
    ]);
    expect(r).toEqual({ ok: false, conflictWith: clash });
  });

  it('walks coordinate frames: each intervening edit is compared in ITS base frame', () => {
    // base "0123456789" → e1 inserts "XX" at 0 → frame1 "XX0123456789";
    // e2 (frame1 coords) deletes "XX" back out at 0. Incoming (base coords) at 8:
    // +2 then -2 → net unchanged, and NO conflict at any step.
    const e1 = record(1, { start: 0, removed: '', inserted: 'XX' }, { start: 0, end: 0 });
    const e2 = record(2, { start: 0, removed: 'XX', inserted: '' }, { start: 0, end: 2 });
    expect(shiftThroughEdits(incoming, [e1, e2])).toEqual({ ok: true, ...incoming });
  });

  it('a zero-width intervening insertion strictly inside the incoming span → conflict', () => {
    const wide = { splice: { start: 2, removed: '234567', inserted: 'x' }, span: { start: 2, end: 8 } };
    const inject = record(1, { start: 5, removed: '', inserted: 'NEW' }, { start: 5, end: 5 });
    expect(shiftThroughEdits(wide, [inject])).toEqual({ ok: false, conflictWith: inject });
  });

  it('an intervening span touching the incoming boundary exactly → no conflict, shift applies', () => {
    const e = record(1, { start: 2, removed: '234567', inserted: '' }, { start: 2, end: 8 });
    const r = shiftThroughEdits(incoming, [e]); // incoming span [8,9) touches [2,8)
    expect(r).toEqual({ ok: true, splice: { ...incoming.splice, start: 2 }, span: { start: 2, end: 3 } });
  });

  it('accumulates multiple disjoint shifts', () => {
    const e1 = record(1, { start: 0, removed: '', inserted: 'AB' }, { start: 0, end: 0 }); // +2
    const e2 = record(2, { start: 4, removed: '45', inserted: '' }, { start: 4, end: 6 }); // -2 (frame1: still before incoming@10)
    const r = shiftThroughEdits(incoming, [e1, e2]);
    expect(r).toEqual({ ok: true, splice: { ...incoming.splice, start: 8 }, span: { start: 8, end: 9 } });
  });
});

describe('reconstructBaseSource', () => {
  it('empty log → head is the base', () => {
    expect(reconstructBaseSource('abc', [])).toBe('abc');
  });

  it('inverts a chain of edits (each recorded in its own base frame)', () => {
    const base = 'hello world';
    const e1: Splice = { start: 0, removed: 'hello', inserted: 'goodbye' };
    const v1 = applySplice(base, e1);
    expect(v1).toBe('goodbye world');
    const e2: Splice = { start: v1.indexOf('world'), removed: 'world', inserted: 'earth' };
    const v2 = applySplice(v1, e2);
    expect(v2).toBe('goodbye earth');
    const log = [record(1, e1, { start: 0, end: 5 }), record(2, e2, { start: 8, end: 13 })];
    expect(reconstructBaseSource(v2, log)).toBe(base);
    // Reconstructing an intermediate base uses only the edits after it.
    expect(reconstructBaseSource(v2, [log[1]])).toBe(v1);
  });
});

describe('newEditId', () => {
  it('is 32 lowercase hex chars (128 bits) and does not repeat', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newEditId()));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^[a-f0-9]{32}$/);
  });
});
