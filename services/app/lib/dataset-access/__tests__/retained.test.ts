import {expect,it} from 'vitest';
import { setDatasetPolicy } from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import {useAppHarness,request,mintAccountToken} from '@/__tests__/harness';
import {POST as create} from '@/app/api/artifacts/route';
import {getArtifactById} from '@/lib/artifacts';
import { requestOrSessionActor } from '@/lib/authentication';
import type { AccessActor } from '@/lib/accounts';
import {loadDatasetRows} from '@/lib/datasets';
import {linkedSql,errorCode,liveLink} from '@/__tests__/linked-datasets';
useAppHarness();
/** The retained storage, executor and grants under the generated API, as a page reader with the link named data. */
async function fixture(dataset:Record<string,unknown>[]|string=[{amount:1,label:'same'},{amount:1,label:'same'},{amount:3,label:null}]){
 const owner=await mintAccountToken('dataset_sql_fixture');
 const req=request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset,access:'readwrite'}});
 const actor=await requestOrSessionActor(req),response=await create(req);expect(response.status,await response.clone().text()).toBe(201);
 const {id}=await response.json(),link=liveLink(id);
 return {actor,link,id,sql:(who:AccessActor,query:string,variables?:Record<string,unknown>)=>linkedSql(who,link,query,variables?{variables}:{})};
}
type Row={_id:string;amount:number|null;label?:string|null};
it('gives duplicate rows stable distinct identities, commits a mixed edit and stores no identity column',async()=>{
 const f=await fixture(),read=(await f.sql(f.actor,'select _id, amount, label from data')).rows! as Row[];
 expect(read).toHaveLength(3);expect(new Set(read.map(r=>r._id)).size).toBe(3);
 const target=read[0]!._id,removed=read[1]!._id;
 const edit=await f.sql(f.actor,'update data set amount = 9.25 where _id = $t',{t:target});
 expect(edit.error).toBeUndefined();
 expect((await f.sql(f.actor,'delete from data where _id = $r',{r:removed})).affected).toBe(1);
 const inserted=(await f.sql(f.actor,'insert into data(amount) values(0)')).returning![0]!._id;
 const next=(await f.sql(f.actor,'select _id, amount from data')).rows! as Row[];
 expect(next.find(r=>r._id===target)!.amount).toBe(9.25);
 expect(next.some(r=>r._id===removed)).toBe(false);
 expect(next.some(r=>r._id===inserted)).toBe(true);
 expect((await getArtifactById(f.id))!.version).toBe(4);
 const raw=await loadDatasetRows((await getArtifactById(f.id))!);
 expect(raw.every(r=>!Object.keys(r).some(k=>k.startsWith('__af_')))).toBe(true);
});
it('requires dataset permission separately from page readability and enforces the insert check',async()=>{
 const f=await fixture();
 await (await getDb()).query("UPDATE artifacts SET visibility='public' WHERE id=$1",[f.id]);
 const viewer={userId:null,tokenId:null,email:null,documentEditor:false};
 expect((await f.sql(viewer,'select amount from data')).rows!).toHaveLength(3);
 const add=(amount:number)=>f.sql(viewer,'insert into data(amount) values($a)',{a:amount});
 expect((await add(2)).affected??0).toBe(0);
 const roles=['viewer','signed_in','anonymous'];
 await setDatasetPolicy(f.actor,f.id,{version:3,tables:[{table:{schema:'public',name:'rows'},select_permissions:roles.map(role=>({role,permission:{columns:'*',filter:{},allow_aggregations:true}})),insert_permissions:roles.map(role=>({role,permission:{columns:['amount'],check:{amount:{_gt:0}}}}))}]},0);
 expect((await add(2)).error).toBeUndefined();
 expect((await add(-1)).error).toBeTruthy();
 expect((await getArtifactById(f.id))!.version).toBe(2);
 await (await getDb()).query("UPDATE artifacts SET visibility='private' WHERE id=$1",[f.id]);
 expect(errorCode(await f.sql(viewer,'select amount from data'))).toBe('dataset_not_found');
});
it('keeps native CSV precision, BOM, duplicate headers, date strings and distinct empty/missing-cell semantics',async()=>{
 const f=await fixture('\uFEFFamount,amount,when,note,exact,precise,blank\r\n1.25,2,2026-10-23,"",9007199254740993,123456789012345.12,\r\n3.5,4,2026-10-24,x,9007199254740995,123456789012345.13,');
 const read=await f.sql(f.actor,'select amount, amount_2, "when", note, exact, precise, blank from data order by amount');
 expect(read.error).toBeUndefined();
 expect(read.rows!).toEqual([{amount:1.25,amount_2:2,when:'2026-10-23',note:'',exact:'9007199254740993',precise:'123456789012345.12',blank:null},{amount:3.5,amount_2:4,when:'2026-10-24',note:'x',exact:'9007199254740995',precise:'123456789012345.13',blank:null}]);
});
it('keeps the original header-only CSV rejection instead of inventing data rows',async()=>{
 const owner=await mintAccountToken('empty_csv_fixture');
 const response=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:'amount,label'}}));
 expect(response.status).toBe(400);expect(await response.json()).toMatchObject({error:'invalid_dataset',code:'empty'});
});
it('refuses remote PostgreSQL catalogs before executing native dataset reads or writes',async()=>{
 const f=await fixture();const db=await getDb();
 await db.query(`UPDATE artifacts SET meta=jsonb_set(meta,'{catalog,kind}','"postgres"'::jsonb) WHERE id=$1`,[f.id]);
 expect(errorCode(await f.sql(f.actor,'select amount from data'))).toBe('dataset_not_found');
 expect(errorCode(await f.sql(f.actor,'delete from data'))).toBe('dataset_not_found');
 expect((await getArtifactById(f.id))?.version).toBe(1);
});
