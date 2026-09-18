import {CliError} from './commands';
/** Downloads abort when no bytes arrive for `stallMs`, never on total duration: a slow link may take as long as it needs. */
/** `onProgress` hears every chunk: the bytes so far and, when the response declares it, the total. */
export type DownloadProgress=(received:number,total?:number)=>void;
export const DOWNLOAD_STALL_MS=60_000;
export async function download(url:string,fetcher:typeof fetch,maxBytes:number,stallMs=DOWNLOAD_STALL_MS,onProgress?:DownloadProgress):Promise<Buffer>{
 const control=new AbortController();let watchdog=setTimeout(()=>control.abort(),stallMs);
 const progressed=()=>{clearTimeout(watchdog);watchdog=setTimeout(()=>control.abort(),stallMs);};
 try{return await downloadWith(url,fetcher,maxBytes,control.signal,progressed,onProgress);}
 catch(error){
  if(control.signal.aborted)throw new CliError('release_unavailable',`Release download stalled for ${Math.round(stallMs/1000)} seconds.`,'Retry afbin update after checking connectivity.');
  throw error;
 }finally{clearTimeout(watchdog);}
}
async function downloadWith(url:string,fetcher:typeof fetch,maxBytes:number,signal:AbortSignal,progressed:()=>void,onProgress?:DownloadProgress):Promise<Buffer>{
 const response=await fetcher(url,{redirect:'follow',signal,headers:{Accept:'application/json','User-Agent':'afbin-update'}});
 if(!response.ok)throw new CliError('release_unavailable',`Release download returned HTTP ${response.status}.`,'Retry afbin update after checking connectivity.');
 if(url.startsWith('https:')&&response.url&&new URL(response.url).protocol!=='https:')throw new CliError('invalid_release','Release download redirected outside HTTPS.');
 const declared=Number(response.headers.get('content-length'));
 if(declared>maxBytes)throw new CliError('invalid_release','Release download exceeds its size limit.');
 const total=Number.isSafeInteger(declared)&&declared>0?declared:undefined;
 if(!response.body)throw new CliError('invalid_release','Release download is empty.');
 const reader=response.body.getReader(),chunks:Buffer[]=[];let length=0;
 const aborted=new Promise<never>((_,reject)=>signal.addEventListener('abort',()=>{reject(new Error('aborted'));reader.cancel().catch(()=>{});},{once:true}));
 try{for(;;){const {done,value}=await Promise.race([reader.read(),aborted]);if(done)break;progressed();length+=value.byteLength;if(length>maxBytes){await reader.cancel();throw new CliError('invalid_release','Release download exceeds its size limit.');}chunks.push(Buffer.from(value));onProgress?.(length,total);}}finally{reader.releaseLock();}
 return Buffer.concat(chunks);
}
