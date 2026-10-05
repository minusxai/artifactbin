import {describe,it,expect} from 'vitest';
import {createDocumentGraph,graphSource} from '@/lib/story/graph/document-graph';
import {prepareHostedFileUpdate} from '../hosted-connect';
import {artifactFile} from './fixture';
describe('offline hosted update preparation',()=>{
 it('prepares a JSONB patch against the verified original baseline instead of a whole replacement',()=>{
  const source='<div id="root"><p id="first">One</p><p id="second">Two</p></div>';
  const file=artifactFile();file.base={version:1,editId:'edit1',source};file.source=source.replace('One','Offline');
  const base={document:createDocumentGraph(source,1),version:1,markup:source,meta:{}};
  const update=prepareHostedFileUpdate(file,base);
  expect(update.schema).toBe(1);expect(update.patch).toBeDefined();expect(update.replacement).toBeUndefined();
  expect(graphSource(base.document)).toBe(source);
 });
 it('refuses forged baseline source before producing an update',()=>{
  const file=artifactFile();const source='<p id="text">Original</p>';file.base={version:1,editId:'edit1',source:'<p id="text">Forged</p>'};
  expect(()=>prepareHostedFileUpdate(file,{document:createDocumentGraph(source,1),version:1,markup:source,meta:{}})).toThrow(/baseline/i);
 });
});
