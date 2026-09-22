import {spawn} from 'node:child_process';
import {readFile,stat} from 'node:fs/promises';
import {basename,resolve} from 'node:path';
import {isSea} from 'node:sea';
import {REMOTE_HISTORY_BYTES,REMOTE_NAME} from '../../contracts/src/remote';
import {REMOTE_WORKER_ARG} from './entry-args';
import {CliError} from './errors';
import type {Connection} from './config';
export interface RemoteLaunchOptions {
 connection:Connection; command:string; args:string[]; name?:string; history?:string;
 cwd:string; home:string; env?:NodeJS.ProcessEnv; timeoutMs?:number;
 worker?:{command:string;args:string[]};
}
export interface RemoteLaunchReceipt {id:string;name:string;url:string;pid:number;status:'starting'}
export interface RemoteWorkerInput extends Omit<RemoteLaunchOptions,'worker'|'timeoutMs'|'env'> {history?:string}
/** Credentials travel only over the private startup pipe, never argv or a persisted launch file. */
export async function launchRemote(options:RemoteLaunchOptions):Promise<RemoteLaunchReceipt>{
 if(process.platform==='win32')throw new CliError('unsupported_platform','Background remote agents currently support macOS and Linux. Use --foreground on Windows.');
 const name=options.name??basename(options.command).replace(/\.exe$/i,'').toLowerCase();
 if(!REMOTE_NAME.test(name))throw new CliError('invalid_name','Use a lowercase agent name of 1–32 letters, digits, underscores or hyphens, starting with a letter.');
 let history:string|undefined;
 if(options.history){
  const file=resolve(options.cwd,options.history),info=await stat(file);
  if(!info.isFile()||info.size>REMOTE_HISTORY_BYTES)throw new CliError('invalid_history',`History must be a UTF-8 file of at most ${REMOTE_HISTORY_BYTES} bytes.`);
  const bytes=await readFile(file);
  if(bytes.length>REMOTE_HISTORY_BYTES)throw new CliError('invalid_history','History grew beyond the size limit.');
  try{history=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new CliError('invalid_history','History must be valid UTF-8.');}
 }
 const worker=options.worker??{command:process.execPath,args:[...(isSea()?[]:[...process.execArgv,process.argv[1]!]),REMOTE_WORKER_ARG]};
 const child=spawn(worker.command,worker.args,{cwd:options.cwd,env:options.env??process.env,detached:true,stdio:['ignore','ignore','ignore','ipc']});
 return new Promise((resolveReceipt,reject)=>{
  let settled=false;
  const finish=(error?:Error,receipt?:RemoteLaunchReceipt)=>{
   if(settled)return;settled=true;clearTimeout(timer);
   child.removeListener('message',message);child.removeListener('exit',exited);
   if(child.connected)child.disconnect();
   if(error){child.kill('SIGTERM');reject(error);}else{child.unref();resolveReceipt(receipt!);}
  };
  const exited=(code:number|null)=>finish(new Error(`Remote worker exited before startup (${code}).`));
  const message=(value:unknown)=>{
   if(!value||typeof value!=='object')return;
   const receipt=value as RemoteLaunchReceipt&{error?:string};
   if(receipt.error)return finish(new Error(receipt.error));
   if(typeof receipt.id==='string'&&typeof receipt.url==='string'&&receipt.status==='starting'&&typeof receipt.pid==='number')finish(undefined,receipt);
  };
  const timer=setTimeout(()=>finish(new Error('Remote worker startup timed out.')),options.timeoutMs??15000);
  child.once('error',error=>finish(error));child.once('exit',exited);child.on('message',message);
  child.send({connection:options.connection,command:options.command,args:options.args,name,history,cwd:options.cwd,home:options.home} satisfies RemoteWorkerInput,error=>{if(error)finish(error);});
 });
}
