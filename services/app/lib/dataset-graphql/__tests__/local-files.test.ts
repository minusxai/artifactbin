import {mkdtemp,writeFile,symlink,rm,truncate} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe,it,expect} from 'vitest';
import {loadLocalDataset} from '../local-files';
import {createLocalPreviewDatasets} from '../local-preview';
describe('local dataset file boundary',()=>{
 it('reuses CSV precision/empty semantics and exposes real composed GraphQL',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'local-dataset-'));
 try{
 await writeFile(path.join(root,'sales.csv'),'id,text,amount\n9007199254740993,"",2\n9007199254740994,,5\n');
 const local=await loadLocalDataset(root,'sales',[{path:'sales.csv',table:'sales'}]);
 const exported=local.export();expect(exported.tables[0]!.rows).toEqual([{id:'9007199254740993',text:'',amount:2},{id:'9007199254740994',text:null,amount:5}]);
 const preview=await createLocalPreviewDatasets(root,[{name:'localSales',files:[{path:'sales.csv',table:'sales'}]}]);
 const reply=await preview.execute({query:'{ localSales { schema { revision tables { id label columns { id type } } } } }'},new AbortController().signal);
 expect(reply.errors).toBeUndefined();expect(JSON.stringify(reply.data)).toContain('sales');
 expect(preview.export('localSales').tables[0]!.rows).toEqual(exported.tables[0]!.rows);
 await expect(loadLocalDataset(root,'bad',[{path:'../secret.csv',table:'bad'}])).rejects.toThrow('local_dataset_path');
 await symlink('/etc/hosts',path.join(root,'escape.csv'));
 await expect(loadLocalDataset(root,'bad',[{path:'escape.csv',table:'bad'}])).rejects.toThrow('local_dataset_path');
 }finally{await rm(root,{recursive:true,force:true});}
 });
});
it('uses a trusted bounded immutable reader without rereading filesystem data',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'local-dataset-reader-'));
 try{
 const paths:string[]=[];
 const preview=await createLocalPreviewDatasets(root,[{name:'localSales',files:[{path:'not-on-disk.csv',table:'sales'}]}],{readText:async relative=>{paths.push(relative);return 'amount\n2\n';}});
 expect(paths).toEqual(['not-on-disk.csv']);expect(preview.export('localSales').tables[0]!.rows).toEqual([{amount:2}]);
 }finally{await rm(root,{recursive:true,force:true});}
});

it('refuses oversized declared files before loading their contents',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'local-dataset-size-'));
 try{const target=path.join(root,'large.csv');await writeFile(target,'');await truncate(target,32*1024*1024+1);
 await expect(loadLocalDataset(root,'large',[{path:'large.csv',table:'large'}])).rejects.toThrow('local_dataset_file_size');
 }finally{await rm(root,{recursive:true,force:true});}
});
