import {randomUUID} from 'node:crypto';
import type { Db } from '@/lib/platform';
import { deleteHeldObjects, failedDeletes, objectStore, type ObjectStore } from '@/lib/object-store';

export interface ExportImage {
  id:string; artifact_id:string; object_key:string; mime:'image/png'|'image/jpeg';
  bytes:number; width:number; height:number;
}
/** `current`: never answer with an image of another source revision (explicit exports); social cards may serve the previous one while refreshing.
 * `stable`: the picture is a function of its revision alone (a social card), so an image of this revision never goes stale. */
/** `waitMs`: this caller's own bound on waiting for a render (a bounded delegated call), below the cache's default. */
interface ExportCacheRequest { cacheKey:string; artifactId:string; revision:string; refresh?:boolean; current?:boolean; stable?:boolean; waitMs?:number }
/** `objects`: where a produced image's bytes are deleted when its publish is refused (the app's store by default). */
interface ExportCacheOptions { freshMs?:number; leaseMs?:number; waitMs?:number; retryMs?:number; pollMs?:number[]; objects?:Pick<ObjectStore,'delete'> }
export type ExportProducer=(id:string)=>Promise<Omit<ExportImage,'id'|'artifact_id'>>;

class ExportCacheUnavailable extends Error {
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
    // A produced image is stored under its own new key before its row exists. When the row is certainly not written
    // (the image is invalid, or the lease was lost and the transaction wrote nothing) nothing will ever name it, so its
    // bytes go at once. A transaction that failed with an unknown outcome keeps them.
    let unnamed:string|undefined;
    try {
      const details=await produce(token);
      const image:ExportImage={...details,id:token,artifact_id:request.artifactId};
      if(!['image/png','image/jpeg'].includes(image.mime)||![image.bytes,image.width,image.height].every(n=>Number.isSafeInteger(n)&&n>0)){
        unnamed=details.object_key;throw new Error('Invalid export image');
      }
      const accepted=await db.transaction(async tx=>{
        const previous=(await tx.query<{image_id:string|null}>('SELECT image_id FROM export_image_cache WHERE cache_key=$1 FOR UPDATE',[request.cacheKey])).rows[0]?.image_id;
        const accepted=await tx.query(`UPDATE export_image_cache SET image_id=$3,source_revision=$4,
          expires_at=clock_timestamp()+$5::int*interval '1 millisecond',claim_token=NULL,lease_until=NULL,retry_after=NULL
          WHERE cache_key=$1 AND claim_token=$2 AND lease_until>clock_timestamp() RETURNING cache_key`,
          [request.cacheKey,token,image.id,request.revision,freshMs]);
        if(!accepted.rows.length)return null;
        if(previous)await tx.query('UPDATE export_images SET replaced_at=clock_timestamp() WHERE id=$1',[previous]);
        await tx.query('INSERT INTO export_images(id,artifact_id,object_key,mime,bytes,width,height) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [image.id,image.artifact_id,image.object_key,image.mime,image.bytes,image.width,image.height]);
        return image;
      });
      if(!accepted)unnamed=image.object_key;
      return accepted;
    } catch (error) {
      // A producer error with `backoff: false` is a definite answer (a missing slide or element), no fault: the claim is
      // released without a retry window, so the page corrected under the same key renders at once.
      if((error as {backoff?:unknown}|null)?.backoff===false)
        await db.query('UPDATE export_image_cache SET claim_token=NULL,lease_until=NULL WHERE cache_key=$1 AND claim_token=$2',[request.cacheKey,token]);
      else await db.query(`UPDATE export_image_cache SET claim_token=NULL,lease_until=NULL,
        retry_after=clock_timestamp()+$3::int*interval '1 millisecond' WHERE cache_key=$1 AND claim_token=$2`,[request.cacheKey,token,retryMs]);
      throw error;
    } finally {
      if(unnamed)await (options.objects??objectStore()).delete(unnamed).catch(()=>{});
    }
  };
  return {
    async read(request:ExportCacheRequest,produce:ExportProducer):Promise<ExportImage> {
      await db.query('INSERT INTO export_image_cache(cache_key,artifact_id) VALUES($1,$2) ON CONFLICT(cache_key) DO NOTHING',[request.cacheKey,request.artifactId]);
      let state=await snapshot(request.cacheKey);
      const baseline=state.image?.id??null,deadline=performance.now()+Math.min(waitMs,request.waitMs??waitMs);
      let attempt=0;
      for(;;){
        const image=state.image,usable=!!image&&!request.refresh&&(!request.current||state.source_revision===request.revision);
        const refreshed=!request.refresh||image?.id!==baseline;
        if(image&&(state.fresh||request.stable)&&state.source_revision===request.revision&&refreshed)return image;
        if(state.backoff){if(usable)return image!;throw new ExportCacheUnavailable();}
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
          if(usable)return image!;
          let timer:ReturnType<typeof setTimeout>|undefined;
          try {
            const result=await Promise.race([job,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new ExportCacheUnavailable()),Math.max(1,deadline-performance.now()));})]);
            if(result)return result;
          } finally {clearTimeout(timer);}
          state=await snapshot(request.cacheKey);continue;
        }
        if(usable)return image!;
        const remaining=deadline-performance.now();if(remaining<=0)throw new ExportCacheUnavailable();
        const delay=polls[Math.min(attempt++,polls.length-1)]!*(0.9+Math.random()*0.2);
        await new Promise(r=>setTimeout(r,Math.min(delay,remaining)));
        state=await snapshot(request.cacheKey);
      }
    },
    async drain():Promise<void>{await Promise.allSettled([...jobs]);},
  };
}

