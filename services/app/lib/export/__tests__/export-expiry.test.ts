/**
 * EXPORT IMAGES EXPIRE (./cache expireExportImages): an image no cache row points at any more is deleted with its row
 * once older than the retention, the pointed one stays; a produced image whose refresh lost its lease is deleted at
 * once, since no row will ever name it.
 */
import {describe,expect,it} from 'vitest';
import {useAppHarness} from '@/__tests__/harness';
import {getDb} from '@/lib/platform';
import {ObjectUnavailable,objectStore} from '@/lib/object-store';
import {createExportCache,expireExportImages} from '../cache';

useAppHarness();
const absent=(key:string)=>expect(objectStore().get(key)).rejects.toBeInstanceOf(ObjectUnavailable);
describe('export images',()=>{
 const options={leaseMs:1000,waitMs:500,pollMs:[1,2],retryMs:100};
 const producer=(written:string[],delayMs=0)=>async(id:string)=>{
  const object_key=`exports/objects/${id}.png`;await new Promise(r=>setTimeout(r,delayMs));
  await objectStore().put(object_key,Buffer.from('png'),'image/png');written.push(object_key);
  return {object_key,mime:'image/png' as const,bytes:3,width:10,height:10};
 };
 it('expire by age once no cache row points at them; the pointed one stays',async()=>{
  const db=await getDb(),cache=createExportCache(db,options),written:string[]=[];
  const request={cacheKey:'full:sweep',artifactId:'abc123',revision:'r1'};
  const first=await cache.read(request,producer(written));
  const second=await cache.read({...request,revision:'r2',current:true},producer(written));
  await db.query("UPDATE export_images SET created_at=now()-interval '2 days'");
  expect(await expireExportImages(db)).toEqual([first.id]);
  await absent(first.object_key);
  expect((await objectStore().get(second.object_key)).toString()).toBe('png');
  expect((await db.query('SELECT id FROM export_images')).rows).toEqual([{id:second.id}]);
  // Within the retention an unpointed image stays.
  const third=await cache.read({...request,revision:'r3',current:true},producer(written));
  expect(await expireExportImages(db)).toEqual([second.id]);expect(third.id).not.toBe(second.id);
  expect(await expireExportImages(db)).toEqual([]);
 });
 it('delete a produced image at once when its refresh lost the lease',async()=>{
  const db=await getDb(),cache=createExportCache(db,{...options,leaseMs:5,waitMs:200}),written:string[]=[];
  await expect(cache.read({cacheKey:'full:lost',artifactId:'abc123',revision:'r1'},producer(written,30))).rejects.toThrow();
  await cache.drain();
  expect(written.length).toBeGreaterThan(0);
  for(const key of written)await absent(key);
  expect((await db.query('SELECT id FROM export_images')).rows).toEqual([]);
 });
});
