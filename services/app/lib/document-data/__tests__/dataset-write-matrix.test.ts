/**
 * THE WRITE EQUIVALENCE MATRIX: every stored policy shape (none, v1, v2) × caller × door × operation, run
 * through mutateDataset (the one executor every write door calls) and compared with the outcome the v3
 * reading of that policy decides (datasetRole + toV3). The cells whose outcome differs from the pre-v3 code
 * are DELIBERATE and listed in CHANGED below; every other cell keeps its old outcome.
 */
import {expect,it} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {ANONYMOUS_ACTOR,type AccessActor} from '@/lib/accounts';
import {viewersWritePolicy} from '@artifactbin/utils';
import {getDb} from '@/lib/platform';
import {getArtifactById} from '@/lib/artifacts';
import {createArtifactFromBody} from '@/lib/publish';
import {account,document,refusal,write} from './dataset-fixture';

useAppHarness();

type Caller='owner'|'editor'|'viewer'|'signedIn'|'member'|'anonymous';
type Door='generic'|'program'|'direct';
type Op='insert'|'update'|'delete';
const CALLERS:Caller[]=['owner','editor','viewer','signedIn','member','anonymous'];
const DOORS:Door[]=['generic','program','direct'];
const OPS:Op[]=['insert','update','delete'];
const SQL:Record<Op,string>={insert:'insert into public.rows values (2)',update:'update public.rows set n=n+10',delete:'delete from public.rows where n>100'};

interface Shape {name:string;policy:(ids:{viewer:string;stranger:string;doc:string})=>unknown;access:'readwrite'|'read';visibility?:'public'|'private';strangerDoc?:boolean}
const SHAPES:Shape[]=[
 {name:'none/readwrite',policy:()=>null,access:'readwrite'},
 {name:'none/read',policy:()=>null,access:'read'},
 {name:'v1/readwrite',policy:()=>viewersWritePolicy(),access:'readwrite'},
 {name:'v1/read',policy:()=>viewersWritePolicy(),access:'read'},
 {name:'v1/private',policy:()=>viewersWritePolicy(),access:'readwrite',visibility:'private'},
 {name:'v2/default',policy:()=>({version:2,allow:[{actions:['read'],from:{user:'*'}},{actions:['insert','update','delete'],from:{artifactOwner:'$owner'}}]}),access:'read'},
 {name:'v2/users',policy:()=>({version:2,allow:[{actions:['read'],from:{user:'*'}},{actions:['insert','update','delete'],from:{user:'*'}}]}),access:'read'},
 {name:'v2/named',policy:ids=>({version:2,allow:[{actions:['read'],from:{user:'*'}},{actions:['insert'],from:{user:ids.viewer}}]}),access:'read'},
 {name:'v2/artifact',policy:ids=>({version:2,allow:[{actions:['read'],from:{user:'*'}},{actions:['insert','update','delete'],from:{artifact:ids.doc}}]}),access:'read'},
 {name:'v2/other-owner',policy:ids=>({version:2,allow:[{actions:['read'],from:{user:'*'}},{actions:['insert','update','delete'],from:{artifactOwner:ids.stranger}}]}),access:'read',strangerDoc:true},
];

/** The v3 decision, written out from the plan's role table and toV3 mapping rows. */
function expected(shape:Shape,caller:Caller,door:Door,op:Op):boolean {
 const admin=caller==='owner'||caller==='editor';
 // The access ceiling stays on datasets without v2 grants, for every caller.
 if(shape.access==='read'&&!shape.name.startsWith('v2/'))return false;
 // A document's program write needs its page owner to hold owner or editor on the dataset.
 if(door==='program'&&shape.strangerDoc)return false;
 if(admin)return true;
 switch(shape.name){
  case 'none/readwrite':return false;
  // v1 entries are copied to viewer, signed_in and anonymous; a private dataset copies them to viewer only.
  case 'v1/readwrite':return true;
  case 'v1/private':return caller==='viewer';
  // v2 artifact selectors become backend_only entries for viewer and signed_in: trusted programs only
  // (signed in, accepted page membership, the page owner holds owner or editor on the dataset).
  case 'v2/default':case 'v2/artifact':return door==='program'&&caller==='member';
  // v2 user:* writes become normal entries for viewer and signed_in.
  case 'v2/users':return caller!=='anonymous';
  // v2 user:<id> has no v3 slot; until the stored migration shares the dataset with that person, the write
  // decision keeps admitting exactly their granted operations outside a program (write.ts namedUserWrites).
  case 'v2/named':return caller==='viewer'&&op==='insert'&&door!=='program';
  default:return false;
 }
}

