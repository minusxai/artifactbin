/**
 * THE NOTIFICATION AUTHORITY the job store consults (notificationAuthority) and the evaluation that
 * feeds it (evaluateNotificationQuery): who may manage a document's jobs, which recipients a saved
 * plan may reach, and when a plan evaluated earlier no longer matches the credential, document,
 * sources or rules it was evaluated under. Credentials expire and are deleted through their rows;
 * the decisions are read only through these public functions.
 */
import {beforeEach,expect,it} from 'vitest';
import type {MutationNotificationJobInput,MutationNotificationPlan} from '@artifactbin/contracts';
import {useAppHarness,mintAccountToken} from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import {createUser,identityForUser,seedOwnerJoin} from '@/lib/accounts';
import {createArtifactFromBody} from '@/lib/publish/publish/requests';
import type {CompiledDataflow} from '@/lib/dataflow';
import {notificationAuthority,notificationContextSnapshot} from '@/lib/notifications';
import {evaluateNotificationQuery,mutationInitiator} from '@/lib/document-data';

useAppHarness();
type Db=Awaited<ReturnType<typeof getDb>>;
let db:Db;
beforeEach(async()=>{db=await getDb();});

async function fixture(){
 const owner=await createUser({email:'owner@example.test'}),token=await mintAccountToken('notify',owner.id),actor=identityForUser(owner.id,token.id,owner.email);
 const created=await createArtifactFromBody({dataset:[{n:1}],visibility:'unlisted'},{...actor,tokenId:token.id},'http://localhost:3000');
 expect(created.status,await created.clone().text()).toBe(201);
 const dataset=(await created.json()).id as string;
 await db.query("INSERT INTO artifacts(id,token_id,user_id,format,visibility,edit_id) VALUES('doc',$1,$2,'html','unlisted','doc-edit')",[token.id,owner.id]);
 await seedOwnerJoin(db,'doc',owner.id);
 const flow:CompiledDataflow={imports:[{name:'tasks',ref:dataset,tables:[{name:'rows',columns:[{name:'n',type:'number'}]}]}],values:[],queries:[],mutations:[],
  notifications:[{name:'status',on:'change',engine:'sqlite',sql:`select null as "to", 'n is ' || cast(n as integer) as message from tasks.rows`,params:[],reads:{imports:['tasks'],queries:[],values:[],builtins:[]},columns:[{name:'to',type:null},{name:'message',type:'string'}],start:0,end:0}]};
 const input:MutationNotificationJobInput={origin:{mutationRunId:'run',documentId:'doc',documentEditId:'doc-edit',documentVersion:1,mutationName:'change'},initiator:mutationInitiator(actor,'agent'),
  rules:flow.notifications!.map(({name,on,sql})=>({name,on,sql})),bindings:{values:{},types:{},userId:owner.id,now:'2026-01-01T00:00:00Z',tz:'UTC'},...notificationContextSnapshot(flow)};
 return {owner,token,dataset,input};
}
const user=async(id:string,kind='account',email=`${id}@example.test`)=>{await db.query('INSERT INTO users(id,email,kind) VALUES($1,$2,$3)',[id,email,kind]);return id;};

it('evaluates current rows into a plan whose sources, fence and rules validate unchanged',async()=>{
 const f=await fixture(),plan=await evaluateNotificationQuery(f.input);
 expect(plan.rules).toEqual([{ruleName:'status',rows:[{recipientIds:[],message:'n is 1'}],sources:[expect.objectContaining({artifactId:f.dataset})]}]);
 await expect(notificationAuthority.validatePlan(db,f.input,plan)).resolves.toBeUndefined();
 // Content is not authority: a later data write leaves the plan valid.
 await db.query('UPDATE artifacts SET version=version+1 WHERE id=$1',[f.dataset]);
 await expect(notificationAuthority.validatePlan(db,f.input,plan)).resolves.toBeUndefined();
});

it('rejects a plan whose rules, sources, fence, source sharing or schema drifted',async()=>{
 const f=await fixture(),plan=await evaluateNotificationQuery(f.input);
 const code=(p:MutationNotificationPlan)=>notificationAuthority.validatePlan(db,f.input,p).then(()=>null,(error:{code:string;retryable:boolean})=>[error.code,error.retryable]);
 expect(await code({...plan,rules:[{...plan.rules[0]!,ruleName:'other'}]})).toEqual(['notification_context_invalid',false]);
 expect(await code({...plan,rules:[{...plan.rules[0]!,sources:[]}]})).toEqual(['notification_context_invalid',false]);
 expect(await code({...plan,executionFence:{...plan.executionFence,documentRevision:'old'}})).toEqual(['notification_authority_changed',true]);
 await db.query("UPDATE artifacts SET visibility='public' WHERE id=$1",[f.dataset]);
 expect(await code(plan)).toEqual(['notification_authority_changed',true]);
 await db.query("UPDATE artifacts SET visibility='unlisted',meta=jsonb_set(meta,'{catalog,tables,0,columns,0,name}','\"m\"') WHERE id=$1",[f.dataset]);
 expect(await code(plan)).toEqual(['notification_schema_changed',false]);
});

