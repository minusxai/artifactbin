/**
 * Internal: one comment watch at a time per watch log: an exclusive <log>.lock holding the watch's
 * pid and a token. A lock is stale when that pid is gone (a killed watch) or nothing has touched it
 * for two minutes (a running watch touches it on every poll); a stale lock is taken over once.
 * Used by: toolbox-comments.mjs (watch --next), comment-reactions-toolbox tests.
 */
import {readFile,writeFile,unlink,stat,utimes} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const STALE_MS=120000;
async function stale(file){
 let held,info;try{[held,info]=await Promise.all([readFile(file,'utf8'),stat(file)]);}catch(error){
  if(error.code==='ENOENT')return true;throw error;}
 const pid=(()=>{try{return JSON.parse(held).pid;}catch{return null;}})();
 if(Date.now()-info.mtimeMs>STALE_MS||!Number.isSafeInteger(pid))return true;
 try{process.kill(pid,0);return false;}catch(error){return error.code==='ESRCH';}
}
/** Creates the lock, taking over a stale one once; returns its token, or null while one runs. */
async function take(file){
 const token=randomUUID(),body=JSON.stringify({pid:process.pid,token});
 for(let attempt=0;attempt<2;attempt++){
  try{await writeFile(file,body,{flag:'wx',mode:0o600});return token;}catch(error){
   if(error.code!=='EEXIST')throw error;}
  if(!await stale(file))return null;
  await unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});
 }
 return null;
}
/** Runs run(touch) holding the lock and releases it on every exit (return, throw, abort); returns
 * null without running while another watch holds it. touch() marks the lock alive. */
export async function withWatchLock(file,run){
 const token=await take(file);if(!token)return null;
 try{return await run(()=>utimes(file,new Date(),new Date()).catch(()=>{}));}
 finally{await readFile(file,'utf8').then(held=>JSON.parse(held).token===token&&unlink(file))
  .catch(()=>{});}
}
