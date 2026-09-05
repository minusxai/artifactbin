import { describe, expect, it } from 'vitest';
import { resolveEditBatch, rebaseEditBatch, MAX_BATCH_EDITS } from '../edit-batch';
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
});
