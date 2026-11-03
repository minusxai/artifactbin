import {describe,it,expect} from 'vitest';
import {datasetCreateFields,datasetQuerySnippet} from '../dataset-usage';
import type {DatasetCatalog} from '../types';
const postgres:DatasetCatalog={kind:'postgres',refreshSeconds:60,defaultSchema:'public',tables:[{schema:'public',name:'orders',columns:[{name:'amount',type:'number'}]}]};
const LEGACY=/schema\{|rows\(tableId|writeRows|data-af-api|expectedRevision|columnId/;
describe('native dataset authoring hints',()=>{
 it('returns a complete native HTML page that reads every row through the generated API with the columns\' field names',()=>{
  const result=datasetCreateFields('abc123',[{name:'amount',type:'number'},{name:'Created By',type:'string'}],2);
  expect(result.usage).toContain('<!doctype html>');expect(result.usage).toContain(datasetQuerySnippet('abc123'));
  expect(result.usage).toContain('data(limit:1000,offset:$offset){_id amount created_by}');
  expect(result.usage).toContain('graphql.mjs schema abc123');
  expect(result.usage).not.toMatch(LEGACY);
  expect(result.usage).not.toMatch(/<Helmet|<Import|<Query|<Chart|afbin push/);
 });
 it('teaches the generated mutations and permissions for writable datasets',()=>{
  const result=datasetCreateFields('abc123',[],2,undefined,'readwrite');
  expect(result.writes).toContain('insert_data_one');expect(result.writes).toContain('update_data_by_pk');expect(result.writes).toContain('policy.mjs template NAME abc123');
  expect(result.writes).not.toMatch(LEGACY);
 });
 it('names the retained metadata API when writes are disabled',()=>{
  const result=datasetCreateFields('abc123',[],0);expect(result.writes).toContain('PATCH /api/my/artifacts/abc123');expect(result.writes).not.toContain('afbin');
 });
 it('does not advertise unsupported PostgreSQL native dataset bindings or writes',()=>{
  const result=datasetCreateFields('abc123',[],2,{catalog:postgres},'readwrite');expect(result.access).toBe('read');expect(result.usage).not.toContain('<link');expect(result.writes).toMatch(/PostgreSQL.*read-only/);
 });
});
