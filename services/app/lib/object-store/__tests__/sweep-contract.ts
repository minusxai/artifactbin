/**
 * THE OBJECT SWEEP's contract (../sweep header), run against each store: by sweep.test.ts on the filesystem store and by
 * sweep-s3.test.ts on a real S3-compatible server, the way store-contract.ts is shared. The caller installs the app
 * harness (`useAppHarness`); `open` returns the bare store the sweep deletes from, never the app's `objectStore()`.
 *
 * An orphan older than the margin goes and a young one stays; an old orphan written again (before the sweep, or between
 * its scan and its delete) stays; a recorded key never stored loses its row; a delete that fails keeps its object's row
 * for the next run and the others go; a reference scan that fails deletes nothing; an object of every swept kind that a
 * published row references stays, however old its record.
 */
import {describe,expect,it} from 'vitest';
import {mintAccountToken,request} from '@/__tests__/harness';
import {getDb,type Db} from '@/lib/platform';
import {POST as create} from '@/app/api/artifacts/route';
import {ObjectUnavailable,objectKey,objectStore,recordObjectWrites,sweepObjects,type ObjectStore} from '..';
import {forgetRecordedWrites,recordedWrites} from '../sweep';

export const age=async(key:string)=>{await (await getDb()).query("UPDATE object_writes SET due_at=now()-interval '1 second' WHERE key=$1",[key]);};
export const dueAt=async(key:string)=>(await (await getDb()).query<{due_at:Date}>('SELECT due_at FROM object_writes WHERE key=$1',[key])).rows[0]?.due_at;
export const unique=()=>JSON.stringify([{n:Math.random()}]);
export const absent=(store:Pick<ObjectStore,'get'>,key:string)=>expect(store.get(key)).rejects.toBeInstanceOf(ObjectUnavailable);
/** The 1x1 PNG the image tier accepts. */
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==','base64');
const PDF=Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R >> endobj\n%%EOF\n');

