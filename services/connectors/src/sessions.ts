/** Bounded sessions: retiring or unconfirmed sessions still own capacity. Queue cancellation
 * removes the waiter before it can dispatch; close failure quarantines rather than frees a slot.
 * A failed cleanup is never a caller's outcome: `use()` answers with its work's own error, or with its result
 * when only the cleanup after it failed (the slot stays quarantined either way), and `acquire()` moves past an
 * idle session it could not evict (or whose eviction outlasts its own deadline), to another idle one, a free
 * slot or that deadline's timeout. Each such failure is logged, without the driver's text; only `close()`, the
 * explicit retry, rejects with it.
 * A quarantine is bounded. Its cleanup is retried every `retryMs`, so a session the driver later confirms gone (a
 * dropped connection the database no longer lists) frees its slot then. And the slot frees anyway `graceMs` after
 * the deadline of the use it last served: every connector sets the engine's own statement timeout from that use's
 * remaining budget, so by then the database has stopped any work the session carried. */
import { CONNECTOR_LIMITS } from '@artifactbin/contracts';
import { log } from '@artifactbin/utils';
import { ConnectorFailure } from './errors';
import { UNCONFIRMED } from './termination';
const warn=log('connectors').warn;
/** A failed cleanup as one `unavailable` error: a driver's own account of why (./termination) is kept, any other
 * failure says only its code, never a driver's text. */
const unconfirmed=(error:unknown)=>new ConnectorFailure('unavailable',error instanceof ConnectorFailure&&error.message.startsWith(UNCONFIRMED)
 ?error.message:`${UNCONFIRMED}: the driver's close failed (${error instanceof ConnectorFailure?error.code:'not a connector error'})`);
