import {describe,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {createLocalStore,createStateStore} from '../../services/app/lib/html-runtime/index.ts';
import {datasetPageHtml} from '../gates/lib/native-dataset-page.mjs';
import {editableDatasetPageHtml} from '../gates/lib/native-editable-dataset-page.mjs';
import {nativeHtml,nativeChoiceScript} from '../gates/lib/native-surface.mjs';
describe('native retained journey fixtures',()=>{
 it('produces a complete HTML document with one canonical core and viewer-local initial state',()=>{
  const source=nativeHtml('Fixture','<section data-af-slide><h1>Visible slide</h1></section>',{state:{picture:1},css:'section{height:800px}'});
  const dom=new JSDOM(source),document=dom.window.document;
  expect(document.doctype.name).toBe('html');expect(document.title).toBe('Fixture');
  expect(document.querySelectorAll('script[data-af="core"]').length).toBe(1);
  expect(document.querySelector('script[data-af="core"]').getAttribute('src')).toBe('/af/core.js');
  expect(JSON.parse(document.querySelector('script[data-af="state"]').textContent)).toEqual({picture:1});
  expect(document.querySelector('[data-af-slide]').textContent).toBe('Visible slide');
 });
 it('places authored behavior after its DOM and uses only the public state import',()=>{
  const source=nativeHtml('Interactive','<button id="choose">Choose</button>',{script:"document.querySelector('#choose').onclick=()=>state.setState({choice:2})"});
  const document=new JSDOM(source).window.document;
  expect(document.body.lastElementChild.type).toBe('module');
  expect(document.body.lastElementChild.textContent).toContain("import {state} from '@afbin/state'");
  expect(document.querySelector('#choose').compareDocumentPosition(document.body.lastElementChild)&4).toBe(4);
 });
});

it('runs native viewer choice behavior against the real public state contract',async()=>{
 const source=nativeHtml('Choice','<button id="choose">Choose</button><output id="value"></output>',{state:{choice:1},script:nativeChoiceScript({field:'choice',button:'#choose',output:'#value',value:2})});
 const document=new JSDOM(source).window.document,state=createStateStore(createLocalStore(JSON.parse(document.querySelector('[data-af="state"]').textContent)));
 const script=document.querySelector('script[type="module"]').textContent.replace("import {state} from '@afbin/state';",'');
 await new Function('document','state',`return (async()=>{${script}})()`)(document,state);
 expect(document.querySelector('#value').textContent).toBe('1');await document.querySelector('#choose').onclick();expect(document.querySelector('#value').textContent).toBe('2');
 expect(state.getState()).toEqual({choice:2});
});

async function runDatasetFixture(html,sql){
 const {document}=new JSDOM(html).window;
 const state=createStateStore(createLocalStore(JSON.parse(document.querySelector('[data-af="state"]').textContent)));
 const script=document.querySelector('script[type="module"]').textContent.replace(/import \{[^}]+\} from '[^']+';/g,'');
 await new Function('document','state','sql','onResolverChange',`return (async()=>{${script}})()`)(document,state,sql,()=>{});
 return {document,state};
}
it('runs linked SQL reads and inserts from the authored dataset fixture',async()=>{
 const calls=[],row={_id:'r1',choice:'ramen'};
 const sql=async(strings,...values)=>{const text=strings.join('?');calls.push({text,values});return text.startsWith('insert')?{affected:1}:[row];};
 const {document}=await runDatasetFixture(datasetPageHtml('DATA12'),sql);
 expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
 expect(calls[0].text).toBe('select _id, "choice" from data limit 100 offset 0');
 await document.querySelector('#vote').onclick();
 expect(calls.find(call=>call.text.startsWith('insert'))).toEqual({text:'insert into data(choice) values(?)',values:['ramen']});
 expect(document.querySelector('#receipt').textContent).toBe('committed');
});
it('keeps a row draft and binds its observed values in the conditional SQL save',async()=>{
 const calls=[],row={_id:'r1',id:1,hours:3};
 const sql=async(strings,...values)=>{const text=strings.join('?');calls.push({text,values});if(text.startsWith('update')){row.hours=values[0];return {affected:1};}return [{...row}];};
 const {document,state}=await runDatasetFixture(editableDatasetPageHtml('DATA12',[{name:'id',key:true},{name:'hours',type:'number'}]),sql);
 const input=document.querySelector('input');input.value='5';await input.oninput();
 expect(state.getState().edits.r1).toEqual({observed:{hours:3},values:{hours:5}});
 await document.querySelector('tbody button').onclick();
 expect(calls.find(call=>call.text.startsWith('update'))).toEqual({text:'update data set "hours" = ? where _id = ? and "hours" IS ?',values:[5,'r1',3]});
 expect(state.getState().edits).toEqual({});expect(document.querySelector('#receipt').textContent).toBe('committed');
});
