import {expect,it} from 'vitest';
import {createDatasetGraphql} from '../index';
import type {DatasetGraphqlPort} from '../types';
it('discovers stable table and column IDs without knowing display schema',async()=>{
 const port:DatasetGraphqlPort={snapshot:async()=>({id:'dataset',revision:'1',policyIdentity:'policy',catalog:{kind:'stored',defaultSchema:'public',refreshSeconds:0,tables:[{schema:'public',name:'records',columns:[{name:'joined',type:'date'}],objectKey:'blob'}]},rowIds:{}}),execute:async()=>[],commit:async()=>{throw new Error('unused');}};
 const api=createDatasetGraphql(port),schema=await api.schema({userId:null,tokenId:null,email:null,documentEditor:false},{kind:'dataset',name:'data',datasetId:'dataset',mode:'live'},new AbortController().signal);
 expect(schema.tables[0]!.columns[0]).toMatchObject({label:'joined',type:'STRING',sourceType:'date'});
 expect(schema.tables[0]!.id).toMatch(/^t_/);expect(schema.tables[0]!.columns[0]!.id).toMatch(/^c_/);
});
