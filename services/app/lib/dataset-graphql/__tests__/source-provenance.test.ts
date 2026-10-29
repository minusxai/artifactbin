import {expect,it} from 'vitest';
import {useAppHarness,request,mintAccountToken} from '@/__tests__/harness';
import {POST as create} from '@/app/api/artifacts/route';
import { requestOrSessionActor } from '@/lib/authentication';
import {MAX_ROWS_LIMIT} from '@/lib/platform';
import {createRetainedDatasetGraphql} from '../retained';
import {createDatasetNamespaceInvoker} from '../index';
import {DATASET_GRAPHQL_SDL} from '@artifactbin/contracts';
useAppHarness();
it('exposes original CSV truncation separately from full stored-source aggregate totals',async()=>{
 const {buildSchema,graphql}=await import('graphql'),owner=await mintAccountToken('source_provenance_fixture');
 const csv=['amount',...Array(MAX_ROWS_LIMIT+3).fill('1')].join('\n'),req=request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:csv}}),actor=await requestOrSessionActor(req),response=await create(req);
 expect(response.status).toBe(201);const {id}=await response.json(),binding={kind:'dataset' as const,name:'data',datasetId:id,mode:'live' as const},signal=new AbortController().signal,api=createRetainedDatasetGraphql(),discovery=await api.schema(actor,binding,signal),table=discovery.tables[0]!;
 expect(table.source).toEqual({truncated:true,totalRows:MAX_ROWS_LIMIT+3,storedRows:MAX_ROWS_LIMIT});
 const invoke=createDatasetNamespaceInvoker(actor,[binding],api),field=(name:string)=>(args:Record<string,unknown>)=>invoke({namespace:'data',fileId:id,version:'live',operation:'query',field:name,args:args as never,principal:{tenant:'page',subject:'viewer'},signal});
 const result=await graphql({schema:buildSchema(DATASET_GRAPHQL_SDL),rootValue:{schema:field('schema'),query:field('query')},source:'query($table:ID!){ schema { tables { source { truncated totalRows storedRows } } } query(tableId:$table,first:1,aggregates:[{id:"count",operation:COUNT}]) { source { truncated totalRows storedRows } rows { cells { columnId value { number } } } } }',variableValues:{table:table.id}});
 expect(result.errors).toBeUndefined();expect(result.data).toMatchObject({schema:{tables:[{source:{truncated:true,totalRows:MAX_ROWS_LIMIT+3,storedRows:MAX_ROWS_LIMIT}}]},query:{source:{truncated:true,totalRows:MAX_ROWS_LIMIT+3,storedRows:MAX_ROWS_LIMIT},rows:[{cells:[{columnId:'count',value:{number:MAX_ROWS_LIMIT}}]}]}});
});
