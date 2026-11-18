import {expect,it,vi} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import {ObjectUnavailable,objectKey,objectStore} from '@/lib/object-store';
import {startAppBackgroundTasks} from '..';
useAppHarness();
it('stop is idempotent: every call returns the one shutdown promise, which resolves',async()=>{
 const db=await getDb();
 const stop=await startAppBackgroundTasks(db);
 const first=stop(),second=stop();
 expect(second).toBe(first);
 await expect(first).resolves.toBeUndefined();
 expect(stop()).toBe(first);
});
const sweepTick=async(db:Awaited<ReturnType<typeof getDb>>)=>{
 const intervals=vi.spyOn(globalThis,'setInterval');
 const stop=await startAppBackgroundTasks(db);
 const tick=intervals.mock.calls.find(([,ms])=>ms===6*60*60*1000)?.[0] as (()=>void)|undefined;
 intervals.mockRestore();
 expect(tick).toBeTypeOf('function');
 tick!();await stop();
};
const seed=async(db:Awaited<ReturnType<typeof getDb>>)=>{
 const key=objectKey('dataset',JSON.stringify([{n:Math.random()}])),image='exports/objects/old.png';
 await objectStore().put(key,'[]');await objectStore().put(image,'png');
 await db.query("UPDATE object_writes SET due_at=now()-interval '1 second' WHERE key=$1",[key]);
 await db.query("INSERT INTO export_images(id,artifact_id,object_key,mime,bytes,width,height,created_at) VALUES('old','abc123',$1,'image/png',3,1,1,now()-interval '9 days')",[image]);
 return {key,image};
};
it('the storage sweep\'s six-hourly tick deletes an old orphan and an expired export image with their rows',async()=>{
 const db=await getDb(),{key,image}=await seed(db);
 await sweepTick(db);
 await expect(objectStore().get(key)).rejects.toBeInstanceOf(ObjectUnavailable);
 await expect(objectStore().get(image)).rejects.toBeInstanceOf(ObjectUnavailable);
 expect((await db.query('SELECT key FROM object_writes WHERE key=$1',[key])).rows).toEqual([]);
 expect((await db.query("SELECT id FROM export_images WHERE id='old'")).rows).toEqual([]);
});
it('a failed object sweep is logged and still lets the tick expire export images',async()=>{
 const db=await getDb(),{key,image}=await seed(db);
 const failing=new Proxy(db,{get(target,prop){
  if(prop==='query')return async(sql:string,args?:unknown[])=>{if(sql.includes('regexp_matches'))throw new Error('scan failed');return target.query(sql,args);};
  const value=Reflect.get(target,prop);return typeof value==='function'?value.bind(target):value;}});
 const errors=vi.spyOn(console,'error').mockImplementation(()=>{});
 let calls:unknown[][]=[];
 try{await sweepTick(failing);calls=[...errors.mock.calls];}finally{errors.mockRestore();}
 expect(calls.some(([message,error])=>String(message).includes('object sweep')&&(error as Error).message==='scan failed')).toBe(true);
 expect((await objectStore().get(key)).toString()).toBe('[]');
 await expect(objectStore().get(image)).rejects.toBeInstanceOf(ObjectUnavailable);
});
