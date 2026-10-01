import {describe,expect,it,vi} from 'vitest';

const parsed=vi.hoisted(()=>({count:0}));
vi.mock('../parse',async(original)=>{
 const real=await original<typeof import('../parse')>();
 return {...real,parseJsx:(source:string)=>{parsed.count++;return real.parseJsx(source);}};
});
const {parseJsxShared}=await import('../parse-shared');
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
