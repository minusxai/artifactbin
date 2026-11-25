/**
 * THE WRITE MATRIX: stored policy shapes (none, and version 3 rules) × caller × door × operation, run through
 * the real page SQL route and the direct-write executor, compared with the decision lib/dataset-permissions/write
 * writes down (datasetRole, the stored rules, the access ceiling and the private ceiling). backend_only entries
 * need program trust, which no mutateDataset door carries (lib/dataset-permissions/__tests__/write.test.ts).
 */
import {expect,it} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {ANONYMOUS_ACTOR,type AccessActor} from '@/lib/accounts';
import {getDb} from '@/lib/platform';
import {getArtifactById} from '@/lib/artifacts';
import {createArtifactFromBody} from '@/lib/publish';
import {sql} from '@/__tests__/page-sql-door-fixture';
import {account,datasetPage,refusal,write} from './dataset-fixture';
import { seedShares, setArtifact } from '@/__tests__/rows';

useAppHarness();

type Caller='owner'|'editor'|'viewer'|'signedIn'|'anonymous';
type Door='page'|'direct';
type Op='insert'|'update'|'delete';
const CALLERS:Caller[]=['owner','editor','viewer','signedIn','anonymous'];
const DOORS:Door[]=['page','direct'];
const OPS:Op[]=['insert','update','delete'];
const SQL:Record<Op,string>={insert:'insert into public.rows (n) values (2)',update:'update public.rows set n=n+10',delete:'delete from public.rows where n>100'};

const RULE_ROLES=['viewer','signed_in','anonymous'];
/** Everyone reads; `writers` insert, update and delete every row (`backend_only`: only through a trusted program). */
const rules=(writers:string[],backendOnly=false)=>{
 const only=backendOnly?{backend_only:true}:{};
 return {version:3,tables:[{table:{schema:'public',name:'rows'},
  select_permissions:RULE_ROLES.map(role=>({role,permission:{columns:'*',filter:{},allow_aggregations:true}})),
  insert_permissions:writers.map(role=>({role,permission:{columns:'*',check:{},...only}})),
  update_permissions:writers.map(role=>({role,permission:{columns:'*',filter:{},check:{},...only}})),
  delete_permissions:writers.map(role=>({role,permission:{filter:{},...only}}))}]};
};

interface Shape {name:string;policy:unknown;access:'readwrite'|'read';visibility?:'public'|'private'}
const SHAPES:Shape[]=[
 {name:'none/readwrite',policy:null,access:'readwrite'},
 {name:'none/read',policy:null,access:'read'},
 {name:'everyone/readwrite',policy:rules(RULE_ROLES),access:'readwrite'},
 {name:'everyone/read',policy:rules(RULE_ROLES),access:'read'},
 {name:'viewers/private',policy:rules(RULE_ROLES),access:'readwrite',visibility:'private'},
 {name:'signed-in',policy:rules(['viewer','signed_in']),access:'readwrite'},
 {name:'programs',policy:rules(['viewer','signed_in'],true),access:'readwrite'},
];

/** The decision, written out from the plan's role table. */
function expected(shape:Shape,caller:Caller,_door:Door,_op:Op):boolean {
 const admin=caller==='owner'||caller==='editor';
 // The access ceiling applies to every caller.
 if(shape.access==='read')return false;
 if(admin)return true;
 switch(shape.name){
  case 'none/readwrite':return false;
  case 'everyone/readwrite':return true;
  // On a private dataset signed_in and anonymous rules never apply.
  case 'viewers/private':return caller==='viewer';
  case 'signed-in':return caller!=='anonymous';
  // backend_only entries ('programs'): trusted programs only, which no door here carries.
  default:return false;
 }
}

it('decides every policy shape × caller × door × operation as the stored rules say',async()=>{
 const owner=await account('matrix_owner'),db=await getDb(),viewer=await account('matrix_viewer'),editor=await account('matrix_editor'),signedIn=await account('matrix_signed_in');
 const actual:Record<string,boolean>={},want:Record<string,boolean>={};
 for(const shape of SHAPES){
  const created=await createArtifactFromBody({dataset:[{n:1}],access:'readwrite',visibility:shape.visibility??'public'},{...owner.actor,tokenId:owner.tokenId},'http://localhost:3000');
  expect(created.status,JSON.stringify(created.body)).toBe(201);
  const f={db,owner,id:created.body.id as string,row:async()=>(await getArtifactById(f.id))!};
  await seedShares(f.db, { artifact_id: f.id, user_id: editor.id, email: editor.email, role: 'editor' }, { artifact_id: f.id, user_id: viewer.id, email: viewer.email, role: 'viewer' });
  await setArtifact(f.db, f.id, { dataset_policy: JSON.stringify(shape.policy), access: shape.access });
  const page=await datasetPage(owner,f.id);
  const people={owner,editor,viewer,signedIn,anonymous:null};
  const actors:Record<Caller,AccessActor>={owner:f.owner.actor,editor:editor.actor,viewer:viewer.actor,signedIn:signedIn.actor,anonymous:ANONYMOUS_ACTOR};
  for(const caller of CALLERS)for(const door of DOORS)for(const op of OPS){
   await f.db.query('DELETE FROM dataset_usage');
   const key=`${shape.name}|${caller}|${door}|${op}`;
   let allowed;
   if(door==='page'){
    const result=await sql(page,people[caller],SQL[op].replace('public.rows','data_rows'));
    expect([200,403,404],`${key}: ${JSON.stringify(result)}`).toContain(result.status);
    allowed=result.status===200;
   }else{
    const result=await write(await f.row(),actors[caller],SQL[op]);
    const reason=refusal(result);
    expect(['dataset_read_only','policy_denied',null],`${key}: ${JSON.stringify(result)}`).toContain(reason);
    allowed=reason===null;
   }
   actual[key]=allowed;want[key]=expected(shape,caller,door,op);
  }
 }
 expect(actual).toEqual(want);
},120_000);

