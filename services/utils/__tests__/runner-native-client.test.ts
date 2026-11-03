import {expect,it} from 'vitest';
import {runnerClient} from '../src/runner-client';
import type {Upstream} from '@artifactbin/contracts';
it('forwards run lookups and cancellation under owner identity without trusting JSON identity',async()=>{
 const calls:Array<{path:string;owner:string|undefined;body:unknown}>=[];
 const forward:Upstream=async(request,actor)=>{const url=new URL(request.url);calls.push({path:url.pathname+url.search,owner:actor.userId,body:request.body?await request.json():null});return Response.json(url.pathname.endsWith('/events')?{events:[],nextSequence:3,hasMore:false}:{runId:'native',status:'running',output:null,receipt:null});};
 const client=runnerClient('https://runner.test',forward);
 expect(Object.keys(client).sort()).toEqual(['cancel','events','getRun','start']);
 expect((await client.getRun({userId:'alice',runId:'native',waitMs:50})).status).toBe('running');
 expect((await client.events({userId:'alice',runId:'native',afterSequence:3})).nextSequence).toBe(3);
 await client.cancel({userId:'alice',runId:'native'});
 expect(calls).toEqual([{path:'/v1/runs/native?wait=50',owner:'alice',body:null},{path:'/v1/runs/native/events?after=3&limit=100',owner:'alice',body:null},{path:'/v1/runs/native/cancel',owner:'alice',body:{}}]);
});
