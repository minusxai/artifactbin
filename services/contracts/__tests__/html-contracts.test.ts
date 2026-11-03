import {ARTIFACT_FORMATS,TEXT_CONTENT_FIELDS} from '../src/artifact-format';
import {describe,it,expect} from 'vitest';
import {parseHtmlNodeAnchor} from '../src/html-annotation';
import {datasetRoleFrom} from '../src/dataset-permissions';
describe('HTML product contracts',()=>{
 it('accepts authored HTML as first-class content',()=>{expect(ARTIFACT_FORMATS).toContain('html');expect(TEXT_CONTENT_FIELDS).toContain('html');});
 it('keeps annotation roles distinct from resolver write roles',()=>{
  // Resolver roles are now the page role from datasetRoleFrom (the Hasura names); a commenter share is viewer.
  expect((['none','viewer','commenter','editor','owner'] as const).map(held=>datasetRoleFrom({held,account:true,linkRole:'none',visibility:'private',throughPage:false}))).toEqual([null,'viewer','viewer','editor','owner']);
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
});
