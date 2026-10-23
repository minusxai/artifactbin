import {ARTIFACT_FORMATS,TEXT_CONTENT_FIELDS} from '../src/artifact-format';
import {describe,it,expect} from 'vitest';
import {parseHtmlNodeAnchor} from '../src/html-annotation';
import {pageResolverRole} from '../src/page-operation';
import {datasetRequestProblem,DATASET_GRAPHQL_SDL,datasetCellFromWire} from '../src/dataset-graphql';
import {DATASET_READ_FIXTURE,DATASET_WRITE_FIXTURE} from './dataset-graphql-fixture';
import type {HtmlDatasetLink} from '../src/html-page';
const live:HtmlDatasetLink={kind:'dataset',name:'records',datasetId:'dataset-a',mode:'live'};
describe('HTML product contracts',()=>{
 it('accepts authored HTML as first-class content',()=>{expect(ARTIFACT_FORMATS).toContain('html');expect(TEXT_CONTENT_FIELDS).toContain('html');});
 it('refuses ambiguous or non-JSON typed cell inputs before resolver dispatch',()=>{
  expect(datasetCellFromWire({type:'NUMBER',number:3})).toEqual({type:'NUMBER',value:3});
  expect(datasetCellFromWire({type:'NUMBER',number:Infinity})).toBeNull();
  expect(datasetCellFromWire({type:'STRING',string:'x',number:3})).toBeNull();
  expect(datasetCellFromWire({type:'JSON',json:{bad:NaN}})).toBeNull();
 });
 it('keeps annotation roles distinct from resolver write roles',()=>{
  expect(['none','viewer','commenter','editor','owner'].map(r=>pageResolverRole(r as Parameters<typeof pageResolverRole>[0]))).toEqual([null,'VIEWER','VIEWER','EDITOR','OWNER']);
 });
 it('accepts explicit historical HTML anchors and refuses AST paths and invalid ranges',()=>{
  const anchor={kind:'html-node',v:1,revision:'revision-a',nodeId:'n12',quote:'selected',range:{start:1,end:4,length:7,fingerprint:'text-a'}};
  expect(parseHtmlNodeAnchor(anchor)).toEqual(anchor);
  expect(parseHtmlNodeAnchor({...anchor,path:[1,2]})).toBeNull();
  expect(parseHtmlNodeAnchor({...anchor,kind:'node'})).toBeNull();
  expect(parseHtmlNodeAnchor({...anchor,range:{...anchor.range,end:8}})).toBeNull();
  expect(parseHtmlNodeAnchor({...anchor,nodeId:null})).toBeNull();
  expect(parseHtmlNodeAnchor({...anchor,revision:''})).toBeNull();
 });
 it('never authorizes writes to pinned archived dataset bindings',()=>{
  const write={tableId:'table-a',expectedRevision:'rev-a',requestId:'req-a',changes:[{kind:'DELETE' as const,rowId:'row-a'}]};
  expect(datasetRequestProblem(live,write)).toBeNull();
  expect(datasetRequestProblem({...live,mode:'pinned',revision:'rev-a'},write)).toBe('pinned_dataset_readonly');
  expect(datasetRequestProblem(live,{...write,expectedRevision:''})).toBe('write_identity_required');
 });
 it('keeps projected cells addressable after labels change',()=>{
  const column=DATASET_READ_FIXTURE.columns[0]!;
  expect({...column,label:'Renamed'} .id).toBe(DATASET_READ_FIXTURE.rows[0]!.cells[0]!.columnId);
  expect(datasetRequestProblem(live,DATASET_WRITE_FIXTURE)).toBeNull();
 });
 it('bounds reads and writes independently of dataset display schema',()=>{
  expect(datasetRequestProblem(live,{tableId:'table-a',first:101})).toBe('invalid_page_size');
  expect(datasetRequestProblem(live,{tableId:'table-a',first:100})).toBeNull();
  expect(datasetRequestProblem(live,{tableId:'table-a',expectedRevision:'a',requestId:'b',changes:[]})).toBe('invalid_changes');
  expect(DATASET_GRAPHQL_SDL).toContain('columnId: ID!');
 });
});
