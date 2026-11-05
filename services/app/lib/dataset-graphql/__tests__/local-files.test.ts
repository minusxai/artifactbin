import {mkdtemp,writeFile,symlink,rm,truncate} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe,it,expect} from 'vitest';
import {loadLocalTables} from '../local-files';
import {createLocalPreviewDatasets} from '../local-preview';
describe('local dataset file boundary',()=>{
 it('reuses CSV precision/empty semantics and exposes real composed GraphQL',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'local-dataset-'));
 try{
 await writeFile(path.join(root,'sales.csv'),'id,text,amount\n9007199254740993,"",2\n9007199254740994,,5\n');
 const tables=await loadLocalTables(root,[{path:'sales.csv',table:'sales'}]);
 expect(tables[0]!.rows).toEqual([{id:'9007199254740993',text:'',amount:2},{id:'9007199254740994',text:null,amount:5}]);
 const preview=await createLocalPreviewDatasets(root,[{name:'localSales',files:[{path:'sales.csv',table:'sales'}]}]);
 const reply=await preview.execute({query:'{ localSales(order_by: {amount: asc}) { id text amount } }'},new AbortController().signal);
 expect(reply).toEqual({data:{localSales:[{id:'9007199254740993',text:'',amount:2},{id:'9007199254740994',text:null,amount:5}]}});
 expect(preview.export('localSales').tables[0]!.rows).toEqual(tables[0]!.rows);
 await expect(loadLocalTables(root,[{path:'../secret.csv',table:'bad'}])).rejects.toThrow('local_dataset_path');
 await symlink('/etc/hosts',path.join(root,'escape.csv'));
 await expect(loadLocalTables(root,[{path:'escape.csv',table:'bad'}])).rejects.toThrow('local_dataset_path');
 }finally{await rm(root,{recursive:true,force:true});}
 });
});
it('uses a trusted bounded immutable reader without rereading filesystem data',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'local-dataset-reader-'));
 try{
 const paths:string[]=[];
 const preview=await createLocalPreviewDatasets(root,[{name:'localSales',files:[{path:'not-on-disk.csv',table:'sales'}]}],{readText:async relative=>{paths.push(relative);return 'amount\n2\n';}});
 expect(await preview.status()).toEqual({dirty:false,namespaces:[]});
 const reply=await preview.execute({query:'mutation { insert_localSales_one(object: {amount: 3}) { amount } }'},new AbortController().signal);
 expect(reply.errors).toBeUndefined();expect(await preview.status()).toEqual({dirty:true,namespaces:['localSales']});
 expect(paths).toEqual(['not-on-disk.csv']);expect(preview.export('localSales').tables[0]!.rows).toEqual([{amount:2},{amount:3}]);
 }finally{await rm(root,{recursive:true,force:true});}
});

it('refuses oversized declared files before loading their contents',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'local-dataset-size-'));
 try{const target=path.join(root,'large.csv');await writeFile(target,'');await truncate(target,32*1024*1024+1);
 await expect(loadLocalTables(root,[{path:'large.csv',table:'large'}])).rejects.toThrow('local_dataset_file_size');
 }finally{await rm(root,{recursive:true,force:true});}
});

it('previews every local link on the generated API: flat roots, where/aggregate, atomic idempotent writes, export',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'local-dataset-hasura-'));
 try{
 const files:Record<string,string>={'orders.csv':'region,amount,paid\nwest,3,true\neast,5,false\nwest,,false\n','notes.csv':'text\nhi\n'};
 const preview=await createLocalPreviewDatasets(root,[{name:'orders',files:[{path:'orders.csv',table:'orders'}]},{name:'notes',files:[{path:'notes.csv',table:'notes'}]}],{readText:async relative=>files[relative]!});
 expect(preview.datasets).toEqual(['orders','notes']);
 expect(preview.schema.sdl).toContain('orders(where: orders_bool_exp');
 expect(preview.schema.sdl).toContain('notes(where: notes_bool_exp');
 const signal=new AbortController().signal;
 const read=await preview.execute({query:'{ orders(where: {region: {_eq: "west"}}, order_by: {amount: desc}) { region amount paid } orders_aggregate { aggregate { count sum { amount } max { region } } } }'},signal);
 expect(read).toEqual({data:{orders:[{region:'west',amount:null,paid:false},{region:'west',amount:3,paid:true}],orders_aggregate:{aggregate:{count:3,sum:{amount:8},max:{region:'west'}}}}});
 const add={query:'mutation { insert_orders(objects: [{region: "north", amount: 1}, {region: "south", paid: true}]) { affected_rows returning { _id region paid } } }',idempotencyKey:'local_key_0123456789'};
 const first=await preview.execute(add,signal);
 expect(first).toMatchObject({data:{insert_orders:{affected_rows:2,returning:[{region:'north',paid:null},{region:'south',paid:true}]}},extensions:{outcomes:{insert_orders:'committed'}}});
 // The same key replays the reply and writes nothing; the session is dirty for export.
 expect(await preview.execute(add,signal)).toEqual(first);
 expect(await preview.status()).toEqual({dirty:true,namespaces:['orders']});
 const bump=await preview.execute({query:'mutation { update_orders(where: {region: {_eq: "west"}, amount: {_is_null: false}}, _inc: {amount: 10}) { affected_rows returning { amount } } delete_orders(where: {region: {_eq: "east"}}) { affected_rows } }'},signal);
 expect(bump.data).toEqual({update_orders:{affected_rows:1,returning:[{amount:13}]},delete_orders:{affected_rows:1}});
 // Too many rows: nothing is written.
 const many=await preview.execute({query:`mutation { insert_orders(objects: [${Array.from({length:101},()=>'{region: "x"}').join(',')}]) { affected_rows } }`},signal);
 expect(many.extensions?.outcomes).toEqual({insert_orders:'rejected'});
 const exported=preview.export('orders').tables[0]!;
 expect(exported.rows).toEqual([{region:'west',amount:13,paid:true},{region:'west',amount:null,paid:false},{region:'north',amount:1,paid:null},{region:'south',amount:null,paid:true}]);
 expect(new Set(exported.rowIds).size).toBe(4);
 expect((await preview.execute({query:'{ notes { text } }'},signal)).data).toEqual({notes:[{text:'hi'}]});
 // The previewing owner may change everything: the capability answers are true, the page's included.
 expect((await preview.execute({query:'{ viewer { canEdit } notes_can { insert } notes { _can { update delete } } }'},signal)).data).toEqual({viewer:{canEdit:true},notes_can:{insert:true},notes:[{_can:{update:true,delete:true}}]});
 const added=await preview.execute({query:'mutation { insert_notes_one(object: {text: "yo"}) { text _can { delete } } }'},signal);
 expect(added.data).toEqual({insert_notes_one:{text:'yo',_can:{delete:true}}});
 }finally{await rm(root,{recursive:true,force:true});}
});
