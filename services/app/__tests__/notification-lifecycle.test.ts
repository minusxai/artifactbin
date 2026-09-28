import {expect,it,vi} from 'vitest';
import {useAppHarness,request} from './harness';
import {POST as createArtifactRoute} from '@/app/api/artifacts/route';
import {getDb} from '@/lib/db';
import {createUser} from '@/lib/users';
import {mintToken} from '@/lib/tokens';
import {compiledOf} from '@/test/helpers/compiled';
import {notificationContextSnapshot} from '@/lib/notification-context';
import {createNotificationJobStore} from '@/lib/notification-jobs';
import {notificationAuthority} from '@/lib/notification-authority';
import {startAppBackgroundTasks} from '@/lib/app-background-tasks';
useAppHarness();
it('the process background lifecycle recovers a persisted job without a request or manual drain',async()=>{
 const owner=await createUser({email:'lifecycle@example.com'}),token=await mintToken('lifecycle',owner.id),db=await getDb();
 const response=await createArtifactRoute(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Lifecycle</p>',visibility:'unlisted'}})),doc=await response.json();
 const flow=await compiledOf('<Import name="tasks" src="ref:abc123" /><Mutation name="change">{`UPDATE tasks.rows SET n=n+1`}</Mutation><Notify name="notice" on="change">{`SELECT $_me.id AS "to", \'Background recovered\' AS message`}</Notify>',{abc123:[{name:'n',type:'number'}]});
 const store=createNotificationJobStore({db,authority:notificationAuthority}),principal={kind:'token' as const,id:token.id};
 await db.transaction(tx=>store.enqueue(tx,[{origin:{mutationRunId:'lifecycle-run',documentId:doc.id,documentEditId:'e',documentVersion:1,mutationName:'change',ruleId:'notice'},initiator:{principal,execution:'agent',agentLabel:null},rule:flow.notifications![0]!,bindings:{values:{},types:{},userId:owner.id,now:new Date().toISOString(),tz:'UTC'},...notificationContextSnapshot(flow)}]));
 expect((await store.list(principal,'lifecycle-run'))[0]?.status).toBe('pending');
 const stop=await startAppBackgroundTasks(db);
 try{await vi.waitFor(async()=>expect((await store.list(principal,'lifecycle-run'))[0]).toMatchObject({status:'completed',attempts:1}),{timeout:2500,interval:25});}
 finally{await stop();await stop();}
});
