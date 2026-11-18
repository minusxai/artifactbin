/**
 * The store itself, exercised through its real interface.
 *
 * The local backend is tested against a real temp directory (publication fault injection
 * still uses real filesystem operations). The S3 backend is held to the SAME contract
 * (store-contract.ts) against a real S3-compatible server in store-s3.test.ts, which CI's
 * integration job runs; that is the point of the abstraction: if the two ever diverge, the
 * app behaves differently on a laptop than in production.
 */
import { describe, it, expect, vi, onTestFinished } from 'vitest';
import { readdir } from 'fs/promises';
import path from 'path';
import { ObjectUnavailable, cachedReads, objectKey, resetReadCache, uniqueObjectKey, createLocalStore, parseS3Url, storageKeyFor, type ObjectStore } from '../index';
import { contractSuite, streamSuite } from './store-contract';
import {tempDir} from '@artifactbin/test-support/temp-dir';

// Fault injection still writes/truncates real files. Pause before bytes finish so a reader deterministically
// observes the publication boundary; an atomic writer's temporary file is not the reader's destination.
const publication = vi.hoisted(() => ({active:false,fail:false,rejectIdenticalRename:false,rejectRename:false,reached:()=>{},pending:Promise.resolve()}));
const mockedFs = vi.hoisted(() => async () => {
  const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  const writing = async (truncate:()=>Promise<void>,finish:()=>Promise<void>) => {
    if (!publication.active) return finish();
    await truncate(); publication.reached(); await publication.pending;
    if (publication.fail) throw new Error('simulated disk write failure');
    await finish();
  };
  return {
    ...real,
    rename: async (...args:Parameters<typeof real.rename>) => {
      if (publication.rejectRename) throw Object.assign(new Error('Windows denied replacing an open object'),{code:'EPERM'});
      if (publication.rejectIdenticalRename) {
        const existing=await real.readFile(args[1]).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return null;throw error;});
        if (existing?.equals(await real.readFile(args[0]))) throw Object.assign(new Error('Windows denied replacing an identical open object'),{code:'EPERM'});
      }
      return real.rename(...args);
    },
    writeFile: (...args:Parameters<typeof real.writeFile>) => writing(() => real.writeFile(args[0], ''), () => real.writeFile(...args)),
    open: async (...args:Parameters<typeof real.open>) => {
      const handle = await real.open(...args);
      if (typeof args[1] !== 'string' || !args[1].includes('w')) return handle;
      return new Proxy(handle, {get(target,key) {
        if (key === 'writeFile') return (...writeArgs:Parameters<typeof handle.writeFile>) => writing(() => handle.writeFile(''), () => handle.writeFile(...writeArgs));
        const value = Reflect.get(target,key,target); return typeof value === 'function' ? value.bind(target) : value;
      }});
    },
  };
});
vi.mock('fs/promises', () => mockedFs());
vi.mock('node:fs/promises', () => mockedFs());

function pausePublication(fail=false) {
  let reached!:()=>void,release!:()=>void;
  const ready=new Promise<void>(resolve=>{reached=resolve;});
  publication.active=true;publication.fail=fail;publication.reached=reached;
  publication.pending=new Promise<void>(resolve=>{release=resolve;});
  return {ready,release:()=>{publication.active=false;release();}};
}

describe('object keys', () => {
  it('are content-addressed, so identical bytes reuse one object', () => {
    expect(objectKey('dataset', 'a,b\n1,2')).toBe(objectKey('dataset', 'a,b\n1,2'));
    expect(objectKey('dataset', 'a,b\n1,2')).not.toBe(objectKey('dataset', 'a,b\n1,3'));
  });

  it('namespace by kind, so unrelated content cannot collide', () => {
    expect(objectKey('dataset', 'x')).not.toBe(objectKey('image', 'x'));
    expect(objectKey('dataset', 'x').startsWith('dataset/')).toBe(true);
  });

  it('are safe as paths — no slashes or dots from the digest', () => {
    const key = objectKey('dataset', 'x');
    expect(key.split('/')).toHaveLength(2);
    expect(key).not.toMatch(/\.\./);
  });

  it('unique keys never repeat', () => {
    expect(uniqueObjectKey('dataset')).not.toBe(uniqueObjectKey('dataset'));
  });
});

// ── local filesystem backend ────────────────────────────────────────────────
contractSuite('local', async () => {
  const dir = await tempDir('ab-objects-',onTestFinished);
  return createLocalStore(dir);
});

describe('local backend refuses to escape its root', () => {
  it('rejects a traversing key rather than writing outside the store', async () => {
    const dir = await tempDir('ab-objects-',onTestFinished);
    const store = createLocalStore(dir);
    await expect(store.put('../escaped', 'x')).rejects.toThrow(/outside the object store/);
    await expect(store.get('../../etc/passwd')).rejects.toThrow(/outside the object store/);
  });
});

