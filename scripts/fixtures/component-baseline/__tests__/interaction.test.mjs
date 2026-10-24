import {describe,it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {interactionBaselineFixtures,interactionPagingSql} from '../interaction.mjs';
import {stateExpectationIssues} from '../../../lib/component-browser-baseline.mjs';
const fixture=id=>interactionBaselineFixtures.find(item=>item.id===id);
const semantic=(text,controls,rows=[])=>({text,controls,rows,overflow:0});
describe('actual original interaction contracts',()=>{
  it('pins supported Select writes and real DataGrid sort cycle to the original source',()=>{
    const repo=path.resolve(import.meta.dirname,'../../../..');
    const source=file=>execFileSync('git',['show',`8eaac63810b66eb575b018be89bb63443e1b7aaf:${file}`],{cwd:repo,encoding:'utf8'});
    expect(source('services/app/lib/islands/kit/select.tsx')).toContain('close(false, true)');
    expect(source('services/app/lib/islands/kit/select.tsx')).toContain('island.setValue(name, coerceScalarInput');
    const grid=source('services/app/lib/islands/kit/data.tsx');
    expect(grid).toContain("old.dir === 'asc' ? { col, dir: 'desc' } : null");
    expect(grid).toContain('onClick={() => cycle(column.col)}');
    expect(grid).toContain('sortRows(shown(), sort())');
    for(const item of interactionBaselineFixtures){expect(item.provenance.revision).toBe('8eaac63810b66eb575b018be89bb63443e1b7aaf');expect(item.states.every(state=>state.expected)).toBe(true);}
  });
  it('rejects a swallowed Select choice and lost selection when reopened',()=>{
    const select=fixture('select-choice');
    const closed=semantic('PERSON Grace',[{role:'button',name:'Person',expanded:'false',focused:true}]);
    expect(stateExpectationIssues(select.states[0].expected,closed)).toEqual([]);
    // Negative control: click closes the menu but fails to write the bound value.
    expect(stateExpectationIssues(select.states[0].expected,{...closed,text:'PERSON Ada'})).toContain('Missing visible text \"Grace\"');
    const reopened=semantic('PERSON Grace Ada Grace Linus',[{role:'button',name:'Person',expanded:'true'},{role:'option',name:'Grace',selected:'true'},{role:'option',name:'Ada',selected:'false'}]);
    expect(stateExpectationIssues(select.states[1].expected,reopened)).toEqual([]);
    const stale={...reopened,controls:reopened.controls.map(control=>control.role==='option'?{...control,selected:control.name==='Ada'?'true':'false'}:control)};
    expect(stateExpectationIssues(select.states[1].expected,stale)).not.toEqual([]);
    expect(select.states[2].actions.map(action=>action.key).filter(Boolean)).toEqual(['ArrowDown','ArrowDown','Enter']);
  });
  it('rejects ignored, inverted and uncleared sorts while retaining raw header evidence',()=>{
    const states=fixture('data-table-sort-cycle').states;
    const original=[['Ada','92'],['Grace','98'],['Linus','85']];
    for(const state of states){expect(stateExpectationIssues(state.expected,semantic('',[{role:'columnheader',name:'Sort by score',sort:state.expected.roles[0].sort}],[['name','score ▲'],...state.expected.bodyRows]))).toEqual([]);}
    // Negative controls preserve table content/count but violate its actual order.
    expect(stateExpectationIssues(states[0].expected,semantic('',[{role:'columnheader',name:'Sort by score',sort:'ascending'}],[['name','score'],...original]))).not.toEqual([]);
    expect(stateExpectationIssues(states[1].expected,semantic('',[{role:'columnheader',name:'Sort by score',sort:'descending'}],[['name','score'],...states[0].expected.bodyRows]))).not.toEqual([]);
    expect(stateExpectationIssues(states[2].expected,semantic('',[{role:'columnheader',name:'Sort by score',sort:'none'}],[['name','score'],...states[1].expected.bodyRows]))).not.toEqual([]);
    expect(states.map(state=>state.actions.length)).toEqual([1,2,3]);
  });
});

it('captures native columnheader names and aria-sort while retaining raw header text',async()=>{
  const {JSDOM}=await import('jsdom'),{mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),sharp=(await import('sharp')).default;
  const {captureBrowserBaseline}=await import('../../../lib/component-browser-baseline.mjs');
  const dom=new JSDOM('<table><thead><tr><th scope="col" aria-label="Sort by score" aria-sort="ascending">score<span aria-hidden="true">▲</span></th><th scope="col" aria-sort="none"><button aria-label="Sort by name">name</button></th></tr></thead><tbody><tr><td>85</td><td>Linus</td></tr></tbody></table>',{url:'http://localhost/reader'});
  const saved=Object.fromEntries(['document','getComputedStyle','innerWidth'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  Object.assign(globalThis,{document:dom.window.document,getComputedStyle:dom.window.getComputedStyle.bind(dom.window),innerWidth:800});
  dom.window.HTMLElement.prototype.getClientRects=()=>[{}];dom.window.document.body.innerText='score▲name85Linus';
  const output=await mkdtemp(path.join(tmpdir(),'interaction-snapshot-'));
  try{
    const bytes=await sharp({create:{width:2,height:2,channels:4,background:'white'}}).png().toBuffer();
    const frame={url:()=> 'http://localhost/reader',evaluate:async fn=>fn.name==='browserState'?fn():{faces:[],used:[],errors:[]}};
    const browser={newContext:async()=>({newPage:async()=>({on:()=>{},screenshot:async()=>bytes}),close:async()=>{}})};
    const [capture]=await captureBrowserBaseline({browser,mount:async()=>({frame}),implementation:'jsx',sourceRevision:'a'.repeat(40),output,fixtures:[{id:'headers',states:[{id:'sorted',actions:[]}]}]});
    expect(capture.semantics.controls).toEqual(expect.arrayContaining([expect.objectContaining({role:'columnheader',name:'Sort by score',sort:'ascending'}),expect.objectContaining({role:'columnheader',name:'Sort by name',sort:'none'})]));
    expect(capture.semantics.rows).toEqual([['score▲','name'],['85','Linus']]);
    expect(stateExpectationIssues({bodyRows:[['85','Linus']]},capture.semantics)).toEqual([]);
    expect(stateExpectationIssues({roles:[{role:'columnheader',name:'Sort by score',sort:'descending'}]},capture.semantics)).not.toEqual([]);
  }finally{for(const [key,descriptor] of Object.entries(saved))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];dom.window.close();await rm(output,{recursive:true,force:true});}
});


it('uses actual SQLite display truncation and the next page for row1001',async()=>{
  const {loadSqlite}=await import('@artifactbin/sql/core');const engine=await loadSqlite();
  const input={tables:{},queries:[{name:'sequence',sql:interactionPagingSql}],params:{},paramTypes:{}};
  const initial=engine.run(input,{limit:1000,pageLimit:500,timeoutMs:2000});
  const table=initial.sequence||initial.tables?.sequence;
  expect(table.rows).toHaveLength(1000);expect(table.truncated).toBe(true);expect(table.totalRows).toBe(1001);
  const page=engine.run({...input,page:{name:'sequence',offset:1000,limit:500}},{limit:1000,pageLimit:500,timeoutMs:2000});
  const next=page.sequence||page.tables?.sequence;
  expect(next.rows).toEqual([{id:1001}]);
  const expected=fixture('data-table-load-more').states[1].expected;
  expect(stateExpectationIssues(expected,semantic('',[],[['id'],['1001']]))).toEqual([]);
  expect(stateExpectationIssues(expected,semantic('',[],[['id'],['1000']]))).not.toEqual([]);
});
