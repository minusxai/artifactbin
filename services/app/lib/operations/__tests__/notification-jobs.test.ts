import {expect,it,vi} from 'vitest';
import type {MutationNotificationJobStore} from '@artifactbin/contracts';
import {notificationJobOperations} from '../notification-jobs';
import type {OpContext} from '../registry';

it('job operations pass only the authenticated principal and requested run/job identity to the repository',async()=>{
 const list=vi.fn(async()=>[]),status=vi.fn(async()=>null),retry=vi.fn(async()=>false);
 const store={list,status,retry} as unknown as MutationNotificationJobStore;
 const ops=notificationJobOperations(async()=>store);
 const ctx:OpContext={actor:{userId:'user',tokenId:'token'},base:'http://localhost:5001',request:new Request('http://localhost:5001'),author:{kind:'agent',label:'untrusted',transport:'http'}};
 expect(await ops[0]!.run(ctx,{runId:'run',actorId:'spoof'})).toEqual({status:200,body:{jobs:[]}});
 expect(list).toHaveBeenCalledWith({kind:'token',id:'token'},'run');
 expect(await ops[1]!.run(ctx,{jobId:'job'})).toEqual({status:404,body:{error:'not_found'}});
 expect(status).toHaveBeenCalledWith({kind:'token',id:'token'},'job');
 expect(await ops[2]!.run(ctx,{jobId:'job'})).toEqual({status:404,body:{error:'not_found'}});
 expect(retry).toHaveBeenCalledWith({kind:'token',id:'token'},'job');
 ctx.actor={userId:null,tokenId:'token'};
 await ops[0]!.run(ctx,{runId:'run'});
 expect(list).toHaveBeenLastCalledWith({kind:'token',id:'token'},'run');
});
