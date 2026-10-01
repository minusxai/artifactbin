import {expect,it} from 'vitest';
import type {MutationNotificationPlan,NotificationSource} from '@artifactbin/contracts';
import {notificationRecipients} from '@/lib/notifications';
const source=(artifactId:string):NotificationSource=>({artifactId,authorityRevision:'a',schemaRevision:'s'});
const plan:MutationNotificationPlan={executionFence:{principalRevision:'p',documentRevision:'d',contextRevision:'c'},rules:[
 {ruleName:'first',rows:[{recipientIds:['u1','u1'],message:'one'},{recipientIds:['u1'],message:'two'}],sources:[source('private1')]},
 {ruleName:'second',rows:[{recipientIds:['u1'],message:'one'},{recipientIds:['u2'],message:'other'}],sources:[source('private2')]}
]};
it('combines every rule into one notification per recipient retaining all distinct messages',()=>{
 expect(notificationRecipients(plan).map(({recipientId,messages})=>({recipientId,messages}))).toEqual([{recipientId:'u1',messages:['one','two']},{recipientId:'u2',messages:['other']}]);
});
it('retains private sources even when their duplicate message collapses',()=>{
 expect(notificationRecipients(plan)[0]?.sources).toEqual([source('private1'),source('private2')]);
});
it('empty rules complete with no recipients',()=>expect(notificationRecipients({...plan,rules:[]})).toEqual([]));
