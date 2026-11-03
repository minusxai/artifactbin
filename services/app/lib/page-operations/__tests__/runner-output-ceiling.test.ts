import {afterEach,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {RESOLVER_LIMITS} from '@artifactbin/contracts';
import {createRunner} from '@artifactbin/runner/local';

// The runner's own ceilings clamp every run's limits: a resolver answer up to RESOLVER_LIMITS.outputBytes must pass
// a runner built with no ceilings of its own, as production's is.
const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
it('lets a resolver answer reach RESOLVER_LIMITS.outputBytes through a runner with default ceilings',async()=>{
 const db=new PGlite();cleanup.push(()=>db.close());
 const runner=await createRunner({db,capabilities:async()=>{throw Error('forbidden');}});cleanup.push(()=>runner.close());
 const bytes=RESOLVER_LIMITS.outputBytes-1024;
 const {runId}=await runner.start({userId:'alice',requestId:'big',program:{source:`export default()=>"x".repeat(${bytes})`,language:'typescript'},input:null,
  limits:{timeoutMs:RESOLVER_LIMITS.wallMs,cpuMs:2000,memoryMiB:64,maxRequests:1,maxOutputBytes:RESOLVER_LIMITS.outputBytes}});
 let run=await runner.getRun({userId:'alice',runId});
 for(let n=0;n<1000&&!run.receipt;n++){await new Promise(r=>setTimeout(r,10));run=await runner.getRun({userId:'alice',runId});}
 expect(run.receipt?.reason??null).toBeNull();
 expect(run.status).toBe('completed');
});
