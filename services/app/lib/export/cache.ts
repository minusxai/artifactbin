import {randomUUID} from 'node:crypto';
import type { Db } from '@/lib/db';

export interface ExportImage {
  id:string; artifact_id:string; object_key:string; mime:'image/png'|'image/jpeg';
  bytes:number; width:number; height:number;
}
export interface ExportCacheRequest { cacheKey:string; artifactId:string; revision:string; refresh?:boolean }
export interface ExportCacheOptions { freshMs?:number; leaseMs?:number; waitMs?:number; retryMs?:number; pollMs?:number[] }
export type ExportProducer=(id:string)=>Promise<Omit<ExportImage,'id'|'artifact_id'>>;

export class ExportCacheUnavailable extends Error {
  constructor(){super('Export refresh did not complete; try again shortly');this.name='ExportCacheUnavailable';}
}
interface Snapshot {image:ExportImage|null;source_revision:string|null;fresh:boolean|null;backoff:boolean|null}

/** Shared metadata only. A producer never executes inside a transaction. */
export function createExportCache(db:Db,options:ExportCacheOptions={}) {
  const freshMs=options.freshMs??3_600_000,leaseMs=options.leaseMs??60_000;
  const waitMs=options.waitMs??35_000,retryMs=options.retryMs??30_000,polls=options.pollMs??[1000,2000,4000,8000];
  if(![freshMs,leaseMs,waitMs,retryMs,...polls].every(n=>Number.isSafeInteger(n)&&n>0)||!polls.length)throw new Error('Invalid export cache timing');
  const jobs=new Set<Promise<ExportImage|null>>();
  const snapshot=async(key:string):Promise<Snapshot> => (await db.query<Snapshot>(`
    SELECT to_jsonb(i) AS image,c.source_revision,c.expires_at>clock_timestamp() AS fresh,
      c.retry_after>clock_timestamp() AS backoff
    FROM export_image_cache c LEFT JOIN export_images i ON i.id=c.image_id WHERE c.cache_key=$1`,[key])).rows[0];
  const produceAndPublish=async(request:ExportCacheRequest,token:string,produce:ExportProducer):Promise<ExportImage|null>=>{
    try {
      const details=await produce(token);
      const image:ExportImage={...details,id:token,artifact_id:request.artifactId};
      if(!['image/png','image/jpeg'].includes(image.mime)||![image.bytes,image.width,image.height].every(n=>Number.isSafeInteger(n)&&n>0))throw new Error('Invalid export image');
      return await db.transaction(async tx=>{
        const accepted=await tx.query(`UPDATE export_image_cache SET image_id=$3,source_revision=$4,
          expires_at=clock_timestamp()+$5::int*interval '1 millisecond',claim_token=NULL,lease_until=NULL,retry_after=NULL
          WHERE cache_key=$1 AND claim_token=$2 AND lease_until>clock_timestamp() RETURNING cache_key`,
          [request.cacheKey,token,image.id,request.revision,freshMs]);
        if(!accepted.rows.length)return null;
        await tx.query('INSERT INTO export_images(id,artifact_id,object_key,mime,bytes,width,height) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [image.id,image.artifact_id,image.object_key,image.mime,image.bytes,image.width,image.height]);
        return image;
      });
    } catch (error) {
      await db.query(`UPDATE export_image_cache SET claim_token=NULL,lease_until=NULL,
        retry_after=clock_timestamp()+$3::int*interval '1 millisecond' WHERE cache_key=$1 AND claim_token=$2`,[request.cacheKey,token,retryMs]);
      throw error;
    }
  };
  return {
    async read(request:ExportCacheRequest,produce:ExportProducer):Promise<ExportImage> {
      await db.query('INSERT INTO export_image_cache(cache_key,artifact_id) VALUES($1,$2) ON CONFLICT(cache_key) DO NOTHING',[request.cacheKey,request.artifactId]);
      let state=await snapshot(request.cacheKey);
      const baseline=state.image?.id??null,deadline=performance.now()+waitMs;
      let attempt=0;
      for(;;){
        const image=state.image;
        const refreshed=!request.refresh||image?.id!==baseline;
        if(image&&state.fresh&&state.source_revision===request.revision&&refreshed)return image;
        if(state.backoff){if(image&&!request.refresh)return image;throw new ExportCacheUnavailable();}
        const token=randomUUID();
        // The conditional update is the cross-process mutex. Preserve the old image.
        const claimed=await db.query(`UPDATE export_image_cache SET claim_token=$2,
          lease_until=clock_timestamp()+$3::int*interval '1 millisecond'
          WHERE cache_key=$1 AND (lease_until IS NULL OR lease_until<=clock_timestamp())
          AND (retry_after IS NULL OR retry_after<=clock_timestamp())
          AND (image_id IS NULL OR expires_at<=clock_timestamp() OR source_revision IS DISTINCT FROM $4
            OR ($5::boolean AND image_id IS NOT DISTINCT FROM $6::text)) RETURNING cache_key`,
          [request.cacheKey,token,leaseMs,request.revision,!!request.refresh,baseline]);
        if(claimed.rows.length){
          const job=produceAndPublish(request,token,produce);jobs.add(job);
          void job.then(()=>jobs.delete(job),()=>jobs.delete(job));
          if(image&&!request.refresh)return image;
          let timer:ReturnType<typeof setTimeout>|undefined;
          try {
            const result=await Promise.race([job,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new ExportCacheUnavailable()),Math.max(1,deadline-performance.now()));})]);
            if(result)return result;
          } finally {clearTimeout(timer);}
          state=await snapshot(request.cacheKey);continue;
        }
        if(image&&!request.refresh)return image;
        const remaining=deadline-performance.now();if(remaining<=0)throw new ExportCacheUnavailable();
        const delay=polls[Math.min(attempt++,polls.length-1)]!*(0.9+Math.random()*0.2);
        await new Promise(r=>setTimeout(r,Math.min(delay,remaining)));
        state=await snapshot(request.cacheKey);
      }
    },
    async drain():Promise<void>{await Promise.allSettled([...jobs]);},
  };
}
