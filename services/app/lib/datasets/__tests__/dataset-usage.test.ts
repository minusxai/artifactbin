import {describe,it,expect} from 'vitest';
import {datasetCreateFields,datasetQuerySnippet} from '../dataset-usage';
const LEGACY=/schema\{|rows\(tableId|writeRows|data-af-api|expectedRevision|columnId/;
describe('native dataset authoring hints',()=>{
 it('returns a complete native HTML page that reads the linked table with sql, never GraphQL',()=>{
  const result=datasetCreateFields('abc123',[{name:'amount',type:'number'},{name:'Created By',type:'string'}],2);
  expect(result.usage).toContain('<!doctype html>');expect(result.usage).toContain(datasetQuerySnippet('abc123'));
  expect(result.usage).toContain("import {sql} from '@afbin/apollo';");
  expect(result.usage).toContain('sql`select * from data limit 1000`');
  expect(result.usage).toContain('sql.mjs schema abc123');
  expect(result.usage).not.toMatch(/\bgql\b|client\.query|graphql/i);
  expect(result.usage).not.toMatch(LEGACY);
  expect(result.usage).not.toMatch(/<Helmet|<Import|<Query|<Chart|afbin push/);
 });
 it('teaches sql writes and permissions for writable datasets',()=>{
  const result=datasetCreateFields('abc123',[],2,undefined,'readwrite');
  expect(result.writes).toContain('insert into data');expect(result.writes).toContain('update data set');expect(result.writes).toContain('policy.mjs template NAME abc123');
  expect(result.writes).toContain('sql.mjs schema abc123');expect(result.writes).not.toMatch(/_by_pk|insert_data_one|graphql/i);
  expect(result.writes).not.toMatch(LEGACY);
 });
 it('names the retained metadata API when writes are disabled',()=>{
  const result=datasetCreateFields('abc123',[],0);expect(result.writes).toContain('PATCH /api/my/artifacts/abc123');expect(result.writes).not.toContain('afbin');
 });
});
