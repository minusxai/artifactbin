/**
 * applyEdits builds its output once, whatever the number of edits: the same string the one-edit-at-a-time splice
 * gives (same-offset ties in list order, abutting and overlapping edits included), in time linear in the page.
 */
import { describe, expect, it } from 'vitest';
import { applyEdits, type Edit } from '../html-source';

/** The splice applyEdits is defined by: every edit in turn, from the end of the source. */
function splicedOneByOne(source: string, edits: readonly Edit[]): string {
  const ordered = edits
    .map((edit, index) => ({ edit, index }))
    .sort((a, b) => b.edit.start - a.edit.start || b.edit.end - a.edit.end || b.index - a.index);
  let output = source;
  for (const { edit } of ordered) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return output;
}

/** A small deterministic generator, so a failure names its seed. */
function random(seed: number) {
  let state = seed >>> 0 || 1;
  return (below: number) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % below; };
}

describe('applyEdits', () => {
  it('gives the one-by-one splice for ties, abutting, nested and overlapping edits', () => {
    const source = '<p a="1">one</p>\n<p>two</p>';
    const cases: Edit[][] = [
      [],
      [{ start: 2, end: 2, text: 'x' }, { start: 2, end: 2, text: 'y' }],
      [{ start: 2, end: 2, text: 'i' }, { start: 2, end: 8, text: 'R' }],
      [{ start: 2, end: 8, text: 'R' }, { start: 2, end: 2, text: 'i' }],
      [{ start: 0, end: 5, text: 'A' }, { start: 5, end: 9, text: 'B' }, { start: 9, end: 9, text: 'C' }],
      [{ start: 3, end: 12, text: 'outer' }, { start: 5, end: 7, text: 'inner' }],
      [{ start: 3, end: 10, text: 'one' }, { start: 6, end: 14, text: 'two' }],
      [{ start: 4, end: 9, text: 'a' }, { start: 4, end: 6, text: 'b' }],
      [{ start: source.length, end: source.length, text: '!' }, { start: 0, end: 0, text: '<!doctype html>' }],
    ];
    for (const edits of cases) expect(applyEdits(source, edits), JSON.stringify(edits)).toBe(splicedOneByOne(source, edits));
    for (let seed = 1; seed <= 400; seed++) {
      const next = random(seed), edits: Edit[] = [];
      for (let i = next(8); i >= 0; i--) {
        const start = next(source.length + 1), end = Math.min(source.length, start + (next(3) ? next(4) : 0));
        edits.push({ start, end, text: 'abc'.slice(0, next(4)) });
      }
      expect(applyEdits(source, edits), `seed ${seed}`).toBe(splicedOneByOne(source, edits));
    }
  });

  it('builds a 1 MB page with 20,000 edits in well under the time a rebuild per edit takes', () => {
    const cell = '<p data-x="1">some text here</p>\n';
    const source = cell.repeat(Math.ceil(1_000_000 / cell.length));
    const edits = Array.from({ length: 20_000 }, (_, i) => {
      const at = Math.floor((i * source.length) / 20_000);
      return { start: at, end: at, text: ' a="b"' };
    });
    applyEdits(source.slice(0, 1000), edits.slice(0, 10));
    const started = performance.now();
    const output = applyEdits(source, edits);
    const elapsed = performance.now() - started;
    expect(output.length).toBe(source.length + 20_000 * 6);
    expect(output.startsWith(' a="b"<p data-x="1">')).toBe(true);
    // One pass takes a few milliseconds here; rebuilding the page per edit took over two seconds.
    expect(elapsed).toBeLessThan(200);
  });
});