export interface SessionDriver<S> { open(key:string,context?:{signal?:AbortSignal;timeoutMs?:number}):Promise<S>; close(session:S):Promise<void> }
interface Entry<S> { key:string; session:Promise<S>; busy:boolean; used:number; until:number; timer?:ReturnType<typeof setTimeout>; retiring?:Promise<void>; retry?:ReturnType<typeof setTimeout> }
const QUARANTINE={retryMs:1000,graceMs:5000};
export class SessionPool<S> {
 private readonly entries=new Set<Entry<S>>();
 private readonly waiting=new Set<()=>void>();
 private closed=false;
 constructor(private readonly driver:SessionDriver<S>,private readonly bounds:{size:number;idleMs:number;waitMs:number;retryMs?:number;graceMs?:number}={size:CONNECTOR_LIMITS.poolSize,idleMs:CONNECTOR_LIMITS.idleMs,waitMs:CONNECTOR_LIMITS.connectTimeoutMs}){}
 count(){return this.entries.size;}
 async use<T>(key:string,work:(session:S,discard:()=>void)=>Promise<T>,context:{signal?:AbortSignal;timeoutMs?:number}={}):Promise<T>{
  const deadline=performance.now()+(context.timeoutMs??this.bounds.waitMs);
  const check=()=>{if(context.signal?.aborted||performance.now()>=deadline)throw new ConnectorFailure('timeout','the query was cancelled or expired');};
  const entry=await this.acquire(key,deadline,context.signal);
  entry.until=deadline;
  let keep=true;
  try{const session=await entry.session;check();return await work(session,()=>{keep=false;});}
  catch(error){keep=false;throw error;}
  finally{if(keep&&!this.closed)this.release(entry);else await this.retire(entry);}
 }
 private async acquire(key:string,deadline:number,signal?:AbortSignal):Promise<Entry<S>>{
  for(;;){
   if(signal?.aborted||performance.now()>=deadline)throw new ConnectorFailure('timeout','the query was cancelled or expired');
   if(this.closed)throw new ConnectorFailure('unavailable','the connection is closed');
   const idle=[...this.entries].find(e=>e.key===key&&!e.busy);
   if(idle){clearTimeout(idle.timer);idle.busy=true;return idle;}
   if(this.entries.size>=this.bounds.size){const evict=[...this.entries].filter(e=>!e.busy).sort((a,b)=>a.used-b.used)[0];if(evict){await this.pause(deadline,signal,this.retire(evict));continue;}}
   if(this.entries.size<this.bounds.size){
    const entry:Entry<S>={key,busy:true,used:performance.now(),until:deadline,session:this.driver.open(key,{signal,timeoutMs:Math.max(1,Math.floor(deadline-performance.now()))})};
    this.entries.add(entry);entry.session.catch(()=>{this.entries.delete(entry);this.wake();});return entry;
   }
   await this.pause(deadline,signal);
  }
 }
 /** Until capacity may have changed (`wake`), `settled` (an eviction's cleanup) finishes, or the caller's own
  * deadline or abort; a slow cleanup carries on in the background and still logs. */
 private pause(deadline:number,signal?:AbortSignal,settled?:Promise<void>):Promise<void>{
  return new Promise<void>(resolve=>{
   const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);this.waiting.delete(done);resolve();};
   const timer=setTimeout(done,Math.max(1,deadline-performance.now()));
   this.waiting.add(done);signal?.addEventListener('abort',done,{once:true});void settled?.then(done);if(signal?.aborted)done();
  });
 }
 private release(entry:Entry<S>){entry.busy=false;entry.used=performance.now();entry.timer=setTimeout(()=>{void this.retire(entry);},this.bounds.idleMs);entry.timer.unref?.();this.wake();}
 private async drop(entry:Entry<S>):Promise<void>{
  if(!this.entries.has(entry))return;
  entry.busy=true;clearTimeout(entry.timer);
  // Keep one cleanup attempt per slot even after a caller's cleanup wait expires.
  if(!entry.retiring){
   entry.retiring=entry.session.then(s=>this.driver.close(s),()=>undefined)
    .then(()=>{this.entries.delete(entry);this.wake();})
    .catch((error:unknown)=>{throw unconfirmed(error);})
    .finally(()=>{entry.retiring=undefined;});
  }
  let timer:ReturnType<typeof setTimeout>;
  try{await Promise.race([entry.retiring,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new ConnectorFailure('unavailable',`${UNCONFIRMED}: the pool's 5000 ms wait for the cleanup expired`)),5000);})]);}
  finally{clearTimeout(timer!);}
 }

 /** Cleanup on a caller's behalf: an unconfirmed termination leaves the slot quarantined (still counted, never
  * reused) and is logged, never thrown into the caller. */
 private async retire(entry:Entry<S>):Promise<void>{
  try{await this.drop(entry);}
  catch(error){
   warn('session termination unconfirmed; its slot stays quarantined',{reason:(error as Error).message,sessions:this.entries.size,size:this.bounds.size});
   if(!entry.retry)this.quarantine(entry,Math.max(entry.until,performance.now())+(this.bounds.graceMs??QUARANTINE.graceMs));
  }
 }
 /** Retry the cleanup until it confirms, or free the slot at `expires` (the header's bound). */
 private quarantine(entry:Entry<S>,expires:number){
  if(this.closed||!this.entries.has(entry))return;
  entry.retry=setTimeout(()=>{
   entry.retry=undefined;
   if(this.closed||!this.entries.has(entry))return;
   if(performance.now()>=expires){
    this.entries.delete(entry);this.wake();
    warn('a quarantined slot reached its bound and is released',{sessions:this.entries.size,size:this.bounds.size});
    return;
   }
   void this.drop(entry).catch(()=>this.quarantine(entry,expires));
  },Math.max(1,Math.min(this.bounds.retryMs??QUARANTINE.retryMs,expires-performance.now())));
  entry.retry.unref?.();
 }
 private wake(){for(const done of [...this.waiting])done();}
 async close(){this.closed=true;for(const e of this.entries)clearTimeout(e.retry);this.wake();await Promise.all([...this.entries].map(e=>this.drop(e)));}
}