/** An export image is kept this long after a refresh replaced it: far past any asset grant (5 minutes) naming it. */
const EXPORT_IMAGE_RETENTION_MS=24*60*60*1000;
/** How many images one expiry transaction locks. */
const EXPIRY_CHUNK=25;
/**
 * Expires export images by age: those no cache row points at, replaced more than `retentionMs` ago (an image with no
 * `replaced_at`, from before it existed or never published, counts from its creation), at most `batch` per run,
 * oldest first. A cache row only ever points at the image its own refresh just inserted, so an image no row points at
 * is never pointed at again; counting from the replacement keeps one served until the moment it was replaced, for as
 * long as any grant issued then lives. A few at a time, each object is deleted before its row, in a transaction
 * holding those rows until every delete settled (lib/object-store `deleteHeldObjects`), so a failed delete or a crash
 * leaves rows for the next run, never an object nothing names. Throws, after committing the rest, when a delete failed.
 */
export async function expireExportImages(db:Db,objects:Pick<ObjectStore,'delete'>=objectStore(),{retentionMs=EXPORT_IMAGE_RETENTION_MS,batch=200}:{retentionMs?:number;batch?:number}={}):Promise<string[]>{
  const expired:string[]=[],kept:string[]=[],failed:unknown[]=[];
  for(;;){
    const limit=Math.min(EXPIRY_CHUNK,batch-expired.length-kept.length);if(limit<=0)break;
    const done=await db.transaction(async tx=>{
      const old=(await tx.query<{id:string;object_key:string}>(`SELECT i.id,i.object_key FROM export_images i
        WHERE COALESCE(i.replaced_at,i.created_at)<clock_timestamp()-$1::bigint*interval '1 millisecond'
          AND NOT EXISTS (SELECT 1 FROM export_image_cache c WHERE c.image_id=i.id) AND NOT (i.id=ANY($3::text[]))
        ORDER BY COALESCE(i.replaced_at,i.created_at) LIMIT $2 FOR UPDATE OF i SKIP LOCKED`,[retentionMs,limit,kept])).rows;
      const out=await deleteHeldObjects(tx,objects,old.map(image=>image.object_key));
      const gone=old.filter(image=>out.deleted.includes(image.object_key)).map(image=>image.id);
      if(gone.length)await tx.query('DELETE FROM export_images WHERE id=ANY($1::text[])',[gone]);
      return {old,gone,failed:out.failed};
    });
    expired.push(...done.gone);failed.push(...done.failed);kept.push(...done.old.filter(image=>!done.gone.includes(image.id)).map(image=>image.id));
    if(done.old.length<limit)break;
  }
  if(failed.length)throw failedDeletes('the export image deletes',failed);
  return expired;
}
