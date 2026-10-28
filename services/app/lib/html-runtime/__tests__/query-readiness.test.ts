import {it,expect} from 'vitest';
import {createQueryReadiness} from '../query-readiness';
function timers(){const tasks=new Set<()=>void>();return {schedule(callback:()=>void){tasks.add(callback);return callback;},cancel(handle:unknown){tasks.delete(handle as ()=>void);},expire(){for(const callback of [...tasks])callback();},size:()=>tasks.size};}
it('bounds initial waits and never dispatches a timed-out or canceled query under a later connection',async()=>{
 const clock=timers();const ready=createQueryReadiness({pending:true,...clock});let sends=0;
 const sender=async()=>{sends++;return {data:{count:9}};};
 const first=ready.wait();clock.expire();expect(await first).toBeNull();expect(clock.size()).toBe(0);
 ready.update(false,undefined,true);const pending=ready.wait();ready.update(true,sender);const bound=(await pending)!;ready.update(false);ready.update(true,sender);await expect(bound({query:'{ count }',variables:{},operation:'query'})).rejects.toThrow();expect(sends).toBe(0);ready.dispose();
});
it('never waits offline and deduplicates availability transitions while preserving a real reconnect',async()=>{
 const ready=createQueryReadiness({pending:false,...timers()});const sender=async()=>({data:{count:9}});
 expect(await ready.wait()).toBeNull();expect(ready.update(true,sender)).toBe(true);expect(ready.update(true,sender)).toBe(false);
 ready.update(false,undefined,true);expect(ready.online()).toBe(false);const pending=ready.wait();ready.update(false);expect(await pending).toBeNull();expect(ready.update(true,sender)).toBe(true);ready.dispose();expect(await ready.wait()).toBeNull();
});
it('releases every pending reader on disposal and invalidates a sender on account replacement',async()=>{
 const clock=timers(),ready=createQueryReadiness({pending:true,...clock});const first=ready.wait(),second=ready.wait();ready.dispose();expect(await first).toBeNull();expect(await second).toBeNull();expect(clock.size()).toBe(0);
 const account=createQueryReadiness({pending:true,...timers()});let calls=0;const old=async()=>{calls++;return {data:{count:1}};};account.update(true,old);const bound=(await account.wait())!;account.update(true,async()=>({data:{count:2}}));await expect(bound({query:'{ count }',variables:{},operation:'query'})).rejects.toThrow();expect(calls).toBe(0);account.dispose();
});