it('revokes evaluation and validation when the initiating token expires, is deleted or changes account',async()=>{
 const f=await fixture(),plan=await evaluateNotificationQuery(f.input);
 const {expires_at:expiry}=(await db.query<{expires_at:string|null}>('SELECT expires_at FROM tokens WHERE id=$1',[f.token.id])).rows[0]!;
 const revoked=async()=>{
  await expect(notificationAuthority.validatePlan(db,f.input,plan)).rejects.toMatchObject({code:'notification_access_revoked'});
  await expect(evaluateNotificationQuery(f.input)).rejects.toMatchObject({code:'notification_access_revoked'});
 };
 await db.query("UPDATE tokens SET expires_at=now()-interval '1 second' WHERE id=$1",[f.token.id]);await revoked();
 await db.query('UPDATE tokens SET expires_at=NULL,deleted_at=now() WHERE id=$1',[f.token.id]);await revoked();
 await db.query('UPDATE tokens SET deleted_at=NULL,user_id=$2 WHERE id=$1',[f.token.id,await user('someone')]);await revoked();
 // Restored to its account but not to its original expiry, it is a different credential than the one evaluated.
 await db.query('UPDATE tokens SET user_id=$2 WHERE id=$1',[f.token.id,f.owner.id]);
 await expect(notificationAuthority.validatePlan(db,f.input,plan)).rejects.toMatchObject({code:'notification_authority_changed',retryable:true});
 await db.query('UPDATE tokens SET expires_at=$2 WHERE id=$1',[f.token.id,expiry]);
 await expect(notificationAuthority.validatePlan(db,f.input,plan)).resolves.toBeUndefined();
});

it('lets the owner, editors and editor links manage a document’s jobs, never viewers, guests or dead credentials',async()=>{
 const f=await fixture(),manage=(principal:Parameters<typeof notificationAuthority.canManage>[1],doc='doc')=>notificationAuthority.canManage(db,principal,doc);
 const editor=await user('editor'),unclaimed=await user('unclaimed'),viewer=await user('viewer'),guest=await user('guest','guest'),stranger=await user('stranger');
 await db.query(`INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES('doc',$1,'editor@example.test','editor'),('doc',NULL,'unclaimed@example.test','editor'),
  ('doc',$2,'viewer@example.test','viewer'),('doc',$3,'guest@example.test','editor')`,[editor,viewer,guest]);
 expect(await manage({kind:'user',id:f.owner.id})).toBe(true);
 expect(await manage({kind:'token',id:f.token.id})).toBe(true);
 expect(await manage({kind:'user',id:editor})).toBe(true);
 expect(await manage({kind:'user',id:unclaimed})).toBe(true);
 expect(await manage({kind:'user',id:viewer})).toBe(false);
 expect(await manage({kind:'user',id:guest})).toBe(false);
 expect(await manage({kind:'user',id:stranger})).toBe(false);
 expect(await manage({kind:'anonymous'})).toBe(false);
 expect(await manage({kind:'user',id:f.owner.id},'missing')).toBe(false);
 expect(await manage({kind:'user',id:f.owner.id},f.dataset)).toBe(false);
 await db.query("UPDATE artifacts SET link_role='editor' WHERE id='doc'");
 expect(await manage({kind:'user',id:stranger})).toBe(true);
 await db.query("UPDATE tokens SET expires_at=now()-interval '1 second' WHERE id=$1",[f.token.id]);
 expect(await manage({kind:'token',id:f.token.id})).toBe(false);
 await db.query('UPDATE tokens SET expires_at=NULL,deleted_at=now() WHERE id=$1',[f.token.id]);
 expect(await manage({kind:'token',id:f.token.id})).toBe(false);
 await db.query("UPDATE users SET expires_at=now()-interval '1 second' WHERE id=$1",[editor]);
 expect(await manage({kind:'user',id:editor})).toBe(false);
});

it('admits only live, explicitly joined recipients who can still read the document and every contributing source',async()=>{
 const f=await fixture(),plan=await evaluateNotificationQuery(f.input);
 const member=await user('member'),outsider=await user('outsider'),expired=await user('expired'),guest=await user('guest','guest');
 for(const id of [member,expired,guest])await seedOwnerJoin(db,'doc',id);
 await db.query("UPDATE users SET expires_at=now()-interval '1 second' WHERE id=$1",[expired]);
 const audience=[member,outsider,expired,guest,f.owner.id];
 const withRows={...plan,rules:plan.rules.map(rule=>({...rule,rows:[{recipientIds:audience,message:'x'}]}))};
 expect((await notificationAuthority.admitRecipients(db,f.input,withRows,audience)).sort()).toEqual([f.owner.id,member].sort());
 await db.query("UPDATE artifacts SET visibility='private' WHERE id=$1",[f.dataset]);
 expect(await notificationAuthority.admitRecipients(db,f.input,withRows,audience)).toEqual([f.owner.id]);
 await db.query("UPDATE artifacts SET visibility='unlisted',meta=jsonb_set(meta,'{catalog,tables,0,columns,0,name}','\"m\"') WHERE id=$1",[f.dataset]);
 expect(await notificationAuthority.admitRecipients(db,f.input,withRows,audience)).toEqual([]);
 await db.query("UPDATE relations SET status='left',deleted_at=now() WHERE subject_id=$1",[member]);
 const sourceFree={...withRows,rules:withRows.rules.map(rule=>({...rule,sources:[]}))};
 expect(await notificationAuthority.admitRecipients(db,f.input,sourceFree,audience)).toEqual([f.owner.id]);
});
