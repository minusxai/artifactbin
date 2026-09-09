import type { Db } from '@/lib/db';
import type { CatalogResult } from './execute';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export interface ResultCacheOptions {
  maxBytes?: number;
  maxEntries?: number;
  leaseMs?: number;
  waitMs?: number;
}
export interface ResultCacheRequest {
  ttlSeconds: number;
  refresh?: boolean;
  signal?: AbortSignal;
  /** Must check live authorization/credential binding, including after waits. */
  authorize(): Promise<void>;
}
export interface DatasetResultCache {
  run(key: string, load: () => Promise<CatalogResult>, request: ResultCacheRequest): Promise<CatalogResult>;
}
/** Database-owned cache; no process-global result map, no upstream work in a transaction. */
export function createDatasetResultCache(db: Db, options: ResultCacheOptions = {}): DatasetResultCache {
  const maxBytes = options.maxBytes ?? 32 * 1024 * 1024, maxEntries = options.maxEntries ?? 100;
  const leaseMs = options.leaseMs ?? 15000, waitMs = options.waitMs ?? 16000;
  if (![maxBytes,maxEntries,leaseMs,waitMs].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid cache bounds');
  type Claim = { kind: 'hit'; result: CatalogResult } | { kind: 'owner'; token: string } | { kind: 'wait' } | { kind: 'bypass' };
  // A short table lock makes BOTH aggregate byte and lease bounds atomic across
  // replicas. Only these bounded metadata transactions hold it, never SQL work.
  const acquire = async(key: string, refresh: boolean): Promise<Claim> => {
    if(!refresh){
      // Hot reads and waiters do not serialize behind unrelated fills.
      const row=(await db.query<{result:unknown;fresh:boolean;live:boolean}>(`SELECT result,expires_at>clock_timestamp() AS fresh,lease_until>clock_timestamp() AS live FROM dataset_result_cache WHERE cache_key=$1`,[key])).rows[0];
      if(row?.result!==null&&row?.fresh){const hit=resultSchema.safeParse(row.result);if(hit.success)return {kind:'hit',result:hit.data};}
      if(row&&row.result===null&&row.live)return {kind:'wait'};
    }
    return db.transaction(async tx => {
    await tx.query('LOCK TABLE dataset_result_cache IN EXCLUSIVE MODE');
    await tx.query('DELETE FROM dataset_result_cache WHERE (result IS NOT NULL AND expires_at<=clock_timestamp()) OR (result IS NULL AND lease_until<=clock_timestamp())');
    const row = (await tx.query<{result: unknown; live: boolean}>('SELECT result,lease_until>clock_timestamp() AS live FROM dataset_result_cache WHERE cache_key=$1',[key])).rows[0];
    if (row && !refresh) {
      if (row.result !== null) {
        const result = resultSchema.safeParse(row.result);
        if (result.success) return {kind:'hit',result:result.data};
        await tx.query('DELETE FROM dataset_result_cache WHERE cache_key=$1',[key]);
      } else if (row.live) return {kind:'wait'};
    }
    if (!row) {
      const count = Number((await tx.query<{n:string}>('SELECT count(*) AS n FROM dataset_result_cache')).rows[0].n);
      if (count >= maxEntries) {
        const evicted=await tx.query('DELETE FROM dataset_result_cache WHERE cache_key=(SELECT cache_key FROM dataset_result_cache WHERE result IS NOT NULL ORDER BY updated_at,cache_key LIMIT 1) RETURNING cache_key');
        if (!evicted.rows.length) return {kind:'bypass'};
      }
    }
    const token=randomUUID();
    await tx.query(`INSERT INTO dataset_result_cache(cache_key,owner_token,lease_until) VALUES($1,$2,clock_timestamp()+$3::int*interval '1 millisecond')
      ON CONFLICT(cache_key) DO UPDATE SET result=NULL,bytes=0,expires_at=NULL,owner_token=$2,lease_until=clock_timestamp()+$3::int*interval '1 millisecond',updated_at=clock_timestamp()`,[key,token,leaseMs]);
    return {kind:'owner',token};
    });
  };
  const release = async (key:string,token:string) => { try { await db.query('DELETE FROM dataset_result_cache WHERE cache_key=$1 AND owner_token=$2',[key,token]); } catch { /* disposable cache unavailable */ } };
  const publish = (key:string,token:string,result:CatalogResult,ttl:number):Promise<boolean> => db.transaction(async tx => {
    await tx.query('LOCK TABLE dataset_result_cache IN EXCLUSIVE MODE');
    const owner=await tx.query('SELECT 1 FROM dataset_result_cache WHERE cache_key=$1 AND owner_token=$2 AND lease_until>clock_timestamp()',[key,token]);
    if (!owner.rows.length) return false;
    const json=JSON.stringify(result),bytes=Buffer.byteLength(json);
    if (bytes>maxBytes) {await tx.query('DELETE FROM dataset_result_cache WHERE cache_key=$1 AND owner_token=$2',[key,token]);return true;}
    let total=Number((await tx.query<{bytes:string}>('SELECT COALESCE(sum(bytes),0) AS bytes FROM dataset_result_cache')).rows[0].bytes);
    const victims=await tx.query<{cache_key:string;bytes:number}>('SELECT cache_key,bytes FROM dataset_result_cache WHERE result IS NOT NULL ORDER BY updated_at,cache_key');
    for(const victim of victims.rows) {
      if(total+bytes<=maxBytes)break;
      await tx.query('DELETE FROM dataset_result_cache WHERE cache_key=$1',[victim.cache_key]);total-=victim.bytes;
    }
    const updated=await tx.query(`UPDATE dataset_result_cache SET result=$3::jsonb,bytes=$4,owner_token=NULL,lease_until=NULL,expires_at=clock_timestamp()+$5::double precision*interval '1 second',updated_at=clock_timestamp()
      WHERE cache_key=$1 AND owner_token=$2 AND lease_until>clock_timestamp()`,[key,token,json,bytes,ttl]);
    return updated.rowCount>0;
  });
  return {async run(key,load,request) {
    const authorize=async()=>{request.signal?.throwIfAborted();await request.authorize();request.signal?.throwIfAborted();};
    const uncached=async()=>{const result=await abortable(load(),request.signal);await authorize();return result;};
    await authorize();
    if (!Number.isFinite(request.ttlSeconds) || request.ttlSeconds<=0) return uncached();
    const deadline=performance.now()+waitMs;let refresh=request.refresh===true;
    for(;;) {
      let claim:Claim;
      try {claim=await acquire(key,refresh);} catch {return uncached();}
      refresh=false;
      if(claim.kind==='hit') {await authorize();return claim.result;}
      if(claim.kind==='bypass')return uncached();
      if(claim.kind==='wait') {
        if(performance.now()>=deadline)return uncached();
        await pause(25,request.signal);await authorize();continue;
      }
      const token=claim.token;
      try {
        const result=await abortable(load(),request.signal);await authorize();
        let accepted:boolean;
        try {accepted=await publish(key,token,result,request.ttlSeconds);} catch {return result;}
        if(accepted)return result;
        // A forced refresh/replacement won. The obsolete worker may not
        // repopulate the cache OR return stale data over its winner.
        if(performance.now()>=deadline)return uncached();
      } finally {await release(key,token);}
      await authorize();
    }
  }};
}

const resultSchema: z.ZodType<CatalogResult> = z.object({
  rows:z.array(z.record(z.string(),z.unknown())),
  columns:z.array(z.object({name:z.string(),type:z.enum(['string','number','boolean','date'])}).strict()),
  refreshedAt:z.string(),truncated:z.boolean().optional(),totalRows:z.number().optional(),
}).strict();
function abortable<T>(promise:Promise<T>,signal?:AbortSignal):Promise<T> {
  if(!signal)return promise;
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason ?? new DOMException('Aborted','AbortError'));
    signal.addEventListener('abort',abort,{once:true});
    promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
    if(signal.aborted)abort();
  });
}
function pause(ms:number,signal?:AbortSignal):Promise<void> {
  return new Promise((resolve,reject)=>{
    const done=()=>{signal?.removeEventListener('abort',abort);resolve();};
    const timer=setTimeout(done,ms);
    const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal?.reason ?? new DOMException('Aborted','AbortError'));};
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
}
