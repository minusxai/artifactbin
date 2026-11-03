import {expect,it} from 'vitest';
import { setDatasetPolicy } from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import {useAppHarness,request,mintAccountToken} from '@/__tests__/harness';
import {POST as create} from '@/app/api/artifacts/route';
import {getArtifactById} from '@/lib/artifacts';
import { requestOrSessionActor } from '@/lib/authentication';
import type { AccessActor } from '@/lib/accounts';
import {loadDatasetRows} from '@/lib/datasets';
import {linkedGql,errorCode,liveLink} from '@/__tests__/linked-datasets';
useAppHarness();
/** The retained storage, executor and grants under the generated API, as a page reader with the link named data. */
async function fixture(dataset:Record<string,unknown>[]|string=[{amount:1,label:'same'},{amount:1,label:'same'},{amount:3,label:null}]){
 const owner=await mintAccountToken('dataset_graphql_fixture');
 const req=request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset,access:'readwrite'}});
 const actor=await requestOrSessionActor(req),response=await create(req);expect(response.status,await response.clone().text()).toBe(201);
 const {id}=await response.json(),link=liveLink(id);
 return {actor,link,id,gql:(who:AccessActor,query:string,variables?:Record<string,unknown>)=>linkedGql(who,link,query,variables?{variables}:{})};
}
type Row={_id:string;amount:number|null;label?:string|null};
it('gives duplicate rows stable distinct identities, commits a mixed edit and stores no identity column',async()=>{
 const f=await fixture(),read=(await f.gql(f.actor,'{ data { _id amount label } }')).data!.data as Row[];
 expect(read).toHaveLength(3);expect(new Set(read.map(r=>r._id)).size).toBe(3);
 const target=read[0]!._id,removed=read[1]!._id;
 const edit=await f.gql(f.actor,'mutation($t:ID!,$r:ID!){ u: update_data_by_pk(pk_columns:{_id:$t},_set:{amount:9.25}){ _id } d: delete_data_by_pk(_id:$r){ _id } i: insert_data_one(object:{amount:0}){ _id } }',{t:target,r:removed});
 expect(edit.errors).toBeUndefined();
 const inserted=(edit.data!.i as {_id:string})._id;
 const next=(await f.gql(f.actor,'{ data { _id amount } }')).data!.data as Row[];
 expect(next.find(r=>r._id===target)!.amount).toBe(9.25);
 expect(next.some(r=>r._id===removed)).toBe(false);
 expect(next.some(r=>r._id===inserted)).toBe(true);
 expect((await getArtifactById(f.id))!.version).toBe(2);
 const raw=await loadDatasetRows((await getArtifactById(f.id))!);
 expect(raw.every(r=>!Object.keys(r).some(k=>k.startsWith('__af_')))).toBe(true);
});
it('requires dataset permission separately from page readability and enforces the insert check',async()=>{
 const f=await fixture();
 await (await getDb()).query("UPDATE artifacts SET visibility='public' WHERE id=$1",[f.id]);
 const viewer={userId:null,tokenId:null,email:null,documentEditor:false};
 expect((await f.gql(viewer,'{ data { amount } }')).data!.data).toHaveLength(3);
 const add=(amount:number)=>f.gql(viewer,'mutation($a:Float){ insert_data_one(object:{amount:$a}){ _id } }',{a:amount});
 expect((await add(2)).data?.insert_data_one??null).toBeNull();
 await setDatasetPolicy(f.actor,f.id,{version:1,enforcement:'enabled',tables:[{table:{schema:'public',name:'rows'},insert_permissions:[{role:'viewer',permission:{columns:['amount'],check:{amount:{_gt:0}}}}]}]},0);
 expect((await add(2)).errors).toBeUndefined();
 expect((await add(-1)).errors?.length).toBeGreaterThan(0);
 expect((await getArtifactById(f.id))!.version).toBe(2);
 await (await getDb()).query("UPDATE artifacts SET visibility='private' WHERE id=$1",[f.id]);
 expect(errorCode(await f.gql(viewer,'{ data { amount } }'))).toBe('dataset_not_found');
});
it('aggregates the whole stored source beyond display page limits',async()=>{
 const f=await fixture(Array.from({length:10005},(_,i)=>({amount:i+1,label:'all'})));
 const result=await f.gql(f.actor,'query($m:Float){ data_aggregate(where:{amount:{_gt:$m}}){ aggregate { count sum { amount } avg { amount } } } }',{m:0});
 expect(result.errors).toBeUndefined();
 expect(result.data).toEqual({data_aggregate:{aggregate:{count:10005,sum:{amount:50055015},avg:{amount:5003}}}});
});
it('preserves COUNT zero and nullable aggregate values for an empty filtered source',async()=>{
 const f=await fixture();
 const result=await f.gql(f.actor,'{ data_aggregate(where:{amount:{_gt:100}}){ aggregate { count sum { amount } min { label } } } }');
 expect(result.errors).toBeUndefined();
 expect(result.data).toEqual({data_aggregate:{aggregate:{count:0,sum:{amount:null},min:{label:null}}}});
});

it('keeps native CSV precision, BOM, duplicate headers, date strings and distinct empty/missing-cell semantics',async()=>{
 const f=await fixture('\uFEFFamount,amount,when,note,exact,precise,blank\r\n1.25,2,2026-10-23,"",9007199254740993,123456789012345.12,\r\n3.5,4,2026-10-24,x,9007199254740995,123456789012345.13,');
 const read=await f.gql(f.actor,'{ data(order_by:{amount:asc}) { amount amount_2 when note exact precise blank } }');
 expect(read.errors).toBeUndefined();
 expect(read.data!.data).toEqual([{amount:1.25,amount_2:2,when:'2026-10-23',note:'',exact:'9007199254740993',precise:'123456789012345.12',blank:null},{amount:3.5,amount_2:4,when:'2026-10-24',note:'x',exact:'9007199254740995',precise:'123456789012345.13',blank:null}]);
});
it('keeps the original header-only CSV rejection instead of inventing data rows',async()=>{
 const owner=await mintAccountToken('empty_csv_fixture');
 const response=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:'amount,label'}}));
 expect(response.status).toBe(400);expect(await response.json()).toMatchObject({error:'invalid_dataset',code:'empty'});
});
it('refuses remote PostgreSQL catalogs before executing native dataset reads or writes',async()=>{
 const f=await fixture();const db=await getDb();
 await db.query(`UPDATE artifacts SET meta=jsonb_set(meta,'{catalog,kind}','"postgres"'::jsonb) WHERE id=$1`,[f.id]);
 expect(errorCode(await f.gql(f.actor,'{ data { amount } }'))).toBe('dataset_not_found');
 expect(errorCode(await f.gql(f.actor,'mutation { delete_data(where:{}){ affected_rows } }'))).toBe('dataset_not_found');
 expect((await getArtifactById(f.id))?.version).toBe(1);
});
