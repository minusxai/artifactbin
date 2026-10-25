/** Browser containers are created by this invocation and verified before any browser executes. */
import assert from 'node:assert/strict';
const BROWSER_CPUS=4;
const BROWSER_MEMORY=6000000000;
export function browserCpuCap(daemonCpus){
 assert.ok(Number.isInteger(daemonCpus)&&daemonCpus>0,'Invalid Docker CPU capacity');return Math.min(BROWSER_CPUS,daemonCpus);
}
export function verifyBrowserContainer(info,{owner,id,cpus=4}){
 assert.ok(Number.isInteger(cpus)&&cpus>0&&cpus<=BROWSER_CPUS,'Invalid chosen browser CPU cap');
 assert.equal(info.Id,id,'Browser container creation identity mismatch');
 assert.equal(info.Config?.Labels?.['afbin.remediation.owner'],owner,'Browser container ownership mismatch');
 assert.equal(info.HostConfig?.NanoCpus,cpus*1e9,'Browser CPU quota mismatch');
 assert.equal(info.HostConfig?.Memory,BROWSER_MEMORY,'Browser memory quota mismatch');
 assert.equal(info.HostConfig?.MemorySwap,BROWSER_MEMORY,'Browser swap must be disabled');
 return {id,owner,cpus,memory_bytes:BROWSER_MEMORY,memory_swap_bytes:BROWSER_MEMORY};
}
