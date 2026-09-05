import { describe, expect, it } from 'vitest';
import { resolveEditBatch, rebaseEditBatch, MAX_BATCH_BYTES, MAX_BATCH_EDITS } from '../edit-batch';
import { applySplice, deriveSpliceFromStrings, touchedSpanFor } from '../splice';
import { parseJsx } from '@/lib/jsx';

const base = '<main><Card id="card">Hello</Card><p id="other">Old</p><section id="dest"></section></main>';
const move = [
  {oldString:'<Card id="card">Hello</Card>', newString:''},
  {oldString:'<section id="dest">', newString:'<section id="dest"><Card id="card">Hello</Card>'},
];
describe('atomic edit batch kernel', () => {
  it('moves a node with separate source and destination regions', () => {
    const result = resolveEditBatch(base, move);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe('<main><p id="other">Old</p><section id="dest"><Card id="card">Hello</Card></section></main>');
    expect(result.changes).toHaveLength(2);
    expect(result.changes.reduceRight((s,c)=>applySplice(s,c.splice),base)).toBe(result.source);
  });
  it('allows temporary invalid JSX and later edits of newly inserted content', () => {
    const result = resolveEditBatch('<p>Hi</p>', [
      {oldString:'<p>',newString:'<section><p>'},
      {oldString:'Hi',newString:'New'},
      {oldString:'New',newString:'Done'},
      {oldString:'</p>',newString:'</p></section>'},
    ]);
    expect(result.ok && result.source).toBe('<section><p>Done</p></section>');
    if(result.ok) expect(parseJsx(result.source).ok).toBe(true);
  });
  it('reports the failing step without returning partially edited source', () => {
    expect(resolveEditBatch('<p>Hi</p>',[{oldString:'Hi',newString:'Done'},{oldString:'missing',newString:'x'}])).toEqual({ok:false,reason:'no_match',editIndex:1});
  });
  it('rejects empty, ambiguous and excessive input', () => {
    expect(resolveEditBatch(base,[])).toEqual({ok:false,reason:'empty_batch'});
    expect(resolveEditBatch('<p>x</p><p>x</p>',[{oldString:'x',newString:'y'}])).toEqual({ok:false,reason:'multiple_matches',editIndex:0});
    expect(resolveEditBatch(base,Array.from({length:MAX_BATCH_EDITS+1},()=>move[0]))).toEqual({ok:false,reason:'too_many_edits'});
  });
  it('rebases a move across an unrelated concurrent sibling edit', () => {
    const batch = resolveEditBatch(base,move);
    const other = deriveSpliceFromStrings(base,'Old','Current');
    if(!batch.ok||!other.ok) throw new Error('expected valid fixtures');
    const head=applySplice(base,other.splice);
    const result=rebaseEditBatch(head,batch.changes,[{seq:1,editId:'other',splice:other.splice,span:touchedSpanFor(base,other.splice)}]);
    expect(result.ok && result.source).toBe('<main><p id="other">Current</p><section id="dest"><Card id="card">Hello</Card></section></main>');
  });
  it('rejects a concurrent change to the moved node as one unit', () => {
    const batch=resolveEditBatch(base,move);
    const other=deriveSpliceFromStrings(base,'Hello','Changed');
    if(!batch.ok||!other.ok) throw new Error('expected valid fixtures');
    expect(rebaseEditBatch(applySplice(base,other.splice),batch.changes,[{seq:1,editId:'other',splice:other.splice,span:touchedSpanFor(base,other.splice)}])).toEqual({ok:false});
  });
  it('does not validate final JSX itself; the publish door must reject it', () => {
    const result=resolveEditBatch('<p>Hi</p>',[{oldString:'</p>',newString:''}]);
    expect(result.ok).toBe(true);
    if(result.ok) expect(parseJsx(result.source).ok).toBe(false);
  });

  it('lowers dependent and overlapping edits to reconstructing disjoint base splices', () => {
    const result = resolveEditBatch('abcdef', [
      { oldString: 'bcd', newString: 'B-D' },
      { oldString: 'B-D', newString: 'BCD!' },
      { oldString: '!', newString: '?' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe('aBCD?ef');
    expect(result.changes.reduceRight((s, c) => applySplice(s, c.splice), 'abcdef')).toBe(result.source);
    for (let i = 1; i < result.changes.length; i++) {
      expect(result.changes[i - 1].splice.start).toBeLessThan(result.changes[i].splice.start);
    }
  });

  it('removes net cancellations instead of publishing phantom changes', () => {
    expect(resolveEditBatch('abc', [
      { oldString: 'b', newString: 'B' },
      { oldString: 'B', newString: 'b' },
    ])).toEqual({ ok: true, source: 'abc', changes: [] });
  });

  it('keeps splice boundaries outside surrogate pairs', () => {
    const result = resolveEditBatch('a😀b', [{ oldString: '😀', newString: '😎' }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].splice).toEqual({ start: 1, removed: '😀', inserted: '😎' });
  });

  it('enforces aggregate UTF-8 input work and exact failing indexes', () => {
    expect(resolveEditBatch('x', [{ oldString: 'x', newString: 'x' }]))
      .toEqual({ ok: false, reason: 'identical', editIndex: 0 });
    expect(resolveEditBatch('x'.repeat(MAX_BATCH_BYTES + 1), [{ oldString: 'x', newString: 'y' }]))
      .toEqual({ ok: false, reason: 'too_large' });
  });

  it('refuses at touching-span collisions and leaves the caller head untouched', () => {
    const original = '<main><p>one</p><p>two</p></main>';
    const batch = resolveEditBatch(original, [{ oldString: 'one', newString: 'ONE' }]);
    const concurrent = deriveSpliceFromStrings(original, '<p>one</p>', '<p>other</p>');
    if (!batch.ok || !concurrent.ok) throw new Error('expected valid fixtures');
    const head = applySplice(original, concurrent.splice);
    expect(rebaseEditBatch(head, batch.changes, [{ seq: 1, editId: 'collision', splice: concurrent.splice, span: touchedSpanFor(original, concurrent.splice) }]))
      .toEqual({ ok: false });
    expect(head).toBe('<main><p>other</p><p>two</p></main>');
  });

  it('property: seeded dependent Unicode edits always lower to an exact base replay', () => {
    let randomState = 0x5eed1234;
    const random = () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState;
    };

    for (let example = 0; example < 80; example++) {
      const base = Array.from({ length: 7 }, (_, i) => `⟦${example}:${i}⟧${i % 2 ? 'é' : '😀'}`).join('|');
      let expected = base;
      const edits: Array<{ oldString: string; newString: string }> = [];

      for (let step = 0; step < 8; step++) {
        const tokens = [...expected.matchAll(/⟦[^⟧]+⟧(?:😀|é|Ω)?/gu)];
        const first = random() % tokens.length;
        const width = 1 + (random() % Math.min(3, tokens.length - first));
        const start = tokens[first].index;
        const last = tokens[first + width - 1];
        const end = last.index + last[0].length;
        const oldString = expected.slice(start, end);
        const newString = `⟦${example}:new:${step}⟧${step % 2 ? 'Ω' : '😀'}`;
        edits.push({ oldString, newString });
        expected = expected.slice(0, start) + newString + expected.slice(end);

        if (step % 3 === 0 || step % 5 === 0) {
          edits.push({ oldString: newString, newString: `${newString}é` });
          expected = expected.replace(newString, `${newString}é`);
        }
        if (step % 5 === 0) {
          edits.push({ oldString: `${newString}é`, newString: oldString });
          expected = expected.replace(`${newString}é`, oldString);
        }
      }

      const result = resolveEditBatch(base, edits);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.source).toBe(expected);
      expect(result.changes.reduceRight((source, change) => applySplice(source, change.splice), base))
        .toBe(expected);
      for (let i = 0; i < result.changes.length; i++) {
        const splice = result.changes[i].splice;
        expect(base.slice(splice.start, splice.start + splice.removed.length)).toBe(splice.removed);
        if (i > 0) {
          const previous = result.changes[i - 1].splice;
          expect(previous.start + previous.removed.length).toBeLessThanOrEqual(splice.start);
        }
        expect(splice.start === 0 || !/[\uD800-\uDBFF]/u.test(base[splice.start - 1])).toBe(true);
        expect(!/[\uDC00-\uDFFF]/u.test(base[splice.start] ?? '')).toBe(true);
      }
    }
  });
});
