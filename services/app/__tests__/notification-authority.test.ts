import {createDatasetSecret} from '@/lib/datasets/secrets';
import {expect,it} from 'vitest';
import {useAppHarness} from './harness';
import {getDb} from '@/lib/platform';
import {createUser} from '@/lib/accounts';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import {seedOwnerJoin} from '@/lib/accounts';
import { notificationExecutionFence, notificationExecutionSource, notificationSourcesReadable } from '@/lib/document-data/notifications/authority';
import { notificationAuthority } from '@/lib/document-data';
import type {MutationNotificationJobInput,MutationNotificationPlan} from '@artifactbin/contracts';
useAppHarness();
async function setup(){
 const db=await getDb(),owner=await createUser({email:'mxmx_test_authority_owner@example.com'}),other=await createUser({email:'mxmx_test_authority_other@example.com'}),token=await mintToken('notify',owner.id);
 await db.query("INSERT INTO artifacts(id,token_id,user_id,format,visibility) VALUES('document',$1,$2,'markup','public')",[token.id,owner.id]);
 await db.query("INSERT INTO artifacts(id,token_id,user_id,format,visibility,meta) VALUES('dataset',$1,$2,'dataset','private',$3::jsonb)",[token.id,owner.id,JSON.stringify({catalog:{kind:'postgres',defaultSchema:'public',refreshSeconds:60,connection:{host:'example.test',port:5432,database:'db',username:'read',passwordSecretId:'secret',ssl:true},tables:[{schema:'public',name:'tasks',source:{schema:'app',table:'tasks'},columns:[{name:'id',type:'string'}]}]}})]);
 const secret=await createDatasetSecret({userId:owner.id,tokenId:token.id},'password',{host:'example.test',port:5432,database:'db',username:'read',ssl:true},'dataset');
 await db.query("UPDATE artifacts SET meta=jsonb_set(meta,'{catalog,connection,passwordSecretId}',to_jsonb($1::text)) WHERE id='dataset'",[secret.id]);
 await seedOwnerJoin(db,'document',owner.id);
 const input:MutationNotificationJobInput={origin:{mutationRunId:'run',documentId:'document',documentEditId:'edit',documentVersion:1,mutationName:'change'},initiator:{principal:{kind:'token',id:token.id},execution:'agent',agentLabel:null},rules:[{name:'notice',on:'change',sql:'select 1'}],bindings:{values:{},types:{},userId:owner.id,now:'2026-09-01T00:00:00Z',tz:'UTC'},contextRevision:'context',contextSnapshot:{}};
 return {db,owner,other,token,input};
}
it('uses real credential and generic catalog receipts without content-version revocation',async()=>{
 const f=await setup(),source=await notificationExecutionSource(f.db,f.input,'dataset');
 expect(source.receipt.artifactId).toBe('dataset');
 await f.db.query("UPDATE artifacts SET version=version+1 WHERE id='dataset'");
 expect((await notificationExecutionSource(f.db,f.input,'dataset')).receipt).toEqual(source.receipt);
 await f.db.query("UPDATE artifacts SET meta=jsonb_set(meta,'{catalog,tables,0,columns,0,name}','\"other\"') WHERE id='dataset'");
 expect((await notificationExecutionSource(f.db,f.input,'dataset')).receipt.schemaRevision).not.toBe(source.receipt.schemaRevision);
 await f.db.query('UPDATE tokens SET deleted_at=now() WHERE id=$1',[f.token.id]);
 await expect(notificationExecutionFence(f.db,f.input)).rejects.toMatchObject({code:'notification_access_revoked'});
});
it('requires explicit current membership and every contributing source permission',async()=>{
 const f=await setup(),source=(await notificationExecutionSource(f.db,f.input,'dataset')).receipt;
 expect(await notificationSourcesReadable(f.db,'document',f.owner.id,[source])).toBe(true);
 expect(await notificationSourcesReadable(f.db,'document',f.other.id,[])).toBe(false);
 await seedOwnerJoin(f.db,'document',f.other.id);
 expect(await notificationSourcesReadable(f.db,'document',f.other.id,[])).toBe(true);
 expect(await notificationSourcesReadable(f.db,'document',f.other.id,[source])).toBe(false);
 const plan:MutationNotificationPlan={executionFence:await notificationExecutionFence(f.db,f.input),rules:[{ruleName:'public',sources:[],rows:[{recipientIds:[f.other.id],message:'same'}]},{ruleName:'private',sources:[source],rows:[{recipientIds:[f.other.id],message:'same'}]}]};
 expect(await notificationAuthority.admitRecipients(f.db,f.input,plan,[f.other.id])).toEqual([]);
 await f.db.query("UPDATE relations SET status='left',deleted_at=now() WHERE subject_id=$1",[f.owner.id]);
 expect(await notificationSourcesReadable(f.db,'document',f.owner.id,[source])).toBe(false);
});
it('never borrows publisher authority for a different initiating user',async()=>{
 const f=await setup();
 await expect(notificationExecutionSource(f.db,{...f.input,initiator:{...f.input.initiator,principal:{kind:'user',id:f.other.id}},bindings:{...f.input.bindings,userId:f.other.id}},'dataset')).rejects.toMatchObject({code:'notification_access_revoked'});
 expect(await notificationAuthority.canManage(f.db,{kind:'user',id:f.other.id},'document')).toBe(false);
});

it('rejects credential deletion and token account reassignment during execution and disclosure',async()=>{
 const f=await setup(),source=(await notificationExecutionSource(f.db,f.input,'dataset')).receipt;
 await f.db.query('UPDATE tokens SET user_id=$2 WHERE id=$1',[f.token.id,f.other.id]);
 await expect(notificationExecutionFence(f.db,f.input)).rejects.toMatchObject({code:'notification_access_revoked'});
 await f.db.query('DELETE FROM dataset_secrets');
 expect(await notificationSourcesReadable(f.db,'document',f.owner.id,[source])).toBe(false);
});
