import {describe,expect,it,vi} from 'vitest';

const parsed=vi.hoisted(()=>({count:0}));
vi.mock('../parse',async(original)=>{
 const real=await original<typeof import('../parse')>();
 return {...real,parseJsx:(source:string)=>{parsed.count++;return real.parseJsx(source);}};
});
const {parseJsxShared,reparse}=await import('../parse-shared');
const {parseJsx}=await import('../parse');
const {sourceChanges}=await import('../../story/document/source-changes');
const {sourceEdits}=await import('../../editor-v2/source-edits');
const {SourceHistory}=await import('../../editor-v2/history');

const table=(n:number)=>`<table><tbody>${Array.from({length:40},(_,r)=>`<tr><td>t${n} r${r}</td><td>${r*n}</td></tr>`).join('')}</tbody></table>`;
const before=`<div>\n<p id="first">First</p>\n<p id="second">Second paragraph</p>\n${Array.from({length:10},(_,n)=>table(n)).join('\n')}\n</div>`;

describe('the shared parse', () => {
  it('parses each distinct source once across one pause: undo history, then the save diff', () => {
    const after=before.replace('Second paragraph','Second paragraph, typed');
    const fresh={changes:sourceChanges(before,after),edits:sourceEdits(before,after)};
    parsed.count=0;
    new SourceHistory().record(before+' ',after+' ');
    sourceEdits(before+' ',after+' ');
    // Before the cache this was about ten whole-document parses of the same two strings.
    expect(parsed.count).toBe(2);
    expect(sourceChanges(before,after)).toEqual(fresh.changes);
    expect(sourceEdits(before,after)).toEqual(fresh.edits);
  });

  it('answers the same tree as a parse, and the same object for the same source', () => {
    expect(parseJsxShared(before)).toEqual(parseJsx(before));
    expect(parseJsxShared(before)).toBe(parseJsxShared(before));
    expect(parseJsxShared('<p>a</p>')).not.toBe(parseJsxShared('<p>b</p>'));
  });
});

describe('the incremental parse', () => {
  const doc=`<Helmet>\n<Query name="q">{\`select 1 as a\`}</Query>\n</Helmet>\n<div className="p-4" id="root">\n<h1 id="t">Title &amp; more</h1>\n<p id="first">First <strong id="s">bold</strong> words.</p>\n<p id="second">Second paragraph, where typing happens.</p>\n<Question title="Q" data="$q" viz={{"kind":"vega-lite","spec":{"mark":"bar"}}} id="Q1" />\n<ul id="l"><li id="i1">one {"lit"}</li><li id="i2">two</li></ul>\n${table(1)}\n<p id="tail">Tail {$q.a}</p>\n</div>\n`;
  it('answers exactly the whole parse for typing inside a paragraph, and parses only that paragraph', () => {
    const at=doc.indexOf('typing happens.')+'typing happens.'.length;
    const next=doc.slice(0,at)+' More typed words'+doc.slice(at);
    parsed.count=0;
    const fast=reparse(doc,parseJsx(doc),next);
    expect(parsed.count).toBe(2);   // the base for the test, then the one paragraph
    expect(fast).toEqual(parseJsx(next));
  });

  it('answers exactly the whole parse, or nothing, for any single change', () => {
    let seed=7;const rand=(n:number)=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed%n;};
    const pieces=['x',' ','<','>','"','}','{','</p>','<em>a</em>','\n','&amp;','id="z"','',''];
    const base=parseJsx(doc);let incremental=0;
    for(let i=0;i<400;i++){
      const at=rand(doc.length),cut=rand(4)?0:rand(12);
      const next=doc.slice(0,at)+pieces[rand(pieces.length)]+doc.slice(at+cut);
      const fast=reparse(doc,base,next);
      if(!fast)continue;
      incremental++;
      expect(fast,`edit at ${at}`).toEqual(parseJsx(next));
    }
    expect(incremental).toBeGreaterThan(40);
  });

  it('is what the shared parse answers for a source one change away from a kept one', () => {
    parseJsxShared(doc);
    const next=doc.replace('Second paragraph','Second paragraph!');
    parsed.count=0;
    expect(parseJsxShared(next)).toEqual(parseJsx(next));
    expect(parsed.count).toBe(2);
  });
});
