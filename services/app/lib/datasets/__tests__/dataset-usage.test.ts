import {describe,it,expect} from 'vitest';
import {datasetCreateFields,datasetQuerySnippet} from '../dataset-usage';
import type {DatasetCatalog} from '../types';
const postgres:DatasetCatalog={kind:'postgres',refreshSeconds:60,defaultSchema:'public',tables:[{schema:'public',name:'orders',columns:[{name:'amount',type:'number'}]}]};
describe('native dataset authoring hints',()=>{
 it('returns a complete native HTML page with schema discovery and bounded typed rows',()=>{
  const result=datasetCreateFields('abc123',[{name:'amount',type:'number'}],2);
  expect(result.usage).toContain('<!doctype html>');expect(result.usage).toContain(datasetQuerySnippet('abc123'));
  expect(result.usage).toContain('schema{revision tables{id label');expect(result.usage).toContain('first:100');expect(result.usage).toContain('pageInfo{hasNextPage endCursor}');
  expect(result.usage).not.toMatch(/<Helmet|<Import|<Query|<Chart|afbin push/);
 });
 it('teaches current revision and idempotent typed writes through GraphQL',()=>{
  const result=datasetCreateFields('abc123',[],2,undefined,'readwrite');
  expect(result.writes).toContain('writeRows');expect(result.writes).toContain('expectedRevision');expect(result.writes).toContain('requestId');expect(result.writes).toContain('policy');
 });
 it('names the retained metadata API when writes are disabled',()=>{
  const result=datasetCreateFields('abc123',[],0);expect(result.writes).toContain('PATCH /api/my/artifacts/abc123');expect(result.writes).not.toContain('afbin');
 });
 it('does not advertise unsupported PostgreSQL native dataset bindings or writes',()=>{
  const result=datasetCreateFields('abc123',[],2,{catalog:postgres},'readwrite');expect(result.access).toBe('read');expect(result.usage).not.toContain('<link');expect(result.writes).toMatch(/PostgreSQL.*read-only/);
 });
});
