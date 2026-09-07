import {expect,it} from 'vitest';
import {useAppHarness} from './harness';
import {mintToken} from '@/lib/tokens';
import {prepareCatalog,catalogOf} from '@/lib/datasets/catalog';
useAppHarness();
it('stores multiple named tables with a stable default schema and preserves their independent shapes',async()=>{
 const t=await mintToken('owner');const c=await prepareCatalog({kind:'stored',defaultSchema:'sales',tables:[{schema:'sales',name:'orders',rows:[{id:1,total:12}]},{schema:'support',name:'tickets',rows:[{subject:'Hello'}]}]},{tokenId:t.id,userId:null});
 expect(c).not.toBeInstanceOf(Response);if(c instanceof Response)return;
 const catalog=catalogOf(c)!;expect(catalog.defaultSchema).toBe('sales');expect(catalog.tables).toHaveLength(2);
 expect(catalog.tables[0].columns.map(c=>c.name)).toEqual(['id','total']);expect(catalog.tables[1].columns.map(c=>c.name)).toEqual(['subject']);
 expect(catalog.tables.every(t=>!!t.objectKey)).toBe(true);
});
it('rejects duplicate table names and empty exposed catalogs',async()=>{
 const t=await mintToken('owner');const actor={tokenId:t.id,userId:null};
 expect((await prepareCatalog({kind:'stored',tables:[]},actor) as Response).status).toBe(400);
 const table={schema:'public',name:'rows',rows:[{n:1}]};
 expect((await prepareCatalog({kind:'stored',tables:[table,table]},actor) as Response).status).toBe(400);
});
it('normalizes a legacy single-table dataset to public.rows without guessing from table count',()=>{
 expect(catalogOf({meta:{columns:[{name:'n',type:'number'}],objectKey:'legacy'}})).toMatchObject({kind:'stored',defaultSchema:'public',tables:[{schema:'public',name:'rows',objectKey:'legacy'}]});
});
