/**
 * THE READ MATRIX: stored policy shapes (none, and version 3 rules) × caller × read door, run through the door
 * functions themselves and compared with the decision lib/dataset-permissions/read writes down (datasetRole, the
 * stored select rules and the private visibility ceiling).
 * Doors: `direct` (canReadArtifact: raw, content, query, events, exports), `tables` (the /a/:id/tables SQL
 * route, which decides exactly as `direct`) and `page` (page GraphQL through a page link).
 */
import {expect,it} from 'vitest';
import {useAppHarness,mintAccountToken,request} from './harness';
import {POST as tables} from '@/app/a/[id]/tables/route';
import {ANONYMOUS_ACTOR,createUser,identityForUser,type AccessActor} from '@/lib/accounts';
import {getDb} from '@/lib/platform';
import {canReadArtifact,getArtifactById} from '@/lib/artifacts';
import {createArtifactFromBody} from '@/lib/publish';
import {linkedSql,errorCode} from './linked-datasets';

useAppHarness();

type Caller='owner'|'editor'|'viewer'|'signedIn'|'anonymous';
type Door='direct'|'page'|'tables';
const CALLERS:Caller[]=['owner','editor','viewer','signedIn','anonymous'];
const DOORS:Door[]=['direct','page','tables'];
const select=(...roles:string[])=>({version:3,tables:[{table:{schema:'public',name:'rows'},select_permissions:roles.map(role=>({role,permission:{columns:'*',filter:{},allow_aggregations:true}}))}]});

interface Shape {name:string;policy:unknown;visibility:'unlisted'|'private'}
const SHAPES:Shape[]=[
 {name:'none/unlisted',policy:null,visibility:'unlisted'},
 {name:'none/private',policy:null,visibility:'private'},
 {name:'everyone/unlisted',policy:select('viewer','signed_in','anonymous'),visibility:'unlisted'},
 {name:'everyone/private',policy:select('viewer','signed_in','anonymous'),visibility:'private'},
 {name:'viewers',policy:select('viewer'),visibility:'unlisted'},
 {name:'signed-in',policy:select('viewer','signed_in'),visibility:'unlisted'},
 {name:'locked',policy:{version:3,tables:[]},visibility:'unlisted'},
];

/** The decision, written out from the plan's role table and the private visibility ceiling. */
function expected(shape:Shape,caller:Caller,door:Door):boolean {
 if(door==='tables')return expected(shape,caller,'direct');
 if(caller==='owner'||caller==='editor')return true;
 const priv=shape.visibility==='private';
 // A page reader without sharing of their own is signed_in or anonymous; directly, a private dataset has no link audience.
 const role=caller==='viewer'?'viewer':priv&&door==='direct'?null:caller==='anonymous'?'anonymous':'signed_in';
 if(!role)return false;
 switch(shape.name){
  // No stored policy reads as select for viewer, signed_in and anonymous. The visibility ceiling keeps a private
  // dataset's link roles out.
  case 'none/unlisted':case 'everyone/unlisted':return true;
  case 'none/private':case 'everyone/private':return role==='viewer';
  case 'viewers':return role==='viewer';
  case 'signed-in':return role!=='anonymous';
  default:return false;
 }
}

async function person(name:string){
 const user=await createUser({email:`${name}@example.test`});const token=await mintAccountToken(name,user.id);
 return {id:user.id,email:user.email!,tokenId:token.id,token:token.token,actor:identityForUser(user.id,token.id,user.email)};
}

async function opens(work:()=>Promise<unknown>):Promise<boolean> {
 try{const out=await work();return out!==false;}catch{return false;}
}

it('decides every policy shape × caller × read door as the stored rules say',async()=>{
 const db=await getDb(),owner=await person('read_owner'),editor=await person('read_editor'),viewer=await person('read_viewer'),signedIn=await person('read_signed_in');
 const actors:Record<Caller,AccessActor>={owner:owner.actor,editor:editor.actor,viewer:viewer.actor,signedIn:signedIn.actor,anonymous:ANONYMOUS_ACTOR};
 const tokens:Record<Caller,string|null>={owner:owner.token,editor:editor.token,viewer:viewer.token,signedIn:signedIn.token,anonymous:null};
 const actual:Record<string,boolean>={},want:Record<string,boolean>={};
 for(const shape of SHAPES){
  const created=await createArtifactFromBody({dataset:[{n:1}],access:'readwrite',visibility:shape.visibility},{...owner.actor,tokenId:owner.tokenId},'http://localhost:3000');
  expect(created.status,await created.clone().text()).toBe(201);
  const id=(await created.json()).id as string;
  await db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'editor'),($1,$4,$5,'viewer')",[id,editor.id,editor.email,viewer.id,viewer.email]);
  await db.query('UPDATE artifacts SET dataset_policy=$2::jsonb WHERE id=$1',[id,JSON.stringify(shape.policy)]);
  const binding={kind:'dataset' as const,name:'data',datasetId:id,mode:'live' as const};
  for(const caller of CALLERS)for(const door of DOORS){
   const actor=actors[caller],key=`${shape.name}|${caller}|${door}`;
   const row=(await getArtifactById(id))!;
   const sql=()=>tables(request(`/a/${id}/tables`,{method:'POST',json:{sql:'select 1 as one'},...(tokens[caller]?{token:tokens[caller]}:{})}),{params:Promise.resolve({id})}).then(r=>r.status===200);
   actual[key]=await opens(door==='direct'?()=>canReadArtifact(row,actor):door==='page'?async()=>{const reply=await linkedSql(actor,binding,'select _id from data limit 1');if(reply.error)throw Error(errorCode(reply)??'refused');}:sql);
   want[key]=expected(shape,caller,door);
  }
 }
 expect(actual).toEqual(want);
},120_000);