export function sweepSuite(name:string,open:()=>Promise<ObjectStore>){
 describe(`the sweep on the ${name} store`,()=>{
  it('deletes an orphan older than the margin and keeps one within it',async()=>{
   const raw=await open(),store=recordedWrites(raw),db=await getDb();
   const old=objectKey('dataset',unique()),young=objectKey('dataset',unique());
   await store.put(old,'[]','application/json');await store.put(young,'[]','application/json');
   await age(old);
   expect(await sweepObjects(db,raw)).toEqual({deleted:[old],kept:0});
   await absent(raw,old);expect((await raw.get(young)).toString()).toBe('[]');
   expect(await dueAt(old)).toBeUndefined();expect(await dueAt(young)).toBeDefined();
   // Restartable: a second run finds nothing due and deletes nothing.
   expect(await sweepObjects(db,raw)).toEqual({deleted:[],kept:0});
  });
  it('keeps an orphan written again between its reference scan and its delete (the recheck under the row lock)',async()=>{
   const raw=await open(),store=recordedWrites(raw),key=objectKey('file',unique()),db=await getDb();
   await store.put(key,'bytes');await age(key);
   // The write lands after the sweep found no reference and before it locks the row to delete.
   let raced=false;
   const racing=new Proxy(db,{get(target,prop){
    if(prop==='transaction')return async(work:Parameters<typeof db.transaction>[0])=>{if(!raced){raced=true;forgetRecordedWrites();await store.put(key,'bytes');}return target.transaction(work);};
    const value=Reflect.get(target,prop);return typeof value==='function'?value.bind(target):value;}});
   expect(await sweepObjects(racing,raw)).toEqual({deleted:[],kept:0});
   expect(raced).toBe(true);expect((await raw.get(key)).toString()).toBe('bytes');
  });
  it('drops the row of a recorded key whose object was never stored, as a failed write leaves it',async()=>{
   const raw=await open(),key=objectKey('pdf',unique());
   await recordObjectWrites([key]);await age(key);
   expect(await sweepObjects(await getDb(),raw)).toEqual({deleted:[key],kept:0});
   expect(await dueAt(key)).toBeUndefined();
  });
  it('keeps an old orphan that is written again, identical bytes and all, just before the sweep',async()=>{
   const raw=await open(),store=recordedWrites(raw),key=objectKey('image',unique());
   await store.put(key,'bytes');await age(key);
   // Another process (nothing recorded here) writes the same content-addressed object again.
   forgetRecordedWrites();await store.put(key,'bytes');
   expect((await sweepObjects(await getDb(),raw)).deleted).toEqual([]);
   expect((await raw.get(key)).toString()).toBe('bytes');
  });
  it('keeps the row and object of a delete that fails, deletes the others, and deletes it on the next run',async()=>{
   const raw=await open(),store=recordedWrites(raw),db=await getDb();
   const failing=objectKey('dataset',unique()),others=[objectKey('dataset',unique()),objectKey('file',unique())];
   for(const key of [failing,...others]){await store.put(key,'[]');await age(key);}
   const refusing:Pick<ObjectStore,'delete'>={async delete(key){if(key===failing)throw new Error('delete refused');await raw.delete(key);}};
   await expect(sweepObjects(db,refusing)).rejects.toThrow(/delete refused/);
   expect((await raw.get(failing)).toString()).toBe('[]');expect(await dueAt(failing)).toBeDefined();
   for(const key of others){await absent(raw,key);expect(await dueAt(key)).toBeUndefined();}
   expect(await sweepObjects(db,raw)).toEqual({deleted:[failing],kept:0});
   await absent(raw,failing);expect(await dueAt(failing)).toBeUndefined();
  });
  it('deletes nothing when the reference scan fails',async()=>{
   const raw=await open(),store=recordedWrites(raw),key=objectKey('image',unique()),db=await getDb();
   await store.put(key,'bytes');await age(key);const due=await dueAt(key);
   const failing=new Proxy(db,{get(target,prop){
    if(prop==='query')return async(sql:string,args?:unknown[])=>{if(sql.includes('regexp_matches')&&sql.includes('artifact_versions'))throw new Error('scan failed');return target.query(sql,args);};
    const value=Reflect.get(target,prop);return typeof value==='function'?value.bind(target):value;}}) as Db;
   const deleting:Pick<ObjectStore,'delete'>={async delete(deleted){throw new Error(`deleted ${deleted}`);}};
   await expect(sweepObjects(failing,deleting)).rejects.toThrow('scan failed');
   expect((await raw.get(key)).toString()).toBe('bytes');expect(await dueAt(key)).toEqual(due);
  });
  it('keeps an object of every swept kind that a published row references, however old its record',async()=>{
   const raw=await open(),token=await mintAccountToken(`sweep-kinds-${name}`);
   const bodies={
    dataset:{dataset:[{city:'Lagos',n:Math.random()}]},
    image:{image:`data:image/png;base64,${PNG.toString('base64')}`},
    pdf:{pdf:`data:application/pdf;base64,${PDF.toString('base64')}`},
    file:{file:{filename:'notes.txt',contentType:'text/plain',base64:Buffer.from(unique()).toString('base64')}},
   };
   const keys:string[]=[];
   for(const [kind,body] of Object.entries(bodies)){
    const made=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{visibility:'private',...body}}));
    expect(made.status,await made.clone().text()).toBe(201);
    const id=(await made.json() as {id:string}).id;
    const key=(await (await getDb()).query<{key:string}>("SELECT meta->>'objectKey' AS key FROM artifacts WHERE id=$1",[id])).rows[0]!.key;
    expect(key.startsWith(`${kind}/`),key).toBe(true);keys.push(key);
   }
   // The publish stored its bytes in the app's store; the same keys are the ones this store would delete.
   for(const key of keys){await raw.put(key,await objectStore().get(key));await age(key);}
   const swept=await sweepObjects(await getDb(),raw);
   expect(swept).toEqual({deleted:[],kept:keys.length});
   for(const key of keys){expect((await raw.get(key)).equals(await objectStore().get(key))).toBe(true);expect(new Date((await dueAt(key))!).getTime()).toBeGreaterThan(Date.now()+29*24*60*60*1000);}
  });
 });
}
