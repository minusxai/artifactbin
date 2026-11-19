/** A shared absolute deadline also bounds an uncooperative nested reader or callback.
 * Canonical execution still receives the signal and checks it before releasing buffered results.
 */
export function deadlineStep<T>(signal:AbortSignal,pending:Promise<T>):Promise<T>{
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(signal.reason);
  signal.addEventListener('abort',abort,{once:true});
  pending.then(value=>{signal.removeEventListener('abort',abort);signal.aborted?reject(signal.reason):resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
  if(signal.aborted)abort();
 });
}