/** The cells where the pre-v3 code decided otherwise, each a deliberate change (see the PR report). */
const CHANGED=new Set<string>([
 // Owner and editor are admin-equivalent: v2 grants no longer refuse them (the default refused the owner's
 // generic and direct writes, and its programs without page membership). A user:* grant already admitted them.
 ...['v2/default','v2/users','v2/named','v2/artifact','v2/other-owner'].flatMap(s=>(['owner','editor'] as const).flatMap(c=>DOORS.flatMap(d=>OPS.map(o=>`${s}|${c}|${d}|${o}`))))
  .filter(key=>!/^v2\/users\|\w+\|(generic|direct)\|/.test(key)&&!/^v2\/other-owner\|\w+\|program\|/.test(key)),
 // v1 rule holders may use the direct SQL door: the engine enforces the same rules on its effect.
 ...['viewer','signedIn','member','anonymous'].flatMap(c=>OPS.map(o=>`v1/readwrite|${c}|direct|${o}`)),
 ...OPS.map(o=>`v1/private|viewer|direct|${o}`),
 // v2 user:* through a document no longer requires page membership AT THE EXECUTOR (the rule names no page).
 // The <Mutation> and registered doors still gate v2 datasets through grantContext first, unchanged.
 ...['viewer','signedIn'].flatMap(c=>OPS.map(o=>`v2/users|${c}|program|${o}`)),
 // v2 user:<id> has no Hasura slot: reported, no entry.
 'v2/named|viewer|generic|insert','v2/named|viewer|direct|insert',
 // v2 artifactOwner:U only works when U holds owner or editor on the dataset.
 ...OPS.map(o=>`v2/other-owner|member|program|${o}`),
]);

const BASELINE=process.env.DATASET_WRITE_MATRIX_BASELINE==='1';

it('decides every policy shape × caller × door × operation as its v3 reading does',async()=>{
 const owner=await account('matrix_owner'),db=await getDb(),viewer=await account('matrix_viewer'),editor=await account('matrix_editor'),signedIn=await account('matrix_signed_in'),member=await account('matrix_member'),stranger=await account('matrix_stranger');
 const actual:Record<string,boolean>={},want:Record<string,boolean>={};
 let n=0;
 for(const shape of SHAPES){
  const created=await createArtifactFromBody({dataset:[{n:1}],access:'readwrite',visibility:shape.visibility??'public'},{...owner.actor,tokenId:owner.tokenId},'http://localhost:3000');
  expect(created.status,await created.clone().text()).toBe(201);
  const f={db,owner,id:(await created.json()).id as string,row:async()=>(await getArtifactById(f.id))!};
  const doc=await document(f.db,`matrixdoc${++n}`,shape.strangerDoc?stranger:f.owner);
  await f.db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'editor'),($1,$4,$5,'viewer')",[f.id,editor.id,editor.email,viewer.id,viewer.email]);
  await f.db.query("INSERT INTO relations(subject_kind,subject_id,verb,object_kind,object_id,status,direction,initiated_by,accepted_at) VALUES('user',$1,'join','artifact',$2,'accepted','invitation',$3,now())",[member.id,doc.id,f.owner.id]);
  await f.db.query('UPDATE artifacts SET dataset_policy=$2::jsonb,access=$3 WHERE id=$1',[f.id,JSON.stringify(shape.policy({viewer:viewer.id,stranger:stranger.id,doc:doc.id})),shape.access]);
  const actors:Record<Caller,AccessActor>={owner:f.owner.actor,editor:editor.actor,viewer:viewer.actor,signedIn:signedIn.actor,member:member.actor,anonymous:ANONYMOUS_ACTOR};
  for(const caller of CALLERS)for(const door of DOORS)for(const op of OPS){
   await f.db.query('DELETE FROM dataset_usage');
   const guard=door==='generic'?{nativePolicy:true}:door==='program'?{document:doc,target:{schema:'public',table:'rows'}}:{};
   const key=`${shape.name}|${caller}|${door}|${op}`;
   const result=await write(await f.row(),actors[caller],SQL[op],guard);
   const reason=refusal(result);
   expect(['dataset_read_only','policy_denied',null],`${key}: ${JSON.stringify(result)}`).toContain(reason);
   // The baseline run (pre-v3 code) expects exactly the listed cells to differ.
   actual[key]=reason===null;want[key]=BASELINE&&CHANGED.has(key)?!expected(shape,caller,door,op):expected(shape,caller,door,op);
  }
 }
 expect(actual).toEqual(want);
 // Every listed change is a cell of the matrix.
 for(const key of CHANGED)expect(Object.hasOwn(want,key),key).toBe(true);
},120_000);

