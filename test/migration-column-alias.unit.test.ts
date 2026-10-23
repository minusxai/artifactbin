import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {repairLegacyColumnAliases} from "../src/migration/conversion/column-alias.ts";
import {SqliteDatabase} from "../src/datasets/sql/engine/database.ts";
import {loadSqliteModule} from "../src/datasets/sql/engine/wasm.ts";
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const sql='select * from items.rows order by id';
const source='<Helmet><Import name="items" src="ref:Abcd12"/><Query name="rows">{`'+sql+'`}</Query><Mutation name="remove">{`delete from items.rows where id=$_row.id`}</Mutation></Helmet><DataTable data="$rows"><Column col="label"><Button run="$remove">Delete</Button></Column></DataTable>';
const table={schema:'public',table:'rows',columns:[{name:'id',type:'number' as const},{name:'label_text',type:'string' as const}]};
const binding={name:'items',legacyRef:'ref:Abcd12',mode:'live' as const,version:3,backendNamespace:'legacyData',backendHref:'/af/v1/ids/Bk1234',tables:[table]};
const admission={version:'column-alias-v1' as const,sourceSha256:hash(source),queryName:'rows',querySha256:hash(sql),bindingName:'items',legacyRef:'ref:Abcd12',datasetVersion:3,tableSha256:hash(JSON.stringify(table)),from:'label',to:'label_text'};
test('audited rename projects display alias and keeps row identity and delete SQL intact',async()=>{
 const result=repairLegacyColumnAliases(source,[binding],[admission]);
 assert.match(result.source,/select \*, "label_text" AS "label" from items.rows order by id/);
 assert.ok(result.source.includes('delete from items.rows where id=$_row.id'));
 assert.equal(result.receipts[0]?.inference,'audited-column-rename');
 assert.equal(repairLegacyColumnAliases(source,[],[]).source,source);
 const db=new SqliteDatabase(await loadSqliteModule());try{
 db.load({...table,schema:'items',rows:[{id:7,label_text:'visible'}]});
 const read=db.prepare('select *, "label_text" AS "label" from items.rows order by id','read');const row=read.bind({}).rows(10,1000).rows[0]!;read.finalize();assert.equal(row.label,'visible');assert.equal(row.id,7);
 const del=db.prepare('delete from items.rows where id=$row__id','write');del.bind({row__id:row.id}).run(1000);del.finalize();const after=db.prepare('select * from items.rows','read');assert.deepEqual(after.bind({}).rows(10,1000).rows,[]);after.finalize();
 }finally{db.close();}
});
test('rename repair requires exact source, query, dataset version and schema',()=>{
 assert.equal(repairLegacyColumnAliases(source+' ',[binding],[admission]).source,source+' ');
 for(const patch of [{querySha256:'a'.repeat(64)},{datasetVersion:4},{tableSha256:'b'.repeat(64)},{bindingName:'other'}])assert.throws(()=>repairLegacyColumnAliases(source,[binding],[{...admission,...patch}]));
 assert.throws(()=>repairLegacyColumnAliases(source,[binding],[admission,admission]));
});
