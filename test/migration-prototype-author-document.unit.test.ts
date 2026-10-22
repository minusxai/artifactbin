import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareAuthorDocument} from '../src/migration/conversion/compiled/author-document.ts';
test('prototype author extraction retains browser effects for the archived module compiler',()=>{
 const script='window.setInterval(()=>document.body.dataset.tick=String(Date.now()),1000);';
 const source='<Helmet><script>{'+JSON.stringify(script)+'}</script></Helmet><p id="status">Ready</p>';
 assert.throws(()=>prepareAuthorDocument(source));
 const result=prepareAuthorDocument(source,'offline-prototype');
 assert.equal(result.author.script,script);
 assert.deepEqual(result.author.exports,[]);
 assert.equal(result.source,'<Helmet></Helmet><p id="status">Ready</p>');
});
test('prototype retains default module exports without inventing an implicit component mount',()=>{
 const script='export default function App(){ return null; }';
 const source='<Helmet><script>{'+JSON.stringify(script)+'}</script></Helmet><p>Saved content</p>';
 assert.throws(()=>prepareAuthorDocument(source),/Default author exports unsupported/);
 const result=prepareAuthorDocument(source,'offline-prototype');
 assert.equal(result.author.script,script);assert.deepEqual(result.author.exports,[]);assert.deepEqual(result.author.mounts,[]);
});
