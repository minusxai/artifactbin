import {describe,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {createClient,createLocalStore,gql} from '../../services/app/lib/html-runtime/apollo/client.ts';
import {nativeHtml,nativeChoiceScript} from '../gates/lib/native-surface.mjs';
describe('native retained journey fixtures',()=>{
 it('produces a complete HTML document with one canonical core and viewer-local initial state',()=>{
  const source=nativeHtml('Fixture','<section data-af-slide><h1>Visible slide</h1></section>',{state:{picture:1},css:'section{height:800px}'});
  const dom=new JSDOM(source),document=dom.window.document;
  expect(document.doctype.name).toBe('html');expect(document.title).toBe('Fixture');
  expect(document.querySelectorAll('script[data-af="core"]').length).toBe(1);
  expect(document.querySelector('script[data-af="core"]').getAttribute('src')).toBe('/af/v1/core.js');
  expect(JSON.parse(document.querySelector('script[data-af="state"]').textContent)).toEqual({picture:1});
  expect(document.querySelector('[data-af-slide]').textContent).toBe('Visible slide');
 });
 it('places authored behavior after its DOM and uses only the public Apollo import',()=>{
  const source=nativeHtml('Interactive','<button id="choose">Choose</button>',{script:"document.querySelector('#choose').onclick=()=>client.updateQuery({query:gql`query { choice }`},()=>({choice:2}))"});
  const document=new JSDOM(source).window.document;
  expect(document.body.lastElementChild.type).toBe('module');
  expect(document.body.lastElementChild.textContent).toContain("import {client,gql} from '@afbin/apollo'");
  expect(document.querySelector('#choose').compareDocumentPosition(document.body.lastElementChild)&4).toBe(4);
 });
});

it('runs native viewer choice behavior against the real public Apollo contract',async()=>{
 const source=nativeHtml('Choice','<button id="choose">Choose</button><output id="value"></output>',{state:{choice:1},script:nativeChoiceScript({field:'choice',button:'#choose',output:'#value',value:2})});
 const document=new JSDOM(source).window.document,state=createLocalStore(JSON.parse(document.querySelector('[data-af="state"]').textContent)),client=createClient({backends:[],state});
 const script=document.querySelector('script[type="module"]').textContent.replace("import {client,gql} from '@afbin/apollo';",'');
 await new Function('document','client','gql',`return (async()=>{${script}})()`)(document,client,gql);
 expect(document.querySelector('#value').textContent).toBe('1');await document.querySelector('#choose').onclick();expect(document.querySelector('#value').textContent).toBe('2');
 expect((await client.query({query:gql`{ choice }`})).data).toEqual({choice:2});
});
