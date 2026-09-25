import {describe,expect,it} from 'vitest';
import {encodeDocument,decodeDocument,type StoredDocument} from '../document-codec';
import {parseJsx} from '../../jsx/parse';
import {serializeJsx} from '../../jsx/serialize';
const databaseOrder=(v:unknown):unknown=>Array.isArray(v)?v.map(databaseOrder):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,databaseOrder(x)])):v;
const canonical=(source:string)=>{const parsed=parseJsx(source);if(!parsed.ok)throw new Error(parsed.error);return serializeJsx(parsed.nodes);};
describe('persisted JSX codec',()=>{
 it.each([
  '<section id="s"><p id="a">Alpha &amp; β 👩🏽‍💻</p><p id="b">&#123;literal&#125;</p></section>',
  '<Helmet><Query name="q">{`select \'<tag>\', 1 as n`}</Query><style>{`p { color: red }`}</style></Helmet><div />',
  '<div data-value={{"z":1,"a":{"end":2,"start":3},"__proto__":{"safe":true}}} />',
  '<div data-value={{"\\u0000":"\\ud800","z":[null,false,1,"\\u0000"]}} />',
  '<><div><For each={$rows} keyBy="id"><p>{$_row.name}</p></For></div></>',
 ])('round trips through JSONB key ordering: %s',input=>{
  const source=canonical(input),document=encodeDocument(source);
  expect(document.kind).toBe('jsx');
  expect(decodeDocument(databaseOrder(JSON.parse(JSON.stringify(document))) as StoredDocument)).toBe(source);
  expect(JSON.stringify(document)).not.toContain('"start":');
 });
 it.each(["<p id='old'>  Legacy &#38; formatting </p>",'<!-- legacy HTML -->','<broken',''])('preserves exact old bytes without republishing: %s',source=>{
  const document=encodeDocument(source);expect(decodeDocument(JSON.parse(JSON.stringify(document)))).toBe(source);
 });
 it('does not mistake unsupported schema or malformed data for an empty document',()=>{
  for(const value of [{schema:2,kind:'jsx',roots:[]},{schema:1,kind:'other'},{schema:1,kind:'jsx',roots:null}])expect(()=>decodeDocument(value as StoredDocument)).toThrow();
 });
});
