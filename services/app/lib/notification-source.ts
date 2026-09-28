/** Bounded source object loading, with one budget across every import in a job. */
import type {Readable} from 'node:stream';
import type {ObjectStore} from './object-store';
import {NOTIFICATION_QUERY_LIMITS,type Row} from '@artifactbin/contracts';
import {NotificationExecutionError} from './notification-error';
export interface NotificationSourceReaderOptions {store:Pick<ObjectStore,'getStream'>;maxBytes?:number;maxRows?:number;timeoutMs?:number}
export function createNotificationSourceReader(options:NotificationSourceReaderOptions){
 let remainingBytes=options.maxBytes??NOTIFICATION_QUERY_LIMITS.sourceBytes,remainingRows=options.maxRows??NOTIFICATION_QUERY_LIMITS.sourceRows;
 const deadline=Date.now()+(options.timeoutMs??NOTIFICATION_QUERY_LIMITS.loadingTimeoutMs);
 return {read(key:string):Promise<Row[]>{
  return new Promise((resolve,reject)=>{
   let finished=false,stream:Readable|undefined;
   const remaining=deadline-Date.now();
   if(remaining<=0){reject(new NotificationExecutionError('notification_query_timeout'));return;}
   const finish=(error:unknown,rows?:Row[])=>{
    if(finished)return;finished=true;clearTimeout(timer);stream?.destroy();
    if(error)reject(error);else resolve(rows!);
   };
   const timer=setTimeout(()=>finish(new NotificationExecutionError('notification_query_timeout')),remaining);
   timer.unref?.();
   // Range includes one sentinel byte. A source larger than the remaining budget
   // is detected without fetching/buffering the whole object, on both S3 and disk.
   Promise.resolve().then(()=>options.store.getStream(key,{start:0,end:remainingBytes})).then(async opened=>{
    stream=opened;
    // ObjectStore cannot abort acquisition itself; a response arriving after timeout
    // is immediately destroyed and can never publish rows or retain a file handle.
    if(finished){stream.destroy();return;}
    try{
     const chunks:Buffer[]=[];
     for await(const part of stream){
      const chunk=Buffer.isBuffer(part)?part:Buffer.from(part as string);
      remainingBytes-=chunk.length;
      if(remainingBytes<0)throw new NotificationExecutionError('notification_capacity');
      chunks.push(chunk);
     }
     if(finished)return;
     let rows:unknown;
     try{rows=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new NotificationExecutionError('notification_source_invalid');}
     if(!Array.isArray(rows)||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new NotificationExecutionError('notification_source_invalid');
     if(Date.now()>deadline)throw new NotificationExecutionError('notification_query_timeout');
     remainingRows-=rows.length;
     if(remainingRows<0)throw new NotificationExecutionError('notification_capacity');
     finish(null,rows as Row[]);
    }catch(error){finish(error);}
   },error=>finish(error));
  });
 }};
}
