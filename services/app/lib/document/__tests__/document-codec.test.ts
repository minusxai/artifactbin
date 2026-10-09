import {describe,expect,it} from 'vitest';
import {decodeDocument,type StoredDocument} from '../document/document-codec';
import {parseJsx} from '../../jsx/parse';
import {serializeJsx} from '../../jsx/serialize';
import {createDocumentGraph} from '../graph/document-graph';
import {encodeDocumentNodes} from '../document/document-node-codec';
const databaseOrder=(v:unknown):unknown=>Array.isArray(v)?v.map(databaseOrder):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,databaseOrder(x)])):v;
const canonical=(source:string)=>{const parsed=parseJsx(source);if(!parsed.ok)throw new Error(parsed.error);return serializeJsx(parsed.nodes);};
describe('stored document codec',()=>{
 it.each([
  '<section id="s"><p id="a">Alpha &amp; β 👩🏽‍💻</p><p id="b">&#123;literal&#125;</p></section>',
  '<Helmet><Query name="q">{`select \'<tag>\', 1 as n`}</Query><style>{`p { color: red }`}</style></Helmet><div />',
  '<div data-value={{"z":1,"a":{"end":2,"start":3},"__proto__":{"safe":true}}} />',
  '<><div><For each={$rows} keyBy="id"><p>{$_row.name}</p></For></div></>',
 ])('a graph round trips through JSONB key ordering: %s',input=>{
  const source=canonical(input),document=createDocumentGraph(source,1);
  expect(decodeDocument(databaseOrder(JSON.parse(JSON.stringify(document))) as StoredDocument)).toBe(source);
 });
 it("a graph that preserves its source keeps old bytes exactly",()=>{
  const source="<p id='old'>  Legacy &#38; formatting </p>";
  expect(decodeDocument(JSON.parse(JSON.stringify(createDocumentGraph(source,1,{preserveSource:true}))))).toBe(source);
 });
 it('decodes nothing but a graph: every retired shape throws instead of reading as a document',()=>{
  const parsed=parseJsx('<p>x</p>');if(!parsed.ok)throw new Error(parsed.error);
  for(const value of [{schema:1,kind:'source',source:'<p>x</p>'},encodeDocumentNodes(parsed.nodes),{schema:2,kind:'semantic',tree:encodeDocumentNodes(parsed.nodes),prose:{}},{schema:1,kind:'other'},null])
   expect(()=>decodeDocument(value as StoredDocument)).toThrow();
 });
});
