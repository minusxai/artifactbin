import {expect,it} from 'vitest';
import {runnerClient} from '../src/runner-client';
import type {Upstream} from '@artifactbin/contracts';
it('forwards terminal input and cancellation under owner identity without trusting JSON identity',async()=>{
 const calls:Array<{path:string;owner:string|undefined;body:unknown}>=[];
 const forward:Upstream=async(request,actor)=>{const path=new URL(request.url).pathname;calls.push({path,owner:actor.userId,body:request.body?await request.json():null});return Response.json(path.endsWith('/terminal')?{snapshot:'terminal output'}:path==='/v1/capabilities'?{version:1,managedProcesses:true}:{});};
 const client=runnerClient('https://runner.test',forward);
 await client.capabilities!();expect(await client.terminal!({userId:'alice',runId:'native'})).toEqual({snapshot:'terminal output'});
 await client.write!({userId:'alice',runId:'native',text:'login\r'});await client.cancel({userId:'alice',runId:'native'});
 expect(calls).toEqual([{path:'/v1/capabilities',owner:'',body:null},{path:'/v1/runs/native/terminal',owner:'alice',body:null},{path:'/v1/runs/native/input',owner:'alice',body:{text:'login\r'}},{path:'/v1/runs/native/cancel',owner:'alice',body:{}}]);
});
