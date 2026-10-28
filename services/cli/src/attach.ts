import type {RemoteView} from '../../contracts/src/remote';
import {CliError} from './errors';
import {httpStatus,type HttpClient} from './http';
import {setTimeout as delay} from 'node:timers/promises';

interface AttachOptions {
 /** The shared client: refresh, sign-in and refusal codes are its job, not this module's. */
 client:HttpClient;id:string;interactive:boolean;
 onSession?:(url:string)=>void;stdout?:(value:string)=>void;signal?:AbortSignal;
}
/** Mirror an existing session as a controller: replay frames, forward input, never register a runner. */
export async function attachRemote(options:AttachOptions):Promise<number>{
 const {client,id}=options;const write=options.stdout??(value=>process.stdout.write(value));
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new CliError('invalid_session','Use the session id returned by afbin list --type session.');
 const request=async<T>(path:string,method='GET',body?:unknown):Promise<T>=>{
  try{return await client.request<T>(`/remote/sessions${path}`,method,body,{},{timeoutMs:10000,signal:options.signal});}
  catch(error){
   const status=httpStatus(error);
   if(status===410)throw new CliError('session_disconnected','The session was removed; a replacement is never created silently.','Start a new session with afbin remote <command>.');
   if(status===404)throw new CliError('not_found',`Session ${id} is not available to this account.`);
   throw error;
  }
 };
 options.onSession?.(`${client.connection.server}/chat?session=${id}`);
 let cursor=-1;let generation:string|undefined;let controlled=false;
 const cols=Math.max(2,Math.min(300,process.stdout.columns||80)),rows=Math.max(2,Math.min(120,process.stdout.rows||24));
 const input=(data:Buffer)=>{void request(`/${id}`,'POST',{type:'input',data:data.toString('utf8')}).catch(()=>{});};
 const wasRaw=process.stdin.isRaw;let attached=false;
 const detach=()=>{if(!attached)return;attached=false;process.stdin.off('data',input);process.stdin.setRawMode(wasRaw??false);process.stdin.pause();};
 try{
  while(!options.signal?.aborted){
   const view=await request<RemoteView>(`/${id}?since=${cursor}`);
   if(generation!==undefined&&view.generation!==generation){cursor=-1;generation=view.generation;continue;}
   generation=view.generation;
   if(cursor===-1&&view.snapshot)write(view.snapshot);
   for(const frame of view.frames)write(frame.data);
   cursor=view.seq;
   if(!view.session.online&&view.session.exitCode!==null)return view.session.exitCode;
   if(options.interactive&&!attached){
    attached=true;process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on('data',input);
    if(!controlled){controlled=true;await request(`/${id}`,'POST',{type:'control',controller:'web',cols,rows}).catch(()=>{});}
   }
   await delay(250,undefined,{signal:options.signal}).catch(()=>{});
  }
  return 1;
 }finally{
  detach();
  if(controlled)await request(`/${id}`,'POST',{type:'control',controller:'local'}).catch(()=>{});
 }
}
