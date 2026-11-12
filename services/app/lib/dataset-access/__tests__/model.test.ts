import {describe,it,expect} from 'vitest';
import {tableIdentity,initialRowIds,rowIdsForObject} from '../model';
const table={schema:'public',name:'rows',columns:[{name:'label',type:'string' as const},{name:'amount',type:'number' as const},{name:'date',type:'date' as const}],objectKey:'blob'};
const id=tableIdentity(table);
describe('dataset stable row identity',()=>{
 it('allocates reproducible opaque row identities per original object',()=>{
  expect(initialRowIds('dataset',id,'blob',2)).toEqual(initialRowIds('dataset',id,'blob',2));
  expect(initialRowIds('dataset',id,'blob',2)[0]).not.toEqual(initialRowIds('dataset',id,'blob2',2)[0]);
 });
 it('preserves saved identities and refuses a corrupt matching sidecar',()=>{
  expect(rowIdsForObject('dataset',id,'blob',1,{objectKey:'blob',ids:['stable']})).toEqual(['stable']);
  expect(()=>rowIdsForObject('dataset',id,'blob',1,{objectKey:'blob',ids:[]})).toThrow('dataset_row_identity_corrupt');
  expect(rowIdsForObject('dataset',id,'replacement',1,{objectKey:'blob',ids:['stable']})).not.toEqual(['stable']);
 });
});
