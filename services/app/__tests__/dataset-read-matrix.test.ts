/**
 * THE READ EQUIVALENCE MATRIX: every stored policy shape (none, v1, v2) × caller × read door, run through the
 * door functions themselves and compared with what the v3 reading of that policy decides (datasetRole +
 * toV3 and the legacy visibility ceiling in lib/dataset-permissions/read; the v2 read-grant compatibility is removed).
 * Doors: `direct` (canReadArtifact: raw, content, query, events, exports), `tables` (the /a/:id/tables SQL
 * route, which decides exactly as `direct` now), `page` (page GraphQL through a page link) and `program` (a page's
 * registered queries, by the page owner's reach).
 * The cells whose outcome differs from the pre-v3 code are DELIBERATE and listed in CHANGED; every other
 * cell keeps its old outcome. DATASET_READ_MATRIX_BASELINE=1 runs the same file against the pre-v3 code.
 */
import {expect,it} from 'vitest';
import {useAppHarness,mintAccountToken,request} from './harness';
import {POST as tables} from '@/app/a/[id]/tables/route';
import {ANONYMOUS_ACTOR,createUser,identityForUser,type AccessActor} from '@/lib/accounts';
import {viewersWritePolicy} from '@artifactbin/utils';
import {getDb} from '@/lib/platform';
import {canReadArtifact,getArtifactById} from '@/lib/artifacts';
import {createArtifactFromBody} from '@/lib/publish';
import {linkedGql,errorCode} from './linked-datasets';
import {registeredQueryImportForRow} from '@/lib/document-data';

useAppHarness();

type Caller='owner'|'editor'|'viewer'|'named'|'signedIn'|'anonymous';
type Door='direct'|'page'|'program'|'tables';
const CALLERS:Caller[]=['owner','editor','viewer','named','signedIn','anonymous'];
const DOORS:Door[]=['direct','page','program','tables'];
const READ_ALL={actions:['read'],from:{user:'*'}};
const DEFAULT_WRITES={actions:['insert','update','delete'],from:{artifactOwner:'$owner'}};

interface Shape {name:string;policy:(ids:{named:string;doc:string})=>unknown;visibility:'unlisted'|'private'}
const SHAPES:Shape[]=[
 {name:'none/unlisted',policy:()=>null,visibility:'unlisted'},
 {name:'none/private',policy:()=>null,visibility:'private'},
 {name:'v1/unlisted',policy:()=>viewersWritePolicy(),visibility:'unlisted'},
 {name:'v1/private',policy:()=>viewersWritePolicy(),visibility:'private'},
 {name:'v2/default',policy:()=>({version:2,allow:[READ_ALL,DEFAULT_WRITES]}),visibility:'unlisted'},
 {name:'v2/private',policy:()=>({version:2,allow:[READ_ALL,DEFAULT_WRITES]}),visibility:'private'},
 {name:'v2/owner-only',policy:()=>({version:2,allow:[{actions:['read'],from:{user:'$owner'}}]}),visibility:'unlisted'},
 {name:'v2/named',policy:ids=>({version:2,allow:[{actions:['read'],from:{user:ids.named}}]}),visibility:'unlisted'},
 {name:'v2/page',policy:ids=>({version:2,allow:[{actions:['read'],from:{artifact:ids.doc}}]}),visibility:'unlisted'},
 {name:'v2/locked',policy:()=>({version:2,allow:[]}),visibility:'unlisted'},
];

/** The v3 decision, written out from the plan's role table, the toV3 mapping rows and the two legacy rules. */
function expected(shape:Shape,caller:Caller,door:Door):boolean {
 if(door==='tables')return expected(shape,caller,'direct');
 if(caller==='owner'||caller==='editor')return true;
 const priv=shape.visibility==='private';
 // A page reader without sharing of their own is signed_in or anonymous; directly, a private dataset has no link audience.
 const role=caller==='viewer'?'viewer':priv&&door==='direct'?null:caller==='anonymous'?'anonymous':'signed_in';
 if(!role)return false;
 switch(shape.name){
  // toV3: select for viewer, signed_in and anonymous. The visibility ceiling keeps a private dataset's link
  // roles out, except through a page whose owner administers the dataset (the page owner's reach, as today).
  case 'none/unlisted':case 'v1/unlisted':case 'v2/default':return true;
  case 'none/private':case 'v1/private':return role==='viewer'||door==='program';
  // v2 grants keep their own ceiling: a private dataset admits its shares only, through any page.
  case 'v2/private':return role==='viewer';
  case 'v2/owner-only':case 'v2/locked':return false;
  // toV3: viewer only; the named person reads only once shared (the compat is removed; the migration shares).
  case 'v2/named':return role==='viewer';
  // toV3: viewer and signed_in; anonymous no longer reads through that page (the compat is removed).
  case 'v2/page':return role!=='anonymous';
  default:return false;
 }
}

