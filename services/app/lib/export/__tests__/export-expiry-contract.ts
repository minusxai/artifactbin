/**
 * EXPORT IMAGES EXPIRE (../cache expireExportImages), run against each store: by export-expiry.test.ts on the app's
 * filesystem store and by export-expiry-s3.test.ts on a real S3-compatible server. The caller installs the app harness.
 * An image no cache row points at any more is deleted with its row a day after the refresh that replaced it, however
 * old it is, and the pointed one stays; a produced image whose refresh lost its lease is deleted at once, since no row
 * will ever name it; a delete that fails keeps its image's row and object for the next run, and the others go.
 */
import {describe,expect,it} from 'vitest';
import {getDb} from '@/lib/platform';
import {ObjectUnavailable,type ObjectStore} from '@/lib/object-store';
import {createExportCache,expireExportImages} from '../cache';

export function exportExpirySuite(name:string,open:()=>Promise<ObjectStore>){
 describe(`export images on the ${name} store`,()=>{
  const absent=(store:ObjectStore,key:string)=>expect(store.get(key)).rejects.toBeInstanceOf(ObjectUnavailable);
  // The cache's own lease and wait: neither may bound a store write here. A fresh S3-compatible server grows its volumes on
  // a bucket's first write (seconds on CI's SeaweedFS), and a 500ms wait failed this suite whenever it wrote first.
  const options=(objects:ObjectStore)=>({pollMs:[1,2],retryMs:100,objects});
  const producer=(store:ObjectStore,written:string[],delayMs=0)=>async(id:string)=>{
   const object_key=`exports/objects/${id}.png`;await new Promise(r=>setTimeout(r,delayMs));
   await store.put(object_key,Buffer.from('png'),'image/png');written.push(object_key);
   return {object_key,mime:'image/png' as const,bytes:3,width:10,height:10};
  };
  it('expire a day after a refresh replaced them, however old; the pointed one stays',async()=>{
   const store=await open(),db=await getDb(),cache=createExportCache(db,options(store)),written:string[]=[];
   const request={cacheKey:`full:sweep-${name}`,artifactId:'abc123',revision:'r1'};
   const first=await cache.read(request,producer(store,written));
   // Two days old and replaced just now (served until then, perhaps under a fresh grant): kept.
   await db.query("UPDATE export_images SET created_at=now()-interval '2 days'");
   const second=await cache.read({...request,revision:'r2',current:true},producer(store,written));
   expect(await expireExportImages(db,store)).toEqual([]);
   await db.query("UPDATE export_images SET replaced_at=now()-interval '2 days' WHERE id=$1",[first.id]);
   expect(await expireExportImages(db,store)).toEqual([first.id]);
   await absent(store,first.object_key);
   expect((await store.get(second.object_key)).toString()).toBe('png');
   expect((await db.query('SELECT id FROM export_images')).rows).toEqual([{id:second.id}]);
   // The pointed image never expires, however old.
   await db.query("UPDATE export_images SET created_at=now()-interval '9 days'");
   expect(await expireExportImages(db,store)).toEqual([]);
  });
  it('delete a produced image at once when its refresh lost the lease',async()=>{
   const store=await open(),db=await getDb(),cache=createExportCache(db,{...options(store),leaseMs:5,waitMs:200}),written:string[]=[];
   await expect(cache.read({cacheKey:`full:lost-${name}`,artifactId:'abc123',revision:'r1'},producer(store,written,30))).rejects.toThrow();
   await cache.drain();
   expect(written.length).toBeGreaterThan(0);
   for(const key of written)await absent(store,key);
   expect((await db.query('SELECT id FROM export_images')).rows).toEqual([]);
  });
  it('keep the row and object of an image whose delete fails, delete the others, and delete it on the next run',async()=>{
   const store=await open(),db=await getDb(),ids=['a','b','c'].map(n=>`${n}${Math.random().toString(16).slice(2)}`);
   for(const id of ids){
    await store.put(`exports/objects/${id}.png`,'png','image/png');
    await db.query("INSERT INTO export_images(id,artifact_id,object_key,mime,bytes,width,height,created_at) VALUES($1,'abc123',$2,'image/png',3,1,1,now()-interval '9 days')",[id,`exports/objects/${id}.png`]);
   }
   const failing=`exports/objects/${ids[1]}.png`;
   const refusing:Pick<ObjectStore,'delete'>={async delete(key){if(key===failing)throw new Error('delete refused');await store.delete(key);}};
   await expect(expireExportImages(db,refusing)).rejects.toThrow(/delete refused/);
   expect((await db.query<{id:string}>('SELECT id FROM export_images')).rows).toEqual([{id:ids[1]}]);
   expect((await store.get(failing)).toString()).toBe('png');
   for(const id of [ids[0]!,ids[2]!])await absent(store,`exports/objects/${id}.png`);
   expect(await expireExportImages(db,store)).toEqual([ids[1]]);
   await absent(store,failing);
  });
 });
}
