import {it,expect} from 'vitest';
import {startConnectionMonitor} from '../monitor';
const status={compatible:true,role:'viewer',remoteDigest:'a'.repeat(64),remoteRevision:'1'};
function clock(){let time=0,id=0;const tasks=new Map<number,{at:number;callback:()=>void}>();return {now:()=>time,schedule(callback:()=>void,delay:number){const key=++id;tasks.set(key,{at:time+delay,callback});return key;},cancel(handle:unknown){tasks.delete(handle as number);},async advance(delay:number){time+=delay;for(const [key,task] of [...tasks])if(task.at<=time){tasks.delete(key);task.callback();}await Promise.resolve();await Promise.resolve();},pending:()=>tasks.size};}
it('polls only in foreground, resumes after inactivity and never overlaps pending reads',async()=>{
 const timer=clock();let visible=false,calls=0,resolve!:(value:typeof status)=>void,signal:AbortSignal|undefined;const received:unknown[]=[];
 const monitor=startConnectionMonitor({...timer,intervalMs:1000,timeoutMs:30_000,foreground:()=>visible,poll:active=>{calls++;signal=active;return new Promise(r=>{resolve=r;});},onStatus:value=>received.push(value),onFailure:()=>{throw Error('unexpected');}});
 await timer.advance(1000);expect(calls).toBe(0);visible=true;monitor.wake();await timer.advance(0);expect(calls).toBe(1);
 await timer.advance(10_000);monitor.wake();await timer.advance(0);expect(calls).toBe(1);
 monitor.dispose();expect(signal?.aborted).toBe(true);resolve(status);await Promise.resolve();await Promise.resolve();expect(received).toEqual([]);expect(timer.pending()).toBe(0);
});
it('allows revocation handlers to stop polling without queued callbacks reviving it',async()=>{
 const timer=clock();let calls=0;const failure=Error('revoked');let monitor:ReturnType<typeof startConnectionMonitor>;
 monitor=startConnectionMonitor({...timer,intervalMs:1000,foreground:()=>true,poll:async()=>{calls++;throw failure;},onStatus:()=>{throw Error('unexpected');},onFailure:error=>{expect(error).toBe(failure);monitor.dispose();}});
 await timer.advance(1000);await timer.advance(100_000);monitor.wake();await timer.advance(1000);expect(calls).toBe(1);expect(timer.pending()).toBe(0);
});

it('bounds stalled observations and ignores their late replies after timeout',async()=>{
 const timer=clock();let resolve!:(value:typeof status)=>void;const received:unknown[]=[],failures:unknown[]=[];
 const monitor=startConnectionMonitor({...timer,intervalMs:1000,timeoutMs:1000,foreground:()=>true,poll:()=>new Promise(r=>{resolve=r;}),onStatus:value=>received.push(value),onFailure:error=>{failures.push(error);monitor.dispose();}});
 await timer.advance(1000);await timer.advance(1000);expect(failures).toHaveLength(1);resolve(status);await Promise.resolve();await Promise.resolve();expect(received).toEqual([]);expect(timer.pending()).toBe(0);
});