describe('the prefix is actually applied to stored keys', () => {
  /**
   * The prefix is the ONLY thing stopping a dev machine writing over
   * production objects — both point at the same bucket — and an assertion that
   * needs a live server runs only where one is (store-s3.test.ts, in CI's integration job).
   *
   * The rule is a pure function (storageKeyFor), so THIS runs always and
   * deleting the prefix logic fails it. The round trip against a server is in store-s3.test.ts.
   */
  it('composes <prefix>/<key> from the configured URL — always, no server needed', () => {
    const prod = parseS3Url('s3://key:secret@s3.example.com/shared-bucket/artifacts');
    const dev = parseS3Url('s3://key:secret@s3.example.com/shared-bucket/artifacts-dev');
    expect(prod.bucket).toBe('shared-bucket');
    expect(dev.bucket).toBe(prod.bucket); // the SAME bucket: only the prefix separates them
    expect(storageKeyFor(prod, 'dataset/abc123')).toBe('artifacts/dataset/abc123');
    expect(storageKeyFor(dev, 'dataset/abc123')).toBe('artifacts-dev/dataset/abc123');
    // Two environments must never resolve one key to one object.
    expect(storageKeyFor(dev, 'dataset/abc123')).not.toBe(storageKeyFor(prod, 'dataset/abc123'));
  });

  it('leaves the key alone when the URL names no prefix (bucket root)', () => {
    const bare = parseS3Url('s3://key:secret@s3.example.com/just-a-bucket');
    expect(bare.prefix).toBe('');
    expect(storageKeyFor(bare, 'dataset/abc123')).toBe('dataset/abc123');
  });

});

/*
 * ── THE STREAMING READ ───────────────────────────────────────────────────────
 *
 * A 25 MB PDF read through `get` is +25 MB of RSS for the life of the response
 * and, worse, would be admitted to the read cache and evict essentially all of
 * it — the cache that exists so datasets and ref images are not
 * refetched on every render. So the PDF tier reads
 * through `getStream`, which buffers nothing and caches nothing, and the
 * cache's own budget never has to move.
 */
describe('getStream', () => {
  streamSuite('local', async () => {
    const dir = await tempDir('ab-stream-',onTestFinished);
    return createLocalStore(dir);
  });


  it('never enters the read cache, so a big object cannot evict what the cache is for', async () => {
    resetReadCache();
    const dir = await tempDir('ab-stream-cache-',onTestFinished);
    const fs = createLocalStore(dir);
    let gets = 0;
    const counted: ObjectStore = { ...fs, get: (key) => { gets += 1; return fs.get(key); } };
    const store = cachedReads(counted);

    // A 25 MB object — the tier's cap, and comfortably under the 32 MB the
    // cache would otherwise admit it at.
    const big = Buffer.alloc(25 * 1024 * 1024, 0x41);
    await store.put('pdf/big', big);
    await store.put('dataset/small', 'a,b\n1,2');

    // The small object is read ONCE and stays cached — before…
    expect((await store.get('dataset/small')).toString()).toBe('a,b\n1,2');
    expect(gets).toBe(1);

    /*
     * DRAINED, not collected: this is what the raw route does (the stream goes
     * to the socket), and it is the only shape in which the number measures the
     * STORE rather than the consumer — accumulating the chunks holds 25 MB by
     * itself, which is exactly the cost being avoided.
     *
     * The BOUNDED CHUNK is the deterministic half of "never read whole": the
     * object arrives 64 KB at a time and no single buffer is ever the file.
     *
     * WHAT IS NOT ASSERTED, and why. A memory figure was tried and removed:
     * `process.memoryUsage()` is PROCESS-wide, so in a full run a neighbouring
     * test file's allocations land in the same number and the assertion fails
     * for a reason that is not this store (measured: +14 MB of arrayBuffers
     * with a sibling file in the worker, against a +2.6 MB bound that held
     * three runs out of three alone). Forcing a collection did not make it
     * reliable either.
     *
     * The numbers themselves, measured once with --expose-gc on this machine
     * and recorded here rather than gated: a whole 25 MB `get` costs +26.2 MB
     * of arrayBuffers and 0.0 MB of RSS; the drained stream costs +0.1 MB of
     * arrayBuffers and +21.2 MB of RSS (uncollected 64 KB buffers). RSS is
     * about V8's allocator, arrayBuffers about how much is held at once — and
     * NEITHER is a number this suite can hold steady, while both assertions
     * below are exact. The bounded chunk is what caught the reviewer's break.
     */
    const drain = async () => {
      let bytes = 0;
      let widest = 0;
      for await (const chunk of await store.getStream('pdf/big')) {
        bytes += (chunk as Uint8Array).byteLength;
        widest = Math.max(widest, (chunk as Uint8Array).byteLength);
      }
      return { bytes, widest };
    };
    const drained = await drain();
    expect(drained.bytes).toBe(big.byteLength);
    // Never one buffer holding the file: 64 KB at a time, whatever the size.
    expect(drained.widest).toBeLessThanOrEqual(1024 * 1024);

    // The small object is still cached AFTER the big read: the stream went
    // nowhere near `get`, so the cache never saw 25 MB to evict for.
    expect((await store.get('dataset/small')).toString()).toBe('a,b\n1,2');
    expect(gets).toBe(1);


  });
});