/** The cells where the pre-v3 code decided otherwise, each a deliberate change (see the PR report). */
/** The pre-v3 tables route read the sharing role alone (canRead(effectiveRole)), never v2 grants: link readers and shares ran SQL. */
const oldTables=(shape:Shape,caller:Caller)=>['owner','editor','viewer'].includes(caller)||shape.visibility!=='private';
const CHANGED=new Set<string>([
 // The tables route now decides as every other door (it never consulted v2 grants).
 ...SHAPES.flatMap(shape=>CALLERS.filter(c=>oldTables(shape,c)!==expected(shape,c,'direct')).map(c=>`${shape.name}|${c}|tables`)),
 // Owner and editor are admin-equivalent: v2 read grants that name neither no longer refuse them.
 ...(['direct','page','program'] as const).map(d=>`v2/owner-only|editor|${d}`),
 ...(['owner','editor'] as const).flatMap(c=>(['direct','page','program'] as const).map(d=>`v2/locked|${c}|${d}`)),
 ...(['owner','editor'] as const).flatMap(c=>(['direct','page','program'] as const).map(d=>`v2/named|${c}|${d}`)),
 ...(['owner','editor'] as const).flatMap(c=>['direct','page'].map(d=>`v2/page|${c}|${d}`)),
 // v2 user:<id> maps to a viewer select (toV3, reported): shared viewers read too.
 ...(['direct','page','program'] as const).map(d=>`v2/named|viewer|${d}`),
 // v2 artifact:X maps to viewer and signed_in selects (toV3, reported): they read directly too.
 ...(['viewer','named','signedIn'] as const).flatMap(c=>['direct','page'].map(d=>`v2/page|${c}|${d}`)),
 // The v2 read-grant compatibility is removed: a named person who is not shared, and anonymous readers of a page-scoped grant, are refused.
 ...(['direct','page','program'] as const).map(d=>`v2/named|named|${d}`),
 'v2/page|anonymous|program',
]);

const BASELINE=process.env.DATASET_READ_MATRIX_BASELINE==='1';

async function person(name:string){
 const user=await createUser({email:`${name}@example.test`});const token=await mintAccountToken(name,user.id);
 return {id:user.id,email:user.email!,tokenId:token.id,token:token.token,actor:identityForUser(user.id,token.id,user.email)};
}

async function opens(work:()=>Promise<unknown>):Promise<boolean> {
 try{const out=await work();return out!==false;}catch{return false;}
}

it('decides every policy shape × caller × read door as its v3 reading does',async()=>{
 const db=await getDb(),owner=await person('read_owner'),editor=await person('read_editor'),viewer=await person('read_viewer'),named=await person('read_named'),signedIn=await person('read_signed_in');
 const actors:Record<Caller,AccessActor>={owner:owner.actor,editor:editor.actor,viewer:viewer.actor,named:named.actor,signedIn:signedIn.actor,anonymous:ANONYMOUS_ACTOR};
 const tokens:Record<Caller,string|null>={owner:owner.token,editor:editor.token,viewer:viewer.token,named:named.token,signedIn:signedIn.token,anonymous:null};
 const actual:Record<string,boolean>={},want:Record<string,boolean>={};
 let n=0;
 for(const shape of SHAPES){
  const created=await createArtifactFromBody({dataset:[{n:1}],access:'readwrite',visibility:shape.visibility},{...owner.actor,tokenId:owner.tokenId},'http://localhost:3000');
  expect(created.status,await created.clone().text()).toBe(201);
  const id=(await created.json()).id as string,doc=`readdoc${++n}`;
  await db.query("INSERT INTO artifacts(id,token_id,user_id,format,visibility,edit_id) VALUES($1,$2,$3,'html','public',$4)",[doc,owner.tokenId,owner.id,`${doc}-edit`]);
  await db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'editor'),($1,$4,$5,'viewer')",[id,editor.id,editor.email,viewer.id,viewer.email]);
  await db.query('UPDATE artifacts SET dataset_policy=$2::jsonb WHERE id=$1',[id,JSON.stringify(shape.policy({named:named.id,doc}))]);
  const binding={kind:'dataset' as const,name:'data',datasetId:id,mode:'live' as const};
  for(const caller of CALLERS)for(const door of DOORS){
   const actor=actors[caller],key=`${shape.name}|${caller}|${door}`;
   const row=(await getArtifactById(id))!,page=(await getArtifactById(doc))!;
   const sql=()=>tables(request(`/a/${id}/tables`,{method:'POST',json:{sql:'select 1 as one'},...(tokens[caller]?{token:tokens[caller]}:{})}),{params:Promise.resolve({id})}).then(r=>r.status===200);
   actual[key]=await opens(door==='direct'?()=>canReadArtifact(row,actor):door==='page'?async()=>{const reply=await linkedGql(actor,binding,'{ data(limit: 1) { _id } }');if(reply.errors?.length)throw Error(errorCode(reply)??'refused');}:door==='tables'?sql:()=>registeredQueryImportForRow(page,id,actor));
   want[key]=BASELINE&&CHANGED.has(key)?!expected(shape,caller,door):expected(shape,caller,door);
  }
 }
 expect(actual).toEqual(want);
 for(const key of CHANGED)expect(Object.hasOwn(want,key),key).toBe(true);
},120_000);
