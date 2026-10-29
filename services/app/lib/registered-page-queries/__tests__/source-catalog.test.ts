import {it,expect} from 'vitest';
import type {DatasetCatalog} from '@/lib/datasets';
import {registeredSourceCatalog} from '../source-catalog';
it('keeps stored model dependencies and their complete object budget',()=>{
 const catalog:DatasetCatalog={kind:'stored',defaultSchema:'public',refreshSeconds:0,tables:[{schema:'public',name:'base',columns:[{name:'amount',type:'number'}],objectKey:'dataset/base'},{schema:'public',name:'rows',columns:[{name:'amount',type:'number'}],sql:'select amount*2 as amount from base'}]};
 const source=registeredSourceCatalog(catalog,'rows',false);
 expect(source.catalog).toBe(catalog);expect(source.selected.sql).toContain('amount*2');expect(source.storedObjects).toEqual([{key:'dataset/base',columns:1}]);
 expect(()=>registeredSourceCatalog(catalog,'missing',false)).toThrow('query_source_unsupported');
 expect(()=>registeredSourceCatalog(catalog,'rows',true)).toThrow('query_source_unsupported');
});
it('admits connected notebook tables only with a dataset-owned connection reference',()=>{
 const catalog:DatasetCatalog={kind:'postgres',defaultSchema:'public',refreshSeconds:0,connection:{host:'database.invalid',port:5432,database:'fixture',username:'reader',ssl:true,passwordSecretId:'sec_fixture'},notebook:{cells:[{id:'model',name:'model',sql:'select 1 as amount'}]},tables:[{schema:'public',name:'rows',columns:[{name:'amount',type:'number'}],modelCellId:'model'}]};
 expect(registeredSourceCatalog(catalog,'rows',false)).toMatchObject({catalog,storedObjects:[]});
 expect(()=>registeredSourceCatalog({...catalog,connection:undefined},'rows',false)).toThrow('query_source_unsupported');
});