describe('local objects publish complete bytes', () => {
  it('keeps old bytes visible to get and getStream until the replacement is published', async () => {
    const dir=await tempDir('ab-publish-',onTestFinished);const store=createLocalStore(dir);
    await store.put('islands/module','complete old module');
    const pause=pausePublication(),pending=store.put('islands/module','complete new module');await pause.ready;
    try {
      const bytes=(await store.get('islands/module')).toString();
      const stream=await store.getStream('islands/module');const parts:Buffer[]=[];for await(const part of stream)parts.push(Buffer.from(part));
      expect({bytes,stream:Buffer.concat(parts).toString()}).toEqual({bytes:'complete old module',stream:'complete old module'});
    } finally {pause.release();await pending;}
    expect((await store.get('islands/module')).toString()).toBe('complete new module');
    expect(await readdir(path.join(dir,'islands'))).toEqual(['module']);
  });

  it('keeps a new object absent until its complete bytes are published', async () => {
    const dir=await tempDir('ab-publish-new-',onTestFinished);const store=createLocalStore(dir);
    const pause=pausePublication(),pending=store.put('islands/module','complete module');await pause.ready;
    try {await expect(store.get('islands/module')).rejects.toBeInstanceOf(ObjectUnavailable);}
    finally {pause.release();await pending;}
    expect((await store.get('islands/module')).toString()).toBe('complete module');
  });

  it('preserves an existing object and removes temporary bytes when replacement fails', async () => {
    const dir=await tempDir('ab-publish-fail-',onTestFinished);const store=createLocalStore(dir);
    await store.put('islands/module','complete old module');
    const pause=pausePublication(true),pending=store.put('islands/module','complete new module');await pause.ready;pause.release();
    await expect(pending).rejects.toThrow('simulated disk write failure');
    expect((await store.get('islands/module')).toString()).toBe('complete old module');
    expect(await readdir(path.join(dir,'islands'))).toEqual(['module']);
  });
});


it('publishes the same cache key concurrently without replacing identical existing bytes',async()=>{
  const dir=await tempDir('ab-publish-identical-',onTestFinished);
  const first=createLocalStore(dir),second=createLocalStore(dir),bytes=Buffer.from('complete compiled module');
  await first.put('islands/module',bytes);
  // Deterministic Windows sharing violation: replacing this existing immutable object is denied.
  // Two store instances and concurrent callers must reuse it, without weakening differing-byte replacement.
  publication.rejectIdenticalRename=true;
  try {
    const writes=await Promise.allSettled(Array.from({length:12},(_,i)=>(i%2?first:second).put('islands/module',bytes)));
    expect(writes.every(write=>write.status==='fulfilled'),JSON.stringify(writes)).toBe(true);
  }finally{publication.rejectIdenticalRename=false;}
  expect(await first.get('islands/module')).toEqual(bytes);
  expect(await readdir(path.join(dir,'islands'))).toEqual(['module']);
});

it('publishes concurrent first writers of identical bytes as one complete object',async()=>{
  const dir=await tempDir('ab-publish-race-',onTestFinished);
  const stores=[createLocalStore(dir),createLocalStore(dir)],bytes=Buffer.from('complete SSR module');
  await Promise.all(Array.from({length:12},(_,i)=>stores[i%2]!.put('islands-ssr/module',bytes)));
  expect(await stores[0]!.get('islands-ssr/module')).toEqual(bytes);
  expect(await readdir(path.join(dir,'islands-ssr'))).toEqual(['module']);
});

it('reports a denied differing-byte replacement and preserves the existing complete object',async()=>{
  const dir=await tempDir('ab-publish-denied-',onTestFinished);
  const store=createLocalStore(dir);
  await store.put('islands/module','old compiled module');
  publication.rejectRename=true;
  try {await expect(store.put('islands/module','new compiled module')).rejects.toMatchObject({code:'EPERM'});}
  finally {publication.rejectRename=false;}
  expect((await store.get('islands/module')).toString()).toBe('old compiled module');
  expect(await readdir(path.join(dir,'islands'))).toEqual(['module']);
});
