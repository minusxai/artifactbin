/** One monotonic stored-read lifetime. Only uncooperative metadata/object reads are raced;
 * SQL is awaited with this signal so B1 confirms worker termination before releasing capacity.
 */
import {sqlTimeout} from '@artifactbin/contracts';
import {SQL_READ_WALL_TIMEOUT_MS} from '@/lib/platform';
export function readLifetime(parent?:AbortSignal,wallTimeoutMs?:number){
 const budget=sqlTimeout(wallTimeoutMs,SQL_READ_WALL_TIMEOUT_MS,SQL_READ_WALL_TIMEOUT_MS,'SQL wall timeout',true);
 const deadline=performance.now()+budget;
 const controller=new AbortController();
 const signal=parent?AbortSignal.any([parent,controller.signal]):controller.signal;
 const expire=()=>controller.abort(new Error('sql_deadline'));
 const timer=setTimeout(expire,budget);timer.unref?.();
 const check=()=>{if(performance.now()>=deadline)expire();signal.throwIfAborted();};
 const remaining=()=>{check();const left=Math.floor(deadline-performance.now());if(left<1){expire();signal.throwIfAborted();}return left;};
 const step=async<T>(pending:Promise<T>):Promise<T>=>{
  let abort!:()=>void;
  const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
  try{const value=await Promise.race([pending,cancelled]);check();return value;}finally{signal.removeEventListener('abort',abort);}
 };
 return {signal,deadline,check,remaining,step,close:()=>clearTimeout(timer)};
}
